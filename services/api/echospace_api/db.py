"""Database engine, session factory and ORM models (SQLAlchemy 2.0).

Large arrays are never stored in rows. Anything bigger than a summary (metric series, frame
dumps, uploaded recordings, experiment payloads) goes to the object store and is referenced by an
``artifacts`` row holding key, format, size, SHA-256 and provenance.

Retention: ``artifacts.retention_until`` and ``recordings.retention_until`` mark when raw data
may be purged (set from RAW_RETENTION_DAYS for uploaded recordings; NULL = keep). The purge job in
:mod:`echospace_api.retention` deletes the object and the row and writes an audit event.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any, ClassVar

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """Timezone-aware UTC datetimes on every backend (SQLite returns naive values otherwise)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC) if value is not None else None

    def process_result_value(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value


class Base(DeclarativeBase):
    type_annotation_map: ClassVar[dict[Any, Any]] = {dict[str, Any]: JSON, list[Any]: JSON}


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, nullable=False)


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    username: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), default="")


class Project(TimestampMixin, Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")


class ProjectMember(TimestampMixin, Base):
    __tablename__ = "project_members"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(String(32), default="owner")


class SensorConfiguration(TimestampMixin, Base):
    __tablename__ = "sensor_configurations"
    __table_args__ = (UniqueConstraint("project_id", "geometry_key"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    geometry_key: Mapped[str] = mapped_column(String(1000), nullable=False)
    room: Mapped[dict[str, Any]] = mapped_column(JSON)
    sensors: Mapped[list[Any]] = mapped_column(JSON)


class Scene(TimestampMixin, Base):
    __tablename__ = "scenes"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    scenario: Mapped[str] = mapped_column(String(16))
    config: Mapped[dict[str, Any]] = mapped_column(JSON)
    config_hash: Mapped[str] = mapped_column(String(16), index=True)


class SessionRow(TimestampMixin, Base):
    __tablename__ = "sessions"
    __table_args__ = (Index("ix_sessions_project_status", "project_id", "status"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    scene_id: Mapped[str | None] = mapped_column(ForeignKey("scenes.id", ondelete="SET NULL"), nullable=True)
    sensor_configuration_id: Mapped[str | None] = mapped_column(
        ForeignKey("sensor_configurations.id", ondelete="SET NULL"), nullable=True
    )
    source_mode: Mapped[str] = mapped_column(String(16))
    engine: Mapped[str] = mapped_column(String(32), default="python-reference")
    status: Mapped[str] = mapped_column(String(16), default="created")
    """created | running | stopped | failed"""
    scenario: Mapped[str] = mapped_column(String(16))
    seed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    config: Mapped[dict[str, Any]] = mapped_column(JSON)
    config_hash: Mapped[str] = mapped_column(String(16))
    pace: Mapped[str] = mapped_column(String(16), default="realtime")
    authorized: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_note: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    frames_produced: Mapped[int] = mapped_column(Integer, default=0)
    frames_dropped: Mapped[int] = mapped_column(Integer, default=0)
    metrics_artifact_id: Mapped[str | None] = mapped_column(
        ForeignKey("artifacts.id", ondelete="SET NULL"), nullable=True
    )
    events: Mapped[list[SessionEvent]] = relationship(
        back_populates="session", cascade="all, delete-orphan", passive_deletes=True
    )


class SessionEvent(TimestampMixin, Base):
    __tablename__ = "session_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    t: Mapped[float | None] = mapped_column(Float, nullable=True)
    """Stream time of the event, seconds (None for lifecycle events)."""
    kind: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(16), default="info")
    message: Mapped[str] = mapped_column(Text)
    session: Mapped[SessionRow] = relationship(back_populates="events")


class Artifact(TimestampMixin, Base):
    __tablename__ = "artifacts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(32))
    """experiment-payload | recording-raw | session-metrics | model-weights"""
    format: Mapped[str] = mapped_column(String(64))
    content_type: Mapped[str] = mapped_column(String(128), default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    retention_until: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True, index=True)


class Recording(TimestampMixin, Base):
    __tablename__ = "recordings"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(200))
    source_mode: Mapped[str] = mapped_column(String(16))
    format: Mapped[str] = mapped_column(String(64))
    sample_rate_hz: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    consent: Mapped[bool] = mapped_column(Boolean, nullable=False)
    consent_note: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id", ondelete="RESTRICT"))
    retention_until: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True, index=True)


class Dataset(TimestampMixin, Base):
    __tablename__ = "datasets"
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    source: Mapped[str] = mapped_column(String(32))


class DatasetManifestRow(TimestampMixin, Base):
    __tablename__ = "dataset_manifests"
    __table_args__ = (UniqueConstraint("dataset_id", "version"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    version: Mapped[str] = mapped_column(String(32))
    checksum: Mapped[str | None] = mapped_column(String(128), nullable=True)
    manifest: Mapped[dict[str, Any]] = mapped_column(JSON)


class ModelRow(TimestampMixin, Base):
    __tablename__ = "models"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    family: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16))


class ModelVersion(TimestampMixin, Base):
    __tablename__ = "model_versions"
    __table_args__ = (UniqueConstraint("model_id", "version"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_id: Mapped[str] = mapped_column(ForeignKey("models.id", ondelete="CASCADE"), index=True)
    version: Mapped[str] = mapped_column(String(32))
    preprocessing_version: Mapped[str] = mapped_column(String(32))
    card: Mapped[dict[str, Any]] = mapped_column(JSON)
    weights_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    """SHA-256 of the weights file the card refers to, when one exists."""


class Experiment(TimestampMixin, Base):
    __tablename__ = "experiments"
    __table_args__ = (Index("ix_experiments_project_started", "project_id", "started_at"),)
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    schema_version: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str] = mapped_column(Text, default="")
    source_mode: Mapped[str] = mapped_column(String(16))
    engine: Mapped[str] = mapped_column(String(32))
    model_id: Mapped[str] = mapped_column(String(64), index=True)
    model_version: Mapped[str] = mapped_column(String(32))
    preprocessing_version: Mapped[str] = mapped_column(String(32))
    inference_device: Mapped[str] = mapped_column(String(200))
    software_version: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16))
    started_at: Mapped[str] = mapped_column(String(40))
    """ISO-8601 string exactly as submitted (the record is reproduced byte-for-byte on read)."""
    ended_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    simulated_duration_s: Mapped[float] = mapped_column(Float)
    frames: Mapped[int] = mapped_column(Integer)
    config: Mapped[dict[str, Any]] = mapped_column(JSON)
    config_hash: Mapped[str] = mapped_column(String(16), index=True)
    replay_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    replay_digest_frames: Mapped[int] = mapped_column(Integer, default=0)
    live_run_reproducible: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    machine: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    tags: Mapped[list[Any]] = mapped_column(JSON, default=list)
    baseline_of: Mapped[str | None] = mapped_column(String(128), nullable=True)
    content_sha256: Mapped[str] = mapped_column(String(64))
    """SHA-256 of the canonical JSON of the full record, used for idempotent re-submission."""
    payload_artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id", ondelete="RESTRICT"))
    metrics: Mapped[list[ExperimentMetric]] = relationship(
        back_populates="experiment",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ExperimentMetric.position",
    )


class ExperimentMetric(Base):
    __tablename__ = "experiment_metrics"
    __table_args__ = (UniqueConstraint("experiment_id", "metric_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    metric_id: Mapped[str] = mapped_column(String(64))
    n: Mapped[int] = mapped_column(Integer)
    mean: Mapped[float | None] = mapped_column(Float, nullable=True)
    median: Mapped[float | None] = mapped_column(Float, nullable=True)
    p95: Mapped[float | None] = mapped_column(Float, nullable=True)
    min: Mapped[float | None] = mapped_column(Float, nullable=True)
    max: Mapped[float | None] = mapped_column(Float, nullable=True)
    last: Mapped[float | None] = mapped_column(Float, nullable=True)
    experiment: Mapped[Experiment] = relationship(back_populates="metrics")


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_target", "target_type", "target_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(64))
    target_type: Mapped[str] = mapped_column(String(32))
    target_id: Mapped[str] = mapped_column(String(128))
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


def make_engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        engine = create_engine(url, connect_args={"check_same_thread": False})

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn: Any, _record: Any) -> None:
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.close()

        return engine
    return create_engine(url, pool_pre_ping=True)


class Database:
    def __init__(self, url: str) -> None:
        self.url = url
        self.engine = make_engine(url)
        self.sessionmaker = sessionmaker(self.engine, expire_on_commit=False)

    def session(self) -> Session:
        return self.sessionmaker()

    def scoped(self) -> Iterator[Session]:
        with self.sessionmaker() as s:
            yield s
