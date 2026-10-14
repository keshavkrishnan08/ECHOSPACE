from __future__ import annotations

import asyncio
import base64
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession
from starlette.websockets import WebSocketDisconnect

from echospace_api.streaming import OutboundQueue

ENVELOPE_KEYS = {"v", "seq", "sessionId", "sentAtMs", "type", "payload"}
FRAME_KEYS = {
    "seq",
    "timestampS",
    "grid",
    "occupancy",
    "varianceRatio",
    "tracks",
    "groundTruth",
    "deltaRssDb",
    "processingMs",
    "provenance",
}


def _session(client: TestClient, cfg: dict[str, Any], pace: str = "max") -> str:
    r = client.post("/api/simulations", json={"config": cfg, "pace": pace})
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


def _until(ws: WebSocketTestSession, pred: Any, limit: int = 2000) -> list[dict[str, Any]]:
    out = []
    for _ in range(limit):
        m = ws.receive_json()
        out.append(m)
        if pred(m, out):
            return out
    raise AssertionError("condition not reached")


def _frames(n: int) -> Any:
    return lambda _m, out: sum(1 for x in out if x["type"] == "frame") >= n


def _check_b64(arr: dict[str, Any]) -> None:
    assert arr["dtype"] == "float32"
    assert len(base64.b64decode(arr["data"])) == 4 * arr["length"]


def test_status_then_frames_with_increasing_seq(client: TestClient, fast_config: dict[str, Any]) -> None:
    sid = _session(client, fast_config)
    with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
        msgs = _until(ws, _frames(12))
    assert msgs[0]["type"] == "status"
    seqs = [m["seq"] for m in msgs]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
    for m in msgs:
        assert set(m) == ENVELOPE_KEYS and m["v"] == 1 and m["sessionId"] == sid
    frames = [m["payload"] for m in msgs if m["type"] == "frame"]
    assert [f["seq"] for f in frames] == list(range(frames[0]["seq"], frames[0]["seq"] + len(frames)))
    f = frames[-1]
    assert set(f) == FRAME_KEYS
    g = f["grid"]
    assert f["occupancy"]["length"] == f["varianceRatio"]["length"] == g["nx"] * g["ny"] * g["nz"]
    assert f["deltaRssDb"]["length"] == 6  # 4 transceivers → 6 links
    for k in ("occupancy", "varianceRatio", "deltaRssDb"):
        _check_b64(f[k])
    assert f["provenance"] == {
        "engine": "python-reference",
        "modelId": "rti-bayes",
        "configHash": f["provenance"]["configHash"],
        "seed": fast_config["seed"],
    }
    assert f["groundTruth"] and len(f["groundTruth"][0]["position"]) == 3
    metrics = [m["payload"] for m in msgs if m["type"] == "metrics"]
    assert metrics and "inputQuality" in metrics[-1]["values"]
    timing = [m["payload"] for m in msgs if m["type"] == "timing"]
    assert timing and {"dropped", "queueDepth", "queueCapacity"} <= set(timing[-1])
    client.post(f"/api/sessions/{sid}/stop")


def test_ping_pong_and_invalid_commands(client: TestClient, fast_config: dict[str, Any]) -> None:
    sid = _session(client, fast_config)
    with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
        _until(ws, _frames(1))
        ws.send_text(json.dumps({"cmd": "ping", "t": 123.5}))
        pong = _until(ws, lambda m, _o: m["type"] == "pong")[-1]
        assert pong["payload"]["t"] == 123.5
        for bad in (
            "not json",
            json.dumps({"cmd": "explode"}),
            json.dumps({"cmd": "ping"}),
            json.dumps({"cmd": "ack", "seq": "x"}),
            json.dumps({"cmd": "pause", "extra": 1}),
        ):
            ws.send_text(bad)
            err = _until(ws, lambda m, _o: m["type"] == "error")[-1]
            assert err["payload"]["code"] == "invalid-command"
        ws.send_text(json.dumps({"cmd": "ack", "seq": 5}))
        timing = _until(ws, lambda m, _o: m["type"] == "timing" and m["payload"]["ackedSeq"] == 5)
        assert timing
    client.post(f"/api/sessions/{sid}/stop")


def test_pause_stops_frames_and_resume_continues(client: TestClient, fast_config: dict[str, Any]) -> None:
    sid = _session(client, fast_config, pace="realtime")
    with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
        _until(ws, _frames(3))
        ws.send_text(json.dumps({"cmd": "pause"}))
        _until(ws, lambda m, _o: m["type"] == "status" and m["payload"]["state"] == "paused")
        # At most one frame that was already being computed may still arrive.
        ws.send_text(json.dumps({"cmd": "ping", "t": 1}))
        after = _until(ws, lambda m, _o: m["type"] == "pong")
        client.portal.call(asyncio.sleep, 0.5)  # type: ignore[union-attr]
        ws.send_text(json.dumps({"cmd": "ping", "t": 2}))
        after += _until(ws, lambda m, _o: m["type"] == "pong" and m["payload"]["t"] == 2)
        assert sum(1 for m in after if m["type"] == "frame") <= 1
        assert client.get(f"/api/sessions/{sid}").json()["state"] == "paused"
        ws.send_text(json.dumps({"cmd": "resume"}))
        _until(ws, _frames(2))
    client.post(f"/api/sessions/{sid}/stop")


def test_reconnect_continues_from_current_state(client: TestClient, fast_config: dict[str, Any]) -> None:
    sid = _session(client, fast_config, pace="realtime")
    with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
        first = _until(ws, _frames(3))
    last_frame = max(m["payload"]["seq"] for m in first if m["type"] == "frame")
    last_env = first[-1]["seq"]
    client.portal.call(asyncio.sleep, 0.3)  # type: ignore[union-attr]
    with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
        second = _until(ws, _frames(2))
    assert second[0]["type"] == "status"
    frames = [m["payload"]["seq"] for m in second if m["type"] == "frame"]
    assert frames[0] > last_frame + 1  # the engine kept running while disconnected
    assert second[0]["seq"] > last_env
    assert client.get(f"/api/sessions/{sid}").json()["status"] == "running"
    client.post(f"/api/sessions/{sid}/stop")


def test_stop_closes_connections_and_rejects_new_ones(client: TestClient, fast_config: dict[str, Any]) -> None:
    sid = _session(client, fast_config)
    with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
        _until(ws, _frames(1))
        assert client.post(f"/api/sessions/{sid}/stop").json()["status"] == "stopped"
        with pytest.raises(WebSocketDisconnect) as exc:
            for _ in range(5000):
                ws.receive_json()
        assert exc.value.code == 1000
    with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
        assert ws.receive_json()["payload"]["state"] == "idle"
    with client.websocket_connect("/ws/sessions/ses_unknown") as ws, pytest.raises(WebSocketDisconnect) as exc:
        ws.receive_json()
    assert exc.value.code == 4404


# --- the bounded queue between producer and sender ------------------------------------------


def _msg(i: int, type_: str = "frame") -> dict[str, Any]:
    return {"seq": i, "type": type_}


def test_queue_drops_oldest_droppable() -> None:
    q = OutboundQueue(maxsize=4)
    for i in range(10):
        q.put(_msg(i))
    assert q.qsize() == 4 and q.dropped == 6
    assert [q.get_nowait()["seq"] for _ in range(4)] == [6, 7, 8, 9]  # type: ignore[index]
    assert q.get_nowait() is None


def test_queue_keeps_control_messages() -> None:
    q = OutboundQueue(maxsize=3)
    q.put(_msg(0, "pong"), droppable=False)
    for i in range(1, 6):
        q.put(_msg(i))
    out = [q.get_nowait() for _ in range(q.qsize())]
    assert [m["seq"] for m in out] == [0, 4, 5]  # type: ignore[index]
    assert q.dropped == 3


def test_queue_coalesces_status_and_caps_control_flood() -> None:
    q = OutboundQueue(maxsize=2)
    q.put(_msg(0, "status"), droppable=False, coalesce="status")
    q.put(_msg(1))
    q.put(_msg(2, "status"), droppable=False, coalesce="status")
    assert [m["seq"] for m in (q.get_nowait(), q.get_nowait())] == [1, 2]  # type: ignore[index]
    assert q.superseded == 1
    for i in range(100):
        q.put(_msg(i, "pong"), droppable=False)
    assert q.qsize() == 4  # hard cap of 2 × maxsize


def test_queue_close_drains_then_returns_none() -> None:
    async def run() -> list[Any]:
        q = OutboundQueue(maxsize=4)
        q.put(_msg(1))
        q.close()
        q.put(_msg(2))  # ignored after close
        return [await q.get(), await q.get()]

    assert asyncio.run(run()) == [_msg(1), None]


def test_slow_subscriber_drops_without_stalling_producer(client: TestClient, fast_config: dict[str, Any]) -> None:
    """A subscriber that never reads gets a bounded queue with drops; the session keeps producing."""
    from echospace_api.db import SessionRow

    sid = _session(client, fast_config)
    ctx = client.app.state.ctx  # type: ignore[attr-defined]
    with ctx.db.session() as s:
        row = s.get(SessionRow, sid)

    async def run() -> tuple[int, int, int]:
        rt = ctx.sessions.runtime(row)
        sub = rt.subscribe()
        await ctx.sessions.start(row)
        for _ in range(1000):
            if rt.frames_produced >= 60:
                break
            await asyncio.sleep(0.02)
        result = (rt.frames_produced, sub.queue.qsize(), sub.queue.dropped)
        await ctx.sessions.stop(sid)
        return result

    produced, depth, dropped = client.portal.call(run)  # type: ignore[union-attr]
    assert produced >= 60
    assert depth <= 2 * ctx.settings.ws_queue_maxsize
    # Two messages (frame + metrics) per frame plus status/timing: well over the 64-slot queue.
    assert dropped > 0
