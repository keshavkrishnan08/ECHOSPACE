import { z } from "zod";

export const DatasetSourceKind = z.enum(["synthetic", "recorded-csi", "recorded-iq", "public"]);

export const DatasetManifest = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  source: DatasetSourceKind,
  license: z.string(),
  usageRestrictions: z.string(),
  captureMethodology: z.string(),
  durationS: z.number().nullable(),
  sampleFormat: z.string(),
  channelCount: z.number().int().nullable(),
  sampleRateHz: z.number().nullable(),
  sceneMetadata: z.record(z.string(), z.unknown()).default({}),
  annotations: z.array(z.string()).default([]),
  splits: z.record(z.string(), z.array(z.string())).default({}),
  validation: z.object({
    status: z.enum(["unvalidated", "valid", "invalid"]),
    checkedAt: z.string().nullable(),
    issues: z.array(z.string()).default([]),
  }),
  consent: z.enum(["not-applicable", "obtained", "unknown"]).default("not-applicable"),
  checksum: z.string().nullable().default(null),
});
export type DatasetManifest = z.infer<typeof DatasetManifest>;
