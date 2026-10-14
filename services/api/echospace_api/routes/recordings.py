"""Upload and deletion of raw recordings.

An upload is a multipart form with two parts: ``metadata`` (JSON, :class:`RecordingMetadata`)
and ``file`` (the raw bytes). ``consent`` must be true, otherwise the upload is refused before
any bytes are stored. The raw file goes to the object store with a retention deadline
(RAW_RETENTION_DAYS or ``retentionDays``); DELETE removes the object and the rows and leaves an
audit event.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import ValidationError
from sqlalchemy import select

from ..db import Artifact, Recording, SessionRow
from ..deps import Ctx, CurrentUser, Db, audit, require_member
from ..schemas import RecordingMetadata, RecordingOut
from ..storage import ObjectTooLargeError
from .experiments import artifact_out

router = APIRouter()


def recording_out(r: Recording, a: Artifact) -> RecordingOut:
    return RecordingOut(
        id=r.id,
        project_id=r.project_id,
        session_id=r.session_id,
        name=r.name,
        source_mode=r.source_mode,
        format=r.format,
        sample_rate_hz=r.sample_rate_hz,
        duration_s=r.duration_s,
        consent=r.consent,
        consent_note=r.consent_note,
        metadata=r.meta,
        retention_until=r.retention_until,
        created_at=r.created_at,
        artifact=artifact_out(a),
    )


@router.post("/api/recordings", status_code=201, response_model=RecordingOut, response_model_by_alias=True)
def upload_recording(
    metadata: Annotated[str, Form(description="RecordingMetadata as JSON")],
    file: Annotated[UploadFile, File(description="raw recording bytes")],
    db: Db,
    user: CurrentUser,
    ctx: Ctx,
) -> RecordingOut:
    try:
        meta = RecordingMetadata.model_validate_json(metadata)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors(include_url=False, include_context=False)) from e
    require_member(db, user, meta.project_id)
    if not meta.consent:
        audit(db, user, meta.project_id, "recording.reject", "recording", "-", reason="consent not given")
        db.commit()
        raise HTTPException(status_code=403, detail="upload refused: explicit consent (consent=true) is required")
    if meta.source_mode == "hardware" and not meta.consent_note.strip():
        raise HTTPException(status_code=403, detail="hardware recordings require a consentNote")
    if meta.session_id is not None:
        s = db.get(SessionRow, meta.session_id)
        if s is None or s.project_id != meta.project_id:
            raise HTTPException(status_code=422, detail="sessionId does not refer to a session in this project")

    rid = f"rec_{uuid.uuid4().hex[:16]}"
    ext = meta.format.lower()
    key = f"projects/{meta.project_id}/recordings/{rid}/raw.{ext}"
    try:
        stored = ctx.store.put_stream(
            key, file.file, file.content_type or "application/octet-stream", ctx.settings.max_upload_mb * 1024 * 1024
        )
    except ObjectTooLargeError as e:
        raise HTTPException(status_code=413, detail=str(e)) from e
    days = meta.retention_days or ctx.settings.raw_retention_days
    until = datetime.now(UTC) + timedelta(days=days)
    art = Artifact(
        id=f"art_{uuid.uuid4().hex[:16]}",
        project_id=meta.project_id,
        key=key,
        kind="recording-raw",
        format=meta.format,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        provenance={
            "recordingId": rid,
            "uploadedBy": user.id,
            "originalFilename": file.filename,
            "sourceMode": meta.source_mode,
        },
        retention_until=until,
    )
    rec = Recording(
        id=rid,
        project_id=meta.project_id,
        session_id=meta.session_id,
        user_id=user.id,
        name=meta.name,
        source_mode=meta.source_mode,
        format=meta.format,
        sample_rate_hz=meta.sample_rate_hz,
        duration_s=meta.duration_s,
        consent=True,
        consent_note=meta.consent_note,
        meta=meta.metadata,
        artifact_id=art.id,
        retention_until=until,
    )
    db.add(art)
    db.flush()
    db.add(rec)
    audit(
        db,
        user,
        meta.project_id,
        "recording.upload",
        "recording",
        rid,
        sizeBytes=stored.size_bytes,
        sha256=stored.sha256,
        retentionUntil=until.isoformat(),
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        ctx.store.delete(key)
        raise
    return recording_out(rec, art)


@router.get("/api/recordings")
def list_recordings(
    db: Db, user: CurrentUser, project_id: str = Query(default="default", alias="projectId")
) -> dict[str, Any]:
    require_member(db, user, project_id)
    rows = db.execute(
        select(Recording, Artifact)
        .join(Artifact, Artifact.id == Recording.artifact_id)
        .where(Recording.project_id == project_id)
        .order_by(Recording.created_at.desc())
    ).all()
    return {"items": [recording_out(r, a).dump() for r, a in rows]}


@router.delete("/api/recordings/{recording_id}", status_code=204)
def delete_recording(recording_id: str, db: Db, user: CurrentUser, ctx: Ctx) -> Response:
    rec = db.get(Recording, recording_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"recording {recording_id!r} not found")
    require_member(db, user, rec.project_id)
    art = db.get(Artifact, rec.artifact_id)
    key = art.key if art else None
    db.delete(rec)
    db.flush()
    if art is not None:
        db.delete(art)
    audit(db, user, rec.project_id, "recording.delete", "recording", recording_id, objectKey=key)
    db.commit()
    if key is not None:
        ctx.store.delete(key)
    return Response(status_code=204)
