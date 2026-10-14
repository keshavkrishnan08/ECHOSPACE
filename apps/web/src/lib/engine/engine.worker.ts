/// <reference lib="webworker" />
import { EchoEngine, PushSource, RecordedSource, type PacketSource } from "@echospace/engine";
import type { ReconstructionFrame } from "@echospace/schemas";
import type { EngineInfo, FromWorker, ToWorker } from "./protocol";
import { DIGEST_FRAMES, digestParts, framePart } from "./digest";

/**
 * Engine host. Runs simulation, DSP and inference off the UI thread. Frames are posted with
 * their typed-array buffers transferred. At most `maxInFlight` unacknowledged messages may be
 * outstanding; beyond that, frames are dropped here and counted (display backpressure).
 */
declare const self: DedicatedWorkerGlobalScope;

let engine: EchoEngine | null = null;
let push: PushSource | null = null;
let playing = false;
let speed = 1;
let inFlight = 0;
let maxInFlight = 2;
let displayDrops = 0;
let lastTick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
/** Incremented by the UI on every launch/restart; frames carry it so stale ones can be dropped. */
let epoch = 0;
let digestBuf: number[] = [];
let digestDone = false;

/** Feeds every produced frame (before any display drop) into the replay digest. */
function digest(frames: ReconstructionFrame[]) {
  if (digestDone) return;
  for (const f of frames) {
    if (f.seq >= DIGEST_FRAMES) continue;
    framePart(f, digestBuf);
    if (f.seq === DIGEST_FRAMES - 1) {
      digestDone = true;
      const e = epoch;
      const clean = !!engine && engine.framesDropped === 0 && engine.queueStats.drops === 0;
      void digestParts(digestBuf).then((d) => post({ type: "digest", epoch: e, digest: d, frames: DIGEST_FRAMES, clean }));
      digestBuf = [];
    }
  }
}

function resetDigest() {
  digestBuf = [];
  digestDone = false;
}

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

function info(e: EchoEngine, initMs: number): EngineInfo {
  const d = e.source.descriptor;
  const { subcarrierOffsetsHz, links, antennaPositions, ...rest } = d;
  void antennaPositions;
  return {
    links: links.map((l) => ({ index: l.index, id: l.id, txId: l.txId, rxId: l.rxId, lengthM: l.lengthM, antennas: l.antennas })),
    grid: { nx: e.pipeline.grid.nx, ny: e.pipeline.grid.ny, nz: e.pipeline.grid.nz, voxelSizeM: e.config.recon.voxelSizeM },
    coverage: null,
    descriptor: { ...rest, subcarrierOffsetsHz: Array.from(subcarrierOffsetsHz) },
    calibrated: e.pipeline.isCalibrated,
    initMs,
    configHash: e.pipeline.configHash,
  };
}

function transferables(frames: ReconstructionFrame[]): Transferable[] {
  const out: Transferable[] = [];
  for (const f of frames) {
    for (const a of [f.occupancy, f.varianceRatio, f.image, f.pointsRaw, f.pointsFiltered]) out.push(a.buffer as ArrayBuffer);
    if (f.groundTruthOccupancy) out.push(f.groundTruthOccupancy.buffer as ArrayBuffer);
  }
  return out;
}

function emit(frames: ReconstructionFrame[]) {
  if (!frames.length || !engine) return;
  digest(frames);
  if (inFlight >= maxInFlight) {
    displayDrops += frames.length;
    return;
  }
  inFlight++;
  post({ type: "frames", frames, simTime: engine.simTime, displayDrops, epoch }, transferables(frames));
}

function tick() {
  if (!engine || !playing) return;
  const t = performance.now();
  const dtWall = Math.min(0.5, (t - lastTick) / 1000);
  lastTick = t;
  try {
    const frames = engine.advance(dtWall * speed, 45);
    emit(frames);
    if (engine.finished) {
      playing = false;
      post({ type: "status", playing: false, simTime: engine.simTime, finished: true, message: "Scenario duration reached" });
    }
  } catch (err) {
    playing = false;
    post({ type: "error", message: err instanceof Error ? err.message : String(err), fatal: false });
  }
}

function startTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, 25);
}

function boot(make: () => EchoEngine, max: number) {
  const t0 = performance.now();
  engine = make();
  resetDigest();
  maxInFlight = max;
  inFlight = 0;
  displayDrops = 0;
  playing = false;
  post({ type: "ready", info: info(engine, performance.now() - t0) });
  post({ type: "status", playing: false, simTime: 0, finished: false });
  startTimer();
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case "init":
        boot(() => {
          const e = new EchoEngine(msg.config, { ridge: msg.ridge, engine: "browser-worker" });
          e.setSelectedLink(msg.selectedLink);
          if (msg.schedule?.length) e.schedule(msg.schedule);
          return e;
        }, msg.maxInFlight);
        break;
      case "init-recorded": {
        const src: PacketSource = new RecordedSource(msg.descriptor, msg.packets, msg.calibration);
        boot(() => new EchoEngine(msg.config, { engine: "browser-worker" }, src), msg.maxInFlight);
        break;
      }
      case "init-push":
        push = new PushSource(msg.descriptor);
        boot(() => new EchoEngine(msg.config, { engine: "browser-worker" }, push!), msg.maxInFlight);
        break;
      case "push-packets":
        if (push) for (const p of msg.packets) push.push(p);
        break;
      case "play":
        if (engine && !engine.finished) {
          playing = true;
          lastTick = performance.now();
          post({ type: "status", playing: true, simTime: engine.simTime, finished: false });
        }
        break;
      case "pause":
        playing = false;
        if (engine) post({ type: "status", playing: false, simTime: engine.simTime, finished: engine.finished });
        break;
      case "speed":
        speed = Math.max(0.05, Math.min(8, msg.speed));
        break;
      case "step":
        if (engine) {
          playing = false;
          const period = 1 / engine.config.dsp.frameRateHz;
          const frames: ReconstructionFrame[] = [];
          for (let i = 0; i < msg.frames && !engine.finished; i++) frames.push(...engine.advance(period, Number.POSITIVE_INFINITY));
          inFlight = 0;
          emit(frames);
          post({ type: "status", playing: false, simTime: engine.simTime, finished: engine.finished });
        }
        break;
      case "epoch":
        epoch = msg.epoch;
        break;
      case "restart":
        epoch = msg.epoch;
        if (engine) {
          engine.restart();
          resetDigest();
          inFlight = 0;
          post({ type: "ready", info: info(engine, 0) });
          post({ type: "status", playing, simTime: 0, finished: false });
        }
        break;
      case "reconfigure":
        if (engine) {
          const t0 = performance.now();
          const frameSeq = engine.reconfigure(msg.config);
          post({ type: "reconfigured", frameSeq, t: engine.changeLog[engine.changeLog.length - 1]?.t ?? 0 });
          post({ type: "ready", info: info(engine, performance.now() - t0) });
        }
        break;
      case "select-link":
        engine?.setSelectedLink(msg.index);
        break;
      case "recalibrate":
        if (engine && !engine.calibrate()) post({ type: "error", message: "This source has no empty-room capture; recalibration is not available.", fatal: false });
        break;
      case "ack":
        inFlight = Math.max(0, inFlight - 1);
        break;
      case "dispose":
        if (timer) clearInterval(timer);
        engine = null;
        playing = false;
        break;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err), fatal: msg.type.startsWith("init") });
  }
};
