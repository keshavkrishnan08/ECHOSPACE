"""Structured JSON logging with request / session context, request-id middleware and counters.

Every log record carries ``requestId`` and ``sessionId`` from context variables when set. Code in
this service logs identifiers, sizes and timings only; signal arrays are never logged.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import time
import uuid
from collections import Counter
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from echospace_telemetry import get_tracer

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
session_id_var: ContextVar[str | None] = ContextVar("session_id", default=None)

_REQUEST_ID = re.compile(r"^[A-Za-z0-9._\-]{8,64}$")
_STD_ATTRS = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if rid := request_id_var.get():
            out["requestId"] = rid
        if sid := session_id_var.get():
            out["sessionId"] = sid
        for k, v in record.__dict__.items():
            if k not in _STD_ATTRS and not k.startswith("_"):
                out[k] = v
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, default=str)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).handlers[:] = []
        logging.getLogger(name).propagate = True
    # The middleware below writes one structured line per request instead.
    logging.getLogger("uvicorn.access").disabled = True


class Counters:
    """Process-wide counters exposed in Prometheus text format on /metrics."""

    def __init__(self) -> None:
        self.http = Counter[tuple[str, int]]()
        self.ws_messages_sent = 0
        self.ws_messages_dropped = 0
        self.frames_produced = 0

    def prometheus(self) -> str:
        lines = [
            "# HELP echospace_http_requests_total HTTP requests by method and status.",
            "# TYPE echospace_http_requests_total counter",
        ]
        for (method, status), n in sorted(self.http.items()):
            lines.append(f'echospace_http_requests_total{{method="{method}",status="{status}"}} {n}')
        for name, help_, value in (
            ("echospace_ws_messages_sent_total", "WebSocket messages sent to clients.", self.ws_messages_sent),
            (
                "echospace_ws_messages_dropped_total",
                "WebSocket messages dropped by full queues.",
                self.ws_messages_dropped,
            ),
            ("echospace_frames_produced_total", "Frames produced by reference engines.", self.frames_produced),
        ):
            lines += [f"# HELP {name} {help_}", f"# TYPE {name} counter", f"{name} {value}"]
        return "\n".join(lines) + "\n"


counters = Counters()


class RequestContextMiddleware:
    """Assigns a request id (honouring a well-formed incoming X-Request-ID), returns it in the
    response, opens a span, and logs one line per HTTP request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.log = logging.getLogger("echospace_api.access")
        self.tracer = get_tracer("echospace_api")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        incoming = dict(scope.get("headers") or []).get(b"x-request-id", b"").decode("latin-1")
        rid = incoming if _REQUEST_ID.match(incoming) else uuid.uuid4().hex
        token = request_id_var.set(rid)
        status = 500
        started = time.perf_counter()

        async def send_wrapper(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message.setdefault("headers", [])
                message["headers"] = [*message["headers"], (b"x-request-id", rid.encode())]
            await send(message)

        path = scope.get("path", "")
        try:
            with self.tracer.start_as_current_span(f"{scope.get('method', 'WS')} {path}") as span:
                span.set_attribute("echospace.request_id", rid)
                await self.app(scope, receive, send_wrapper)
                span.set_attribute("http.status_code", status)
        finally:
            if scope["type"] == "http":
                method = scope.get("method", "")
                counters.http[(method, status)] += 1
                self.log.info(
                    "request",
                    extra={
                        "method": method,
                        "path": path,
                        "status": status,
                        "durationMs": round((time.perf_counter() - started) * 1000, 2),
                    },
                )
            request_id_var.reset(token)
