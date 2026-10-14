from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, inspect

from echospace_api.db import Base
from echospace_api.main import run_migrations

TABLES = {
    "projects",
    "users",
    "project_members",
    "sessions",
    "session_events",
    "sensor_configurations",
    "scenes",
    "recordings",
    "datasets",
    "dataset_manifests",
    "models",
    "model_versions",
    "experiments",
    "experiment_metrics",
    "artifacts",
    "audit_events",
}


def test_upgrade_head_on_fresh_sqlite(tmp_path: Path) -> None:
    url = f"sqlite:///{tmp_path / 'fresh.db'}"
    run_migrations(url)
    insp = inspect(create_engine(url))
    tables = set(insp.get_table_names())
    assert tables >= TABLES and "alembic_version" in tables
    # The migration matches the ORM metadata (same tables and columns).
    for name, table in Base.metadata.tables.items():
        assert {c["name"] for c in insp.get_columns(name)} == {c.name for c in table.columns}, name
    fks = {(fk["referred_table"], tuple(fk["constrained_columns"])) for fk in insp.get_foreign_keys("experiments")}
    assert ("artifacts", ("payload_artifact_id",)) in fks and ("projects", ("project_id",)) in fks
    # Running it again is a no-op.
    run_migrations(url)


def test_downgrade_to_base(tmp_path: Path) -> None:
    from alembic import command
    from alembic.config import Config

    from echospace_api.main import MIGRATIONS_DIR

    url = f"sqlite:///{tmp_path / 'down.db'}"
    run_migrations(url)
    cfg = Config(str(MIGRATIONS_DIR.parent / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.attributes["database_url"] = url
    cfg.attributes["configure_logger"] = False
    command.downgrade(cfg, "base")
    assert set(inspect(create_engine(url)).get_table_names()) <= {"alembic_version"}
