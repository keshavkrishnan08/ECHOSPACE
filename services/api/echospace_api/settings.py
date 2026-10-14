"""Service configuration, read from environment variables (and an optional ``.env`` file)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./var/echospace.db"
    """SQLAlchemy URL. Postgres: ``postgresql+psycopg://user:pass@host:5432/echospace``."""

    object_store: Literal["local", "s3"] = "local"
    object_store_dir: Path = Path("./var/objects")
    """Root directory of the local object store."""
    s3_endpoint: str | None = None
    """S3-compatible endpoint (e.g. MinIO ``http://minio:9000``); None for AWS S3."""
    s3_bucket: str = "echospace"
    s3_region: str = "us-east-1"
    # AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are read by boto3 itself.

    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:3000"])
    """Comma-separated list of allowed browser origins."""

    raw_retention_days: int = Field(default=30, ge=1)
    """Uploaded raw recordings are deleted this many days after upload (see retention_until)."""
    max_upload_mb: int = Field(default=512, ge=1)
    log_level: str = "INFO"

    ws_queue_maxsize: int = Field(default=32, ge=1, le=4096)
    """Per-connection outbound queue length; the oldest droppable messages are dropped when full."""
    timing_every_frames: int = Field(default=10, ge=1)

    auto_migrate: bool = True
    """Run ``alembic upgrade head`` on startup (convenient for local SQLite; disable in production)."""

    models_dir: Path = REPO_ROOT / "models"
    datasets_dir: Path = REPO_ROOT / "datasets" / "manifests"
    native_dir: Path = REPO_ROOT / "engine" / "python"

    local_username: str = "local"
    """Name of the single local user (local auth mode)."""

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def database_kind(self) -> Literal["sqlite", "postgresql"]:
        return "postgresql" if self.database_url.startswith("postgresql") else "sqlite"


@lru_cache
def get_settings() -> Settings:
    return Settings()
