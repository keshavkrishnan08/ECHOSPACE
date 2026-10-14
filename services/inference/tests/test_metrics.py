import math

import numpy as np
import pytest

from echospace_inference.metrics import (
    IdSwitchCounter,
    TrackMatch,
    body_surface_points,
    chamfer,
    evaluate_tracks,
    expected_calibration_error,
    ground_truth_occupancy,
    iou,
    percentile,
)
from echospace_inference.tracking import Track
from echospace_sim.presets import load_preset
from echospace_sim.scene import build_grid
from echospace_sim.source import GroundTruthSubject, SyntheticSource


def _gt(x: float = 1.0, y: float = 1.0) -> GroundTruthSubject:
    return GroundTruthSubject("s", "S", (x, y, 1.0), (0, 0, 0), 0.0, "standing", np.zeros(51, np.float32), 1.7, 0.2)


def _track(x: float, confirmed: bool = True, tid: str = "T") -> Track:
    return Track(tid, (x, 1.0, 1.0), (0, 0, 0), (0, 0, 0), 1, 3, 0, confirmed, 1.0, [])


def test_iou() -> None:
    assert iou([1, 1, 0, 0], [1, 0, 1, 0], 0.5) == pytest.approx(1 / 3)
    assert iou([0, 0], [0, 0], 0.5) is None


def test_chamfer() -> None:
    a = np.array([0, 0, 0, 1, 1, 1, 0, 0, 1, 1], dtype=np.float32)
    b = np.array([0, 0, 0, 1, 0, 0], dtype=np.float64)
    assert chamfer(a, b) == pytest.approx(0, abs=1e-6)
    shifted = np.array([0, 0, 1, 1, 1], dtype=np.float32)
    assert chamfer(shifted, np.array([0.0, 0.0, 0.0])) == pytest.approx(1)
    assert chamfer(np.zeros(0, np.float32), b) is None


def test_expected_calibration_error() -> None:
    ece, bins = expected_calibration_error([0, 0, 1, 1], [0, 0, 1, 1])
    assert ece == pytest.approx(0, abs=1e-12)
    assert len(bins) == 10 and bins[9].n == 2
    ece, _ = expected_calibration_error([0.8] * 10, [1] * 4 + [0] * 6)
    assert ece == pytest.approx(0.4)


def test_percentile() -> None:
    assert percentile([1, 2, 3, 4], 0.5) == pytest.approx(2.5)
    assert percentile([4, math.nan, 1], 1) == 4
    assert percentile([], 0.5) is None


def test_id_switch_counter() -> None:
    c = IdSwitchCounter()
    c.update([TrackMatch("a", "T1", 0)])
    assert c.update([TrackMatch("a", "T2", 0)]) == ["a: T1 → T2"]
    assert c.total == 1


def test_evaluate_tracks_with_match_radius() -> None:
    assert evaluate_tracks([_track(1.2)], [_gt()]).recall == 1
    far = evaluate_tracks([_track(3)], [_gt()])
    assert far.recall == 0 and far.precision == 0 and far.position_error_m is None
    assert evaluate_tracks([_track(1.2, confirmed=False)], [_gt()]).precision is None
    assert evaluate_tracks([_track(1.0)], []).precision == 0


def test_evaluate_tracks_assigns_globally() -> None:
    gts = [GroundTruthSubject(i, i, (x, 1.0, 1.0), (0, 0, 0), 0, "standing", np.zeros(51, np.float32), 1.7, 0.2)
           for i, x in (("a", 1.0), ("b", 1.6))]  # fmt: skip
    ev = evaluate_tracks([_track(1.3, tid="T1"), _track(1.9, tid="T2")], gts)
    assert {(m.gt_id, m.track_id) for m in ev.matches} == {("a", "T1"), ("b", "T2")}
    assert ev.position_error_m == pytest.approx(0.3)


def test_ground_truth_occupancy_and_surface_points() -> None:
    cfg = load_preset("B")
    g = build_grid(cfg.room, 0.25)
    gt = SyntheticSource(cfg).ground_truth(2.0)
    occ = ground_truth_occupancy(g, gt)
    assert occ.dtype == np.uint8
    filled = g.centers[occ == 1]
    assert len(filled) > 0
    assert np.all(np.hypot(filled[:, 0] - gt[0].position[0], filled[:, 1] - gt[0].position[1]) < 0.4)
    pts = body_surface_points(gt)
    assert pts.shape == (192, 3)
    np.testing.assert_allclose(np.hypot(pts[:, 0] - gt[0].position[0], pts[:, 1] - gt[0].position[1]), 0.22)
