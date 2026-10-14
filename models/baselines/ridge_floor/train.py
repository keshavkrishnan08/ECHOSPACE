"""Train the ridge floor-occupancy baseline (``ridge-floor``) on synthetic scenes.

    python models/baselines/ridge_floor/train.py [--workers 4] [--out var/datasets/synthetic-ridge-v1.npz]

Steps (all deterministic given the constants in data.py):

1. Generate 48 synthetic recordings in the fixed scenario-B geometry with the Python reference
   simulator + pipeline (data.py).
2. Split by scene seed into train / validation / test, stratified by scene kind (empty, one
   subject, two subjects). Frames of one scene never appear in two splits.
3. Fill missing features with the training mean, standardize with training mean / std.
4. Closed-form ridge regression for each α in ALPHAS. For each α, find the decision threshold τ
   on the clipped scores that maximizes pooled validation IoU; keep the (α, τ) pair with the best
   validation IoU.
5. Operating point: least-squares fits to sparse 0/1 targets are shrunk towards the base rate,
   so the validation-optimal threshold τ* is well below 0.5. The output is rescaled by
   g = 0.5 / τ* (folded into W and b; ``ridgePredict`` stays a plain clipped linear map) so that
   the engine's nominal 0.5 decision level corresponds to τ*. Scores are detection scores, not
   probabilities.
6. Choose the out-of-distribution limit as the 99.5th percentile of per-frame mean |z| on the
   validation scenes.
7. Evaluate on the held-out test scenes against the rti-bayes output of the same pipeline runs,
   both at fixed thresholds and at an rti-bayes threshold chosen on the same validation scenes.

Outputs: weights.json (the ``RidgeWeights`` interface of packages/engine/src/recon/ridge.ts),
metrics.json, and datasets/manifests/synthetic-ridge-v1.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import sys
import time
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt

sys.path.insert(0, str(Path(__file__).resolve().parent))

import data

ROOT = Path(__file__).resolve().parents[3]
OUT_DIR = Path(__file__).resolve().parent
MANIFEST = ROOT / "datasets" / "manifests" / "synthetic-ridge-v1.json"

MODEL_ID = "ridge-floor"
MODEL_VERSION = "1.0.0"
PREPROCESSING_VERSION = "pp-1.0.0"
DATASET_ID = "synthetic-ridge-v1"
ALPHAS = [1e-2, 1e-1, 1.0, 10.0, 100.0, 1e3, 1e4, 1e5]
THRESHOLD = 0.5
"""Deployed decision level of the (rescaled) ridge scores."""
RIDGE_TAU_GRID = [round(0.05 * i, 2) for i in range(2, 11)]
RTI_TAU_GRID = [round(0.05 * i, 2) for i in range(10, 20)]
SPLIT_SEED = 20261014
SPLIT_FRACTIONS = (0.70, 0.15, 0.15)
OOD_PERCENTILE = 99.5


def js_to_fixed(v: float, digits: int = 2) -> str:
    """JavaScript ``Number.prototype.toFixed`` for ordinary magnitudes.

    toFixed rounds the exact binary value half away from zero (Python's format() rounds half to
    even, which differs for values such as 4.125).
    """
    return f"{Decimal(v).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP):f}"


def geometry_key(room: dict[str, Any], sensors: list[dict[str, Any]]) -> str:
    """Same string as ``geometryKey(room, sensors)`` in packages/engine/src/recon/ridge.ts."""
    r = f"{js_to_fixed(room['width'])}x{js_to_fixed(room['depth'])}x{js_to_fixed(room['height'])}"
    s = ";".join(",".join(js_to_fixed(v) for v in n["position"]) for n in sensors if n.get("enabled", True))
    return f"{r}|{s}"


def split_by_scene(seeds: list[int]) -> dict[str, list[int]]:
    rng = np.random.default_rng(SPLIT_SEED)
    out: dict[str, list[int]] = {"train": [], "val": [], "test": []}
    for kind in ("empty", "one", "two"):
        group = [s for s in seeds if data.scene_kind(s) == kind]
        group = [group[i] for i in rng.permutation(len(group))]
        n_val = max(1, round(len(group) * SPLIT_FRACTIONS[1]))
        n_test = max(1, round(len(group) * SPLIT_FRACTIONS[2]))
        out["val"] += group[:n_val]
        out["test"] += group[n_val : n_val + n_test]
        out["train"] += group[n_val + n_test :]
    return {k: sorted(v) for k, v in out.items()}


def stack(scenes: list[data.SceneData], seeds: list[int], attr: str) -> npt.NDArray[Any]:
    by_seed = {s.seed: s for s in scenes}
    return np.concatenate([getattr(by_seed[s], attr) for s in seeds])


def fit_ridge(
    Z: npt.NDArray[np.float64], Y: npt.NDArray[np.float64], alpha: float
) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    """Closed-form ridge on standardized (zero-mean) inputs; the intercept is not penalized."""
    y_mean = Y.mean(axis=0)
    A = Z.T @ Z + alpha * np.eye(Z.shape[1])
    W = np.linalg.solve(A, Z.T @ (Y - y_mean))
    return W, y_mean


def weights_dict(
    link_ids: list[str],
    mean: npt.NDArray[np.float64],
    std: npt.NDArray[np.float64],
    W: npt.NDArray[np.float64],
    b: npt.NDArray[np.float64],
    ood: float,
    geometry: str,
    nx: int,
    ny: int,
) -> dict[str, Any]:
    room = data.base_config()["room"]
    n_nodes = sum(1 for s in data.base_config()["sensors"] if s["enabled"])
    return {
        "id": MODEL_ID,
        "version": MODEL_VERSION,
        "geometryKey": geometry,
        "links": len(link_ids),
        "featureNames": [f"deltaRssDb[{i}]" for i in link_ids] + [f"motionEnergy[{i}]" for i in link_ids],
        "mean": [float(v) for v in mean],
        "std": [float(v) for v in std],
        "W": [float(v) for v in W.ravel()],
        "b": [float(v) for v in b],
        "grid": {"nx": nx, "ny": ny, "cellM": data.CELL_M},
        "oodMaxMeanAbsZ": round(float(ood), 4),
        "trainedOn": (
            f"{room['width']:.2f}×{room['depth']:.2f}×{room['height']:.2f} m room, "
            f"{n_nodes} perimeter nodes (scenario B layout)"
        ),
    }


def best_threshold(score: npt.NDArray[Any], target: npt.NDArray[Any], grid: list[float]) -> tuple[float, float]:
    """(threshold, IoU) maximizing pooled IoU over `grid`; ties go to the higher threshold."""
    best = (grid[0], -1.0)
    for t in grid:
        v = data.detection_metrics(score, target, t)["iou"] or 0.0
        if v >= best[1]:
            best = (t, v)
    return best


def evaluate_split(
    scenes: list[data.SceneData], seeds: list[int], weights: dict[str, Any], rti_tau: float
) -> dict[str, Any]:
    """Ridge vs. rti-bayes on the given scenes, overall and per scene kind."""
    X = stack(scenes, seeds, "features")
    Y = stack(scenes, seeds, "target")
    rti_obs = stack(scenes, seeds, "rti_observed")
    rti_all = stack(scenes, seeds, "rti_all")
    kinds = np.concatenate([[data.scene_kind(s)] * len(next(x for x in scenes if x.seed == s).t) for s in seeds])
    pred, mean_abs_z = data.ridge_predict(weights, X)
    out: dict[str, Any] = {
        "ridge": data.detection_metrics(pred, Y, THRESHOLD),
        "rtiObservedT05": data.detection_metrics(rti_obs, Y, THRESHOLD),
        "rtiObservedT06": data.detection_metrics(rti_obs, Y, 0.6),
        "rtiObservedValTuned": {"threshold": rti_tau, **data.detection_metrics(rti_obs, Y, rti_tau)},
        "rtiAllVoxelsT05": data.detection_metrics(rti_all, Y, THRESHOLD),
        "ridgeOodFraction": float(np.mean(mean_abs_z > weights["oodMaxMeanAbsZ"])),
        "byKind": {},
    }
    for kind in ("empty", "one", "two"):
        m = kinds == kind
        if m.any():
            out["byKind"][kind] = {
                "ridge": data.detection_metrics(pred[m], Y[m], THRESHOLD),
                "rtiObservedT05": data.detection_metrics(rti_obs[m], Y[m], THRESHOLD),
                "rtiObservedValTuned": data.detection_metrics(rti_obs[m], Y[m], rti_tau),
            }
    return out


def dataset_checksum(scenes: list[data.SceneData]) -> str:
    h = hashlib.sha256()
    for s in sorted(scenes, key=lambda x: x.seed):
        h.update(np.ascontiguousarray(s.features).tobytes())
        h.update(np.ascontiguousarray(s.target).tobytes())
    return "sha256:" + h.hexdigest()


def machine_info() -> dict[str, Any]:
    return {
        "platform": platform.platform(),
        "processor": platform.processor() or platform.machine(),
        "cpuCount": os.cpu_count(),
        "python": platform.python_version(),
        "numpy": np.__version__,
    }


def write_manifest(scenes: list[data.SceneData], splits: dict[str, list[int]], checksum: str, nx: int, ny: int) -> None:
    issues: list[str] = []
    all_seeds = [s for v in splits.values() for s in v]
    if len(all_seeds) != len(set(all_seeds)):
        issues.append("a scene seed appears in more than one split")
    for s in scenes:
        if not np.isin(s.target, (0, 1)).all():
            issues.append(f"scene {s.seed}: non-binary target")
        if s.features.shape[1] != 56 or s.target.shape[1] != nx * ny:
            issues.append(f"scene {s.seed}: unexpected array shape")
    cfg = data.base_config()
    frames = sum(len(s.t) for s in scenes)
    manifest = {
        "id": DATASET_ID,
        "name": "Synthetic ridge-floor training set (scenario B geometry)",
        "version": "1.0.0",
        "source": "synthetic",
        "license": "generated, CC0 for the configs",
        "usageRestrictions": (
            "Synthetic data from a simplified, uncalibrated channel model. Suitable for testing the pipeline "
            "and for training/evaluating baselines on the same simulator; not evidence of real-world performance."
        ),
        "captureMethodology": (
            "Generated by models/baselines/ridge_floor/train.py with the Python reference simulator "
            "(echospace_sim) and pipeline (echospace_inference.ReferenceEngine). Fixed scenario-B geometry; "
            "per scene: random waypoint walks (0.5-1.4 m/s) with stops, sits and turns for 0, 1 or 2 subjects, "
            "random start delays giving empty-room segments. Regenerated deterministically from the seeds; the "
            "arrays are not committed."
        ),
        "durationS": round(len(scenes) * data.SCENE_DURATION_S, 1),
        "sampleFormat": (
            "per frame (10 Hz): float32 features [deltaRssDb x28, motionEnergy x28]; uint8 floor target 12x10 "
            "cells (0.5 m, x fastest); float32 rti-bayes floor projection 12x10"
        ),
        "channelCount": 28,
        "sampleRateHz": cfg["dsp"]["frameRateHz"],
        "sceneMetadata": {
            "baseScenario": "B",
            "room": cfg["room"],
            "geometryKey": geometry_key(cfg["room"], cfg["sensors"]),
            "packetRateHz": cfg["signal"]["packetRateHz"],
            "sceneDurationS": data.SCENE_DURATION_S,
            "warmupFramesDropped": data.WARMUP_FRAMES,
            "frames": frames,
            "scenesByKind": {k: sum(1 for s in scenes if s.kind == k) for k in ("empty", "one", "two")},
            "targetDefinition": (
                f"cell = 1 if its centre is within subject radius + {data.TARGET_MARGIN_M} m of a present subject"
            ),
            "regenerate": "python models/baselines/ridge_floor/train.py --out var/datasets/synthetic-ridge-v1.npz",
        },
        "annotations": ["floor-occupancy-0.5m", "subject-count", "rti-bayes-floor-projection"],
        "splits": {k: [str(s) for s in v] for k, v in splits.items()},
        "validation": {
            "status": "invalid" if issues else "valid",
            "checkedAt": datetime.now(UTC).isoformat(timespec="seconds"),
            "issues": issues,
        },
        "consent": "not-applicable",
        "checksum": checksum,
    }
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1))
    ap.add_argument("--out", type=Path, default=None, help="optional .npz dump of the generated arrays")
    args = ap.parse_args()

    started = time.perf_counter()
    nx, ny = data.floor_grid_shape()
    seeds = data.SCENE_SEEDS
    print(f"generating {len(seeds)} scenes with {args.workers} workers ...", flush=True)
    scenes = data.generate_scenes(seeds, args.workers)
    gen_seconds = time.perf_counter() - started
    print(f"generated in {gen_seconds:.0f} s", flush=True)
    link_ids = scenes[0].link_ids

    splits = split_by_scene(seeds)
    X_tr = stack(scenes, splits["train"], "features").astype(np.float64)
    Y_tr = stack(scenes, splits["train"], "target").astype(np.float64)
    X_va = stack(scenes, splits["val"], "features").astype(np.float64)
    Y_va = stack(scenes, splits["val"], "target")

    mean = np.nanmean(X_tr, axis=0)
    X_tr = np.where(np.isfinite(X_tr), X_tr, mean)
    std = X_tr.std(axis=0)
    std = np.where(std > 1e-9, std, 1.0)
    Z_tr = (X_tr - mean) / std

    cfg = data.base_config()
    geometry = geometry_key(cfg["room"], cfg["sensors"])
    curve = []
    best: tuple[float, float, float] | None = None  # (alpha, tau, val IoU)
    for alpha in ALPHAS:
        W, b = fit_ridge(Z_tr, Y_tr, alpha)
        pred, _ = data.ridge_predict(weights_dict(link_ids, mean, std, W, b, np.inf, geometry, nx, ny), X_va)
        tau, val_iou = best_threshold(pred, Y_va, RIDGE_TAU_GRID)
        at05 = data.detection_metrics(pred, Y_va, THRESHOLD)["iou"]
        mse = float(np.mean((pred - Y_va) ** 2))
        curve.append(
            {
                "alpha": alpha,
                "valIouAt0.5": at05,
                "valBestThreshold": tau,
                "valIouAtBestThreshold": val_iou,
                "valMse": mse,
            }
        )
        print(
            f"alpha={alpha:g}: val IoU {val_iou:.4f} at threshold {tau} (at 0.5: {at05 or 0:.4f}), MSE {mse:.5f}",
            flush=True,
        )
        if best is None or val_iou >= best[2]:
            best = (alpha, tau, val_iou)
    assert best is not None
    alpha, tau, _ = best
    gain = THRESHOLD / tau
    W, b = fit_ridge(Z_tr, Y_tr, alpha)
    W, b = W * gain, b * gain
    w = weights_dict(link_ids, mean, std, W, b, np.inf, geometry, nx, ny)
    _, val_abs_z = data.ridge_predict(w, X_va)
    ood = float(np.percentile(val_abs_z, OOD_PERCENTILE))
    w = weights_dict(link_ids, mean, std, W, b, ood, geometry, nx, ny)
    rti_tau, rti_val_iou = best_threshold(stack(scenes, splits["val"], "rti_observed"), Y_va, RTI_TAU_GRID)

    train_pred, _ = data.ridge_predict(w, stack(scenes, splits["train"], "features"))
    test = evaluate_split(scenes, splits["test"], w, rti_tau)
    val = evaluate_split(scenes, splits["val"], w, rti_tau)
    checksum = dataset_checksum(scenes)

    (OUT_DIR / "weights.json").write_text(json.dumps(w, separators=(",", ":")) + "\n", encoding="utf-8")
    write_manifest(scenes, splits, checksum, nx, ny)

    frames = {k: int(sum(len(s.t) for s in scenes if s.seed in v)) for k, v in splits.items()}
    metrics = {
        "model": {"id": MODEL_ID, "version": MODEL_VERSION, "preprocessingVersion": PREPROCESSING_VERSION},
        "dataset": {"id": DATASET_ID, "checksum": checksum, "scenes": len(scenes), "framesBySplit": frames},
        "splits": splits,
        "splitMethod": f"by scene seed, stratified by scene kind, numpy default_rng({SPLIT_SEED})",
        "features": "deltaRssDb (28 links) + motionEnergy (28 links); NaN replaced by the training mean",
        "target": (
            f"{nx}x{ny} floor cells of {data.CELL_M} m; 1 if the cell centre is within subject radius + "
            f"{data.TARGET_MARGIN_M} m of a present subject"
        ),
        "threshold": THRESHOLD,
        "alphaGrid": ALPHAS,
        "alpha": alpha,
        "alphaSelection": "maximum pooled validation IoU at the best threshold per alpha (ties → larger alpha)",
        "validationCurve": curve,
        "operatingPoint": {
            "rawThreshold": tau,
            "outputGain": gain,
            "rule": "validation-optimal threshold tau* on the clipped raw scores; W and b multiplied by 0.5 / tau* "
            "so that ridge scores >= 0.5 are exactly raw scores >= tau*",
        },
        "rtiThresholdSelection": {
            "grid": RTI_TAU_GRID,
            "threshold": rti_tau,
            "valIou": rti_val_iou,
            "rule": "same procedure as the ridge operating point, on the rti-bayes observed-voxel floor projection",
        },
        "oodMaxMeanAbsZ": w["oodMaxMeanAbsZ"],
        "oodRule": f"{OOD_PERCENTILE}th percentile of per-frame mean |z| over the validation frames",
        "train": {"ridge": data.detection_metrics(train_pred, stack(scenes, splits["train"], "target"), THRESHOLD)},
        "validation": val,
        "test": test,
        "comparisonNotes": [
            "Metrics are pooled over all frames of the split (micro-averaged cell counts).",
            "Ridge is evaluated on its per-frame output (no temporal smoothing) at 0.5, its validation-chosen "
            "operating point.",
            "rtiObservedValTuned applies a threshold chosen on the validation scenes, so both models get an "
            "operating point tuned on identical data.",
            "rti-bayes is the engine output of the same pipeline runs: per-voxel occupancy after the default EMA "
            "(0.5) and 3x3x3 box filter at 0.25 m voxels, projected to 0.5 m cells by max over z and over the "
            "2x2 voxel columns of each cell.",
            "rtiObserved* takes the max over voxels with posterior variance ratio <= 0.95 only. rti-bayes reports "
            "0.5 ('unknown') for unobserved voxels, which include the entire bottom and top voxel layers here, "
            "so the all-voxel projection (rtiAllVoxelsT05) marks every cell occupied at threshold 0.5.",
            "rtiObservedT06 uses the engine's default occupancyThreshold (0.6).",
        ],
        "runtime": {
            "totalSeconds": round(time.perf_counter() - started, 1),
            "generationSeconds": round(gen_seconds, 1),
            "workers": args.workers,
            "sceneSecondsMean": round(float(np.mean([s.seconds for s in scenes])), 1),
        },
        "machine": machine_info(),
        "createdAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "caveat": "Synthetic test scenes from the same simulator and geometry as training; not validated on real data.",
    }
    (OUT_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            args.out,
            seeds=np.concatenate([[s.seed] * len(s.t) for s in scenes]),
            t=np.concatenate([s.t for s in scenes]),
            features=np.concatenate([s.features for s in scenes]),
            target=np.concatenate([s.target for s in scenes]),
            rti_observed=np.concatenate([s.rti_observed for s in scenes]),
            subjects_present=np.concatenate([s.subjects_present for s in scenes]),
        )

    r, q, v = test["ridge"], test["rtiObservedT05"], test["rtiObservedValTuned"]
    print(f"alpha={alpha:g}, raw threshold {tau} (gain {gain:.3f}), OOD limit {w['oodMaxMeanAbsZ']}")
    print(f"test ridge: IoU {r['iou']:.3f} P {r['precision']:.3f} R {r['recall']:.3f}")
    print(f"test rti-bayes (observed, 0.5): IoU {q['iou']:.3f} P {q['precision']:.3f} R {q['recall']:.3f}")
    print(f"test rti-bayes (observed, {rti_tau}): IoU {v['iou']:.3f} P {v['precision']:.3f} R {v['recall']:.3f}")
    print(f"total {time.perf_counter() - started:.0f} s")


if __name__ == "__main__":
    main()
