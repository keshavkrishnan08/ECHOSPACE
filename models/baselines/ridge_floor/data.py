"""Synthetic dataset for the ridge floor-occupancy baseline.

Every scene reuses the fixed geometry of preset B (6.00 × 5.00 × 2.80 m room, 8 perimeter
transceivers, B's obstacles and openings, B's signal / impairment / DSP settings) and replaces
only the subjects and the random seed. Recordings are produced by the Python reference simulator
and pipeline (``echospace_inference.ReferenceEngine``), so the per-frame link features are the
ones the TypeScript engine computes at runtime (see services/inference/tests/test_parity.py).

Per frame we record:

* features ``[deltaRssDb (L), motionEnergy (L)]`` with L = 28 links (NaN when a link had no packet);
* the floor-occupancy target on a 0.5 m grid (12 × 10 cells, x fastest): a cell is 1 when its
  centre lies within ``radius + 0.25 m`` of any present subject's floor position, else 0;
* the rti-bayes occupancy produced by the same pipeline run, projected to the same 0.5 m cells
  (see :func:`rti_floor`).

Everything is a deterministic function of the scene seed.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt

from echospace_inference import ReferenceEngine
from echospace_sim import load_preset, parse_scenario
from echospace_sim.scene import VoxelGrid

CELL_M = 0.5
TARGET_MARGIN_M = 0.25
SCENE_DURATION_S = 16.0
WARMUP_FRAMES = 5
"""Frames dropped at the start of each scene while the RSS low-pass filter settles."""
UNKNOWN_VARIANCE_RATIO = 0.95
"""rti-bayes reports occupancy 0.5 ("unknown") where the variance ratio exceeds this value."""

SCENE_SEEDS: list[int] = list(range(1001, 1049))
"""48 scenes. Kind by position i: i % 8 == 0 empty (6), odd i one subject (24), otherwise two subjects (18)."""

WALL_MARGIN_M = 0.45
OBSTACLE_MARGIN_M = 0.25


def scene_kind(seed: int) -> str:
    i = SCENE_SEEDS.index(seed)
    if i % 8 == 0:
        return "empty"
    return "one" if i % 2 else "two"


@dataclass
class SceneData:
    seed: int
    kind: str
    link_ids: list[str]
    t: npt.NDArray[np.float64]
    features: npt.NDArray[np.float32]
    """(T, 2L)"""
    target: npt.NDArray[np.uint8]
    """(T, nx·ny)"""
    rti_observed: npt.NDArray[np.float32]
    """(T, nx·ny) max over observed voxels (variance ratio ≤ 0.95) of the engine's smoothed occupancy."""
    rti_all: npt.NDArray[np.float32]
    """(T, nx·ny) max over all voxels, including the constant 0.5 of unobserved ones."""
    subjects_present: npt.NDArray[np.int8]
    seconds: float


def base_config() -> dict[str, Any]:
    return load_preset("B").to_json_dict()


def floor_grid_shape() -> tuple[int, int]:
    room = base_config()["room"]
    return round(room["width"] / CELL_M), round(room["depth"] / CELL_M)


def _free_point(rng: np.random.Generator, room: dict[str, Any], obstacles: list[dict[str, Any]]) -> tuple[float, float]:
    """A waypoint inside the walls and outside every obstacle footprint (plus margin)."""
    for _ in range(1000):
        x = float(rng.uniform(WALL_MARGIN_M, room["width"] - WALL_MARGIN_M))
        y = float(rng.uniform(WALL_MARGIN_M, room["depth"] - WALL_MARGIN_M))
        blocked = any(
            o["min"][0] - OBSTACLE_MARGIN_M <= x <= o["max"][0] + OBSTACLE_MARGIN_M
            and o["min"][1] - OBSTACLE_MARGIN_M <= y <= o["max"][1] + OBSTACLE_MARGIN_M
            for o in obstacles
        )
        if not blocked:
            return round(x, 3), round(y, 3)
    raise RuntimeError("no free waypoint found")


def _random_subject(
    rng: np.random.Generator, index: int, room: dict[str, Any], obstacles: list[dict[str, Any]], min_delay: float
) -> dict[str, Any]:
    start = _free_point(rng, room, obstacles)
    actions: list[dict[str, Any]] = []
    total = 0.0
    pos = start
    while total < SCENE_DURATION_S + 4:
        to = _free_point(rng, room, obstacles)
        speed = round(float(rng.uniform(0.5, 1.4)), 2)
        actions.append({"type": "walk", "to": list(to), "speed": speed})
        total += math.hypot(to[0] - pos[0], to[1] - pos[1]) / speed
        pos = to
        u = rng.uniform()
        if u < 0.25:
            d = round(float(rng.uniform(1.0, 4.0)), 1)
            actions.append({"type": "stop", "durationS": d})
            total += d
        elif u < 0.45:
            d = round(float(rng.uniform(2.0, 6.0)), 1)
            actions.append({"type": "sit", "durationS": d})
            total += d
        elif u < 0.6:
            actions.append({"type": "turn", "headingDeg": round(float(rng.uniform(-180, 180))), "durationS": 1})
            total += 1
    delay = 0.0 if rng.uniform() < 0.5 else round(float(rng.uniform(1.0, 6.0)), 1)
    return {
        "id": f"s{index + 1}",
        "label": f"S{index + 1}",
        "heightM": round(float(rng.uniform(1.55, 1.95)), 2),
        "radiusM": round(float(rng.uniform(0.18, 0.28)), 2),
        "rcsM2": round(float(rng.uniform(0.7, 1.3)), 2),
        "start": list(start),
        "startHeadingDeg": round(float(rng.uniform(-180, 180))),
        "startDelayS": max(min_delay, delay),
        "actions": actions,
        "loop": True,
    }


def scene_config(seed: int) -> dict[str, Any]:
    """Scenario configuration (camelCase JSON) of one training scene."""
    cfg = base_config()
    rng = np.random.default_rng(seed)
    kind = scene_kind(seed)
    n = {"empty": 0, "one": 1, "two": 2}[kind]
    subjects = []
    for i in range(n):
        # The second subject enters later in about half of the scenes, so frames with one
        # and with two subjects both occur in two-subject scenes.
        min_delay = round(float(rng.uniform(2.0, 8.0)), 1) if i == 1 and rng.uniform() < 0.5 else 0.0
        subjects.append(_random_subject(rng, i, cfg["room"], cfg["obstacles"], min_delay))
    cfg.update(
        scenario="custom",
        name=f"ridge-floor training scene {seed} ({kind})",
        seed=seed,
        durationS=SCENE_DURATION_S,
        subjects=subjects,
    )
    return cfg


def cell_centres(nx: int, ny: int) -> npt.NDArray[np.float64]:
    i, j = np.meshgrid(np.arange(nx), np.arange(ny), indexing="xy")
    return np.stack([(i.ravel() + 0.5) * CELL_M, (j.ravel() + 0.5) * CELL_M], axis=1)


def floor_target(subjects: list[tuple[float, float, float]], centres: npt.NDArray[np.float64]) -> npt.NDArray[np.uint8]:
    """1 for cells whose centre is within radius + TARGET_MARGIN_M of a subject (x, y, radius)."""
    out = np.zeros(len(centres), dtype=bool)
    for x, y, r in subjects:
        out |= np.hypot(centres[:, 0] - x, centres[:, 1] - y) <= r + TARGET_MARGIN_M
    return out.astype(np.uint8)


def rti_floor(
    occupancy: npt.NDArray[np.float32], variance_ratio: npt.NDArray[np.float32], g: VoxelGrid, nx: int, ny: int
) -> tuple[npt.NDArray[np.float32], npt.NDArray[np.float32]]:
    """Projects 3-D rti-bayes occupancy onto the 0.5 m floor cells.

    Max over z, then max over the voxel columns falling in each cell (the 0.25 m engine grid
    nests exactly into 0.5 m cells for this room). Returned twice: over observed voxels only, and
    over all voxels. rti-bayes assigns 0.5 to unobserved voxels, which in this layout include
    the whole bottom and top layers, so the all-voxel projection is ≥ 0.5 everywhere and is not a
    usable detector at threshold 0.5.
    """
    if g.nx % nx or g.ny % ny:
        raise ValueError("engine voxel grid does not nest into the floor cells")
    fx, fy = g.nx // nx, g.ny // ny
    vol = occupancy.reshape(g.nz, g.ny, g.nx)
    observed = variance_ratio.reshape(g.nz, g.ny, g.nx) <= UNKNOWN_VARIANCE_RATIO
    obs = np.where(observed, vol, 0).max(axis=0)
    full = vol.max(axis=0)

    def pool(a: npt.NDArray[np.float32]) -> npt.NDArray[np.float32]:
        return a.reshape(ny, fy, nx, fx).max(axis=(1, 3)).ravel().astype(np.float32)

    return pool(obs), pool(full)


def generate_scene(seed: int) -> SceneData:
    started = time.perf_counter()
    cfg = parse_scenario(scene_config(seed))
    engine = ReferenceEngine(cfg)
    nx, ny = floor_grid_shape()
    centres = cell_centres(nx, ny)
    radius = {s.id: s.radius_m for s in cfg.subjects}
    n_frames = round(SCENE_DURATION_S * cfg.dsp.frame_rate_hz)
    grid = engine.pipeline.grid
    ts, feats, targets, rti_obs, rti_all, present = [], [], [], [], [], []
    for k in range(n_frames):
        frame, gt = engine.step()
        if k < WARMUP_FRAMES:
            continue
        ts.append(frame.timestamp_s)
        feats.append(np.concatenate([frame.delta_rss_db, frame.motion_energy]).astype(np.float32))
        targets.append(floor_target([(s.position[0], s.position[1], radius[s.id]) for s in gt], centres))
        o, a = rti_floor(frame.occupancy, frame.variance_ratio, grid, nx, ny)
        rti_obs.append(o)
        rti_all.append(a)
        present.append(len(gt))
    return SceneData(
        seed=seed,
        kind=scene_kind(seed),
        link_ids=[link.id for link in engine.source.links],
        t=np.array(ts),
        features=np.stack(feats),
        target=np.stack(targets),
        rti_observed=np.stack(rti_obs),
        rti_all=np.stack(rti_all),
        subjects_present=np.array(present, dtype=np.int8),
        seconds=time.perf_counter() - started,
    )


def generate_scenes(seeds: list[int], workers: int) -> list[SceneData]:
    """Generates scenes in parallel processes; the result is independent of `workers`."""
    if workers <= 1:
        return [generate_scene(s) for s in seeds]
    from multiprocessing import get_context

    with get_context("fork").Pool(workers) as pool:
        return pool.map(generate_scene, seeds, chunksize=1)


# ---------------------------------------------------------------------------------------------
# Model and metrics shared by train.py and models/evaluation/evaluate.py


def ridge_predict(
    weights: dict[str, Any], x: npt.NDArray[np.floating]
) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    """Batch version of ``ridgePredict`` in packages/engine/src/recon/ridge.ts.

    Returns the clipped cell scores (T, C) and the per-frame mean |z| used for the OOD check.
    """
    mean = np.asarray(weights["mean"], dtype=np.float64)
    std = np.asarray(weights["std"], dtype=np.float64)
    std = np.where(std == 0, 1.0, std)
    W = np.asarray(weights["W"], dtype=np.float64).reshape(len(mean), len(weights["b"]))
    b = np.asarray(weights["b"], dtype=np.float64)
    xa = np.asarray(x, dtype=np.float64)
    xa = np.where(np.isfinite(xa), xa, mean)
    z = (xa - mean) / std
    return np.clip(z @ W + b, 0.0, 1.0), np.mean(np.abs(z), axis=1)


def detection_metrics(
    score: npt.NDArray[np.floating], target: npt.NDArray[np.integer], threshold: float
) -> dict[str, Any]:
    """Cell-level metrics pooled over all frames, plus per-frame IoU statistics.

    ``iou`` = Σ|P∩T| / Σ|P∪T| over frames (micro average). ``medianFrameIou`` is the median of
    per-frame IoU over frames whose union is non-empty. ``emptyFrameFalsePositiveRate`` is the
    fraction of frames without any subject in which at least one cell is predicted occupied.
    """
    p = np.asarray(score) >= threshold
    t = np.asarray(target) > 0
    inter = np.sum(p & t, axis=1)
    union = np.sum(p | t, axis=1)
    tp = int(inter.sum())
    fp = int(np.sum(p & ~t))
    fn = int(np.sum(~p & t))
    nonempty = union > 0
    frame_iou = inter[nonempty] / union[nonempty]
    empty = ~t.any(axis=1)
    return {
        "frames": len(t),
        "iou": tp / (tp + fp + fn) if tp + fp + fn else None,
        "precision": tp / (tp + fp) if tp + fp else None,
        "recall": tp / (tp + fn) if tp + fn else None,
        "medianFrameIou": float(np.median(frame_iou)) if len(frame_iou) else None,
        "meanFrameIou": float(np.mean(frame_iou)) if len(frame_iou) else None,
        "emptyFrames": int(empty.sum()),
        "emptyFrameFalsePositiveRate": float(np.mean(p[empty].any(axis=1))) if empty.any() else None,
    }
