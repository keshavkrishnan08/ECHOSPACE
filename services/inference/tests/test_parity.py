"""Cross-language parity against fixtures exported by packages/engine/scripts/export-parity.ts.

Regenerate the fixtures with ``npx tsx scripts/export-parity.ts`` (from packages/engine) after any
intentional change to the TypeScript engine. Tolerances are documented in docs/numerical-tolerances.md.
"""

from __future__ import annotations

import base64
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
import pytest

from echospace_inference.pipeline import Frame, ReferenceEngine
from echospace_sim.channel import CsiPacket
from echospace_sim.config import parse_scenario
from echospace_sim.source import SyntheticSource

FIXTURE_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "parity"
FIXTURES = sorted(p.stem for p in FIXTURE_DIR.glob("*.json"))

CSI_RTOL = 1e-5
CSI_ATOL = 1e-6
CALIBRATION_ATOL_DB = 1e-6
DELTA_RSS_ATOL_DB = 1e-4
IMAGE_RTOL = 1e-4
OCCUPANCY_ATOL = 1e-4


def f32(encoded: str) -> npt.NDArray[np.float32]:
    return np.frombuffer(base64.b64decode(encoded), dtype="<f4")


def as_float(values: list[float | None]) -> npt.NDArray[np.float64]:
    return np.array([math.nan if v is None else v for v in values], dtype=np.float64)


@dataclass
class Run:
    fixture: dict[str, Any]
    packets: list[CsiPacket]
    engine: ReferenceEngine
    frames: list[Frame]


@pytest.fixture(scope="module", params=FIXTURES)
def run(request: pytest.FixtureRequest) -> Run:
    fx = json.loads((FIXTURE_DIR / f"{request.param}.json").read_text(encoding="utf-8"))
    cfg = parse_scenario(fx["config"])
    last = fx["dropWindow"]["lastSeq"]
    packets = [p for p in SyntheticSource(cfg).pull(last / cfg.signal.packet_rate_hz) if p.seq <= last]
    engine = ReferenceEngine(cfg)
    frames = engine.run(len(fx["frames"]))
    return Run(fx, packets, engine, frames)


def test_fixtures_present() -> None:
    assert {"scenario-b", "scenario-f-impaired"} <= set(FIXTURES)


def test_links_and_grid(run: Run) -> None:
    assert [link.id for link in run.engine.source.links] == run.fixture["links"]
    g = run.engine.pipeline.grid
    assert {"nx": g.nx, "ny": g.ny, "nz": g.nz} == run.fixture["grid"]


def test_drop_pattern_and_missing_timestamps(run: Run) -> None:
    L = len(run.fixture["links"])
    delivered: list[list[int]] = [[] for _ in range(L)]
    missing_ts: list[list[int]] = [[] for _ in range(L)]
    for p in run.packets:
        delivered[p.link].append(p.seq)
        if math.isnan(p.timestamp_s):
            missing_ts[p.link].append(p.seq)
    assert delivered == run.fixture["dropWindow"]["delivered"]
    assert missing_ts == run.fixture["dropWindow"]["missingTimestamp"]


def test_csi(run: Run) -> None:
    by_link: dict[int, list[CsiPacket]] = {}
    for p in run.packets:
        by_link.setdefault(p.link, []).append(p)
    for link, expected in enumerate(run.fixture["packets"]):
        assert expected, f"link {link} has no reference packets"
        for ours, ref in zip(by_link[link], expected, strict=False):
            assert ours.seq == ref["seq"]
            if ref["timestampS"] is None:
                assert math.isnan(ours.timestamp_s)
            else:
                assert ours.timestamp_s == pytest.approx(ref["timestampS"], abs=1e-12)
            np.testing.assert_allclose(ours.re, f32(ref["re"]), rtol=CSI_RTOL, atol=CSI_ATOL, equal_nan=True)
            np.testing.assert_allclose(ours.im, f32(ref["im"]), rtol=CSI_RTOL, atol=CSI_ATOL, equal_nan=True)


def test_calibration(run: Run) -> None:
    cal = run.fixture["calibration"]
    pl = run.engine.pipeline
    np.testing.assert_allclose(pl.baseline_rss, as_float(cal["baselineRss"]), rtol=0, atol=CALIBRATION_ATOL_DB)
    np.testing.assert_allclose(pl.snr_est, as_float(cal["snrEst"]), rtol=0, atol=CALIBRATION_ATOL_DB)
    np.testing.assert_allclose(pl.calib_motion, as_float(cal["calibMotion"]), rtol=1e-6)


def test_frames(run: Run) -> None:
    assert len(run.frames) == len(run.fixture["frames"])
    for ours, ref in zip(run.frames, run.fixture["frames"], strict=True):
        assert ours.seq == ref["seq"]
        assert ours.timestamp_s == pytest.approx(ref["timestampS"], abs=1e-12)
        assert ours.state == ref["state"]
        assert ours.model_status == ref["modelStatus"]
        np.testing.assert_allclose(
            ours.delta_rss_db, f32(ref["deltaRssDb"]), rtol=0, atol=DELTA_RSS_ATOL_DB, equal_nan=True
        )
        np.testing.assert_allclose(ours.rss_db, f32(ref["rssDb"]), rtol=0, atol=DELTA_RSS_ATOL_DB, equal_nan=True)
        np.testing.assert_allclose(ours.delivery_ratio, f32(ref["deliveryRatio"]), rtol=0, atol=1e-7)
        np.testing.assert_allclose(ours.motion_energy, f32(ref["motionEnergy"]), rtol=1e-4, equal_nan=True)
        image = f32(ref["image"])
        scale = max(float(np.max(np.abs(image))), 1e-12)
        np.testing.assert_allclose(ours.image, image, rtol=0, atol=IMAGE_RTOL * scale)
        np.testing.assert_allclose(ours.variance_ratio, f32(ref["varianceRatio"]), rtol=0, atol=OCCUPANCY_ATOL)
        np.testing.assert_allclose(ours.occupancy, f32(ref["occupancy"]), rtol=0, atol=OCCUPANCY_ATOL)
