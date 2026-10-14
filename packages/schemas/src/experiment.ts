import { z } from "zod";
import { ScenarioConfig } from "./scenario";

export const EXPERIMENT_SCHEMA_VERSION = 1 as const;

export const ExperimentStatus = z.enum(["draft", "running", "completed", "failed", "cancelled"]);
export type ExperimentStatus = z.infer<typeof ExperimentStatus>;

export const MachineInfo = z.object({
  userAgent: z.string().nullable().default(null),
  hardwareConcurrency: z.number().nullable().default(null),
  deviceMemoryGb: z.number().nullable().default(null),
  platform: z.string().nullable().default(null),
  gpu: z.string().nullable().default(null),
});
export type MachineInfo = z.infer<typeof MachineInfo>;

/** Summary statistic over a metric time series. NaN-free; null when no samples were available. */
export const MetricSummary = z.object({
  id: z.string(),
  n: z.number().int().min(0),
  mean: z.number().nullable(),
  median: z.number().nullable(),
  p95: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  last: z.number().nullable(),
});
export type MetricSummary = z.infer<typeof MetricSummary>;

export const MetricSeries = z.object({
  id: z.string(),
  t: z.array(z.number()),
  v: z.array(z.number().nullable()),
});
export type MetricSeries = z.infer<typeof MetricSeries>;

export const ExperimentRecord = z.object({
  schemaVersion: z.literal(EXPERIMENT_SCHEMA_VERSION).default(EXPERIMENT_SCHEMA_VERSION),
  id: z.string(),
  name: z.string().min(1).max(200),
  notes: z.string().max(5000).default(""),
  projectId: z.string().default("default"),
  sourceMode: z.enum(["synthetic", "recorded", "hardware"]),
  config: ScenarioConfig,
  configHash: z.string(),
  modelId: z.string(),
  modelVersion: z.string(),
  preprocessingVersion: z.string(),
  engine: z.enum(["browser-worker", "python-reference"]),
  inferenceDevice: z.string().default("cpu"),
  softwareVersion: z.string(),
  machine: MachineInfo.nullable().default(null),
  status: ExperimentStatus,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  simulatedDurationS: z.number().min(0),
  frames: z.number().int().min(0),
  /** SHA-256 over a canonical digest of the first N frames, used to verify deterministic replay. */
  replayDigest: z.string().nullable().default(null),
  replayDigestFrames: z.number().int().min(0).default(0),
  summaries: z.array(MetricSummary).default([]),
  series: z.array(MetricSeries).default([]),
  events: z.array(z.object({ t: z.number(), kind: z.string(), message: z.string() })).default([]),
  tags: z.array(z.string()).default([]),
  baselineOf: z.string().nullable().default(null),
});
export type ExperimentRecord = z.infer<typeof ExperimentRecord>;
