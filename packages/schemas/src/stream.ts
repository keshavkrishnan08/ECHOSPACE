import { z } from "zod";

/**
 * JSON envelope used on the WebSocket between the Python reference service and the UI.
 * Binary arrays are base64-encoded little-endian Float32 with an explicit length.
 */
export const B64Float32 = z.object({ dtype: z.literal("float32"), length: z.number().int().min(0), data: z.string() });

export const StreamEnvelope = z.object({
  v: z.literal(1),
  seq: z.number().int().min(0),
  sessionId: z.string(),
  sentAtMs: z.number(),
  type: z.enum(["status", "frame", "metrics", "timing", "track-event", "warning", "error", "pong"]),
  payload: z.unknown(),
});
export type StreamEnvelope = z.infer<typeof StreamEnvelope>;

export const StatusPayload = z.object({
  state: z.enum(["idle", "initializing", "calibrating", "streaming", "paused", "degraded", "error"]),
  message: z.string().default(""),
});

export const FramePayload = z.object({
  seq: z.number().int(),
  timestampS: z.number(),
  grid: z.object({ nx: z.number().int(), ny: z.number().int(), nz: z.number().int(), voxelSizeM: z.number(), origin: z.tuple([z.number(), z.number(), z.number()]) }),
  occupancy: B64Float32,
  varianceRatio: B64Float32,
  tracks: z.array(z.object({
    id: z.string(),
    position: z.tuple([z.number(), z.number(), z.number()]),
    velocity: z.tuple([z.number(), z.number(), z.number()]),
    covariance: z.tuple([z.number(), z.number(), z.number()]),
    confirmed: z.boolean(),
  })),
  groundTruth: z.array(z.object({ id: z.string(), position: z.tuple([z.number(), z.number(), z.number()]) })).nullable(),
  deltaRssDb: B64Float32,
  processingMs: z.number(),
  provenance: z.object({ engine: z.literal("python-reference"), modelId: z.string(), configHash: z.string(), seed: z.number().nullable() }),
});
export type FramePayload = z.infer<typeof FramePayload>;

export const ClientCommand = z.discriminatedUnion("cmd", [
  z.object({ cmd: z.literal("ping"), t: z.number() }),
  z.object({ cmd: z.literal("pause") }),
  z.object({ cmd: z.literal("resume") }),
  z.object({ cmd: z.literal("ack"), seq: z.number().int() }),
]);
export type ClientCommand = z.infer<typeof ClientCommand>;

export function decodeB64Float32(b: z.infer<typeof B64Float32>): Float32Array {
  // atob is global in every browser and in Node 16+, so no Buffer fallback (and no Node types) is needed.
  const bin = atob(b.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const out = new Float32Array(bytes.buffer, 0, b.length);
  return out;
}
