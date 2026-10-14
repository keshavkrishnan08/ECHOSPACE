/// <reference lib="webworker" />
import { EchoEngine, percentile, type RidgeWeights } from "@echospace/engine";
import type { ScenarioConfig } from "@echospace/schemas";

/**
 * Runs one configuration for a fixed stream duration without real-time pacing and summarises
 * accuracy (simulation metrics) and systems metrics separately. Used for ablations and
 * model-versus-systems comparisons; every variant gets the same seed.
 */
declare const self: DedicatedWorkerGlobalScope;

export interface OfflineRequest {
  id: string;
  config: ScenarioConfig;
  durationS: number;
  ridge: RidgeWeights | null;
}

export interface OfflineResult {
  id: string;
  frames: number;
  accuracy: Record<string, { median: number | null; mean: number | null; n: number }>;
  systems: { initMs: number; frameMedianMs: number | null; frameP95Ms: number | null; framesPerSecond: number; heapMb: number | null; frameBytes: number };
  modelStatus: Record<string, number>;
  series: Array<{ t: number; positionErrorM: number | null; floorIou: number | null; meanConfidence: number; processingMs: number }>;
}

const KEYS = ["positionErrorM", "floorIou", "voxelIou", "precision", "recall", "chamferM", "meanConfidence", "inputQuality", "observedFraction"] as const;

self.onmessage = (ev: MessageEvent<OfflineRequest>) => {
  const { id, config, durationS, ridge } = ev.data;
  try {
    const t0 = performance.now();
    const eng = new EchoEngine(config, { ridge });
    const initMs = performance.now() - t0;
    const vals: Record<string, number[]> = Object.fromEntries(KEYS.map((k) => [k, [] as number[]]));
    const proc: number[] = [];
    const status: Record<string, number> = {};
    const series: OfflineResult["series"] = [];
    let frames = 0;
    let bytes = 0;
    const tRun = performance.now();
    const period = 1 / config.dsp.frameRateHz;
    while (eng.simTime < durationS - 1e-9) {
      for (const f of eng.advance(period, Infinity, Infinity)) {
        frames++;
        proc.push(f.metrics.processingMs);
        status[f.capability.modelStatus] = (status[f.capability.modelStatus] ?? 0) + 1;
        bytes = f.occupancy.byteLength + f.varianceRatio.byteLength + f.image.byteLength + f.pointsRaw.byteLength + f.pointsFiltered.byteLength;
        if (f.timestampS >= 1) for (const k of KEYS) {
          const v = f.metrics[k] as number | null;
          if (v !== null && Number.isFinite(v)) vals[k].push(v);
        }
        series.push({ t: f.timestampS, positionErrorM: f.metrics.positionErrorM, floorIou: f.metrics.floorIou, meanConfidence: f.metrics.meanConfidence, processingMs: f.metrics.processingMs });
      }
      if (frames % 50 === 0) self.postMessage({ type: "progress", id, t: eng.simTime });
    }
    const wall = performance.now() - tRun;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const result: OfflineResult = {
      id,
      frames,
      accuracy: Object.fromEntries(KEYS.map((k) => [k, { median: percentile(vals[k], 0.5), mean: vals[k].length ? vals[k].reduce((a, b) => a + b, 0) / vals[k].length : null, n: vals[k].length }])),
      systems: { initMs, frameMedianMs: percentile(proc, 0.5), frameP95Ms: proc.length >= 20 ? percentile(proc, 0.95) : null, framesPerSecond: frames / (wall / 1000), heapMb: mem ? mem.usedJSHeapSize / 1048576 : null, frameBytes: bytes },
      modelStatus: status,
      series,
    };
    self.postMessage({ type: "done", id, result });
  } catch (e) {
    self.postMessage({ type: "error", id, message: e instanceof Error ? e.message : String(e) });
  }
};
