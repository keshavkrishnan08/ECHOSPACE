"""FastAPI application factory.

uvicorn echospace_api.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from echospace_telemetry import configure_tracing

from . import __version__
from .catalog import sync_catalog
from .db import Database
from .deps import AppContext, seed_defaults
from .observability import RequestContextMiddleware, configure_logging
from .retention import retention_loop
from .routes import catalog, experiments, recordings, sessions, system, ws
from .runtime import SessionManager
from .settings import Settings, get_settings
from .storage import make_object_store

log = logging.getLogger(__name__)
MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"


def run_migrations(database_url: str) -> None:
    """``alembic upgrade head`` against ``database_url`` (used by AUTO_MIGRATE and the tests)."""
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(MIGRATIONS_DIR.parent / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.attributes["database_url"] = database_url
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    configure_tracing("echospace-api", __version__)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if settings.database_url.startswith("sqlite:///"):
            Path(settings.database_url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        if settings.auto_migrate:
            await asyncio.to_thread(run_migrations, settings.database_url)
        db = Database(settings.database_url)
        store = make_object_store(settings)
        with db.session() as s:
            seed_defaults(s, settings.local_username)
            sync_catalog(s, settings.models_dir, settings.datasets_dir)
        manager = SessionManager(db, store, settings.ws_queue_maxsize, settings.timing_every_frames)
        app.state.ctx = AppContext(settings, db, store, manager, time.monotonic())
        retention = asyncio.create_task(retention_loop(db, store), name="retention")
        log.info("api ready", extra={"database": settings.database_kind, "objectStore": settings.object_store})
        try:
            yield
        finally:
            retention.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await retention
            await manager.shutdown()
            db.engine.dispose()

    app = FastAPI(
        title="ECHOSPACE API",
        version=__version__,
        description="Control plane for the ECHOSPACE Python reference engine. See docs/api.md.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["content-type", "x-request-id"],
        expose_headers=["x-request-id"],
    )
    app.add_middleware(RequestContextMiddleware)
    for module in (system, sessions, experiments, catalog, recordings, ws):
        app.include_router(module.router)
    return app


app = create_app()
