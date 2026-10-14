import numpy as np
import pytest

from echospace_inference.tracking import Detection, Tracker, detect, hungarian
from echospace_sim.config import TrackingConfig
from echospace_sim.presets import load_preset
from echospace_sim.scene import build_grid


def test_hungarian_optimal_gated_and_rectangular() -> None:
    assert hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]) == [1, 0, 2]
    assert hungarian([[0.5, 9], [9, 9]], 1) == [0, -1]
    assert hungarian([[1, 0.1, 5]]) == [1]
    assert hungarian([]) == []
    assert hungarian([[], []]) == [-1, -1]


def test_tracker_confirms_and_estimates_velocity() -> None:
    t = Tracker(TrackingConfig(birth_hits=3, max_misses=2), 1, 10)
    tracks = []
    events = []
    for i in range(20):
        tracks, ev = t.step([Detection((1 + 0.1 * i, 2, 1), 0.9)], 0.1, i * 0.1)
        events += [e.kind for e in ev]
    assert len(tracks) == 1
    assert tracks[0].confirmed
    assert tracks[0].velocity[0] == pytest.approx(1, abs=0.5)
    assert events[:2] == ["track-birth", "track-confirmed"]
    assert len(tracks[0].trail) == 10
    assert tracks[0].id.startswith("T-") and len(tracks[0].id) == 6


def test_tracker_terminates_after_max_misses() -> None:
    t = Tracker(TrackingConfig(birth_hits=3, max_misses=2), 1, 10)
    for i in range(5):
        t.step([Detection((1, 1, 1), 0.9)], 0.1, i)
    kinds = []
    for i in range(5):
        tracks, ev = t.step([], 0.1, 5 + i)
        kinds += [e.kind for e in ev]
    assert "track-death" in kinds
    assert tracks == []


@pytest.mark.parametrize("filt", ["ema", "none"])
def test_other_filters_follow_the_detection(filt: str) -> None:
    t = Tracker(TrackingConfig(filter=filt, birth_hits=1), 3, 5)
    for i in range(10):
        tracks, _ = t.step([Detection((1 + 0.1 * i, 1, 1), 0.8)], 0.1, i)
    assert tracks[0].position[0] == pytest.approx(1.9, abs=0.25)
    assert tracks[0].covariance == (0.35**2, 0.0, 0.35**2)


def test_detect_finds_separated_blobs_with_nms() -> None:
    cfg = load_preset("A")
    g = build_grid(cfg.room, 0.25)
    field = np.zeros((g.nz, g.ny, g.nx), dtype=np.float32)
    field[2:6, 4, 4] = 0.9
    field[2:6, 4, 5] = 0.8
    field[3, 15, 18] = 0.7
    dets = detect(field.ravel(), g, 0.55, 4)
    assert len(dets) == 2
    assert dets[0].score == pytest.approx(0.9)
    x, y, z = dets[0].position
    assert 1.0 < x < 1.5 and y == pytest.approx(g.centers[4 * g.nx, 1])
    assert 0.5 < z < 1.5
    assert detect(field.ravel(), g, 0.55, 1) == dets[:1]
    assert detect(field.ravel(), g, 0.95, 4) == []
