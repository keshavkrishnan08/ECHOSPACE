"""Evaluation against synthetic ground truth (port of metrics/evaluate.ts).

All functions here are only meaningful when the source provides ground truth (synthetic
scenarios); their outputs are simulation metrics. Track-to-truth matching uses
``scipy.optimize.linear_sum_assignment`` (see :func:`echospace_inference.tracking.hungarian`)
and Chamfer distances ``scipy.spatial.distance.cdist``.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np
import numpy.typing as npt
from scipy.spatial.distance import cdist

from echospace_sim.scene import VoxelGrid
from echospace_sim.source import GroundTruthSubject

from .occupancy import floor_projection
from .tracking import Track, hungarian

MATCH_RADIUS_M = 0.75


def _max_joint_z(s: GroundTruthSubject) -> float:
    m = max(0.0, float(np.max(s.joints[2::3]))) if len(s.joints) else 0.0
    return m or s.height_m


def ground_truth_occupancy(g: VoxelGrid, subjects: Sequence[GroundTruthSubject]) -> npt.NDArray[np.uint8]:
    """Ground-truth body occupancy: voxel centres inside each subject's vertical body cylinder."""
    out = np.zeros(g.count, dtype=np.uint8)
    c = g.centers
    for s in subjects:
        top = _max_joint_z(s) + 0.08
        r = s.radius_m
        dx = c[:, 0] - s.position[0]
        dy = c[:, 1] - s.position[1]
        inside = (dx * dx + dy * dy <= r * r + 0.25 * g.size * g.size) & (c[:, 2] <= top)
        out[inside] = 1
    return out


def iou(pred: npt.ArrayLike, truth: npt.ArrayLike, threshold: float) -> float | None:
    """Intersection over union of `pred` ≥ threshold against `truth` > 0; None when both are empty."""
    p = np.asarray(pred) >= threshold
    t = np.asarray(truth) > 0
    union = int(np.count_nonzero(p | t))
    return int(np.count_nonzero(p & t)) / union if union else None


def floor_from_voxels(field_: npt.ArrayLike, g: VoxelGrid) -> npt.NDArray[np.float32]:
    return floor_projection(field_, g)


def body_surface_points(subjects: Sequence[GroundTruthSubject]) -> npt.NDArray[np.float64]:
    """Deterministic samples on each subject's body cylinder surface (32 around × 6 heights), shape (n, 3)."""
    pts: list[tuple[float, float, float]] = []
    for s in subjects:
        top = _max_joint_z(s)
        for h in range(6):
            z = ((h + 0.5) / 6) * top
            for a in range(32):
                th = (a / 32) * 2 * math.pi
                pts.append((s.position[0] + s.radius_m * math.cos(th), s.position[1] + s.radius_m * math.sin(th), z))
    return np.array(pts, dtype=np.float64).reshape(-1, 3)


def chamfer(a: npt.ArrayLike, b: npt.ArrayLike, max_a: int = 800) -> float | None:
    """Symmetric mean nearest-neighbour (Chamfer) distance.

    `a` is a stride-5 point cloud (x, y, z, confidence, value), subsampled to about `max_a`
    points; `b` is an (n, 3) array or a flat stride-3 array.
    """
    pa = np.asarray(a, dtype=np.float64).reshape(-1, 5)
    pb = np.asarray(b, dtype=np.float64).reshape(-1, 3)
    if not len(pa) or not len(pb):
        return None
    step = max(1, len(pa) // max_a)
    d2 = cdist(pa[::step, :3], pb, metric="sqeuclidean")
    return 0.5 * (float(np.mean(np.sqrt(d2.min(axis=1)))) + float(np.mean(np.sqrt(d2.min(axis=0)))))


@dataclass
class TrackMatch:
    gt_id: str
    track_id: str
    error_m: float


@dataclass
class TrackEvaluation:
    position_error_m: float | None
    precision: float | None
    recall: float | None
    matches: list[TrackMatch] = field(default_factory=list)


def evaluate_tracks(tracks: Sequence[Track], gt: Sequence[GroundTruthSubject]) -> TrackEvaluation:
    """Matches confirmed tracks to ground truth within MATCH_RADIUS_M (minimum total floor distance)."""
    confirmed = [t for t in tracks if t.confirmed]
    if not gt:
        return TrackEvaluation(None, 0.0 if confirmed else None, None)
    cost = [[math.hypot(t.position[0] - s.position[0], t.position[1] - s.position[1]) for t in confirmed] for s in gt]
    assign = hungarian(cost, MATCH_RADIUS_M) if confirmed else [-1] * len(gt)
    matches = [TrackMatch(gt[gi].id, confirmed[ti].id, cost[gi][ti]) for gi, ti in enumerate(assign) if ti >= 0]
    err = sum(m.error_m for m in matches) / len(matches) if matches else None
    return TrackEvaluation(
        position_error_m=err,
        precision=len(matches) / len(confirmed) if confirmed else None,
        recall=len(matches) / len(gt),
        matches=matches,
    )


class IdSwitchCounter:
    """Counts identity switches: a ground-truth subject matched to a different track than before."""

    def __init__(self) -> None:
        self._last: dict[str, str] = {}
        self.total = 0

    def update(self, matches: Sequence[TrackMatch]) -> list[str]:
        switched: list[str] = []
        for m in matches:
            prev = self._last.get(m.gt_id)
            if prev and prev != m.track_id:
                self.total += 1
                switched.append(f"{m.gt_id}: {prev} → {m.track_id}")
            self._last[m.gt_id] = m.track_id
        return switched

    def reset(self) -> None:
        self._last.clear()
        self.total = 0


@dataclass
class CalibrationBin:
    lo: float
    hi: float
    mean_p: float
    freq: float
    n: int


def expected_calibration_error(
    p: npt.ArrayLike, truth: npt.ArrayLike, bins: int = 10
) -> tuple[float, list[CalibrationBin]]:
    """Expected calibration error with equal-width bins, for voxel probabilities vs. binary truth."""
    pa = np.asarray(p, dtype=np.float64)
    ta = (np.asarray(truth) > 0).astype(np.float64)
    idx = np.minimum(bins - 1, np.floor(pa * bins).astype(np.int64))
    n = np.bincount(idx, minlength=bins)
    sp = np.bincount(idx, weights=pa, minlength=bins)
    st = np.bincount(idx, weights=ta, minlength=bins)
    mean_p = np.divide(sp, n, out=np.zeros(bins), where=n > 0)
    freq = np.divide(st, n, out=np.zeros(bins), where=n > 0)
    ece = float(np.sum(n / max(1, pa.size) * np.abs(mean_p - freq)))
    out = [CalibrationBin(i / bins, (i + 1) / bins, float(mean_p[i]), float(freq[i]), int(n[i])) for i in range(bins)]
    return ece, out


def percentile(values: Sequence[float], q: float) -> float | None:
    """Linear-interpolation percentile (q in [0, 1]) over the finite values; None when there are none."""
    v = sorted(x for x in values if math.isfinite(x))
    if not v:
        return None
    pos = (len(v) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    return v[lo] + (v[hi] - v[lo]) * (pos - lo)
