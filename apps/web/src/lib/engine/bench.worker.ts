/// <reference lib="webworker" />
import { EchoEngine, percentile } from "@echospace/engine";
import type { ScenarioConfig } from "@echospace/schemas";

/**
 * Benchmark host: a fixed configuration and seed processed frame-by-frame as fast as possible
 * (no real-time pacing), with warm-up frames excluded from the statistics.
 */
declare const self: DedicatedWorkerGlobalScope;

export interface BenchRequest {
  config: ScenarioConfig;
  warmup: number;
  iterations: number;
}

export interface BenchResult {
  initMs: number;
  warmup: number;
  iterations: number;
  wallMs: number;
  framesPerSecond: number;
  frame: { median: number | null; p95: number | null; p99: number | null; min: number; max: number; mean: number };
  stages: Array<{ id: string; label: string; median: number | null; p95: number | null }>;
  timerResolutionMs: number;
}

self.onmessage = (ev: MessageEvent<BenchRequest>) => {
  const { config, warmup, iterations } = ev.data;
  try {
    let t = performance.now();
    const engine = new EchoEngine(config);
    const initMs = performance.now() - t;
    const period = 1 / config.dsp.frameRateHz;
    for (let i = 0; i < warmup; i++) engine.advance(period, Infinity, Infinity);
    const frameMs: number[] = [];
    const stage = new Map<string, { label: string; d: number[] }>();
    t = performance.now();
    for (let i = 0; i < iterations; i++) {
      const s0 = performance.now();
      const frames = engine.advance(period, Infinity, Infinity);
      const dt = performance.now() - s0;
      if (!frames.length) continue;
      frameMs.push(dt);
      for (const s of frames[frames.length - 1].stages) {
        if (!stage.has(s.id)) stage.set(s.id, { label: s.label, d: [] });
        stage.get(s.id)!.d.push(s.durationMs);
      }
      if (i % 20 === 0) self.postMessage({ type: "progress", done: i, total: iterations });
    }
    const wallMs = performance.now() - t;
    let res = Infinity;
    let a = performance.now();
    for (let i = 0; i < 1000; i++) {
      const b = performance.now();
      if (b > a) {
        res = Math.min(res, b - a);
        a = b;
      }
    }
    const result: BenchResult = {
      initMs,
      warmup,
      iterations: frameMs.length,
      wallMs,
      framesPerSecond: frameMs.length / (wallMs / 1000),
      frame: {
        median: percentile(frameMs, 0.5),
        p95: frameMs.length >= 20 ? percentile(frameMs, 0.95) : null,
        p99: frameMs.length >= 100 ? percentile(frameMs, 0.99) : null,
        min: Math.min(...frameMs),
        max: Math.max(...frameMs),
        mean: frameMs.reduce((x, y) => x + y, 0) / frameMs.length,
      },
      stages: [...stage.entries()].map(([id, v]) => ({ id, label: v.label, median: percentile(v.d, 0.5), p95: v.d.length >= 20 ? percentile(v.d, 0.95) : null })),
      timerResolutionMs: Number.isFinite(res) ? res : NaN,
    };
    self.postMessage({ type: "done", result });
  } catch (e) {
    self.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
