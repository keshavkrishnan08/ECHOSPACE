import type { ReconstructionFrame, ScenarioConfig } from "@echospace/schemas";
import { BoundedQueue } from "../dsp/queue";
import type { RidgeWeights } from "../recon/ridge";
import type { CsiPacket } from "../sim/channel";
import { stableHash } from "../sim/scene";
import { Pipeline } from "./pipeline";
import { SyntheticSource, type PacketSource } from "./source";

const wallMs = () => (typeof performance !== "undefined" && performance.timeOrigin ? performance.timeOrigin + performance.now() : Date.now());
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export interface EngineOptions {
  ridge?: RidgeWeights | null;
  engine?: "browser-worker" | "python-reference";
}

/** Keys whose change requires a new pipeline (geometry, grids, buffers) and recalibration. */
function pipelineKey(c: ScenarioConfig) {
  return stableHash({
    room: [c.room.width, c.room.depth, c.room.height],
    sensors: c.sensors,
    sig: [c.signal.subcarriers, c.signal.bandwidthHz, c.signal.centerFreqHz, c.signal.packetRateHz],
    recon: [c.recon.voxelSizeM, c.recon.ellipseExcessM, c.recon.priorStd, c.recon.priorCorrelationM, c.recon.noiseStdDb],
    dsp: [c.dsp.bufferSeconds, c.dsp.calibrationSeconds, c.dsp.frameRateHz],
  });
}

/** Keys whose change requires a new channel simulator. */
function channelKey(c: ScenarioConfig) {
  return stableHash({ room: c.room, obstacles: c.obstacles, openings: c.openings, sensors: c.sensors, subjects: c.subjects, signal: c.signal, impairments: c.impairments, seed: c.seed });
}

function sceneKey(c: ScenarioConfig) {
  return stableHash({ room: c.room, obstacles: c.obstacles, openings: c.openings, signal: c.signal });
}

/**
 * Orchestrates source → bounded acquisition queue → pipeline. The caller drives time with
 * `advance(dtSim, budgetMs)`. If processing cannot keep up, the acquisition queue fills and drops
 * packets according to the configured policy, and frame slots that cannot be processed in time
 * are skipped and counted: nothing grows without bound.
 */
export class EchoEngine {
  config: ScenarioConfig;
  source: PacketSource;
  pipeline: Pipeline;
  private queue: BoundedQueue<{ p: CsiPacket; enqueuedAtMs: number; enqueuedPerf: number }>;
  simTime = 0;
  private nextFrameT: number;
  framesDropped = 0;
  framesProduced = 0;
  private calibratedSceneKey: string | null = null;
  readonly changeLog: Array<{ frameSeq: number; t: number; config: ScenarioConfig }> = [];
  private scheduled: Array<{ frameSeq: number; config: ScenarioConfig }> = [];

  constructor(config: ScenarioConfig, readonly opts: EngineOptions = {}, source?: PacketSource) {
    this.config = config;
    this.source = source ?? new SyntheticSource(config);
    this.pipeline = new Pipeline(config, this.source.descriptor, { ridge: opts.ridge, engine: opts.engine });
    this.queue = this.makeQueue(config);
    this.nextFrameT = 1 / config.dsp.frameRateHz;
    this.calibrate();
  }

  private makeQueue(c: ScenarioConfig) {
    const cap = Math.max(1, c.pipeline.queueDepth) * Math.max(1, this.source.descriptor.links.length);
    return new BoundedQueue<{ p: CsiPacket; enqueuedAtMs: number; enqueuedPerf: number }>(cap, c.pipeline.dropPolicy);
  }

  calibrate(): boolean {
    const cal = this.source.calibration();
    if (cal && cal.length) {
      this.pipeline.calibrate(cal);
      this.calibratedSceneKey = sceneKey(this.config);
      return true;
    }
    return false;
  }

  get calibrationStale() {
    return this.source.descriptor.mode === "synthetic" && this.calibratedSceneKey !== null && this.calibratedSceneKey !== sceneKey(this.config);
  }

  get queueStats() {
    return { depth: this.queue.length, capacity: this.queue.capacity, drops: this.queue.drops };
  }

  /**
   * Applies a new configuration at the next frame boundary, rebuilding only what the change
   * requires. When the channel changes, packets already pulled from the old source are discarded
   * and generation resumes right after the last processed frame, so the result depends only on
   * (launch config, frame index of each change): not on UI timing. Returns the frame index.
   */
  reconfigure(next: ScenarioConfig): number {
    const prev = this.config;
    this.config = next;
    const frameSeq = this.framesProduced;
    const resumeT = this.nextFrameT - 1 / prev.dsp.frameRateHz;
    this.changeLog.push({ frameSeq, t: resumeT, config: next });
    const rebuildPipeline = pipelineKey(prev) !== pipelineKey(next);
    if (this.source instanceof SyntheticSource && channelKey(prev) !== channelKey(next)) {
      const src = new SyntheticSource(next);
      src.seek(resumeT + 1e-9);
      this.source = src;
      this.queue.clear();
      this.simTime = Math.max(0, resumeT);
    }
    if (prev.pipeline.queueDepth !== next.pipeline.queueDepth || prev.pipeline.dropPolicy !== next.pipeline.dropPolicy || rebuildPipeline) {
      this.queue = this.makeQueue(next);
    }
    if (rebuildPipeline) {
      this.pipeline = new Pipeline(next, this.source.descriptor, { ridge: this.opts.ridge, engine: this.opts.engine, selectedLink: this.pipeline.selectedLink });
      this.calibrate();
      this.nextFrameT = Math.max(this.nextFrameT, this.simTime + 1 / next.dsp.frameRateHz);
    } else {
      this.pipeline.cfg = next;
    }
    return frameSeq;
  }

  /** Queues configuration changes to apply when frame `frameSeq` is about to be produced (replay). */
  schedule(changes: Array<{ frameSeq: number; config: ScenarioConfig }>) {
    this.scheduled = [...changes].sort((a, b) => a.frameSeq - b.frameSeq);
  }

  setSelectedLink(i: number) {
    this.pipeline.selectedLink = Math.max(0, Math.min(i, this.source.descriptor.links.length - 1));
  }

  /** Restarts the run from t = 0 with the current configuration (deterministic). */
  restart() {
    this.source = this.source instanceof SyntheticSource ? new SyntheticSource(this.config) : this.source;
    this.source.reset();
    this.pipeline = new Pipeline(this.config, this.source.descriptor, { ridge: this.opts.ridge, engine: this.opts.engine, selectedLink: this.pipeline.selectedLink });
    this.queue = this.makeQueue(this.config);
    this.simTime = 0;
    this.nextFrameT = 1 / this.config.dsp.frameRateHz;
    this.framesDropped = 0;
    this.framesProduced = 0;
    this.changeLog.length = 0;
    this.scheduled = [];
    this.calibrate();
  }

  get finished() {
    return this.simTime >= this.source.durationS();
  }

  /**
   * Advances stream time by dtSim seconds and processes due frames within `budgetMs` of wall time.
   * `maxLagS` bounds how far frame processing may fall behind stream time before slots are skipped.
   */
  advance(dtSim: number, budgetMs = 60, maxLagS = 1.5): ReconstructionFrame[] {
    const t0 = now();
    const target = Math.min(this.simTime + dtSim, this.source.durationS());
    const enqMs = wallMs();
    const enqPerf = now();
    for (const p of this.source.pull(target)) this.queue.push({ p, enqueuedAtMs: enqMs, enqueuedPerf: enqPerf });
    this.simTime = target;
    const frames: ReconstructionFrame[] = [];
    const period = 1 / this.config.dsp.frameRateHz;
    if (this.nextFrameT < this.simTime - maxLagS) {
      const skip = Math.floor((this.simTime - maxLagS - this.nextFrameT) / period) + 1;
      this.framesDropped += skip;
      this.nextFrameT += skip * period;
    }
    while (this.nextFrameT <= this.simTime + 1e-9 && (frames.length === 0 || now() - t0 < budgetMs)) {
      if (this.scheduled.length && this.scheduled[0].frameSeq <= this.framesProduced) {
        this.reconfigure(this.scheduled.shift()!.config);
        for (const p of this.source.pull(target)) this.queue.push({ p, enqueuedAtMs: enqMs, enqueuedPerf: enqPerf });
        this.simTime = target;
        continue;
      }
      const window: CsiPacket[] = [];
      let oldestPerf = Number.POSITIVE_INFINITY;
      let newestMs = 0;
      while (this.queue.length && this.queue.peek()!.p.trueTimeS <= this.nextFrameT + 1e-9) {
        const it = this.queue.shift()!;
        window.push(it.p);
        oldestPerf = Math.min(oldestPerf, it.enqueuedPerf);
        newestMs = Math.max(newestMs, it.enqueuedAtMs);
      }
      const gt = this.source.groundTruth(this.nextFrameT);
      const frame = this.pipeline.process(window, this.nextFrameT, gt, {
        queueDelayMs: Number.isFinite(oldestPerf) ? now() - oldestPerf : 0,
        ingestedAtMs: newestMs || wallMs(),
        acquisitionDepth: this.queue.length,
        acquisitionCapacity: this.queue.capacity,
        acquisitionDrops: this.queue.drops,
        framesDropped: this.framesDropped,
        injectedDelayMs: this.config.pipeline.injectedInferenceDelayMs,
      });
      if (this.source.propagationPaths && this.pipeline.selectedLink < this.source.descriptor.links.length) {
        frame.propagation = this.source.propagationPaths(this.nextFrameT, this.pipeline.selectedLink);
      }
      if (this.calibrationStale) frame.warnings.push("Scene geometry or materials changed since calibration. The empty-room baseline is stale, recalibrate to remove artefacts.");
      frames.push(frame);
      this.framesProduced++;
      this.nextFrameT += period;
    }
    return frames;
  }

  /** Runs the whole configured duration as fast as possible (offline evaluation / tests). */
  runOffline(onFrame: (f: ReconstructionFrame) => void, durationS = this.source.durationS()) {
    const step = 1 / this.config.dsp.frameRateHz;
    while (this.simTime < durationS - 1e-9) {
      for (const f of this.advance(step, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)) onFrame(f);
    }
  }
}
