"""Wire format of the session WebSocket (packages/schemas/src/stream.ts) and the outbound queue.

Envelopes: ``{v: 1, seq, sessionId, sentAtMs, type, payload}``. ``seq`` is assigned per session
when a message is created and is strictly increasing in send order on every connection (a
connection may see gaps where messages were dropped or addressed to another connection).
Float arrays are ``{dtype: "float32", length, data}`` with ``data`` the base64 of little-endian
IEEE-754 float32 bytes.
"""

from __future__ import annotations

import asyncio
import base64
import math
from collections import deque
from dataclasses import dataclass, field
from typing import Annotated, Any, Literal

import numpy as np
import numpy.typing as npt
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

MessageType = Literal["status", "frame", "metrics", "timing", "track-event", "warning", "error", "pong"]
StreamState = Literal["idle", "initializing", "calibrating", "streaming", "paused", "degraded", "error"]


def b64_float32(values: npt.ArrayLike) -> dict[str, Any]:
    arr = np.ascontiguousarray(np.asarray(values, dtype="<f4").ravel())
    return {"dtype": "float32", "length": int(arr.size), "data": base64.b64encode(arr.tobytes()).decode("ascii")}


def finite_or_none(x: float | None) -> float | None:
    if x is None:
        return None
    x = float(x)
    return x if math.isfinite(x) else None


# --- client → server commands (ClientCommand in stream.ts) ------------------------------------


class _Cmd(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PingCommand(_Cmd):
    cmd: Literal["ping"]
    t: float


class PauseCommand(_Cmd):
    cmd: Literal["pause"]


class ResumeCommand(_Cmd):
    cmd: Literal["resume"]


class AckCommand(_Cmd):
    cmd: Literal["ack"]
    seq: int


ClientCommand = Annotated[PingCommand | PauseCommand | ResumeCommand | AckCommand, Field(discriminator="cmd")]
client_command = TypeAdapter[ClientCommand](ClientCommand)


# --- bounded outbound queue -------------------------------------------------------------------


@dataclass
class _Item:
    message: dict[str, Any]
    droppable: bool
    coalesce: str | None


@dataclass
class OutboundQueue:
    """Bounded FIFO between a session's producer and one WebSocket sender.

    ``put`` never blocks, so a slow or stalled client cannot stall the producer or other clients.
    When the queue holds ``maxsize`` items, the oldest *droppable* item (frames, metrics) is
    discarded and counted in ``dropped``. Control messages (status, pong, error) are not dropped
    that way; ``coalesce`` keeps at most one queued message per key (the newest status / timing
    supersedes an unsent older one), and a hard cap of ``2 × maxsize`` bounds memory even if a
    client floods pings without reading.

    asyncio.Queue is not used directly because it cannot drop selectively.
    """

    maxsize: int
    dropped: int = 0
    superseded: int = 0
    _items: deque[_Item] = field(default_factory=deque)
    _ready: asyncio.Event = field(default_factory=asyncio.Event)
    closed: bool = False

    def qsize(self) -> int:
        return len(self._items)

    def put(self, message: dict[str, Any], *, droppable: bool = True, coalesce: str | None = None) -> None:
        if self.closed:
            return
        if coalesce is not None:
            before = len(self._items)
            self._items = deque(i for i in self._items if i.coalesce != coalesce)
            self.superseded += before - len(self._items)
        if len(self._items) >= self.maxsize:
            victim = next((i for i in self._items if i.droppable), None)
            if victim is not None:
                self._items.remove(victim)
                self.dropped += 1
            elif droppable:
                self.dropped += 1
                return
            elif len(self._items) >= 2 * self.maxsize:
                self._items.popleft()
                self.dropped += 1
        self._items.append(_Item(message, droppable, coalesce))
        self._ready.set()

    def get_nowait(self) -> dict[str, Any] | None:
        if not self._items:
            return None
        item = self._items.popleft()
        if not self._items:
            self._ready.clear()
        return item.message

    async def get(self) -> dict[str, Any] | None:
        """Next message, or None once the queue is closed and drained."""
        while True:
            msg = self.get_nowait()
            if msg is not None:
                return msg
            if self.closed:
                return None
            self._ready.clear()
            await self._ready.wait()

    def close(self) -> None:
        """No further puts; ``get`` returns the remaining items, then None."""
        self.closed = True
        self._ready.set()
