"""Projects, sessions, simulations and scenario presets."""

from __future__ import annotations

import asyncio
import json
import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from echospace_sim import load_preset
from echospace_sim.config import ScenarioConfig

from ..catalog import scenarios
from ..db import Artifact, Project, ProjectMember, Scene, SensorConfiguration, SessionRow, User
from ..deps import AppContext, Ctx, CurrentUser, Db, audit, current_user, get_ctx, require_member
from ..hashing import stable_hash
from ..metrics_catalog import METRICS
from ..runtime import SessionNotStartableError
from ..schemas import (
    ProjectOut,
    ScenarioOut,
    SessionCreate,
    SessionMetricsOut,
    SessionOut,
    SimulationCreate,
    SimulationRestart,
)

router = APIRouter()


def geometry_key(cfg: ScenarioConfig) -> str:
    """Same key as ``geometryKey`` in packages/engine/src/recon/ridge.ts."""

    def fx(v: float) -> str:
        return f"{Decimal(v).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):f}"

    r = cfg.room
    sensors = ";".join(",".join(fx(v) for v in s.position) for s in cfg.sensors if s.enabled)
    return f"{fx(r.width)}x{fx(r.depth)}x{fx(r.height)}|{sensors}"


def session_out(row: SessionRow, ctx: AppContext) -> SessionOut:
    rt = ctx.sessions.get(row.id)
    return SessionOut(
        id=row.id,
        project_id=row.project_id,
        source_mode=row.source_mode,  # type: ignore[arg-type]
        engine=row.engine,
        status=row.status,
        state=rt.state if rt else "idle",
        scenario=row.scenario,
        seed=row.seed,
        model_id=row.config["recon"]["modelId"],
        config_hash=row.config_hash,
        pace=row.pace,
        authorized=row.authorized,
        created_at=row.created_at,
        started_at=row.started_at,
        stopped_at=row.stopped_at,
        frames_produced=rt.frames_produced if rt else row.frames_produced,
        frames_dropped=rt.dropped_total() if rt else row.frames_dropped,
        subscribers=len(rt.subscribers) if rt else 0,
        ws_path=f"/ws/sessions/{row.id}",
    )


def _create_session(
    db: Session,
    user: User,
    *,
    project_id: str,
    source_mode: str,
    cfg: ScenarioConfig,
    pace: str,
    authorized: bool,
    consent_note: str,
) -> SessionRow:
    require_member(db, user, project_id)
    config = cfg.to_json_dict()
    chash = stable_hash(config)
    gkey = geometry_key(cfg)
    sensor_cfg = db.scalar(
        select(SensorConfiguration).where(
            SensorConfiguration.project_id == project_id, SensorConfiguration.geometry_key == gkey
        )
    )
    if sensor_cfg is None:
        sensor_cfg = SensorConfiguration(
            id=f"sc_{uuid.uuid4().hex[:16]}",
            project_id=project_id,
            geometry_key=gkey,
            name=f"{cfg.room.width:g}×{cfg.room.depth:g} m, {sum(s.enabled for s in cfg.sensors)} nodes",
            room=config["room"],
            sensors=config["sensors"],
        )
        db.add(sensor_cfg)
    scene = Scene(
        id=f"scn_{uuid.uuid4().hex[:16]}",
        project_id=project_id,
        name=cfg.name,
        scenario=cfg.scenario,
        config=config,
        config_hash=chash,
    )
    db.add(scene)
    row = SessionRow(
        id=f"ses_{uuid.uuid4().hex[:16]}",
        project_id=project_id,
        user_id=user.id,
        scene_id=scene.id,
        sensor_configuration_id=sensor_cfg.id,
        source_mode=source_mode,
        engine="python-reference",
        status="created",
        scenario=cfg.scenario,
        seed=cfg.seed if source_mode == "synthetic" else None,
        config=config,
        config_hash=chash,
        pace=pace,
        authorized=authorized,
        consent_note=consent_note,
    )
    db.add(row)
    audit(
        db,
        user,
        project_id,
        "session.create",
        "session",
        row.id,
        sourceMode=source_mode,
        configHash=chash,
        authorized=authorized,
    )
    db.commit()
    return row


def _load_session(db: Session, user: User, session_id: str) -> SessionRow:
    row = db.get(SessionRow, session_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"session {session_id!r} not found")
    require_member(db, user, row.project_id)
    return row


@router.get("/api/projects")
def list_projects(db: Db, user: CurrentUser) -> dict[str, Any]:
    rows = db.execute(
        select(Project, ProjectMember.role)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == user.id)
        .order_by(Project.created_at)
    ).all()
    items = [
        ProjectOut(id=p.id, name=p.name, description=p.description, created_at=p.created_at, role=role).dump()
        for p, role in rows
    ]
    return {"items": items}


@router.post("/api/sessions", status_code=201, response_model=SessionOut, response_model_by_alias=True)
def create_session(body: SessionCreate, db: Db, user: CurrentUser, ctx: Ctx) -> SessionOut:
    if body.source_mode == "hardware" and not (body.authorized and body.consent_note.strip()):
        audit(db, user, body.project_id, "session.reject", "session", "-", reason="hardware without authorization")
        db.commit()
        raise HTTPException(
            status_code=403,
            detail="hardware sessions require authorized=true and a consentNote describing who consented to capture",
        )
    row = _create_session(
        db,
        user,
        project_id=body.project_id,
        source_mode=body.source_mode,
        cfg=body.config,
        pace=body.pace,
        authorized=body.authorized,
        consent_note=body.consent_note,
    )
    return session_out(row, ctx)


@router.get("/api/sessions/{session_id}", response_model=SessionOut, response_model_by_alias=True)
def get_session(session_id: str, db: Db, user: CurrentUser, ctx: Ctx) -> SessionOut:
    return session_out(_load_session(db, user, session_id), ctx)


async def _with_db(request: Request, fn: Any) -> Any:
    """Runs a synchronous DB function with a fresh session in a worker thread."""
    ctx = get_ctx(request)

    def run() -> Any:
        with ctx.db.session() as s:
            return fn(s, current_user(s))

    return await asyncio.to_thread(run)


@router.post("/api/sessions/{session_id}/start", response_model=SessionOut, response_model_by_alias=True)
async def start_session(session_id: str, request: Request) -> SessionOut:
    ctx = get_ctx(request)
    row = await _with_db(request, lambda s, u: _load_session(s, u, session_id))
    if row.status in ("stopped", "failed"):
        raise HTTPException(status_code=409, detail=f"session is {row.status}; create a new session or restart it")
    try:
        await ctx.sessions.start(row)
    except SessionNotStartableError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    row = await _with_db(request, lambda s, u: _load_session(s, u, session_id))
    return session_out(row, ctx)


@router.post("/api/sessions/{session_id}/stop", response_model=SessionOut, response_model_by_alias=True)
async def stop_session(session_id: str, request: Request) -> SessionOut:
    ctx = get_ctx(request)
    await _with_db(request, lambda s, u: _load_session(s, u, session_id))
    await ctx.sessions.stop(session_id)

    def finish(s: Session, u: User) -> SessionRow:
        row = _load_session(s, u, session_id)
        audit(s, u, row.project_id, "session.stop", "session", row.id, framesProduced=row.frames_produced)
        s.commit()
        return row

    return session_out(await _with_db(request, finish), ctx)


@router.get("/api/sessions/{session_id}/metrics", response_model=SessionMetricsOut, response_model_by_alias=True)
def session_metrics(session_id: str, db: Db, user: CurrentUser, ctx: Ctx) -> SessionMetricsOut:
    row = _load_session(db, user, session_id)
    rt = ctx.sessions.get(session_id)
    if rt is not None:
        series = rt.series_json()
    elif row.metrics_artifact_id:
        art = db.get(Artifact, row.metrics_artifact_id)
        series = json.loads(ctx.store.get_bytes(art.key))["series"] if art else []
    else:
        series = []
    return SessionMetricsOut.model_validate(
        {
            "sessionId": session_id,
            "definitions": [METRICS[s["id"]] for s in series if s["id"] in METRICS],
            "series": series,
        }
    )


@router.get("/api/scenarios")
def list_scenarios() -> dict[str, Any]:
    return {"items": [ScenarioOut.model_validate(s).dump() for s in scenarios()]}


@router.post("/api/simulations", status_code=201, response_model=SessionOut, response_model_by_alias=True)
def create_simulation(body: SimulationCreate, db: Db, user: CurrentUser, ctx: Ctx) -> SessionOut:
    cfg = load_preset(body.scenario) if body.scenario else body.config
    assert cfg is not None
    if body.seed is not None:
        cfg = ScenarioConfig.model_validate({**cfg.to_json_dict(), "seed": body.seed})
    row = _create_session(
        db,
        user,
        project_id=body.project_id,
        source_mode="synthetic",
        cfg=cfg,
        pace=body.pace,
        authorized=False,
        consent_note="",
    )
    return session_out(row, ctx)


@router.post("/api/simulations/{session_id}/restart", response_model=SessionOut, response_model_by_alias=True)
async def restart_simulation(session_id: str, request: Request, body: SimulationRestart | None = None) -> SessionOut:
    ctx = get_ctx(request)
    row = await _with_db(request, lambda s, u: _load_session(s, u, session_id))
    if row.source_mode != "synthetic":
        raise HTTPException(status_code=409, detail="only synthetic sessions can be restarted")
    await ctx.sessions.restart(row, body.seed if body else None)

    def finish(s: Session, u: User) -> SessionRow:
        r = _load_session(s, u, session_id)
        audit(s, u, r.project_id, "simulation.restart", "session", r.id, seed=r.seed)
        s.commit()
        return r

    return session_out(await _with_db(request, finish), ctx)
