/** Number of leading frames covered by the replay digest. */
export const DIGEST_FRAMES = 40;

/**
 * SHA-256 over quantized occupancy (every 7th voxel, 1e-4) and link attenuation (1e-3 dB) of the
 * first DIGEST_FRAMES frames. Computed in the engine worker, so frames dropped by display
 * backpressure do not affect it.
 */
export async function digestParts(parts: number[]): Promise<string> {
  const buf = new TextEncoder().encode(parts.join(","));
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function framePart(f: { occupancy: Float32Array; features: { deltaRssDb: Float32Array } }, out: number[]) {
  for (let i = 0; i < f.occupancy.length; i += 7) out.push(Math.round(f.occupancy[i] * 1e4));
  for (const v of f.features.deltaRssDb) out.push(Number.isFinite(v) ? Math.round(v * 1e3) : -999999);
}

/** Runs the deterministic digest in a short-lived worker. */
export function deterministicDigest(config: import("@echospace/schemas").ScenarioConfig, schedule: Array<{ frameSeq: number; config: import("@echospace/schemas").ScenarioConfig }>, ridge: import("@echospace/engine").RidgeWeights | null): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./verify.worker.ts", import.meta.url), { type: "module", name: "echospace-verify" });
    w.onmessage = (e: MessageEvent<{ type: string; digest?: string | null; message?: string }>) => {
      w.terminate();
      if (e.data.type === "done") resolve(e.data.digest ?? null);
      else reject(new Error(e.data.message ?? "verification failed"));
    };
    w.postMessage({ config, schedule: schedule.map((c) => ({ frameSeq: c.frameSeq, config: c.config })), ridge });
  });
}
