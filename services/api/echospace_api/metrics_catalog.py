"""Metric catalogue: Python port of packages/schemas/src/metrics.ts.

Ids, labels, units and definitions are identical to the TypeScript catalogue; keep the two in
sync (services/api/tests/test_metrics_catalog.py compares them).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class MetricDefinition(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)

    id: str
    label: str
    unit: str
    definition: str
    source: str
    kind: Literal["system", "signal", "simulation", "reconstruction", "tracking"]
    """"simulation" metrics require synthetic ground truth and are never shown for measured data."""
    better: Literal["lower", "higher", "none"]


def _m(id: str, label: str, unit: str, kind: str, better: str, definition: str, source: str) -> MetricDefinition:
    return MetricDefinition.model_validate(
        {
            "id": id,
            "label": label,
            "unit": unit,
            "kind": kind,
            "better": better,
            "definition": definition,
            "source": source,
        }
    )


METRICS: dict[str, MetricDefinition] = {
    "frameRate": _m(
        "frameRate",
        "Update rate",
        "Hz",
        "system",
        "higher",
        "Reconstruction frames received by the UI per wall-clock second, averaged over the last 2 s.",
        "apps/web session store: frame arrival timestamps",
    ),
    "processingMs": _m(
        "processingMs",
        "Processing time",
        "ms",
        "system",
        "lower",
        "Sum of measured stage durations (performance.now) for one frame inside the engine. Excludes queueing and transfer.",
        "packages/engine pipeline stage timers",
    ),
    "endToEndMs": _m(
        "endToEndMs",
        "End-to-end latency",
        "ms",
        "system",
        "lower",
        "Wall-clock time from the engine ingesting the newest packet of a frame to the UI receiving the frame. Synthetic sources generate packets on demand, so acquisition latency is not included.",
        "engine ingest timestamp vs. UI receive timestamp (same clock: performance.timeOrigin + now)",
    ),
    "inputRate": _m(
        "inputRate",
        "Input data rate",
        "packets/s",
        "signal",
        "none",
        "CSI packets accepted by the validation stage per second of stream time, summed across links.",
        "engine validate stage counters",
    ),
    "packetDeliveryRatio": _m(
        "packetDeliveryRatio",
        "Packet delivery",
        "ratio",
        "signal",
        "higher",
        "Packets received divided by packets expected from the nominal packet rate over the last frame window, averaged across links.",
        "engine features stage",
    ),
    "meanSnrDb": _m(
        "meanSnrDb",
        "Estimated SNR",
        "dB",
        "signal",
        "higher",
        "Mean over links of 10·log10(mean |H|² / residual variance) estimated from the calibration window. N/A before calibration completes.",
        "engine calibration",
    ),
    "inputQuality": _m(
        "inputQuality",
        "Input quality",
        "0–1",
        "signal",
        "higher",
        "Product of delivery ratio and a logistic SNR factor σ((SNR−10 dB)/3 dB). A documented heuristic, not a standard metric.",
        "engine features stage",
    ),
    "meanConfidence": _m(
        "meanConfidence",
        "Reconstruction confidence",
        "0–1",
        "reconstruction",
        "higher",
        "Mean of (1 − posterior variance ratio) over voxels inside the room. Measures how constrained the image is by the links, not whether it is correct.",
        "rti-bayes posterior variance / model-declared confidence",
    ),
    "observedFraction": _m(
        "observedFraction",
        "Observed volume",
        "ratio",
        "reconstruction",
        "higher",
        "Fraction of voxels whose posterior variance ratio is below 0.8 (i.e. constrained by at least one link).",
        "engine reconstruct stage",
    ),
    "activeTracks": _m(
        "activeTracks",
        "Active tracks",
        "count",
        "tracking",
        "none",
        "Confirmed tracks maintained by the temporal association stage in the latest frame.",
        "engine tracker",
    ),
    "positionErrorM": _m(
        "positionErrorM",
        "Position error",
        "m",
        "simulation",
        "lower",
        "Mean floor-plane distance between optimally matched (Hungarian) confirmed tracks and synthetic ground-truth subjects. Unmatched subjects are excluded and counted by recall.",
        "engine metrics: synthetic ground truth",
    ),
    "floorIou": _m(
        "floorIou",
        "Floor IoU",
        "0–1",
        "simulation",
        "higher",
        "Intersection over union between floor-plane occupancy (max over z, thresholded) and the ground-truth body footprint grid.",
        "engine metrics: synthetic ground truth",
    ),
    "voxelIou": _m(
        "voxelIou",
        "Voxel IoU",
        "0–1",
        "simulation",
        "higher",
        "3D intersection over union between thresholded occupancy voxels and ground-truth body voxels.",
        "engine metrics: synthetic ground truth",
    ),
    "precision": _m(
        "precision",
        "Detection precision",
        "0–1",
        "simulation",
        "higher",
        "Confirmed tracks within 0.75 m of a ground-truth subject divided by confirmed tracks.",
        "engine metrics: synthetic ground truth",
    ),
    "recall": _m(
        "recall",
        "Detection recall",
        "0–1",
        "simulation",
        "higher",
        "Ground-truth subjects with a confirmed track within 0.75 m divided by ground-truth subjects present.",
        "engine metrics: synthetic ground truth",
    ),
    "chamferM": _m(
        "chamferM",
        "Chamfer distance",
        "m",
        "simulation",
        "lower",
        "Symmetric mean nearest-neighbour distance between the filtered point cloud and points sampled on ground-truth body surfaces. N/A when either set is empty.",
        "engine metrics: synthetic ground truth",
    ),
    "idSwitchesTotal": _m(
        "idSwitchesTotal",
        "Identity switches",
        "count",
        "simulation",
        "lower",
        "Cumulative number of times the track matched to a ground-truth subject changed identity.",
        "engine metrics: synthetic ground truth",
    ),
    "jitterM": _m(
        "jitterM",
        "Track jitter",
        "m",
        "simulation",
        "lower",
        "RMS of the second difference of matched track positions (x, y) over the window, i.e. frame-to-frame roughness of the estimate. Computed only for tracks matched to ground truth.",
        "apps/web arena analysis over buffered frames",
    ),
    "lagS": _m(
        "lagS",
        "Temporal lag",
        "s",
        "simulation",
        "lower",
        "Mean along-track error (track − truth projected on the true velocity direction, negated) divided by true speed, over frames where the subject moves faster than 0.3 m/s. Positive = estimate trails the subject.",
        "apps/web arena analysis over buffered frames",
    ),
    "coverage": _m(
        "coverage",
        "Link coverage",
        "ratio",
        "reconstruction",
        "higher",
        "Fraction of floor cells (max over height) whose posterior variance ratio is below 0.8 — a geometry-only observability measure of the sensor layout.",
        "rti-bayes posterior variance",
    ),
    "gpuUtilization": _m(
        "gpuUtilization",
        "GPU utilization",
        "%",
        "system",
        "none",
        "Browsers do not expose GPU utilization. Reported only by the Python service when NVML is available.",
        "services/api diagnostics (NVML)",
    ),
    "sessionDuration": _m(
        "sessionDuration",
        "Session duration",
        "s",
        "system",
        "none",
        "Stream time elapsed since the session started streaming.",
        "engine clock",
    ),
}

METRIC_IDS = list(METRICS)
