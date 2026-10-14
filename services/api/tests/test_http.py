from __future__ import annotations

import io
import json
import re
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select

from echospace_api.db import AuditEvent, Database
from echospace_api.hashing import js_number, stable_hash
from echospace_api.metrics_catalog import METRICS
from echospace_api.settings import Settings
from echospace_sim import load_preset

REPO = Path(__file__).resolve().parents[3]


def test_health_shape(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"status", "version", "capabilities", "database", "objectStore"}
    assert body["status"] == "ok"
    assert body["database"] == "sqlite" and body["objectStore"] == "local"
    caps = body["capabilities"]
    assert set(caps) == {"websocket", "pythonReferenceEngine", "gpu", "nativeDsp"}
    assert caps["websocket"] is True and caps["pythonReferenceEngine"] is True
    assert isinstance(caps["gpu"], bool) and isinstance(caps["nativeDsp"], bool)


def test_request_id_is_generated_or_echoed(client: TestClient) -> None:
    assert re.fullmatch(r"[0-9a-f]{32}", client.get("/api/health").headers["x-request-id"])
    assert client.get("/api/health", headers={"X-Request-ID": "req-12345678"}).headers["x-request-id"] == "req-12345678"
    # Malformed ids are replaced rather than reflected.
    assert client.get("/api/health", headers={"X-Request-ID": "<bad>"}).headers["x-request-id"] != "<bad>"


def test_prometheus_and_diagnostics(client: TestClient) -> None:
    client.get("/api/health")
    assert "echospace_http_requests_total" in client.get("/metrics").text
    d = client.get("/api/diagnostics").json()
    assert d["database"]["ok"] and d["objectStore"]["ok"]
    assert d["process"]["pid"] > 0 and d["sessions"] == []


def test_projects_seeded(client: TestClient) -> None:
    items = client.get("/api/projects").json()["items"]
    assert [p["id"] for p in items] == ["default"]
    assert items[0]["role"] == "owner"


def test_scenarios_list(client: TestClient) -> None:
    items = client.get("/api/scenarios").json()["items"]
    assert [s["key"] for s in items] == list("ABCDEFGHIJ")
    for s in items:
        assert s["objective"] and s["lesson"] and s["difficulty"]
        assert s["config"]["scenario"] == s["key"]


def test_invalid_config_is_422(client: TestClient, fast_config: dict[str, Any]) -> None:
    bad = {**fast_config, "room": {**fast_config["room"], "width": 100}}
    r = client.post("/api/sessions", json={"sourceMode": "synthetic", "config": bad})
    assert r.status_code == 422
    assert any("width" in json.dumps(e["loc"]) for e in r.json()["detail"])
    assert client.post("/api/sessions", json={"sourceMode": "synthetic"}).status_code == 422
    assert client.post("/api/sessions", json={"sourceMode": "telepathy", "config": fast_config}).status_code == 422
    both = client.post("/api/simulations", json={"scenario": "A", "config": fast_config})
    assert both.status_code == 422


def test_session_lifecycle(client: TestClient, fast_config: dict[str, Any]) -> None:
    r = client.post("/api/sessions", json={"sourceMode": "synthetic", "config": fast_config, "pace": "max"})
    assert r.status_code == 201
    s = r.json()
    assert s["status"] == "created" and s["engine"] == "python-reference" and s["seed"] == fast_config["seed"]
    assert s["configHash"] == stable_hash(fast_config)
    sid = s["id"]
    assert client.get(f"/api/sessions/{sid}").json()["status"] == "created"

    assert client.post(f"/api/sessions/{sid}/start").json()["status"] == "running"
    for _ in range(400):
        if client.get(f"/api/sessions/{sid}").json()["framesProduced"] >= 10:
            break
        client.portal.call(_sleep, 0.02)  # type: ignore[union-attr]
    assert client.get(f"/api/sessions/{sid}").json()["framesProduced"] >= 10

    m = client.get(f"/api/sessions/{sid}/metrics").json()
    ids = {x["id"] for x in m["series"]}
    assert {"processingMs", "inputQuality", "floorIou"} <= ids
    assert {d["id"] for d in m["definitions"]} == ids
    assert m["definitions"][0]["definition"] == METRICS[m["definitions"][0]["id"]].definition

    stopped = client.post(f"/api/sessions/{sid}/stop").json()
    assert stopped["status"] == "stopped" and stopped["framesProduced"] >= 10
    # Metrics remain available after stop (flushed to the object store).
    assert len(client.get(f"/api/sessions/{sid}/metrics").json()["series"]) == len(ids)
    assert client.post(f"/api/sessions/{sid}/start").status_code == 409
    assert client.get("/api/sessions/ses_missing").status_code == 404


async def _sleep(s: float) -> None:
    import asyncio

    await asyncio.sleep(s)


def test_hardware_session_requires_authorization(
    client: TestClient, fast_config: dict[str, Any], settings: Settings
) -> None:
    body = {"sourceMode": "hardware", "config": fast_config}
    assert client.post("/api/sessions", json=body).status_code == 403
    assert client.post("/api/sessions", json={**body, "authorized": True}).status_code == 403
    assert client.post("/api/sessions", json={**body, "consentNote": "everyone agreed"}).status_code == 403
    ok = client.post("/api/sessions", json={**body, "authorized": True, "consentNote": "lab staff, written consent"})
    assert ok.status_code == 201
    # No acquisition backend in the Python service: starting is refused explicitly.
    r = client.post(f"/api/sessions/{ok.json()['id']}/start")
    assert r.status_code == 409 and "acquisition backend" in r.json()["detail"]
    with Database(settings.database_url).session() as s:
        actions = list(s.scalars(select(AuditEvent.action)))
    assert actions.count("session.reject") == 3 and "session.create" in actions


def test_simulation_from_preset_and_restart(client: TestClient) -> None:
    r = client.post("/api/simulations", json={"scenario": "C", "seed": 99, "pace": "max"})
    assert r.status_code == 201
    s = r.json()
    assert s["scenario"] == "C" and s["seed"] == 99 and s["sourceMode"] == "synthetic"
    expected = {**load_preset("C").to_json_dict(), "seed": 99}
    assert s["configHash"] == stable_hash(expected)
    r2 = client.post(f"/api/simulations/{s['id']}/restart", json={"seed": 5})
    assert r2.status_code == 200
    assert r2.json()["seed"] == 5 and r2.json()["status"] == "running"
    assert client.post(f"/api/sessions/{s['id']}/stop").json()["status"] == "stopped"


def test_experiment_round_trip(client: TestClient, experiment_record: dict[str, Any], settings: Settings) -> None:
    r = client.post(
        "/api/experiments", content=json.dumps(experiment_record), headers={"content-type": "application/json"}
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["created"] is True
    key = created["payloadArtifact"]["key"]
    assert (settings.object_store_dir / key).is_file()

    full = client.get("/api/experiments?full=true").json()["items"]
    assert len(full) == 1
    assert full[0] == experiment_record
    assert client.get(f"/api/experiments/{experiment_record['id']}").json() == experiment_record

    summaries = client.get("/api/experiments").json()["items"]
    assert summaries[0]["id"] == experiment_record["id"] and "series" not in summaries[0]
    assert summaries[0]["scenario"] == "B" and len(summaries[0]["summaries"]) == len(experiment_record["summaries"])

    # Re-posting the same record is idempotent; a different record with the same id is a conflict.
    again = client.post("/api/experiments", json=experiment_record)
    assert again.status_code == 200 and again.json()["created"] is False
    assert len(client.get("/api/experiments").json()["items"]) == 1
    changed = {**experiment_record, "name": "renamed"}
    assert client.post("/api/experiments", json=changed).status_code == 409

    assert client.delete(f"/api/experiments/{experiment_record['id']}").status_code == 204
    assert client.get(f"/api/experiments/{experiment_record['id']}").status_code == 404
    assert not (settings.object_store_dir / key).exists()
    assert client.get("/api/experiments?full=true").json()["items"] == []


def test_experiment_defaults_and_validation(client: TestClient, experiment_record: dict[str, Any]) -> None:
    minimal = {
        k: v
        for k, v in experiment_record.items()
        if k
        not in (
            "schemaVersion",
            "notes",
            "projectId",
            "summaries",
            "series",
            "events",
            "configChanges",
            "tags",
            "baselineOf",
            "machine",
            "replayDigest",
            "replayDigestFrames",
            "inferenceDevice",
        )
    }
    r = client.post("/api/experiments", json=minimal)
    assert r.status_code == 201, r.text
    got = client.get(f"/api/experiments/{minimal['id']}").json()
    assert got["schemaVersion"] == 1 and got["projectId"] == "default" and got["inferenceDevice"] == "cpu"
    assert got["series"] == [] and got["machine"] is None and got["replayDigestFrames"] == 0
    for bad in (
        {**experiment_record, "id": "x1", "frames": -1},
        {**experiment_record, "id": "x2", "engine": "gpu"},
        {**experiment_record, "id": "x3", "schemaVersion": 2},
        {**experiment_record, "id": "x4", "name": ""},
    ):
        assert client.post("/api/experiments", json=bad).status_code == 422


def test_models_and_datasets(client: TestClient) -> None:
    models = client.get("/api/models").json()["items"]
    registry = json.loads((REPO / "models" / "registry.json").read_text())
    assert [m["id"] for m in models] == [m["id"] for m in registry]
    assert {"rti-bayes", "bp-dsb", "ridge-floor", "tcn-encoder", "transformer-encoder"} <= {m["id"] for m in models}
    ridge = client.get("/api/models/ridge-floor").json()
    assert ridge["family"] == "shallow-learned" and ridge["preprocessingVersion"] == "pp-1.0.0"
    assert client.get("/api/models/nope").status_code == 404
    datasets = client.get("/api/datasets").json()["items"]
    ds = next(d for d in datasets if d["id"] == "synthetic-ridge-v1")
    assert ds["source"] == "synthetic" and ds["consent"] == "not-applicable"
    assert ds["validation"]["status"] == "valid" and set(ds["splits"]) == {"train", "val", "test"}


def _upload(client: TestClient, meta: dict[str, Any], data: bytes = b"\x00\x01raw-csi-bytes" * 100) -> Any:
    return client.post(
        "/api/recordings",
        data={"metadata": json.dumps(meta)},
        files={"file": ("capture.npz", io.BytesIO(data), "application/octet-stream")},
    )


def test_recording_requires_consent_and_delete_removes_object(client: TestClient, settings: Settings) -> None:
    meta = {"name": "bench capture", "format": "csi-npz", "consent": False}
    r = _upload(client, meta)
    assert r.status_code == 403
    assert not any(p.is_file() for p in settings.object_store_dir.rglob("*"))
    assert _upload(client, {"name": "x", "format": "csi-npz"}).status_code == 422

    data = b"\x00\x01raw-csi-bytes" * 100
    r = _upload(client, {**meta, "consent": True, "consentNote": "single operator", "sampleRateHz": 100}, data)
    assert r.status_code == 201, r.text
    rec = r.json()
    art = rec["artifact"]
    path = settings.object_store_dir / art["key"]
    assert path.read_bytes() == data and art["sizeBytes"] == len(data)
    import hashlib

    assert art["sha256"] == hashlib.sha256(data).hexdigest()
    assert rec["retentionUntil"] is not None and art["kind"] == "recording-raw"
    assert [x["id"] for x in client.get("/api/recordings").json()["items"]] == [rec["id"]]

    assert client.delete(f"/api/recordings/{rec['id']}").status_code == 204
    assert not path.exists()
    assert client.delete(f"/api/recordings/{rec['id']}").status_code == 404
    with Database(settings.database_url).session() as s:
        actions = list(s.scalars(select(AuditEvent.action).where(AuditEvent.target_id == rec["id"])))
    assert actions == ["recording.upload", "recording.delete"]


def test_retention_purge(client: TestClient, settings: Settings) -> None:
    from datetime import UTC, datetime, timedelta

    from echospace_api.retention import purge_expired
    from echospace_api.storage import LocalObjectStore

    r = _upload(client, {"name": "old", "format": "bin", "consent": True, "retentionDays": 1})
    key = r.json()["artifact"]["key"]
    db = Database(settings.database_url)
    store = LocalObjectStore(settings.object_store_dir)
    assert purge_expired(db, store) == 0
    assert purge_expired(db, store, now=datetime.now(UTC) + timedelta(days=2)) == 1
    assert not store.exists(key)
    assert client.get("/api/recordings").json()["items"] == []


def test_stable_hash_matches_typescript() -> None:
    # Reference values computed with stableHash() from packages/engine/src/sim/scene.ts.
    assert stable_hash(load_preset("B").to_json_dict()) == "e14e5a95"
    assert stable_hash(load_preset("I").to_json_dict()) == "ecd0166c"
    assert stable_hash({"a": [1e-7, 0.00001, 1e21, 1.2345678901234568e20, -0.5, 1.5e300, "é😀"]}) == "fde9a61c"
    assert [js_number(x) for x in (1.0, 0.1, 1e-7, 1e21, 123.456, -2.5e-9)] == [
        "1",
        "0.1",
        "1e-7",
        "1e+21",
        "123.456",
        "-2.5e-9",
    ]


def test_metric_catalogue_matches_typescript() -> None:
    src = (REPO / "packages" / "schemas" / "src" / "metrics.ts").read_text()
    ts = dict(
        re.findall(
            r'id: "(\w+)", label: "[^"]*", unit: "[^"]*", kind: "\w+", better: "\w+",\s*'
            r'definition: "((?:[^"\\]|\\.)*)"',
            src,
        )
    )
    assert set(ts) == set(METRICS)
    for k, definition in ts.items():
        assert json.loads(f'"{definition}"') == METRICS[k].definition
