/// <reference lib="webworker" />
import { EchoEngine, type RidgeWeights } from "@echospace/engine";
import type { ReconstructionFrame, ScenarioConfig } from "@echospace/schemas";

/**
 * Secondary engine for side-by-side comparisons. It advances (unpaced) to whatever stream time
 * the primary session has reached, keeps a bounded frame history, and returns the frame with a
 * requested sequence number. Same frame rate ⇒ same timestamps for equal sequence numbers.
 */
declare const self: DedicatedWorkerGlobalScope;

let engine: EchoEngine | null = null;
let frames: ReconstructionFrame[] = [];
const CAP = 600;

type Msg =
  | { type: "init"; config: ScenarioConfig; ridge: RidgeWeights | null }
  | { type: "advance"; toTime: number; want: number | null };

self.onmessage = (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  try {
    if (m.type === "init") {
      engine = new EchoEngine(m.config, { ridge: m.ridge });
      frames = [];
      self.postMessage({ type: "ready" });
      return;
    }
    if (!engine) return;
    const period = 1 / engine.config.dsp.frameRateHz;
    while (engine.simTime < m.toTime - 1e-9 && !engine.finished) {
      for (const f of engine.advance(Math.min(period, m.toTime - engine.simTime + 1e-9), Infinity, Infinity)) {
        frames.push(f);
        if (frames.length > CAP) frames.shift();
      }
    }
    const pick = m.want === null ? frames[frames.length - 1] : frames.find((f) => f.seq === m.want) ?? frames[frames.length - 1];
    self.postMessage({ type: "frame", frame: pick ?? null, simTime: engine.simTime });
  } catch (e) {
    self.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
