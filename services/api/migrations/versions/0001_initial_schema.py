"""Initial schema: projects, users, sessions, recordings, datasets, models, experiments, artifacts, audit.

Revision ID: 0001
Revises:
Create Date: 2026-10-14 19:58:09.473349
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=True),
        sa.Column("project_id", sa.String(length=64), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=32), nullable=False),
        sa.Column("target_id", sa.String(length=128), nullable=False),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("audit_events", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_audit_events_at"), ["at"], unique=False)
        batch_op.create_index("ix_audit_target", ["target_type", "target_id"], unique=False)

    op.create_table(
        "datasets",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "models",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("family", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("username", sa.String(length=128), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username"),
    )
    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("project_id", sa.String(length=64), nullable=False),
        sa.Column("key", sa.String(length=512), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("format", sa.String(length=64), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("provenance", sa.JSON(), nullable=False),
        sa.Column("retention_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )
    with op.batch_alter_table("artifacts", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_artifacts_project_id"), ["project_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_artifacts_retention_until"), ["retention_until"], unique=False)

    op.create_table(
        "dataset_manifests",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("dataset_id", sa.String(length=128), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("checksum", sa.String(length=128), nullable=True),
        sa.Column("manifest", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dataset_id", "version"),
    )
    with op.batch_alter_table("dataset_manifests", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_dataset_manifests_dataset_id"), ["dataset_id"], unique=False)

    op.create_table(
        "model_versions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("model_id", sa.String(length=64), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("preprocessing_version", sa.String(length=32), nullable=False),
        sa.Column("card", sa.JSON(), nullable=False),
        sa.Column("weights_sha256", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["model_id"], ["models.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("model_id", "version"),
    )
    with op.batch_alter_table("model_versions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_model_versions_model_id"), ["model_id"], unique=False)

    op.create_table(
        "project_members",
        sa.Column("project_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "user_id"),
    )
    op.create_table(
        "scenes",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("project_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("scenario", sa.String(length=16), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("config_hash", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("scenes", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_scenes_config_hash"), ["config_hash"], unique=False)
        batch_op.create_index(batch_op.f("ix_scenes_project_id"), ["project_id"], unique=False)

    op.create_table(
        "sensor_configurations",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("project_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("geometry_key", sa.String(length=1000), nullable=False),
        sa.Column("room", sa.JSON(), nullable=False),
        sa.Column("sensors", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "geometry_key"),
    )
    with op.batch_alter_table("sensor_configurations", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_sensor_configurations_project_id"), ["project_id"], unique=False)

    op.create_table(
        "experiments",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("project_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("source_mode", sa.String(length=16), nullable=False),
        sa.Column("engine", sa.String(length=32), nullable=False),
        sa.Column("model_id", sa.String(length=64), nullable=False),
        sa.Column("model_version", sa.String(length=32), nullable=False),
        sa.Column("preprocessing_version", sa.String(length=32), nullable=False),
        sa.Column("inference_device", sa.String(length=200), nullable=False),
        sa.Column("software_version", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("started_at", sa.String(length=40), nullable=False),
        sa.Column("ended_at", sa.String(length=40), nullable=True),
        sa.Column("simulated_duration_s", sa.Float(), nullable=False),
        sa.Column("frames", sa.Integer(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("config_hash", sa.String(length=16), nullable=False),
        sa.Column("replay_digest", sa.String(length=64), nullable=True),
        sa.Column("replay_digest_frames", sa.Integer(), nullable=False),
        sa.Column("machine", sa.JSON(), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("baseline_of", sa.String(length=128), nullable=True),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("payload_artifact_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["payload_artifact_id"], ["artifacts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("experiments", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_experiments_config_hash"), ["config_hash"], unique=False)
        batch_op.create_index(batch_op.f("ix_experiments_model_id"), ["model_id"], unique=False)
        batch_op.create_index("ix_experiments_project_started", ["project_id", "started_at"], unique=False)

    op.create_table(
        "sessions",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("project_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("scene_id", sa.String(length=64), nullable=True),
        sa.Column("sensor_configuration_id", sa.String(length=64), nullable=True),
        sa.Column("source_mode", sa.String(length=16), nullable=False),
        sa.Column("engine", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("scenario", sa.String(length=16), nullable=False),
        sa.Column("seed", sa.Integer(), nullable=True),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("config_hash", sa.String(length=16), nullable=False),
        sa.Column("pace", sa.String(length=16), nullable=False),
        sa.Column("authorized", sa.Boolean(), nullable=False),
        sa.Column("consent_note", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("frames_produced", sa.Integer(), nullable=False),
        sa.Column("frames_dropped", sa.Integer(), nullable=False),
        sa.Column("metrics_artifact_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["metrics_artifact_id"], ["artifacts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["scene_id"], ["scenes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["sensor_configuration_id"], ["sensor_configurations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("sessions", schema=None) as batch_op:
        batch_op.create_index("ix_sessions_project_status", ["project_id", "status"], unique=False)
        batch_op.create_index(batch_op.f("ix_sessions_user_id"), ["user_id"], unique=False)

    op.create_table(
        "experiment_metrics",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("experiment_id", sa.String(length=128), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("metric_id", sa.String(length=64), nullable=False),
        sa.Column("n", sa.Integer(), nullable=False),
        sa.Column("mean", sa.Float(), nullable=True),
        sa.Column("median", sa.Float(), nullable=True),
        sa.Column("p95", sa.Float(), nullable=True),
        sa.Column("min", sa.Float(), nullable=True),
        sa.Column("max", sa.Float(), nullable=True),
        sa.Column("last", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("experiment_id", "metric_id"),
    )
    with op.batch_alter_table("experiment_metrics", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_experiment_metrics_experiment_id"), ["experiment_id"], unique=False)

    op.create_table(
        "recordings",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("project_id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=True),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("source_mode", sa.String(length=16), nullable=False),
        sa.Column("format", sa.String(length=64), nullable=False),
        sa.Column("sample_rate_hz", sa.Float(), nullable=True),
        sa.Column("duration_s", sa.Float(), nullable=True),
        sa.Column("consent", sa.Boolean(), nullable=False),
        sa.Column("consent_note", sa.Text(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("artifact_id", sa.String(length=64), nullable=False),
        sa.Column("retention_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["artifact_id"], ["artifacts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("recordings", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_recordings_project_id"), ["project_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_recordings_retention_until"), ["retention_until"], unique=False)

    op.create_table(
        "session_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("t", sa.Float(), nullable=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("session_events", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_session_events_session_id"), ["session_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("session_events", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_session_events_session_id"))

    op.drop_table("session_events")
    with op.batch_alter_table("recordings", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_recordings_retention_until"))
        batch_op.drop_index(batch_op.f("ix_recordings_project_id"))

    op.drop_table("recordings")
    with op.batch_alter_table("experiment_metrics", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_experiment_metrics_experiment_id"))

    op.drop_table("experiment_metrics")
    with op.batch_alter_table("sessions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_sessions_user_id"))
        batch_op.drop_index("ix_sessions_project_status")

    op.drop_table("sessions")
    with op.batch_alter_table("experiments", schema=None) as batch_op:
        batch_op.drop_index("ix_experiments_project_started")
        batch_op.drop_index(batch_op.f("ix_experiments_model_id"))
        batch_op.drop_index(batch_op.f("ix_experiments_config_hash"))

    op.drop_table("experiments")
    with op.batch_alter_table("sensor_configurations", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_sensor_configurations_project_id"))

    op.drop_table("sensor_configurations")
    with op.batch_alter_table("scenes", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_scenes_project_id"))
        batch_op.drop_index(batch_op.f("ix_scenes_config_hash"))

    op.drop_table("scenes")
    op.drop_table("project_members")
    with op.batch_alter_table("model_versions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_model_versions_model_id"))

    op.drop_table("model_versions")
    with op.batch_alter_table("dataset_manifests", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_dataset_manifests_dataset_id"))

    op.drop_table("dataset_manifests")
    with op.batch_alter_table("artifacts", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_artifacts_retention_until"))
        batch_op.drop_index(batch_op.f("ix_artifacts_project_id"))

    op.drop_table("artifacts")
    op.drop_table("users")
    op.drop_table("projects")
    op.drop_table("models")
    op.drop_table("datasets")
    with op.batch_alter_table("audit_events", schema=None) as batch_op:
        batch_op.drop_index("ix_audit_target")
        batch_op.drop_index(batch_op.f("ix_audit_events_at"))

    op.drop_table("audit_events")
