"""Retention: deletes raw artifacts whose ``retention_until`` has passed.

Runs once at startup and then hourly inside the API process. Each deletion removes the object,
the artifact row and any recording row referencing it, and writes an audit event.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import select

from .db import Artifact, AuditEvent, Database, Recording
from .storage import ObjectStore

log = logging.getLogger(__name__)
INTERVAL_S = 3600


def purge_expired(db: Database, store: ObjectStore, now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    purged = 0
    with db.session() as s:
        expired = s.scalars(
            select(Artifact).where(Artifact.retention_until.is_not(None), Artifact.retention_until < now)
        ).all()
        for art in expired:
            for rec in s.scalars(select(Recording).where(Recording.artifact_id == art.id)).all():
                s.delete(rec)
            s.flush()
            store.delete(art.key)
            s.delete(art)
            s.add(
                AuditEvent(
                    action="retention.purge",
                    target_type="artifact",
                    target_id=art.id,
                    project_id=art.project_id,
                    details={
                        "key": art.key,
                        "retentionUntil": art.retention_until.isoformat() if art.retention_until else None,
                    },
                )
            )
            purged += 1
        s.commit()
    if purged:
        log.info("purged expired artifacts", extra={"count": purged})
    return purged


async def retention_loop(db: Database, store: ObjectStore) -> None:
    while True:
        try:
            await asyncio.to_thread(purge_expired, db, store)
        except Exception:
            log.exception("retention purge failed")
        await asyncio.sleep(INTERVAL_S)
