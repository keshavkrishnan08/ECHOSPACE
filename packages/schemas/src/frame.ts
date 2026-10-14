import type { StageId } from "./scenario";
import type { Vec3 } from "./scene";

/**
 * Where a piece of data came from. Every frame and every derived output carries one of these
 * so the UI can never present synthetic data as a physical measurement.
 */
export type SourceMode = "synthetic" | "recorded" | "hardware";

export type ProcessingState = "idle" | "initializing" | "calibrating" | "streaming" | "paused" | "degraded" | "error";

export type DataOrigin = "measured" | "derived" | "synthetic-ground-truth";

export interface Provenance {
  sourceMode: SourceMode;
  sourceId: string;
  scenario: string | null;
  seed: number | null;
  modelId: string;
  modelVersion: string;
  preprocessingVersion: string;
  engine: "browser-worker" | "python-reference";
  configHash: string;
}

export interface CsiSnapshot {
  linkIndex: number;
  /** Interleaved [antenna][subcarrier] magnitude (linear, normalized units). */
  magnitude: Float32Array;
  /** Interleaved [antenna][subcarrier] phase, raw (radians, wrapped). */
  phaseRaw: Float32Array;
  /** Phase after linear sanitization (radians, unwrapped then de-trended). */
  phaseSanitized: Float32Array;
  antennas: number;
  subcarriers: number;
  /** Subcarrier offsets from centre frequency, Hz. */
  subcarrierOffsetsHz: Float32Array;
  timestampS: number;
}

export interface LinkFeatures {
  /** Mean received power over subcarriers and antennas, dB relative to normalized unit power. */
  rssDb: Float32Array;
  /** Calibrated attenuation: baseline RSS minus current RSS, dB (positive = more loss). */
  deltaRssDb: Float32Array;
  /** Normalized temporal variation energy of sanitized CSI over the window (unitless). */
  motionEnergy: Float32Array;
  /** Estimated per-link SNR in dB from residual variance during calibration (NaN before calibration). */
  snrEstDb: Float32Array;
  /** Fraction of expected packets that arrived during the last frame window. */
  deliveryRatio: Float32Array;
}

export interface Track {
  id: string;
  position: Vec3;
  velocity: Vec3;
  /** 2x2 position covariance in the floor plane [xx, xy, yy], m^2. */
  covariance: [number, number, number];
  ageFrames: number;
  hits: number;
  misses: number;
  confirmed: boolean;
  confidence: number;
  trail: Array<[number, number, number]>;
}

export interface Detection {
  position: Vec3;
  score: number;
}

export interface GroundTruthSubject {
  id: string;
  label: string;
  position: Vec3;
  velocity: Vec3;
  headingRad: number;
  posture: "standing" | "walking" | "sitting" | "turning";
  /** 17 COCO-order joints, flattened xyz. Synthetic, never inferred. */
  joints: Float32Array;
  heightM: number;
  radiusM: number;
}

export interface TrackEvent {
  kind: "track-birth" | "track-confirmed" | "track-death" | "id-switch" | "signal-warning" | "capability" | "recon-change" | "annotation" | "error";
  timestampS: number;
  message: string;
  trackId?: string;
  severity: "info" | "warning" | "error";
}

export interface StageRecord {
  id: StageId;
  label: string;
  enabled: boolean;
  bypassed: boolean;
  applicable: boolean;
  inputShape: string;
  outputShape: string;
  dtype: string;
  /** Measured processing time for this stage on the latest frame, milliseconds (performance.now()). */
  durationMs: number;
  /** Time the oldest input item waited in the preceding queue, milliseconds. */
  queueDelayMs: number;
  itemsIn: number;
  itemsOut: number;
  drops: number;
  errors: number;
  note: string;
}

export interface FrameMetrics {
  /** Simulation metrics are only present when synthetic ground truth exists. */
  positionErrorM: number | null;
  floorIou: number | null;
  voxelIou: number | null;
  precision: number | null;
  recall: number | null;
  chamferM: number | null;
  meanConfidence: number;
  observedFraction: number;
  activeTracks: number;
  confirmedTracks: number;
  idSwitchesTotal: number;
  inputQuality: number;
  meanSnrDb: number | null;
  packetDeliveryRatio: number;
  processingMs: number;
  endToEndMs: number | null;
}

export interface ReconstructionFrame {
  seq: number;
  /** Simulation or acquisition time of the newest packet in this frame, seconds. */
  timestampS: number;
  /** Wall-clock time the frame was emitted, epoch ms. */
  emittedAtMs: number;
  state: ProcessingState;
  provenance: Provenance;
  grid: { nx: number; ny: number; nz: number; voxelSizeM: number; origin: Vec3 };
  /** Occupancy probability per voxel, x-fastest ordering. */
  occupancy: Float32Array;
  /** Posterior variance ratio per voxel (1 = prior, unobserved; 0 = fully determined). */
  varianceRatio: Float32Array;
  /** Raw image value per voxel (model-specific units, documented in the model card). */
  image: Float32Array;
  /** Points xyz + confidence + source flag (0 raw, 1 filtered), stride 5. */
  pointsRaw: Float32Array;
  pointsFiltered: Float32Array;
  detections: Detection[];
  tracks: Track[];
  groundTruth: GroundTruthSubject[] | null;
  groundTruthOccupancy: Uint8Array | null;
  features: LinkFeatures;
  csi: CsiSnapshot | null;
  /** One spectrogram column (Doppler power, dB) per frame for the selected link. */
  dopplerColumn: Float32Array | null;
  dopplerFreqsHz: Float32Array | null;
  stages: StageRecord[];
  metrics: FrameMetrics;
  events: TrackEvent[];
  capability: {
    skeleton: "unsupported" | "available";
    reason: string;
    modelStatus: "ok" | "degraded" | "unsupported";
    modelMessage: string;
  };
  warnings: string[];
}
