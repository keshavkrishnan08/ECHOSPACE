"""Experiment records submitted by the web app (or any client producing ExperimentRecord JSON).

Scalar fields, the configuration and the metric summaries are stored in the database; the
metric series, events and mid-run configuration changes (unbounded in size) are stored as one
JSON artifact in the object store. GET reassembles the original record.
"""

from __future__ import annotations

import json
import re
import uuid
from hashlib import sha256
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import Artifact, Experiment, ExperimentMetric, ProjectMember, User
from ..deps import Ctx, CurrentUser, Db, audit, require_member
from ..hashing import sha256_json
from ..schemas import ArtifactOut, ExperimentCreated, ExperimentRecord, ExperimentSummary
from ..storage import ObjectNotFoundError, ObjectStore

router = APIRouter()

_SAFE_ID = re.compile(r"^[A-Za-z0-9._\-]{1,100}$")


def object_key(project_id: str, experiment_id: str) -> str:
    part = experiment_id if _SAFE_ID.match(experiment_id) else "h-" + sha256(experiment_id.encode()).hexdigest()[:32]
    pid = project_id if _SAFE_ID.match(project_id) else "h-" + sha256(project_id.encode()).hexdigest()[:32]
    return f"projects/{pid}/experiments/{part}/payload.json"


def artifact_out(a: Artifact) -> ArtifactOut:
    return ArtifactOut(
        id=a.id,
        key=a.key,
        kind=a.kind,
        format=a.format,
        content_type=a.content_type,
        size_bytes=a.size_bytes,
        sha256=a.sha256,
        provenance=a.provenance,
        retention_until=a.retention_until,
        created_at=a.created_at,
    )


def _summary(e: Experiment) -> ExperimentSummary:
    return ExperimentSummary.model_validate(
        {
            "id": e.id,
            "name": e.name,
            "projectId": e.project_id,
            "sourceMode": e.source_mode,
            "engine": e.engine,
            "modelId": e.model_id,
            "modelVersion": e.model_version,
            "status": e.status,
            "startedAt": e.started_at,
            "endedAt": e.ended_at,
            "simulatedDurationS": e.simulated_duration_s,
            "frames": e.frames,
            "configHash": e.config_hash,
            "scenario": e.config.get("scenario", ""),
            "tags": e.tags,
            "summaries": [_metric(m) for m in e.metrics],
        }
    )


def _metric(m: ExperimentMetric) -> dict[str, Any]:
    return {
        "id": m.metric_id,
        "n": m.n,
        "mean": m.mean,
        "median": m.median,
        "p95": m.p95,
        "min": m.min,
        "max": m.max,
        "last": m.last,
    }


def reassemble(db: Session, store: ObjectStore, e: Experiment) -> dict[str, Any]:
    art = db.get(Artifact, e.payload_artifact_id)
    payload: dict[str, Any] = {"series": [], "events": [], "configChanges": []}
    if art is not None:
        try:
            payload = json.loads(store.get_bytes(art.key))
        except ObjectNotFoundError as err:
            raise HTTPException(status_code=500, detail=f"payload object of experiment {e.id} is missing") from err
    record = {
        "schemaVersion": e.schema_version,
        "id": e.id,
        "name": e.name,
        "notes": e.notes,
        "projectId": e.project_id,
        "sourceMode": e.source_mode,
        "config": e.config,
        "configHash": e.config_hash,
        "modelId": e.model_id,
        "modelVersion": e.model_version,
        "preprocessingVersion": e.preprocessing_version,
        "engine": e.engine,
        "inferenceDevice": e.inference_device,
        "softwareVersion": e.software_version,
        "machine": e.machine,
        "status": e.status,
        "startedAt": e.started_at,
        "endedAt": e.ended_at,
        "simulatedDurationS": e.simulated_duration_s,
        "frames": e.frames,
        "replayDigest": e.replay_digest,
        "replayDigestFrames": e.replay_digest_frames,
        "liveRunReproducible": e.live_run_reproducible,
        "summaries": [_metric(m) for m in e.metrics],
        "series": payload["series"],
        "events": payload["events"],
        "configChanges": payload["configChanges"],
        "tags": e.tags,
        "baselineOf": e.baseline_of,
    }
    return ExperimentRecord.model_validate(record).dump()


def _visible_projects(db: Session, user: User) -> list[str]:
    return list(db.scalars(select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)))


@router.get("/api/experiments")
def list_experiments(
    db: Db,
    user: CurrentUser,
    ctx: Ctx,
    full: bool = Query(default=False, description="return full ExperimentRecords instead of summaries"),
    project_id: str | None = Query(default=None, alias="projectId"),
) -> dict[str, Any]:
    if project_id is not None:
        require_member(db, user, project_id)
        projects = [project_id]
    else:
        projects = _visible_projects(db, user)
    rows = db.scalars(
        select(Experiment).where(Experiment.project_id.in_(projects)).order_by(Experiment.started_at.desc())
    ).all()
    if full:
        return {"items": [reassemble(db, ctx.store, e) for e in rows]}
    return {"items": [_summary(e).dump() for e in rows]}


@router.post("/api/experiments", status_code=201, response_model=ExperimentCreated, response_model_by_alias=True)
def create_experiment(
    record: ExperimentRecord, response: Response, db: Db, user: CurrentUser, ctx: Ctx
) -> ExperimentCreated:
    require_member(db, user, record.project_id)
    data = record.dump()
    digest = sha256_json(data)
    existing = db.get(Experiment, record.id)
    if existing is not None:
        if existing.project_id != record.project_id:
            require_member(db, user, existing.project_id)
        if existing.content_sha256 != digest:
            raise HTTPException(
                status_code=409,
                detail=f"experiment {record.id!r} already exists with different content; records are immutable",
            )
        response.status_code = 200
        art = db.get(Artifact, existing.payload_artifact_id)
        assert art is not None
        return ExperimentCreated(id=existing.id, created=False, payload_artifact=artifact_out(art))

    payload = {"series": data["series"], "events": data["events"], "configChanges": data["configChanges"]}
    key = object_key(record.project_id, record.id)
    stored = ctx.store.put_bytes(key, json.dumps(payload, separators=(",", ":")).encode(), "application/json")
    art = Artifact(
        id=f"art_{uuid.uuid4().hex[:16]}",
        project_id=record.project_id,
        key=key,
        kind="experiment-payload",
        format="echospace-experiment-payload+json",
        content_type="application/json",
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        provenance={
            "experimentId": record.id,
            "engine": record.engine,
            "softwareVersion": record.software_version,
            "configHash": record.config_hash,
            "schemaVersion": record.schema_version,
        },
    )
    db.add(art)
    db.flush()
    exp = Experiment(
        id=record.id,
        project_id=record.project_id,
        user_id=user.id,
        schema_version=record.schema_version,
        name=record.name,
        notes=record.notes,
        source_mode=record.source_mode,
        engine=record.engine,
        model_id=record.model_id,
        model_version=record.model_version,
        preprocessing_version=record.preprocessing_version,
        inference_device=record.inference_device,
        software_version=record.software_version,
        status=record.status,
        started_at=record.started_at,
        ended_at=record.ended_at,
        simulated_duration_s=record.simulated_duration_s,
        frames=record.frames,
        config=data["config"],
        config_hash=record.config_hash,
        replay_digest=record.replay_digest,
        replay_digest_frames=record.replay_digest_frames,
        live_run_reproducible=record.live_run_reproducible,
        machine=data["machine"],
        tags=record.tags,
        baseline_of=record.baseline_of,
        content_sha256=digest,
        payload_artifact_id=art.id,
    )
    exp.metrics = [
        ExperimentMetric(
            position=i,
            metric_id=m.id,
            n=m.n,
            mean=m.mean,
            median=m.median,
            p95=m.p95,
            min=m.min,
            max=m.max,
            last=m.last,
        )
        for i, m in enumerate(record.summaries)
    ]
    db.add(exp)
    audit(db, user, record.project_id, "experiment.create", "experiment", record.id, payloadBytes=stored.size_bytes)
    try:
        db.commit()
    except Exception:
        db.rollback()
        ctx.store.delete(key)
        raise
    return ExperimentCreated(id=exp.id, created=True, payload_artifact=artifact_out(art))


def _load(db: Session, user: User, experiment_id: str) -> Experiment:
    e = db.get(Experiment, experiment_id)
    if e is None:
        raise HTTPException(status_code=404, detail=f"experiment {experiment_id!r} not found")
    require_member(db, user, e.project_id)
    return e


@router.get("/api/experiments/{experiment_id}")
def get_experiment(experiment_id: str, db: Db, user: CurrentUser, ctx: Ctx) -> dict[str, Any]:
    return reassemble(db, ctx.store, _load(db, user, experiment_id))


@router.delete("/api/experiments/{experiment_id}", status_code=204)
def delete_experiment(experiment_id: str, db: Db, user: CurrentUser, ctx: Ctx) -> Response:
    e = _load(db, user, experiment_id)
    art = db.get(Artifact, e.payload_artifact_id)
    db.delete(e)
    db.flush()
    if art is not None:
        db.delete(art)
    audit(db, user, e.project_id, "experiment.delete", "experiment", experiment_id)
    db.commit()
    if art is not None:
        ctx.store.delete(art.key)
    return Response(status_code=204)
