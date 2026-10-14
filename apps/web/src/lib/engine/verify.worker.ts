/// <reference lib="webworker" />
import { EchoEngine, type RidgeWeights } from "@echospace/engine";
import type { ScenarioConfig } from "@echospace/schemas";
import { DIGEST_FRAMES, digestParts, framePart } from "./digest";

/**
 * Deterministic replay digest: runs the launch configuration with its scheduled changes, unpaced
 * and without any backpressure, for the first DIGEST_FRAMES frames.
 */
declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (ev: MessageEvent<{ config: ScenarioConfig; schedule: Array<{ frameSeq: number; config: ScenarioConfig }>; ridge: RidgeWeights | null }>) => {
  try {
    const eng = new EchoEngine(ev.data.config, { ridge: ev.data.ridge });
    eng.schedule(ev.data.schedule);
    const parts: number[] = [];
    const period = 1 / ev.data.config.dsp.frameRateHz;
    let n = 0;
    while (n < DIGEST_FRAMES && !eng.finished) {
      for (const f of eng.advance(period, Infinity, Infinity)) {
        if (f.seq < DIGEST_FRAMES) {
          framePart(f, parts);
          n++;
        }
      }
    }
    self.postMessage({ type: "done", digest: n === DIGEST_FRAMES ? await digestParts(parts) : null });
  } catch (e) {
    self.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
