"""Health, diagnostics and Prometheus counters."""

from __future__ import annotations

import os
import platform
import resource
import sys
import threading
import time
from typing import Any

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from sqlalchemy import text

from .. import __version__
from ..capabilities import gpu_info, native_dsp_info
from ..deps import Ctx
from ..observability import counters
from ..schemas import HealthCapabilities, HealthOut

router = APIRouter()


@router.get("/api/health", response_model=HealthOut, response_model_by_alias=True)
def health(ctx: Ctx) -> HealthOut:
    return HealthOut(
        status="ok",
        version=__version__,
        capabilities=HealthCapabilities(
            websocket=True,
            python_reference_engine=True,
            gpu=bool(gpu_info()["available"]),
            native_dsp=bool(native_dsp_info(str(ctx.settings.native_dir))["available"]),
        ),
        database=ctx.settings.database_kind,
        object_store=ctx.settings.object_store,
    )


def _timed(fn: Any) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        fn()
        return {"ok": True, "latencyMs": round((time.perf_counter() - started) * 1000, 2)}
    except Exception as e:
        return {
            "ok": False,
            "latencyMs": round((time.perf_counter() - started) * 1000, 2),
            "error": f"{type(e).__name__}: {e}"[:300],
        }


@router.get("/api/diagnostics")
def diagnostics(ctx: Ctx) -> dict[str, Any]:
    def db_ping() -> None:
        with ctx.db.engine.connect() as c:
            c.execute(text("SELECT 1"))

    usage = resource.getrusage(resource.RUSAGE_SELF)
    return {
        "process": {
            "pid": os.getpid(),
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "cpuCount": os.cpu_count(),
            "threads": threading.active_count(),
            "uptimeS": round(time.monotonic() - ctx.started_monotonic, 1),
            # ru_maxrss is KiB on Linux, bytes on macOS.
            "maxRssBytes": usage.ru_maxrss * (1 if sys.platform == "darwin" else 1024),
            "cpuUserS": round(usage.ru_utime, 2),
            "cpuSystemS": round(usage.ru_stime, 2),
        },
        "database": {"kind": ctx.settings.database_kind, **_timed(db_ping)},
        "objectStore": {"kind": ctx.store.kind, **_timed(ctx.store.ping)},
        "gpu": gpu_info(),
        "nativeDsp": native_dsp_info(str(ctx.settings.native_dir)),
        "sessions": ctx.sessions.queue_stats(),
        "counters": {
            "framesProduced": counters.frames_produced,
            "wsMessagesSent": counters.ws_messages_sent,
            "wsMessagesDropped": counters.ws_messages_dropped,
        },
    }


@router.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
def prometheus() -> str:
    return counters.prometheus()
