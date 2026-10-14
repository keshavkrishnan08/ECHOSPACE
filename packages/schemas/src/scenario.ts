import { z } from "zod";
import { Obstacle, Opening, Room, SensorNode, Vec2 } from "./scene";

export const SCENARIO_SCHEMA_VERSION = 1 as const;

export const MotionAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("walk"), to: Vec2, speed: z.number().min(0.1).max(3).default(1.0) }),
  z.object({ type: z.literal("stop"), durationS: z.number().min(0).max(120) }),
  z.object({ type: z.literal("turn"), headingDeg: z.number(), durationS: z.number().min(0.1).max(10).default(1) }),
  z.object({ type: z.literal("sit"), durationS: z.number().min(0).max(120) }),
]);
export type MotionAction = z.infer<typeof MotionAction>;

export const SubjectSpec = z.object({
  id: z.string().min(1),
  /** Synthetic, non-identifying label such as "S1". */
  label: z.string().min(1),
  heightM: z.number().min(1).max(2.2).default(1.75),
  radiusM: z.number().min(0.1).max(0.4).default(0.22),
  /** Bistatic radar cross-section in m^2 used by the scatter model (normalized model, not calibrated). */
  rcsM2: z.number().min(0.05).max(5).default(1.0),
  start: Vec2,
  startHeadingDeg: z.number().default(0),
  startDelayS: z.number().min(0).default(0),
  actions: z.array(MotionAction).default([]),
  loop: z.boolean().default(true),
});
export type SubjectSpec = z.infer<typeof SubjectSpec>;

export const SignalConfig = z.object({
  centerFreqHz: z.number().min(2.4e9).max(7.2e9).default(5.32e9),
  bandwidthHz: z.number().min(20e6).max(160e6).default(40e6),
  subcarriers: z.number().int().min(8).max(128).default(30),
  packetRateHz: z.number().min(10).max(1000).default(100),
  /** Ratio of mean static channel power to complex noise power per sample, dB. */
  snrDb: z.number().min(-10).max(50).default(25),
  maxReflectionOrder: z.number().int().min(0).max(1).default(1),
  /** Number of the room's six surfaces that produce reflections (0-6, ordered: 4 walls, floor, ceiling). */
  reflectingSurfaces: z.number().int().min(0).max(6).default(6),
  subjectScatter: z.boolean().default(true),
  subjectShadowing: z.boolean().default(true),
  /** Peak body shadowing loss on a path passing through the body axis, dB. */
  bodyShadowDb: z.number().min(0).max(20).default(8),
});
export type SignalConfig = z.infer<typeof SignalConfig>;

export const AntennaFault = z.object({ sensorId: z.string(), antenna: z.number().int().min(0) });

export const ImpairmentConfig = z.object({
  packetLoss: z.number().min(0).max(0.95).default(0.01),
  /** Expected number of burst dropouts per link per second. */
  burstRateHz: z.number().min(0).max(5).default(0),
  burstLengthPackets: z.number().int().min(1).max(500).default(20),
  timestampJitterMs: z.number().min(0).max(50).default(0.5),
  missingTimestampProb: z.number().min(0).max(1).default(0),
  /** Std-dev of per-antenna random phase that cannot be removed by sanitization, radians. */
  phaseInstabilityRad: z.number().min(0).max(3.2).default(0.02),
  cfo: z.boolean().default(true),
  sto: z.boolean().default(true),
  /** Std-dev of per-packet automatic gain control error, in dB. */
  agcSigmaDb: z.number().min(0).max(6).default(0.2),
  missingAntennas: z.array(AntennaFault).default([]),
});
export type ImpairmentConfig = z.infer<typeof ImpairmentConfig>;

export const DspConfig = z.object({
  frameRateHz: z.number().min(1).max(30).default(10),
  bufferSeconds: z.number().min(0.5).max(10).default(2.56),
  calibrationSeconds: z.number().min(0.5).max(30).default(3),
  phaseSanitize: z.boolean().default(true),
  hampel: z.object({
    enabled: z.boolean().default(true),
    halfWindow: z.number().int().min(1).max(10).default(3),
    nSigma: z.number().min(1).max(6).default(3),
  }).default({ enabled: true, halfWindow: 3, nSigma: 3 }),
  lowpass: z.object({
    enabled: z.boolean().default(true),
    /** Exponential smoothing factor applied to per-link RSS features. */
    alpha: z.number().min(0.01).max(1).default(0.5),
  }).default({ enabled: true, alpha: 0.5 }),
});
export type DspConfig = z.infer<typeof DspConfig>;

export const ReconModelId = z.enum(["rti-bayes", "bp-dsb", "ridge-floor", "tcn-encoder", "transformer-encoder"]);
export type ReconModelId = z.infer<typeof ReconModelId>;

export const ReconConfig = z.object({
  modelId: ReconModelId.default("rti-bayes"),
  voxelSizeM: z.number().min(0.15).max(0.6).default(0.25),
  /**
   * Detection threshold z0 on the null-hypothesis z-score of the posterior-mean attenuation
   * density. Occupancy probability is reported as Phi(z - z0) (a detection confidence, not a
   * calibrated posterior probability).
   */
  detectionZ: z.number().min(0).max(10).default(4),
  occupancyThreshold: z.number().min(0.05).max(0.99).default(0.6),
  confidenceThreshold: z.number().min(0).max(1).default(0.1),
  temporalSmoothing: z.number().min(0).max(0.98).default(0.5),
  spatialFilter: z.boolean().default(true),
  ellipseExcessM: z.number().min(0.02).max(1).default(0.12),
  priorStd: z.number().min(0.05).max(10).default(1.0),
  priorCorrelationM: z.number().min(0.05).max(3).default(0.35),
  noiseStdDb: z.number().min(0.05).max(10).default(1.0),
  /** Correlation kernel truncation radius in multiples of priorCorrelationM. */
  kernelCutoff: z.number().min(1).max(8).default(4),
  maxPoints: z.number().int().min(100).max(50000).default(6000),
  outlierRemoval: z.boolean().default(true),
});
export type ReconConfig = z.infer<typeof ReconConfig>;

export const TemporalFilter = z.enum(["none", "ema", "kalman", "learned"]);
export type TemporalFilter = z.infer<typeof TemporalFilter>;

export const TrackingConfig = z.object({
  enabled: z.boolean().default(true),
  filter: TemporalFilter.default("kalman"),
  emaAlpha: z.number().min(0.01).max(1).default(0.35),
  /** Kalman white-acceleration spectral density, m^2/s^3. */
  processNoise: z.number().min(0.001).max(50).default(1.5),
  /** Detection position std-dev, metres. */
  measurementStdM: z.number().min(0.01).max(3).default(0.35),
  gateM: z.number().min(0.2).max(5).default(1.2),
  birthHits: z.number().int().min(1).max(20).default(3),
  maxMisses: z.number().int().min(1).max(100).default(8),
  detectionThreshold: z.number().min(0.05).max(0.99).default(0.55),
  maxDetections: z.number().int().min(1).max(10).default(4),
});
export type TrackingConfig = z.infer<typeof TrackingConfig>;

export const PrivacyConfig = z.object({
  mode: z.enum(["standard", "coarse"]).default("standard"),
  showSkeleton: z.boolean().default(true),
  trackHistorySeconds: z.number().min(0).max(120).default(10),
});
export type PrivacyConfig = z.infer<typeof PrivacyConfig>;

export const STAGE_IDS = [
  "validate",
  "align",
  "buffer",
  "estimate",
  "preprocess",
  "filter",
  "features",
  "spatial",
  "inference",
  "reconstruct",
  "associate",
  "serialize",
] as const;
export const StageId = z.enum(STAGE_IDS);
export type StageId = z.infer<typeof StageId>;

export const PipelineConfig = z.object({
  queueDepth: z.number().int().min(1).max(4096).default(256),
  dropPolicy: z.enum(["drop-oldest", "drop-newest"]).default("drop-oldest"),
  /** Maximum frames in flight to the presentation layer before the engine drops frames. */
  maxInFlightFrames: z.number().int().min(1).max(16).default(2),
  /** Artificial busy-wait added to the inference stage to exercise backpressure. Labelled as injected in the UI. */
  injectedInferenceDelayMs: z.number().min(0).max(2000).default(0),
  bypass: z.partialRecord(StageId, z.boolean()).default({}),
});
export type PipelineConfig = z.infer<typeof PipelineConfig>;

export const ScenarioKey = z.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "custom"]);
export type ScenarioKey = z.infer<typeof ScenarioKey>;

export const ScenarioConfig = z.object({
  schemaVersion: z.literal(SCENARIO_SCHEMA_VERSION).default(SCENARIO_SCHEMA_VERSION),
  scenario: ScenarioKey,
  name: z.string().min(1),
  seed: z.number().int().min(0).max(0xffffffff),
  durationS: z.number().min(5).max(3600).default(60),
  room: Room,
  obstacles: z.array(Obstacle).default([]),
  openings: z.array(Opening).default([]),
  sensors: z.array(SensorNode).min(2),
  subjects: z.array(SubjectSpec).default([]),
  signal: SignalConfig,
  impairments: ImpairmentConfig,
  dsp: DspConfig,
  recon: ReconConfig,
  tracking: TrackingConfig,
  privacy: PrivacyConfig,
  pipeline: PipelineConfig,
});
export type ScenarioConfig = z.infer<typeof ScenarioConfig>;
export type ScenarioConfigInput = z.input<typeof ScenarioConfig>;

export function parseScenario(input: unknown): ScenarioConfig {
  return ScenarioConfig.parse(input);
}
