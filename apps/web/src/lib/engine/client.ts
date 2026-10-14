import type { ReconstructionFrame, ScenarioConfig } from "@echospace/schemas";
import type { CsiPacket, RidgeWeights, SourceDescriptor } from "@echospace/engine";
import type { EngineInfo, FromWorker, ToWorker } from "./protocol";

export interface EngineCallbacks {
  onReady(info: EngineInfo): void;
  onReconfigured(frameSeq: number, t: number): void;
  onFrames(frames: ReconstructionFrame[], meta: { simTime: number; displayDrops: number; receivedAtMs: number }): void;
  onStatus(s: { playing: boolean; simTime: number; finished: boolean; message?: string }): void;
  onError(message: string, fatal: boolean): void;
}

const wallMs = () => performance.timeOrigin + performance.now();

/** Main-thread handle on the engine worker. */
export class EngineClient {
  private worker: Worker | null = null;
  constructor(private cb: EngineCallbacks) {}

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module", name: "echospace-engine" });
    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      switch (m.type) {
        case "ready":
          this.cb.onReady(m.info);
          break;
        case "reconfigured":
          this.cb.onReconfigured(m.frameSeq, m.t);
          break;
        case "frames": {
          const receivedAtMs = wallMs();
          for (const f of m.frames) f.metrics.endToEndMs = receivedAtMs - f.ingestedAtMs;
          this.cb.onFrames(m.frames, { simTime: m.simTime, displayDrops: m.displayDrops, receivedAtMs });
          this.send({ type: "ack" });
          break;
        }
        case "status":
          this.cb.onStatus(m);
          break;
        case "error":
          this.cb.onError(m.message, m.fatal);
          break;
      }
    };
    w.onerror = (e) => this.cb.onError(e.message || "Engine worker crashed", true);
    this.worker = w;
    return w;
  }

  send(msg: ToWorker) {
    this.ensure().postMessage(msg);
  }

  init(config: ScenarioConfig, ridge: RidgeWeights | null, selectedLink: number, maxInFlight: number, schedule?: Array<{ frameSeq: number; config: ScenarioConfig }>) {
    this.send({ type: "init", config, ridge, selectedLink, maxInFlight, schedule });
  }

  initRecorded(config: ScenarioConfig, descriptor: SourceDescriptor, packets: CsiPacket[], calibration: CsiPacket[] | null, maxInFlight: number) {
    this.send({ type: "init-recorded", config, descriptor, packets, calibration, maxInFlight });
  }

  initPush(config: ScenarioConfig, descriptor: SourceDescriptor, maxInFlight: number) {
    this.send({ type: "init-push", config, descriptor, maxInFlight });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
  }
}
