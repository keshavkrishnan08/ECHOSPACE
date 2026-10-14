"""Session WebSocket: ``/ws/sessions/{id}``.

On connect the client receives the current ``status``; if the session was only created, it is
started (synthetic sessions). Frames, metrics, timing, warnings and track events follow. The
client may send ClientCommand messages (``ping``, ``pause``, ``resume``, ``ack``); each one is
validated, and an invalid message is answered with an ``error`` envelope without closing the
connection. Disconnecting does not stop the session: a later connection continues from the
engine's current state. ``POST /api/sessions/{id}/stop`` closes all connections (code 1000).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from ..db import ProjectMember, SessionRow
from ..deps import LOCAL_USER_ID, get_ctx
from ..observability import counters, session_id_var
from ..runtime import SessionNotStartableError, SessionRuntime, Subscriber
from ..streaming import AckCommand, PauseCommand, PingCommand, ResumeCommand, client_command

router = APIRouter()
log = logging.getLogger(__name__)

MAX_CLIENT_MESSAGE_BYTES = 4096


async def _sender(ws: WebSocket, sub: Subscriber) -> None:
    while (msg := await sub.queue.get()) is not None:
        msg = {**msg, "sentAtMs": time.time() * 1000}
        await ws.send_text(json.dumps(msg, separators=(",", ":"), allow_nan=False))
        sub.sent += 1
        counters.ws_messages_sent += 1
    await ws.close(code=1000, reason="session stopped")


async def _receiver(ws: WebSocket, rt: SessionRuntime, sub: Subscriber) -> None:
    while True:
        raw = await ws.receive_text()
        if len(raw) > MAX_CLIENT_MESSAGE_BYTES:
            rt.send_to(
                sub, "error", {"code": "message-too-large", "message": f"limit is {MAX_CLIENT_MESSAGE_BYTES} bytes"}
            )
            continue
        try:
            cmd = client_command.validate_json(raw)
        except ValidationError as e:
            errors = [{"loc": list(x["loc"]), "msg": x["msg"]} for x in e.errors(include_url=False)]
            rt.send_to(sub, "error", {"code": "invalid-command", "message": "invalid client command", "errors": errors})
            continue
        if isinstance(cmd, PingCommand):
            rt.send_to(sub, "pong", {"t": cmd.t, "serverTimeMs": time.time() * 1000})
        elif isinstance(cmd, PauseCommand):
            rt.pause()
        elif isinstance(cmd, ResumeCommand):
            rt.resume()
        elif isinstance(cmd, AckCommand):
            sub.acked_seq = cmd.seq if sub.acked_seq is None else max(sub.acked_seq, cmd.seq)


@router.websocket("/ws/sessions/{session_id}")
async def session_socket(ws: WebSocket, session_id: str) -> None:
    ctx = get_ctx(ws)
    token = session_id_var.set(session_id)
    try:

        def load() -> SessionRow | None:
            with ctx.db.session() as s:
                row = s.get(SessionRow, session_id)
                # Local auth: the single local user must be a member of the session's project.
                if row is None or s.get(ProjectMember, (row.project_id, LOCAL_USER_ID)) is None:
                    return None
                return row

        row = await asyncio.to_thread(load)
        await ws.accept()
        if row is None:
            await ws.close(code=4404, reason="session not found")
            return
        if row.status in ("stopped", "failed"):
            await ws.send_text(
                json.dumps(
                    {
                        "v": 1,
                        "seq": 0,
                        "sessionId": session_id,
                        "sentAtMs": time.time() * 1000,
                        "type": "status",
                        "payload": {"state": "idle", "message": f"session {row.status}"},
                    }
                )
            )
            await ws.close(code=1000, reason=f"session {row.status}")
            return
        rt = ctx.sessions.runtime(row)
        sub = rt.subscribe()
        log.info("websocket connected", extra={"subscriber": sub.id})
        if not rt.running and row.status == "created":
            try:
                await ctx.sessions.start(row)
            except SessionNotStartableError as e:
                rt.send_to(sub, "error", {"code": "not-startable", "message": str(e)})
                rt.unsubscribe(sub)
        sender = asyncio.create_task(_sender(ws, sub))
        receiver = asyncio.create_task(_receiver(ws, rt, sub))
        done, pending = await asyncio.wait({sender, receiver}, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError):
                await t
        for t in done:
            exc = t.exception()
            if exc is not None and not isinstance(exc, WebSocketDisconnect | RuntimeError):
                log.error("websocket task failed", exc_info=exc)
        counters.ws_messages_dropped += sub.queue.dropped
        rt.unsubscribe(sub)
        log.info("websocket closed", extra={"subscriber": sub.id, "sent": sub.sent, "dropped": sub.queue.dropped})
    finally:
        session_id_var.reset(token)
