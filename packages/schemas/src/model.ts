import { z } from "zod";

export const ModelStatus = z.enum(["available", "experimental", "unavailable"]);
export type ModelStatus = z.infer<typeof ModelStatus>;

export const ModelTask = z.enum(["occupancy-3d", "occupancy-floor", "point-cloud", "localization", "tracking", "skeleton"]);
export type ModelTask = z.infer<typeof ModelTask>;

export const ModelCard = z.object({
  id: z.string(),
  name: z.string(),
  family: z.enum(["classical", "shallow-learned", "tcn", "transformer", "fusion", "state-estimator"]),
  version: z.string(),
  status: ModelStatus,
  description: z.string(),
  inputSchema: z.string(),
  outputSchema: z.string(),
  preprocessingVersion: z.string(),
  inferenceDevice: z.string(),
  confidenceSemantics: z.string(),
  supportedTasks: z.array(ModelTask),
  providesJoints: z.boolean(),
  trainingDataset: z.string().nullable(),
  knownLimitations: z.array(z.string()),
  requirements: z.array(z.string()).default([]),
  evaluation: z.array(z.object({
    dataset: z.string(),
    split: z.string(),
    metric: z.string(),
    value: z.number(),
    note: z.string().default(""),
  })).default([]),
  references: z.array(z.string()).default([]),
});
export type ModelCard = z.infer<typeof ModelCard>;
