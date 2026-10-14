"""Re-run the ridge-floor test evaluation from the saved weights and compare with metrics.json.

    python models/evaluation/evaluate.py [--workers 4] [--tolerance 1e-9]

Regenerates the held-out test scenes listed in models/baselines/ridge_floor/metrics.json with
the reference simulator, applies weights.json exactly as ``ridgePredict`` in
packages/engine/src/recon/ridge.ts does, recomputes the test metrics for ridge-floor and
rti-bayes, and checks them against metrics.json and the evaluation entries of
models/registry.json. Exits with status 1 on any mismatch.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
RIDGE_DIR = ROOT / "models" / "baselines" / "ridge_floor"
sys.path.insert(0, str(RIDGE_DIR))

import data  # noqa: E402
import train  # noqa: E402

# Registry evaluation entries that must equal a value in metrics.json["test"].
REGISTRY_CHECKS = {
    ("ridge-floor", "floor-iou@0.5"): ("ridge", "iou"),
    ("ridge-floor", "precision@0.5"): ("ridge", "precision"),
    ("ridge-floor", "recall@0.5"): ("ridge", "recall"),
    ("rti-bayes", "floor-iou@0.5"): ("rtiObservedT05", "iou"),
    ("rti-bayes", "precision@0.5"): ("rtiObservedT05", "precision"),
    ("rti-bayes", "recall@0.5"): ("rtiObservedT05", "recall"),
    ("rti-bayes", "floor-iou@val-tuned"): ("rtiObservedValTuned", "iou"),
}


def compare(expected: Any, actual: Any, path: str, tol: float, errors: list[str]) -> None:
    if isinstance(expected, dict):
        for k, v in expected.items():
            if k not in actual:
                errors.append(f"{path}.{k}: missing in recomputed result")
            else:
                compare(v, actual[k], f"{path}.{k}", tol, errors)
    elif isinstance(expected, float) or isinstance(actual, float):
        if expected is None or actual is None or not math.isclose(expected, actual, rel_tol=0, abs_tol=tol):
            errors.append(f"{path}: expected {expected}, got {actual}")
    elif expected != actual:
        errors.append(f"{path}: expected {expected!r}, got {actual!r}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1))
    ap.add_argument("--tolerance", type=float, default=1e-9)
    args = ap.parse_args()

    weights = json.loads((RIDGE_DIR / "weights.json").read_text(encoding="utf-8"))
    metrics = json.loads((RIDGE_DIR / "metrics.json").read_text(encoding="utf-8"))
    registry = json.loads((ROOT / "models" / "registry.json").read_text(encoding="utf-8"))
    errors: list[str] = []

    cfg = data.base_config()
    if weights["geometryKey"] != train.geometry_key(cfg["room"], cfg["sensors"]):
        errors.append("weights.geometryKey does not match the scenario-B geometry")
    if len(weights["W"]) != len(weights["mean"]) * len(weights["b"]):
        errors.append("weights.W has the wrong size")

    seeds = metrics["splits"]["test"]
    started = time.perf_counter()
    print(f"regenerating {len(seeds)} test scenes ...", flush=True)
    scenes = data.generate_scenes(seeds, args.workers)
    rti_tau = metrics["rtiThresholdSelection"]["threshold"]
    result = train.evaluate_split(scenes, seeds, weights, rti_tau)
    compare(metrics["test"], result, "test", args.tolerance, errors)

    cards = {c["id"]: c for c in registry}
    for (model_id, metric), (group, key) in REGISTRY_CHECKS.items():
        entries = [e for e in cards.get(model_id, {}).get("evaluation", []) if e["metric"] == metric]
        if len(entries) != 1:
            errors.append(f"registry {model_id}: expected one '{metric}' entry, found {len(entries)}")
        elif not math.isclose(entries[0]["value"], round(result[group][key], 4), abs_tol=1e-12):
            errors.append(f"registry {model_id} {metric}: {entries[0]['value']} != {round(result[group][key], 4)}")

    r, q = result["ridge"], result["rtiObservedT05"]
    print(f"ridge-floor: IoU {r['iou']:.4f}  P {r['precision']:.4f}  R {r['recall']:.4f}")
    print(f"rti-bayes @0.5: IoU {q['iou']:.4f}  P {q['precision']:.4f}  R {q['recall']:.4f}")
    print(f"evaluated in {time.perf_counter() - started:.0f} s")
    if errors:
        print("MISMATCH:\n  " + "\n  ".join(errors))
        return 1
    print("OK: recomputed test metrics match metrics.json and registry.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
