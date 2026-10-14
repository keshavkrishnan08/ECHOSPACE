"""OpenTelemetry setup shared by ECHOSPACE Python services.

Tracing is exported only when ``OTEL_EXPORTER_OTLP_ENDPOINT`` is set and the OTLP/HTTP exporter
(extra ``otlp``) is installed. Otherwise the OpenTelemetry API's default no-op tracer is used, so
instrumented code runs unchanged and costs almost nothing. Spans must carry identifiers and sizes
only, never signal payloads.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from opentelemetry import trace

__all__ = ["configure_tracing", "get_tracer", "tracing_enabled"]

_log = logging.getLogger(__name__)
_configured = False
_enabled = False


def configure_tracing(service_name: str, service_version: str = "0.0.0") -> bool:
    """Installs a tracer provider exporting over OTLP/HTTP if an endpoint is configured.

    Idempotent. Returns True when spans are exported, False when tracing is a no-op.
    """
    global _configured, _enabled
    if _configured:
        return _enabled
    _configured = True
    if not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return False
    try:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        _log.warning("OTEL_EXPORTER_OTLP_ENDPOINT is set but the OTLP exporter is not installed; tracing disabled")
        return False
    resource = Resource.create({"service.name": service_name, "service.version": service_version})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    _enabled = True
    return True


def tracing_enabled() -> bool:
    return _enabled


def get_tracer(name: str) -> Any:
    """A tracer from the global provider (no-op unless :func:`configure_tracing` enabled export)."""
    return trace.get_tracer(name)
