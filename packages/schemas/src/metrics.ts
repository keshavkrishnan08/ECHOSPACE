/**
 * Metric catalogue. Every metric displayed anywhere in the product must have an entry here.
 * `source` names the code path that produces it so values are traceable.
 */
export interface MetricDefinition {
  id: string;
  label: string;
  unit: string;
  definition: string;
  source: string;
  /** "simulation" metrics require synthetic ground truth and are never shown for measured data. */
  kind: "system" | "signal" | "simulation" | "reconstruction" | "tracking";
  better: "lower" | "higher" | "none";
}

export const METRICS: Record<string, MetricDefinition> = {
  frameRate: {
    id: "frameRate", label: "Update rate", unit: "Hz", kind: "system", better: "higher",
    definition: "Reconstruction frames received by the UI per wall-clock second, averaged over the last 2 s.",
    source: "apps/web session store: frame arrival timestamps",
  },
  processingMs: {
    id: "processingMs", label: "Processing time", unit: "ms", kind: "system", better: "lower",
    definition: "Sum of measured stage durations (performance.now) for one frame inside the engine. Excludes queueing and transfer.",
    source: "packages/engine pipeline stage timers",
  },
  endToEndMs: {
    id: "endToEndMs", label: "End-to-end latency", unit: "ms", kind: "system", better: "lower",
    definition: "Wall-clock time from the engine ingesting the newest packet of a frame to the UI receiving the frame. Synthetic sources generate packets on demand, so acquisition latency is not included.",
    source: "engine ingest timestamp vs. UI receive timestamp (same clock: performance.timeOrigin + now)",
  },
  inputRate: {
    id: "inputRate", label: "Input data rate", unit: "packets/s", kind: "signal", better: "none",
    definition: "CSI packets accepted by the validation stage per second of stream time, summed across links.",
    source: "engine validate stage counters",
  },
  packetDeliveryRatio: {
    id: "packetDeliveryRatio", label: "Packet delivery", unit: "ratio", kind: "signal", better: "higher",
    definition: "Packets received divided by packets expected from the nominal packet rate over the last frame window, averaged across links.",
    source: "engine features stage",
  },
  meanSnrDb: {
    id: "meanSnrDb", label: "Estimated SNR", unit: "dB", kind: "signal", better: "higher",
    definition: "Mean over links of 10·log10(mean |H|² / residual variance) estimated from the calibration window. N/A before calibration completes.",
    source: "engine calibration",
  },
  inputQuality: {
    id: "inputQuality", label: "Input quality", unit: "0-1", kind: "signal", better: "higher",
    definition: "Product of delivery ratio and a logistic SNR factor σ((SNR−10 dB)/3 dB). A documented heuristic, not a standard metric.",
    source: "engine features stage",
  },
  meanConfidence: {
    id: "meanConfidence", label: "Reconstruction confidence", unit: "0-1", kind: "reconstruction", better: "higher",
    definition: "Mean of (1 − posterior variance ratio) over voxels inside the room. Measures how constrained the image is by the links, not whether it is correct.",
    source: "rti-bayes posterior variance / model-declared confidence",
  },
  observedFraction: {
    id: "observedFraction", label: "Observed volume", unit: "ratio", kind: "reconstruction", better: "higher",
    definition: "Fraction of voxels whose posterior variance ratio is below 0.8 (i.e. constrained by at least one link).",
    source: "engine reconstruct stage",
  },
  activeTracks: {
    id: "activeTracks", label: "Active tracks", unit: "count", kind: "tracking", better: "none",
    definition: "Confirmed tracks maintained by the temporal association stage in the latest frame.",
    source: "engine tracker",
  },
  positionErrorM: {
    id: "positionErrorM", label: "Position error", unit: "m", kind: "simulation", better: "lower",
    definition: "Mean floor-plane distance between optimally matched (Hungarian) confirmed tracks and synthetic ground-truth subjects. Unmatched subjects are excluded and counted by recall.",
    source: "engine metrics: synthetic ground truth",
  },
  floorIou: {
    id: "floorIou", label: "Floor IoU", unit: "0-1", kind: "simulation", better: "higher",
    definition: "Intersection over union between floor-plane occupancy (max over z, thresholded) and the ground-truth body footprint grid.",
    source: "engine metrics: synthetic ground truth",
  },
  voxelIou: {
    id: "voxelIou", label: "Voxel IoU", unit: "0-1", kind: "simulation", better: "higher",
    definition: "3D intersection over union between thresholded occupancy voxels and ground-truth body voxels.",
    source: "engine metrics: synthetic ground truth",
  },
  precision: {
    id: "precision", label: "Detection precision", unit: "0-1", kind: "simulation", better: "higher",
    definition: "Confirmed tracks within 0.75 m of a ground-truth subject divided by confirmed tracks.",
    source: "engine metrics: synthetic ground truth",
  },
  recall: {
    id: "recall", label: "Detection recall", unit: "0-1", kind: "simulation", better: "higher",
    definition: "Ground-truth subjects with a confirmed track within 0.75 m divided by ground-truth subjects present.",
    source: "engine metrics: synthetic ground truth",
  },
  chamferM: {
    id: "chamferM", label: "Chamfer distance", unit: "m", kind: "simulation", better: "lower",
    definition: "Symmetric mean nearest-neighbour distance between the filtered point cloud and points sampled on ground-truth body surfaces. N/A when either set is empty.",
    source: "engine metrics: synthetic ground truth",
  },
  idSwitchesTotal: {
    id: "idSwitchesTotal", label: "Identity switches", unit: "count", kind: "simulation", better: "lower",
    definition: "Cumulative number of times the track matched to a ground-truth subject changed identity.",
    source: "engine metrics: synthetic ground truth",
  },
  jitterM: {
    id: "jitterM", label: "Track jitter", unit: "m", kind: "simulation", better: "lower",
    definition: "RMS of the second difference of matched track positions (x, y) over the window, i.e. frame-to-frame roughness of the estimate. Computed only for tracks matched to ground truth.",
    source: "apps/web arena analysis over buffered frames",
  },
  lagS: {
    id: "lagS", label: "Temporal lag", unit: "s", kind: "simulation", better: "lower",
    definition: "Mean along-track error (track − truth projected on the true velocity direction, negated) divided by true speed, over frames where the subject moves faster than 0.3 m/s. Positive = estimate trails the subject.",
    source: "apps/web arena analysis over buffered frames",
  },
  coverage: {
    id: "coverage", label: "Link coverage", unit: "ratio", kind: "reconstruction", better: "higher",
    definition: "Fraction of floor cells (max over height) whose posterior variance ratio is below 0.8, a geometry-only observability measure of the sensor layout.",
    source: "rti-bayes posterior variance",
  },
  gpuUtilization: {
    id: "gpuUtilization", label: "GPU utilization", unit: "%", kind: "system", better: "none",
    definition: "Browsers do not expose GPU utilization. Reported only by the Python service when NVML is available.",
    source: "services/api diagnostics (NVML)",
  },
  sessionDuration: {
    id: "sessionDuration", label: "Session duration", unit: "s", kind: "system", better: "none",
    definition: "Stream time elapsed since the session started streaming.",
    source: "engine clock",
  },
};

export const METRIC_IDS = Object.keys(METRICS);
