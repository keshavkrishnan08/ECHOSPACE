from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from echospace_api.hashing import stable_hash
from echospace_api.main import create_app
from echospace_api.settings import Settings
from echospace_sim import load_preset

REPO = Path(__file__).resolve().parents[3]


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=f"sqlite:///{tmp_path / 'api.db'}",
        object_store="local",
        object_store_dir=tmp_path / "objects",
        models_dir=REPO / "models",
        datasets_dir=REPO / "datasets" / "manifests",
        log_level="WARNING",
        ws_queue_maxsize=64,
        timing_every_frames=5,
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as c:
        yield c


@pytest.fixture
def fast_config() -> dict[str, Any]:
    """Scenario B reduced to 4 nodes, 8 subcarriers, 20 packets/s and 0.5 m voxels: ~10 ms per frame."""
    cfg = load_preset("B").to_json_dict()
    for s in cfg["sensors"][4:]:
        s["enabled"] = False
    cfg["signal"].update(subcarriers=8, packetRateHz=20)
    cfg["dsp"].update(calibrationSeconds=0.5)
    cfg["recon"].update(voxelSizeM=0.5)
    cfg["durationS"] = 60
    return cfg


SERIES_KEYS = [
    "positionErrorM",
    "floorIou",
    "voxelIou",
    "precision",
    "recall",
    "chamferM",
    "meanConfidence",
    "observedFraction",
    "activeTracks",
    "idSwitchesTotal",
    "inputQuality",
    "packetDeliveryRatio",
    "meanSnrDb",
    "processingMs",
    "endToEndMs",
]


@pytest.fixture
def experiment_record() -> dict[str, Any]:
    """An ExperimentRecord shaped exactly like buildExperiment() in apps/web/src/lib/store/experiments.ts."""
    config = load_preset("B").to_json_dict()
    changed = {**config, "recon": {**config["recon"], "temporalSmoothing": 0.7}}
    t = [0.1 * i for i in range(1, 6)]
    series = [
        {"id": k, "t": t, "v": [None, 0.5, 0.25, 0.75, 1.0] if k != "chamferM" else [None] * 5} for k in SERIES_KEYS
    ]
    summaries = []
    for k in SERIES_KEYS:
        if k == "chamferM":
            summaries.append(
                {"id": k, "n": 0, "mean": None, "median": None, "p95": None, "min": None, "max": None, "last": None}
            )
        else:
            summaries.append(
                {"id": k, "n": 4, "mean": 0.625, "median": 0.625, "p95": None, "min": 0.25, "max": 1.0, "last": 1.0}
            )
    return {
        "schemaVersion": 1,
        "id": "exp_m2x9k1ab3f",
        "name": "Scenario B baseline",
        "notes": "rti-bayes, default settings",
        "projectId": "default",
        "sourceMode": "synthetic",
        "config": config,
        "configHash": stable_hash(config),
        "modelId": "rti-bayes",
        "modelVersion": "1.0.0",
        "preprocessingVersion": "pp-1.0.0",
        "engine": "browser-worker",
        "inferenceDevice": "cpu (browser worker, JavaScript)",
        "softwareVersion": "0.1.0",
        "machine": {
            "userAgent": "Mozilla/5.0 (X11; Linux x86_64)",
            "hardwareConcurrency": 8,
            "deviceMemoryGb": 8,
            "platform": "Linux x86_64",
            "gpu": None,
        },
        "status": "completed",
        "startedAt": "2026-10-14T18:00:00.000Z",
        "endedAt": "2026-10-14T18:01:00.000Z",
        "simulatedDurationS": 0.5,
        "frames": 5,
        "replayDigest": "9f" * 32,
        "replayDigestFrames": 40,
        "summaries": summaries,
        "series": series,
        "events": [{"t": 0.3, "kind": "track-confirmed", "message": "Track T1 confirmed"}],
        "configChanges": [{"frameSeq": 3, "t": 0.3, "config": changed}],
        "tags": ["baseline", "scenario-b"],
        "baselineOf": None,
    }
