"""Live sessions: one Python reference engine per running session, fanned out to WebSocket clients.

A :class:`SessionRuntime` owns the engine and a producer task. The producer advances the engine
in a worker thread (``asyncio.to_thread``; the engine is CPU-bound NumPy/Python code), encodes the
frame there as well, and then, on the event loop, puts the envelopes into every subscriber's
:class:`~echospace_api.streaming.OutboundQueue`. Subscribers come and go independently of the
producer, so a client that reconnects continues from the engine's current state.

Lifecycle (``sessions.status``): created → running → stopped, or failed on an engine error.
Stopping flushes counters, buffered session events and the metric series (as an artifact in the
object store) to the database.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import uuid
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, cast

import numpy as np

from echospace_inference import ReferenceEngine
from echospace_inference.metrics import (
    IdSwitchCounter,
    evaluate_tracks,
    floor_from_voxels,
    ground_truth_occupancy,
    iou,
)
from echospace_inference.pipeline import Frame
from echospace_sim.config import ScenarioConfig
from echospace_sim.source import GroundTruthSubject
from echospace_telemetry import get_tracer

from .db import Artifact, Database, SessionEvent, SessionRow, utcnow
from .hashing import stable_hash
from .observability import counters, session_id_var
from .storage import ObjectStore
from .streaming import OutboundQueue, StreamState, b64_float32, finite_or_none

log = logging.getLogger(__name__)
tracer = get_tracer("echospace_api.runtime")

SERIES_CAPACITY = 6000
"""Samples kept per metric (10 minutes at 10 Hz); older samples are discarded."""

SERIES_IDS = [
    "processingMs",
    "inputQuality",
    "meanSnrDb",
    "packetDeliveryRatio",
    "meanConfidence",
    "observedFraction",
    "activeTracks",
    "positionErrorM",
    "floorIou",
    "voxelIou",
    "precision",
    "recall",
    "idSwitchesTotal",
    "sessionDuration",
]


class SessionNotStartableError(RuntimeError):
    pass


def envelope(seq: int, session_id: str, type_: str, payload: Any) -> dict[str, Any]:
    return {
        "v": 1,
        "seq": seq,
        "sessionId": session_id,
        "sentAtMs": time.time() * 1000,
        "type": type_,
        "payload": payload,
    }


@dataclass
class Subscriber:
    id: str
    queue: OutboundQueue
    connected_at: float = field(default_factory=time.time)
    sent: int = 0
    acked_seq: int | None = None


@dataclass
class _Encoded:
    """Everything derived from one engine step, computed off the event loop."""

    frame_payload: dict[str, Any]
    metrics: dict[str, float | None]
    state: str
    model_status: str
    model_message: str
    warnings: list[str]
    confirmed: dict[str, tuple[float, float]]
    timestamp_s: float
    processing_ms: float
    step_ms: float


class SessionRuntime:
    def __init__(
        self, row: SessionRow, on_flush: Callable[[SessionRuntime], None], queue_maxsize: int, timing_every: int
    ) -> None:
        self.id = row.id
        self.project_id = row.project_id
        self.source_mode = row.source_mode
        self.config = ScenarioConfig.model_validate(row.config)
        self.config_hash = row.config_hash
        self.pace = row.pace
        self.queue_maxsize = queue_maxsize
        self.timing_every = timing_every
        self._on_flush = on_flush
        self.state: StreamState = "idle"
        self.state_message = ""
        self.subscribers: dict[str, Subscriber] = {}
        self.seq = 0
        self.frames_produced = 0
        self.dropped_closed = 0
        """Messages dropped for subscribers that have since disconnected."""
        self.last_step_ms: float | None = None
        self.last_processing_ms: float | None = None
        self.series: dict[str, deque[tuple[float, float | None]]] = {}
        self.pending_events: list[SessionEvent] = []
        self.task: asyncio.Task[None] | None = None
        self._running = asyncio.Event()
        self._running.set()
        self._reset_tracking()

    # -- messaging -----------------------------------------------------------------------------

    def _next(self, type_: str, payload: Any) -> dict[str, Any]:
        msg = envelope(self.seq, self.id, type_, payload)
        self.seq += 1
        return msg

    def broadcast(self, type_: str, payload: Any, *, droppable: bool = True, coalesce: str | None = None) -> None:
        msg = self._next(type_, payload)
        for sub in self.subscribers.values():
            sub.queue.put(msg, droppable=droppable, coalesce=coalesce)

    def send_to(
        self, sub: Subscriber, type_: str, payload: Any, *, droppable: bool = False, coalesce: str | None = None
    ) -> None:
        sub.queue.put(self._next(type_, payload), droppable=droppable, coalesce=coalesce)

    def status_payload(self) -> dict[str, Any]:
        return {"state": self.state, "message": self.state_message}

    def set_state(self, state: StreamState, message: str = "") -> None:
        if state == self.state and message == self.state_message:
            return
        self.state = state
        self.state_message = message
        self.broadcast("status", self.status_payload(), droppable=False, coalesce="status")

    def subscribe(self) -> Subscriber:
        sub = Subscriber(uuid.uuid4().hex[:12], OutboundQueue(self.queue_maxsize))
        self.subscribers[sub.id] = sub
        self.send_to(sub, "status", self.status_payload(), coalesce="status")
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        if self.subscribers.pop(sub.id, None) is not None:
            self.dropped_closed += sub.queue.dropped
        sub.queue.close()

    def timing_payload(self, sub: Subscriber) -> dict[str, Any]:
        return {
            "framesProduced": self.frames_produced,
            "messagesSent": sub.sent,
            "queueDepth": sub.queue.qsize(),
            "queueCapacity": sub.queue.maxsize,
            "dropped": sub.queue.dropped,
            "superseded": sub.queue.superseded,
            "ackedSeq": sub.acked_seq,
            "lastSeq": self.seq - 1,
            "processingMs": self.last_processing_ms,
            "stepMs": self.last_step_ms,
            "paused": not self._running.is_set(),
        }

    def event(self, kind: str, message: str, severity: str = "info", t: float | None = None) -> None:
        self.pending_events.append(SessionEvent(session_id=self.id, t=t, kind=kind, severity=severity, message=message))

    # -- control -------------------------------------------------------------------------------

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def start(self) -> None:
        if self.source_mode != "synthetic":
            raise SessionNotStartableError(
                f"{self.source_mode} sessions have no acquisition backend in the Python service; only synthetic "
                "sessions can be streamed. Recorded data can be uploaded via /api/recordings."
            )
        if self.running:
            return
        self._running.set()
        self.task = asyncio.create_task(self._produce(), name=f"session-{self.id}")
        self.event("lifecycle", "started")

    def pause(self) -> None:
        if self._running.is_set():
            self._running.clear()
            self.set_state("paused", "paused by client")
            self.event("lifecycle", "paused")

    def resume(self) -> None:
        if not self._running.is_set():
            self._running.set()
            self.set_state("streaming", "")
            self.event("lifecycle", "resumed")

    async def cancel(self) -> None:
        if self.task is not None and not self.task.done():
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
        self.task = None

    async def restart(self, seed: int | None) -> None:
        await self.cancel()
        if seed is not None:
            self.config = self.config.model_copy(update={"seed": seed})
        self.frames_produced = 0
        self.series.clear()
        self._reset_tracking()
        self.state = "idle"
        self.event("lifecycle", f"restarted (seed {self.config.seed})")
        self.start()

    def close_subscribers(self) -> None:
        for sub in list(self.subscribers.values()):
            self.unsubscribe(sub)

    # -- producer ------------------------------------------------------------------------------

    def _reset_tracking(self) -> None:
        self._id_switches = IdSwitchCounter()
        self._prev_confirmed: set[str] = set()
        self._prev_warnings: tuple[str, ...] = ()
        self._prev_model_status = "ok"

    async def _produce(self) -> None:
        token = session_id_var.set(self.id)
        try:
            self.set_state("initializing", "building the reference engine and calibrating on an empty-room capture")
            with tracer.start_as_current_span("engine.init") as span:
                span.set_attribute("echospace.session_id", self.id)
                engine = await asyncio.to_thread(ReferenceEngine, self.config)
            log.info("engine ready", extra={"links": engine.pipeline.L, "voxels": engine.pipeline.grid.count})
            period = 1 / self.config.dsp.frame_rate_hz
            total = round(self.config.duration_s * self.config.dsp.frame_rate_hz)
            loop = asyncio.get_running_loop()
            due = loop.time()
            while self.frames_produced < total:
                if not self._running.is_set():
                    await self._running.wait()
                    due = loop.time()
                with tracer.start_as_current_span("engine.step") as span:
                    enc = await asyncio.to_thread(self._step, engine)
                    span.set_attribute("echospace.frame_seq", self.frames_produced)
                self._publish(enc)
                if self.pace == "realtime":
                    due += period
                    delay = due - loop.time()
                    if delay > 0:
                        await asyncio.sleep(delay)
                    else:
                        due = loop.time()  # running behind real time: do not try to catch up
                        await asyncio.sleep(0)
                else:
                    await asyncio.sleep(0)
            self.set_state("idle", f"scenario duration reached ({self.config.duration_s:g} s)")
            self.event("lifecycle", "scenario duration reached")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # engine failure: report on the stream and in the session record
            log.exception("session producer failed")
            self.set_state("error", f"engine error: {type(e).__name__}")
            self.broadcast("error", {"code": "engine-error", "message": f"{type(e).__name__}: {e}"}, droppable=False)
            self.event("error", f"{type(e).__name__}: {e}", "error")
            raise
        finally:
            session_id_var.reset(token)

    def _step(self, engine: ReferenceEngine) -> _Encoded:
        started = time.perf_counter()
        frame, gt = engine.step()
        step_ms = (time.perf_counter() - started) * 1000
        return self._encode(engine, frame, gt, engine.last_process_ms, step_ms)

    def _encode(
        self, engine: ReferenceEngine, frame: Frame, gt: list[GroundTruthSubject], processing_ms: float, step_ms: float
    ) -> _Encoded:
        cfg = self.config
        g = engine.pipeline.grid
        synthetic = self.source_mode == "synthetic"
        payload = {
            "seq": frame.seq,
            "timestampS": frame.timestamp_s,
            "grid": {"nx": g.nx, "ny": g.ny, "nz": g.nz, "voxelSizeM": g.size, "origin": list(g.origin)},
            "occupancy": b64_float32(frame.occupancy),
            "varianceRatio": b64_float32(frame.variance_ratio),
            "tracks": [
                {
                    "id": t.id,
                    "position": [float(v) for v in t.position],
                    "velocity": [float(v) for v in t.velocity],
                    "covariance": [float(v) for v in t.covariance],
                    "confirmed": bool(t.confirmed),
                }
                for t in frame.tracks
            ],
            "groundTruth": [{"id": s.id, "position": [float(v) for v in s.position]} for s in gt]
            if synthetic
            else None,
            "deltaRssDb": b64_float32(frame.delta_rss_db),
            "processingMs": processing_ms,
            "provenance": {
                "engine": "python-reference",
                "modelId": cfg.recon.model_id,
                "configHash": self.config_hash,
                "seed": cfg.seed if synthetic else None,
            },
        }
        vr = frame.variance_ratio.astype(np.float64)
        delivery = frame.delivery_ratio.astype(np.float64)
        confirmed = [t for t in frame.tracks if t.confirmed]
        m: dict[str, float | None] = {
            "processingMs": processing_ms,
            "inputQuality": frame.input_quality,
            "meanSnrDb": frame.mean_snr_db,
            "packetDeliveryRatio": float(delivery.mean()) if delivery.size else 0.0,
            "meanConfidence": float(np.mean(1 - vr)),
            "observedFraction": float(np.mean(vr < 0.8)),
            "activeTracks": float(len(confirmed)),
            "sessionDuration": frame.timestamp_s,
            "positionErrorM": None,
            "floorIou": None,
            "voxelIou": None,
            "precision": None,
            "recall": None,
            "idSwitchesTotal": float(self._id_switches.total),
        }
        if synthetic and frame.model_status != "unsupported" and frame.state != "calibrating":
            ev = evaluate_tracks(frame.tracks, gt)
            self._id_switches.update(ev.matches)
            gt_occ = ground_truth_occupancy(g, gt)
            thr = cfg.recon.occupancy_threshold
            m.update(
                positionErrorM=ev.position_error_m,
                precision=ev.precision,
                recall=ev.recall,
                idSwitchesTotal=float(self._id_switches.total),
                voxelIou=iou(frame.occupancy, gt_occ, thr),
                floorIou=iou(floor_from_voxels(frame.occupancy, g), floor_from_voxels(gt_occ, g), thr),
            )
        return _Encoded(
            frame_payload=payload,
            metrics={k: finite_or_none(v) for k, v in m.items()},
            state=frame.state,
            model_status=frame.model_status,
            model_message=frame.model_message,
            warnings=list(frame.warnings),
            confirmed={t.id: (float(t.position[0]), float(t.position[1])) for t in confirmed},
            timestamp_s=frame.timestamp_s,
            processing_ms=processing_ms,
            step_ms=step_ms,
        )

    def _publish(self, enc: _Encoded) -> None:
        self.frames_produced += 1
        counters.frames_produced += 1
        self.last_processing_ms = enc.processing_ms
        self.last_step_ms = enc.step_ms
        t = enc.timestamp_s
        if self._running.is_set():
            self.set_state(cast(StreamState, enc.state), enc.model_message)
        if enc.model_status != self._prev_model_status:
            self.event(
                "model-status",
                f"{enc.model_status}: {enc.model_message}",
                "error" if enc.model_status == "unsupported" else "warning",
                t,
            )
            self._prev_model_status = enc.model_status
        warnings = tuple(enc.warnings)
        if warnings != self._prev_warnings:
            for w in warnings:
                if w not in self._prev_warnings:
                    self.broadcast("warning", {"timestampS": t, "message": w}, droppable=False)
                    self.event("warning", w, "warning", t)
            self._prev_warnings = warnings
        current = set(enc.confirmed)
        for tid in sorted(current - self._prev_confirmed):
            x, y = enc.confirmed[tid]
            self.broadcast(
                "track-event",
                {
                    "kind": "track-confirmed",
                    "timestampS": t,
                    "trackId": tid,
                    "severity": "info",
                    "message": f"track {tid} confirmed at ({x:.2f}, {y:.2f}) m",
                },
                droppable=False,
            )
        for tid in sorted(self._prev_confirmed - current):
            self.broadcast(
                "track-event",
                {
                    "kind": "track-death",
                    "timestampS": t,
                    "trackId": tid,
                    "severity": "info",
                    "message": f"track {tid} no longer confirmed",
                },
                droppable=False,
            )
        self._prev_confirmed = current

        self.broadcast("frame", enc.frame_payload)
        self.broadcast("metrics", {"seq": enc.frame_payload["seq"], "timestampS": t, "values": enc.metrics})
        for k in SERIES_IDS:
            self.series.setdefault(k, deque(maxlen=SERIES_CAPACITY)).append((t, enc.metrics.get(k)))
        if self.frames_produced % self.timing_every == 0:
            for sub in self.subscribers.values():
                self.send_to(sub, "timing", self.timing_payload(sub), coalesce="timing")
        if len(self.pending_events) >= 50:
            self._on_flush(self)

    def dropped_total(self) -> int:
        return self.dropped_closed + sum(sub.queue.dropped for sub in self.subscribers.values())

    def series_json(self) -> list[dict[str, Any]]:
        return [{"id": k, "t": [p[0] for p in v], "v": [p[1] for p in v]} for k, v in self.series.items()]


class SessionManager:
    """Registry of live session runtimes for this process."""

    def __init__(self, db: Database, store: ObjectStore, queue_maxsize: int, timing_every: int) -> None:
        self.db = db
        self.store = store
        self.queue_maxsize = queue_maxsize
        self.timing_every = timing_every
        self.runtimes: dict[str, SessionRuntime] = {}

    def runtime(self, row: SessionRow) -> SessionRuntime:
        rt = self.runtimes.get(row.id)
        if rt is None:
            rt = SessionRuntime(row, self._flush_events_soon, self.queue_maxsize, self.timing_every)
            self.runtimes[row.id] = rt
        return rt

    def get(self, session_id: str) -> SessionRuntime | None:
        return self.runtimes.get(session_id)

    def _background(self, fn: Callable[..., None], *args: Any) -> None:
        """Runs blocking persistence work in the default executor, logging failures."""
        fut = asyncio.get_running_loop().run_in_executor(None, fn, *args)

        def done(f: asyncio.Future[None]) -> None:
            if not f.cancelled() and f.exception() is not None:
                log.error("background persistence failed", exc_info=f.exception())

        fut.add_done_callback(done)

    def _flush_events_soon(self, rt: SessionRuntime) -> None:
        events, rt.pending_events = rt.pending_events, []
        self._background(self._write_events, events)

    def _write_events(self, events: list[SessionEvent]) -> None:
        if not events:
            return
        with self.db.session() as s:
            s.add_all(events)
            s.commit()

    async def start(self, row: SessionRow) -> SessionRuntime:
        rt = self.runtime(row)
        was_running = rt.running
        rt.start()
        if rt.task is not None and not was_running:
            rt.task.add_done_callback(lambda task: self._on_done(rt, task))
        await asyncio.to_thread(self._mark_running, rt.id)
        return rt

    def _on_done(self, rt: SessionRuntime, task: asyncio.Task[None]) -> None:
        """The producer ended by itself (scenario duration reached or engine error)."""
        if task.cancelled():
            return
        failed = task.exception() is not None
        rt.close_subscribers()
        if self.runtimes.get(rt.id) is rt:
            del self.runtimes[rt.id]
        self._background(self._persist, rt, "failed" if failed else "stopped")

    def _mark_running(self, session_id: str) -> None:
        with self.db.session() as s:
            row = s.get(SessionRow, session_id)
            if row is not None and row.status != "running":
                row.status = "running"
                row.started_at = utcnow()
                row.stopped_at = None
                s.commit()

    async def stop(self, session_id: str) -> None:
        rt = self.runtimes.get(session_id)
        if rt is None:
            await asyncio.to_thread(self._persist_status_only, session_id)
            return
        await rt.cancel()
        rt.set_state("idle", "session stopped")
        rt.event("lifecycle", "stopped")
        rt.close_subscribers()
        await asyncio.to_thread(self._persist, rt, "stopped")
        self.runtimes.pop(session_id, None)

    async def restart(self, row: SessionRow, seed: int | None) -> SessionRuntime:
        rt = self.runtime(row)
        await rt.restart(seed)
        if rt.task:
            rt.task.add_done_callback(lambda task: self._on_done(rt, task))
        await asyncio.to_thread(self._mark_restarted, rt)
        return rt

    def _mark_restarted(self, rt: SessionRuntime) -> None:
        with self.db.session() as s:
            row = s.get(SessionRow, rt.id)
            if row is None:
                return
            cfg = rt.config.to_json_dict()
            row.config = cfg
            row.seed = rt.config.seed
            row.config_hash = rt.config_hash = stable_hash(cfg)
            row.status = "running"
            row.started_at = utcnow()
            row.stopped_at = None
            row.frames_produced = 0
            s.commit()

    def _persist_status_only(self, session_id: str) -> None:
        with self.db.session() as s:
            row = s.get(SessionRow, session_id)
            if row is not None and row.status in ("created", "running"):
                row.status = "stopped"
                row.stopped_at = utcnow()
                s.commit()

    def _persist(self, rt: SessionRuntime, status: str) -> None:
        """Flushes counters, events and the metric series of a session to the database / object store."""
        events, rt.pending_events = rt.pending_events, []
        data = json.dumps({"sessionId": rt.id, "configHash": rt.config_hash, "series": rt.series_json()}).encode()
        key = f"projects/{rt.project_id}/sessions/{rt.id}/metrics.json"
        stored = self.store.put_bytes(key, data, "application/json")
        with self.db.session() as s:
            row = s.get(SessionRow, rt.id)
            if row is None:
                return
            art = s.query(Artifact).filter_by(key=key).one_or_none()
            if art is None:
                art = Artifact(id=f"art_{uuid.uuid4().hex[:16]}", project_id=rt.project_id, key=key)
                s.add(art)
            art.kind = "session-metrics"
            art.format = "echospace-metric-series+json"
            art.content_type = "application/json"
            art.size_bytes = stored.size_bytes
            art.sha256 = stored.sha256
            art.provenance = {
                "sessionId": rt.id,
                "configHash": rt.config_hash,
                "engine": "python-reference",
                "frames": rt.frames_produced,
            }
            s.flush()
            row.metrics_artifact_id = art.id
            row.status = status
            row.stopped_at = utcnow()
            row.frames_produced = rt.frames_produced
            row.frames_dropped = rt.dropped_total()
            s.add_all(events)
            s.commit()

    async def shutdown(self) -> None:
        for sid in list(self.runtimes):
            try:
                await self.stop(sid)
            except Exception:
                log.exception("failed to stop session during shutdown", extra={"sessionId": sid})

    def queue_stats(self) -> list[dict[str, Any]]:
        out = []
        for rt in self.runtimes.values():
            out.append(
                {
                    "sessionId": rt.id,
                    "state": rt.state,
                    "running": rt.running,
                    "framesProduced": rt.frames_produced,
                    "lastProcessingMs": rt.last_processing_ms,
                    "lastStepMs": rt.last_step_ms,
                    "subscribers": [
                        {
                            "id": s.id,
                            "queueDepth": s.queue.qsize(),
                            "queueCapacity": s.queue.maxsize,
                            "dropped": s.queue.dropped,
                            "sent": s.sent,
                            "ackedSeq": s.acked_seq,
                        }
                        for s in rt.subscribers.values()
                    ],
                }
            )
        return out
