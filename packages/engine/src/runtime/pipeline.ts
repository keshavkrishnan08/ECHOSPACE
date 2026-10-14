import type {
  FrameMetrics,
  GroundTruthSubject,
  ReconstructionFrame,
  ScenarioConfig,
  StageId,
  StageRecord,
  TrackEvent,
} from "@echospace/schemas";
import { PREPROCESSING_VERSION } from "@echospace/schemas";
import { alignLink } from "../dsp/align";
import { dopplerFreqs, dopplerSpectrum } from "../dsp/fft";
import { hampel } from "../dsp/hampel";
import { BoundedQueue, RingSeries } from "../dsp/queue";
import { sanitizePacket } from "../dsp/sanitize";
import { validatePackets } from "../dsp/validate";
import {
  IdSwitchCounter,
  bodySurfacePoints,
  chamfer,
  evaluateTracks,
  floorFromVoxels,
  groundTruthOccupancy,
  iou,
} from "../metrics/evaluate";
import { BackProjectionModel } from "../recon/backprojection";
import { boxFilter3d, emaInPlace, samplePoints } from "../recon/occupancy";
import { geometryKey, ridgePredict, type RidgeWeights } from "../recon/ridge";
import { RtiModel } from "../recon/rti";
import type { CsiPacket } from "../sim/channel";
import { STREAM, deriveSeed } from "../sim/rng";
import { buildGrid, stableHash, type VoxelGrid } from "../sim/scene";
import { detect } from "../tracking/detect";
import { Tracker } from "../tracking/tracker";
import type { SourceDescriptor } from "./source";

export const STAGE_LABELS: Record<StageId, string> = {
  validate: "Input validation",
  align: "Timestamp alignment",
  buffer: "Packet buffering",
  estimate: "Channel estimation",
  preprocess: "Phase & amplitude preprocessing",
  filter: "Noise filtering",
  features: "Feature extraction",
  spatial: "Spatial representation",
  inference: "Model inference",
  reconstruct: "Reconstruction filtering",
  associate: "Temporal association",
  serialize: "Output serialization",
};

export const MODEL_VERSIONS: Record<string, string> = {
  "rti-bayes": "1.0.0",
  "bp-dsb": "1.0.0",
  "ridge-floor": "1.0.0",
  "tcn-encoder": "—",
  "transformer-encoder": "—",
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const wallMs = () => (typeof performance !== "undefined" && performance.timeOrigin ? performance.timeOrigin + performance.now() : Date.now());

interface LinkHistory {
  san: BoundedQueue<{ re: Float64Array; im: Float64Array; t: number }>;
  rss: RingSeries;
}

export interface PipelineOptions {
  ridge?: RidgeWeights | null;
  engine?: "browser-worker" | "python-reference";
  selectedLink?: number;
}

export class Pipeline {
  readonly grid: VoxelGrid;
  readonly L: number;
  private rti: RtiModel | null = null;
  private bp: BackProjectionModel | null = null;
  private tracker: Tracker;
  private idSwitches = new IdSwitchCounter();
  private hist: LinkHistory[];
  private rssFilt: Float64Array;
  private occState: Float32Array | null = null;
  private calibrated = false;
  private calBuffer: CsiPacket[] = [];
  private baselineRss: Float64Array;
  private calibMotion: Float64Array;
  private snrEst: Float64Array;
  private background: Array<{ re: Float64Array; im: Float64Array } | null>;
  private bpNorm: Float64Array;
  private xMHz: Float64Array;
  private seq = 0;
  private stage: Record<StageId, StageRecord>;
  private totalAccepted = 0;
  private lastFrameT = 0;
  private selfCalibrated = false;
  readonly configHash: string;
  selectedLink: number;
  private lastPacket: Array<{ p: CsiPacket; san: ReturnType<typeof sanitizePacket> } | null>;

  constructor(public cfg: ScenarioConfig, readonly source: SourceDescriptor, readonly opts: PipelineOptions = {}) {
    this.L = source.links.length;
    this.grid = buildGrid(cfg.room, cfg.recon.voxelSizeM);
    const bufferPackets = Math.max(8, Math.round(cfg.dsp.bufferSeconds * (source.packetRateHz ?? 100)));
    this.hist = source.links.map(() => ({ san: new BoundedQueue(bufferPackets, "drop-oldest"), rss: new RingSeries(bufferPackets) }));
    this.rssFilt = new Float64Array(this.L).fill(Number.NaN);
    this.baselineRss = new Float64Array(this.L).fill(Number.NaN);
    this.calibMotion = new Float64Array(this.L).fill(Number.NaN);
    this.snrEst = new Float64Array(this.L).fill(Number.NaN);
    this.background = source.links.map(() => null);
    this.bpNorm = new Float64Array(this.L).fill(1);
    this.xMHz = Float64Array.from(source.subcarrierOffsetsHz, (v) => v / 1e6);
    this.lastPacket = source.links.map(() => null);
    this.selectedLink = Math.min(opts.selectedLink ?? 0, Math.max(0, this.L - 1));
    const trailFrames = Math.round(cfg.privacy.trackHistorySeconds * cfg.dsp.frameRateHz);
    this.tracker = new Tracker(cfg.tracking, deriveSeed(cfg.seed, 99, Date.now() & 0xffff), trailFrames);
    this.configHash = stableHash(cfg);
    if (source.geometryKnown && this.L > 0) this.rti = new RtiModel(this.grid, source.links, cfg.recon);
    this.stage = Object.fromEntries(
      (Object.keys(STAGE_LABELS) as StageId[]).map((id) => [
        id,
        {
          id, label: STAGE_LABELS[id], enabled: true, bypassed: Boolean(cfg.pipeline.bypass[id]), applicable: true,
          inputShape: "—", outputShape: "—", dtype: "—", durationMs: 0, queueDelayMs: 0, itemsIn: 0, itemsOut: 0, drops: 0, errors: 0, note: "",
        } satisfies StageRecord,
      ]),
    ) as Record<StageId, StageRecord>;
    this.stage.estimate.applicable = false;
    this.stage.estimate.note = source.adapter === "sdr"
      ? "Least-squares channel estimation from known preambles (SDR adapter not implemented in this build)."
      : "Not applicable: the source already provides per-subcarrier channel estimates (CSI).";
  }

  get isCalibrated() {
    return this.calibrated;
  }

  private ensureBp() {
    if (!this.bp && this.source.geometryKnown && this.source.antennaPositions) {
      const freqs = Float64Array.from(this.source.subcarrierOffsetsHz, (o) => (this.source.centerFreqHz ?? 5.32e9) + o);
      this.bp = new BackProjectionModel(this.grid, this.source.links, this.source.antennaPositions, freqs);
    }
    return this.bp;
  }

  private rssOf(p: CsiPacket): number {
    let s = 0;
    let n = 0;
    for (let i = 0; i < p.re.length; i++) {
      const r = p.re[i];
      const q = p.im[i];
      if (r === r && q === q) {
        s += r * r + q * q;
        n++;
      }
    }
    return n ? 10 * Math.log10(s / n + 1e-20) : Number.NaN;
  }

  /** Establishes per-link baselines from an empty-room capture. */
  calibrate(packets: CsiPacket[], selfCalibrated = false) {
    const K = this.source.subcarriers;
    const byLink: CsiPacket[][] = this.source.links.map(() => []);
    for (const p of packets) if (p.link >= 0 && p.link < this.L) byLink[p.link].push(p);
    byLink.forEach((list, l) => {
      if (!list.length) return;
      const M = this.source.antennas[l];
      const n = M * K;
      const sumRe = new Float64Array(n);
      const sumIm = new Float64Array(n);
      const sum2 = new Float64Array(n);
      let rssSum = 0;
      let rssN = 0;
      let motion = 0;
      let motionN = 0;
      let prev: { re: Float64Array; im: Float64Array } | null = null;
      const sans: Array<{ re: Float64Array; im: Float64Array }> = [];
      for (const p of list) {
        const r = this.rssOf(p);
        if (Number.isFinite(r)) {
          rssSum += r;
          rssN++;
        }
        const s = sanitizePacket(p.re, p.im, M, K, this.xMHz, this.cfg.dsp.phaseSanitize);
        sans.push(s);
        for (let i = 0; i < n; i++) {
          sumRe[i] += s.re[i];
          sumIm[i] += s.im[i];
          sum2[i] += s.re[i] * s.re[i] + s.im[i] * s.im[i];
        }
        if (prev) {
          motion += normDiff(prev, s);
          motionN++;
        }
        prev = s;
      }
      const N = list.length;
      let sig = 0;
      let res = 0;
      const bg = { re: new Float64Array(n), im: new Float64Array(n) };
      for (let i = 0; i < n; i++) {
        const mr = sumRe[i] / N;
        const mi = sumIm[i] / N;
        bg.re[i] = mr;
        bg.im[i] = mi;
        const p2 = mr * mr + mi * mi;
        if (Number.isFinite(p2)) {
          sig += p2;
          res += Math.max(0, sum2[i] / N - p2);
        }
      }
      this.background[l] = bg;
      this.baselineRss[l] = rssN ? rssSum / rssN : Number.NaN;
      this.calibMotion[l] = motionN ? motion / motionN : Number.NaN;
      this.snrEst[l] = res > 0 ? 10 * Math.log10(sig / res) : Number.NaN;
      // Back-projection normaliser: mean residual energy per packet (incoherent noise level).
      let e = 0;
      for (const s of sans) for (let i = 0; i < n; i++) {
        const dr = s.re[i] - bg.re[i];
        const di = s.im[i] - bg.im[i];
        if (dr === dr && di === di) e += dr * dr + di * di;
      }
      this.bpNorm[l] = Math.max(1e-12, e / sans.length);
    });
    this.calibrated = true;
    this.selfCalibrated = selfCalibrated;
  }

  /** Feeds packets for one frame window and returns a fully instrumented frame. */
  process(packets: CsiPacket[], frameT: number, gt: GroundTruthSubject[] | null, ctx: { queueDelayMs: number; ingestedAtMs: number; acquisitionDepth: number; acquisitionCapacity: number; acquisitionDrops: number; framesDropped: number; injectedDelayMs: number }): ReconstructionFrame {
    const cfg = this.cfg;
    const K = this.source.subcarriers;
    const L = this.L;
    const st = this.stage;
    const warnings: string[] = [];
    const events: TrackEvent[] = [];
    const rate = this.source.packetRateHz ?? 100;
    const dt = this.lastFrameT ? Math.max(1e-3, frameT - this.lastFrameT) : 1 / cfg.dsp.frameRateHz;
    this.lastFrameT = frameT;
    const t0all = now();

    // 1. validate
    let t0 = now();
    const v = validatePackets(packets, { links: L, antennas: this.source.antennas, subcarriers: K });
    this.totalAccepted += v.accepted.length;
    Object.assign(st.validate, {
      inputShape: `${packets.length} packets`, outputShape: `${v.accepted.length} packets`, dtype: "complex64",
      durationMs: now() - t0, queueDelayMs: ctx.queueDelayMs, itemsIn: packets.length, itemsOut: v.accepted.length,
      errors: st.validate.errors + v.rejected, note: v.errors[0] ?? "",
    });
    if (v.missingAntennas.size) {
      const desc = [...v.missingAntennas.entries()].map(([l, s]) => `${this.source.links[l].id} ant ${[...s].join("/")}`).join(", ");
      warnings.push(`Missing antenna channels (non-finite samples): ${desc}`);
      events.push({ kind: "signal-warning", timestampS: frameT, message: `Missing channels: ${desc}`, severity: "warning" });
    }

    // 2. align
    t0 = now();
    const byLink: CsiPacket[][] = this.source.links.map(() => []);
    for (const p of v.accepted) byLink[p.link].push(p);
    let recon = 0;
    let gaps = 0;
    let jitterSum = 0;
    let jitterN = 0;
    for (let l = 0; l < L; l++) {
      const a = alignLink(byLink[l], rate);
      byLink[l] = a.packets;
      recon += a.reconstructedTimestamps;
      gaps += a.gaps;
      if (Number.isFinite(a.jitterMs)) {
        jitterSum += a.jitterMs;
        jitterN++;
      }
    }
    Object.assign(st.align, {
      inputShape: `${v.accepted.length} packets`, outputShape: `${L} links × ordered`, dtype: "float64 ts",
      durationMs: now() - t0, itemsIn: v.accepted.length, itemsOut: v.accepted.length,
      note: `${recon} timestamps reconstructed, ${gaps} sequence gaps, jitter ${jitterN ? (jitterSum / jitterN).toFixed(2) : "N/A"} ms`,
    });
    if (recon > v.accepted.length * 0.2) warnings.push(`${recon} packet timestamps were missing and reconstructed from sequence numbers.`);

    // Calibration handling for sources without an empty-room capture.
    if (!this.calibrated) {
      for (const list of byLink) this.calBuffer.push(...list);
      const need = this.cfg.dsp.calibrationSeconds;
      const span = this.calBuffer.length ? this.calBuffer[this.calBuffer.length - 1].trueTimeS - this.calBuffer[0].trueTimeS : 0;
      if (span >= need) {
        this.calibrate(this.calBuffer, true);
        this.calBuffer = [];
        events.push({ kind: "signal-warning", timestampS: frameT, message: `No empty-room capture: baseline estimated from the first ${need.toFixed(1)} s of the stream (may include people).`, severity: "warning" });
      }
    }

    // 3. buffer + 4. estimate (n/a) + 5. preprocess
    t0 = now();
    let sanTime = 0;
    let historyDrops = 0;
    const frameSan: Array<Array<{ re: Float64Array; im: Float64Array; t: number }>> = this.source.links.map(() => []);
    for (let l = 0; l < L; l++) {
      const M = this.source.antennas[l];
      const h = this.hist[l];
      for (const p of byLink[l]) {
        const ts = now();
        const san = sanitizePacket(p.re, p.im, M, K, this.xMHz, cfg.dsp.phaseSanitize && !cfg.pipeline.bypass.preprocess);
        sanTime += now() - ts;
        const before = h.san.drops;
        h.san.push({ re: san.re, im: san.im, t: p.timestampS });
        historyDrops += h.san.drops - before;
        h.rss.push(this.rssOf(p));
        frameSan[l].push({ re: san.re, im: san.im, t: p.timestampS });
        this.lastPacket[l] = { p, san };
      }
    }
    const bufDur = now() - t0 - sanTime;
    Object.assign(st.buffer, {
      inputShape: `${v.accepted.length} packets`, outputShape: `${L} rings × ${this.hist[0]?.san.capacity ?? 0}`, dtype: "complex128",
      durationMs: bufDur, itemsIn: v.accepted.length, itemsOut: v.accepted.length,
      note: `bounded history, ${cfg.dsp.bufferSeconds.toFixed(2)} s per link; ${historyDrops} oldest packets aged out this frame`,
    });
    Object.assign(st.estimate, { inputShape: "—", outputShape: "—", dtype: "—", durationMs: 0, bypassed: true });
    Object.assign(st.preprocess, {
      inputShape: `${v.accepted.length} × [M × ${K}] complex`, outputShape: `${v.accepted.length} × [M × ${K}] complex (sanitized)`, dtype: "complex128",
      durationMs: sanTime, itemsIn: v.accepted.length, itemsOut: v.accepted.length, bypassed: !cfg.dsp.phaseSanitize || Boolean(cfg.pipeline.bypass.preprocess),
      note: cfg.dsp.phaseSanitize ? "linear phase fit on reference antenna removed from all antennas (CFO/STO)" : "phase sanitization disabled",
    });

    // 6. filter
    t0 = now();
    const frameRss = new Float64Array(L).fill(Number.NaN);
    let replaced = 0;
    const hampelOn = cfg.dsp.hampel.enabled && !cfg.pipeline.bypass.filter;
    for (let l = 0; l < L; l++) {
      const nNew = byLink[l].length;
      if (!nNew) continue;
      const series = this.hist[l].rss.toArray();
      const ctxLen = Math.min(series.length, nNew + cfg.dsp.hampel.halfWindow * 2);
      const tail = series.subarray(series.length - ctxLen);
      const filtered = hampelOn ? hampel(tail, cfg.dsp.hampel.halfWindow, cfg.dsp.hampel.nSigma) : { y: tail, replaced: 0 };
      replaced += filtered.replaced;
      let s = 0;
      let n = 0;
      for (let i = filtered.y.length - nNew; i < filtered.y.length; i++) if (Number.isFinite(filtered.y[i])) {
        s += filtered.y[i];
        n++;
      }
      if (!n) continue;
      const mean = s / n;
      const a = cfg.dsp.lowpass.enabled && !cfg.pipeline.bypass.filter ? cfg.dsp.lowpass.alpha : 1;
      this.rssFilt[l] = Number.isFinite(this.rssFilt[l]) ? a * mean + (1 - a) * this.rssFilt[l] : mean;
      frameRss[l] = this.rssFilt[l];
    }
    Object.assign(st.filter, {
      inputShape: `${L} RSS series`, outputShape: `${L} RSS (dB)`, dtype: "float64", durationMs: now() - t0,
      itemsIn: v.accepted.length, itemsOut: L, bypassed: Boolean(cfg.pipeline.bypass.filter),
      note: `Hampel (±${cfg.dsp.hampel.halfWindow}, ${cfg.dsp.hampel.nSigma}σ) replaced ${replaced} samples; EMA α=${cfg.dsp.lowpass.alpha}`,
    });

    // 7. features
    t0 = now();
    const rssDb = new Float32Array(L);
    const deltaRssDb = new Float32Array(L);
    const motionEnergy = new Float32Array(L);
    const deliveryRatio = new Float32Array(L);
    const expected = rate / cfg.dsp.frameRateHz;
    for (let l = 0; l < L; l++) {
      rssDb[l] = frameRss[l];
      deltaRssDb[l] = this.calibrated ? this.baselineRss[l] - frameRss[l] : Number.NaN;
      deliveryRatio[l] = Math.min(1, byLink[l].length / expected);
      const fs = frameSan[l];
      let me = 0;
      let mn = 0;
      for (let i = 1; i < fs.length; i++) {
        me += normDiff(fs[i - 1], fs[i]);
        mn++;
      }
      const raw = mn ? me / mn : Number.NaN;
      motionEnergy[l] = Number.isFinite(this.calibMotion[l]) && this.calibMotion[l] > 0 ? raw / this.calibMotion[l] : raw;
    }
    const snrDb = Float32Array.from(this.snrEst);
    Object.assign(st.features, {
      inputShape: `${L} links`, outputShape: `${L} × 4 features`, dtype: "float32", durationMs: now() - t0,
      itemsIn: L, itemsOut: L * 4, note: this.calibrated ? (this.selfCalibrated ? "baseline self-estimated from stream start" : "baseline from empty-room calibration") : "awaiting calibration",
    });

    // 8. spatial + 9. inference
    const modelId = cfg.recon.modelId;
    let image: Float32Array = new Float32Array(this.grid.count);
    let varianceRatio: Float32Array = new Float32Array(this.grid.count).fill(1);
    let occupancy: Float32Array = new Float32Array(this.grid.count);
    let modelStatus: "ok" | "degraded" | "unsupported" = "ok";
    let modelMessage = "";
    let activeLinks = 0;
    t0 = now();
    const finiteLinks = Array.from(deltaRssDb).filter((x) => Number.isFinite(x)).length;
    if (!this.calibrated) {
      modelStatus = "degraded";
      modelMessage = "Calibrating: collecting baseline before imaging.";
    } else if (!this.source.geometryKnown || !this.rti) {
      modelStatus = "unsupported";
      modelMessage = "Sensor geometry is unknown for this source, so no spatial reconstruction is possible. Signal diagnostics remain available.";
    } else if (modelId === "tcn-encoder" || modelId === "transformer-encoder") {
      modelStatus = "unsupported";
      modelMessage = `${modelId} is a registered interface slot without trained weights in this build. No output is produced.`;
    } else if (finiteLinks < 3 && modelId !== "bp-dsb") {
      modelStatus = "unsupported";
      modelMessage = `Insufficient observations: ${finiteLinks} usable link(s); attenuation imaging needs at least 3 links with crossing geometry to localise anything.`;
      varianceRatio = this.rti.coverage().slice();
    } else if (modelId === "rti-bayes") {
      const y = Float32Array.from(deltaRssDb, (x) => (Number.isFinite(x) ? Math.max(-3, Math.min(25, x)) : Number.NaN));
      const r = this.rti.reconstruct(y);
      image = r.image;
      varianceRatio = r.varianceRatio;
      occupancy = r.occupancy;
      activeLinks = r.activeLinks;
      if (activeLinks < L) {
        modelStatus = "degraded";
        modelMessage = `${L - activeLinks} of ${L} links had no data this frame; posterior variance raised where they provided coverage.`;
      }
    } else if (modelId === "bp-dsb") {
      const bp = this.ensureBp();
      if (!bp) {
        modelStatus = "unsupported";
        modelMessage = "Coherent back-projection needs receive-antenna positions, which this source does not declare.";
      } else {
        const dyn: Array<{ re: Float64Array; im: Float64Array } | null> = [];
        for (let l = 0; l < L; l++) {
          const fs = frameSan[l];
          const bg = this.background[l];
          if (!fs.length || !bg) {
            dyn.push(null);
            continue;
          }
          const last = fs[fs.length - 1];
          const re = new Float64Array(last.re.length);
          const im = new Float64Array(last.im.length);
          for (let i = 0; i < re.length; i++) {
            re[i] = last.re[i] - bg.re[i];
            im[i] = last.im[i] - bg.im[i];
          }
          dyn.push({ re, im });
          activeLinks++;
        }
        const img = bp.image(dyn, this.bpNorm);
        const nAct = Math.max(1, activeLinks);
        for (let i = 0; i < img.length; i++) {
          const ratio = img[i] / nAct;
          image[i] = ratio;
          occupancy[i] = 1 / (1 + Math.exp(-(ratio - 6) / 1.5));
        }
        varianceRatio = this.rti.coverage().slice();
        modelMessage = "Detection statistic = mean per-link coherent energy relative to the calibration noise level; probability mapping is a fixed logistic heuristic (uncalibrated).";
      }
    } else if (modelId === "ridge-floor") {
      const w = this.opts.ridge;
      const key = geometryKey(cfg.room, cfg.sensors);
      if (!w) {
        modelStatus = "unsupported";
        modelMessage = "ridge-floor weights are not loaded in this engine instance.";
      } else if (w.geometryKey !== key || w.links !== L) {
        modelStatus = "unsupported";
        modelMessage = `Unexpected scene geometry: ridge-floor was trained for ${w.trainedOn}; this scene (${cfg.room.width}×${cfg.room.depth} m, ${cfg.sensors.length} nodes) does not match, so the model refuses to run.`;
        varianceRatio = this.rti.coverage().slice();
      } else {
        const feats = new Float64Array(2 * L);
        for (let l = 0; l < L; l++) {
          feats[l] = deltaRssDb[l];
          feats[L + l] = motionEnergy[l];
        }
        const out = ridgePredict(w, feats);
        const cov = this.rti.coverage();
        varianceRatio = cov.slice();
        const g = this.grid;
        for (let k = 0; k < g.nz; k++)
          for (let j = 0; j < g.ny; j++)
            for (let i = 0; i < g.nx; i++) {
              const id = i + g.nx * (j + g.ny * k);
              const x = g.centers[id * 3];
              const y = g.centers[id * 3 + 1];
              const z = g.centers[id * 3 + 2];
              const ci = Math.min(w.grid.nx - 1, Math.floor(x / w.grid.cellM));
              const cj = Math.min(w.grid.ny - 1, Math.floor(y / w.grid.cellM));
              const s = out.floor[ci + w.grid.nx * cj];
              image[id] = s;
              occupancy[id] = z < 1.8 ? s : 0;
            }
        if (out.ood) {
          modelStatus = "degraded";
          modelMessage = `Distribution shift: mean |z| of input features is ${out.meanAbsZ.toFixed(1)} (training limit ${w.oodMaxMeanAbsZ}). Output shown but should not be trusted.`;
          warnings.push(modelMessage);
        } else modelMessage = "Floor-plane scores extruded to 1.8 m; the model has no vertical resolution.";
      }
    }
    const spatialMs = now() - t0;
    Object.assign(st.spatial, {
      inputShape: `${L} link features`, outputShape: `${this.grid.nx}×${this.grid.ny}×${this.grid.nz} image`, dtype: "float32",
      durationMs: spatialMs * 0.7, itemsIn: L, itemsOut: this.grid.count, note: `${modelId}: ${activeLinks} active links`,
    });
    t0 = now();
    if (ctx.injectedDelayMs > 0) {
      const until = now() + ctx.injectedDelayMs;
      while (now() < until) { /* deliberate busy-wait: injected inference delay */ }
    }
    Object.assign(st.inference, {
      inputShape: `${this.grid.count} voxels`, outputShape: `${this.grid.count} probabilities`, dtype: "float32",
      durationMs: spatialMs * 0.3 + (now() - t0), itemsIn: this.grid.count, itemsOut: this.grid.count,
      errors: st.inference.errors + (modelStatus === "unsupported" ? 1 : 0),
      note: (ctx.injectedDelayMs > 0 ? `INJECTED DELAY ${ctx.injectedDelayMs} ms. ` : "") + (modelMessage || `${modelId} ok`),
    });
    if (modelStatus !== "ok" && modelMessage) events.push({ kind: "capability", timestampS: frameT, message: modelMessage, severity: modelStatus === "unsupported" ? "error" : "warning" });

    // 10. reconstruct
    t0 = now();
    if (!this.occState || this.occState.length !== occupancy.length) this.occState = occupancy.slice();
    else emaInPlace(this.occState, occupancy, cfg.pipeline.bypass.reconstruct ? 0 : cfg.recon.temporalSmoothing);
    let smoothed = this.occState;
    if (cfg.recon.spatialFilter && !cfg.pipeline.bypass.reconstruct) smoothed = boxFilter3d(smoothed, this.grid);
    const occOut = modelStatus === "unsupported" ? new Float32Array(this.grid.count) : smoothed;
    const pseed = deriveSeed(cfg.seed, STREAM.points, this.seq);
    const rawImageNorm = normalizeImage(image);
    const raw = modelStatus === "unsupported" ? { points: new Float32Array(0), removed: 0 } : samplePoints(rawImageNorm, null, this.grid, { threshold: 0.35, confidenceThreshold: 0, maxPoints: cfg.recon.maxPoints, outlierRemoval: false, seed: pseed });
    const filt = modelStatus === "unsupported" ? { points: new Float32Array(0), removed: 0 } : samplePoints(occOut, varianceRatio, this.grid, { threshold: cfg.recon.occupancyThreshold, confidenceThreshold: cfg.recon.confidenceThreshold, maxPoints: cfg.recon.maxPoints, outlierRemoval: cfg.recon.outlierRemoval, seed: pseed ^ 0x5bd1e995 });
    Object.assign(st.reconstruct, {
      inputShape: `${this.grid.count} voxels`, outputShape: `${raw.points.length / 5} raw / ${filt.points.length / 5} filtered points`, dtype: "float32",
      durationMs: now() - t0, itemsIn: this.grid.count, itemsOut: filt.points.length / 5, bypassed: Boolean(cfg.pipeline.bypass.reconstruct),
      note: `EMA ${cfg.recon.temporalSmoothing}, spatial ${cfg.recon.spatialFilter ? "3×3×3 box" : "off"}, ${filt.removed} isolated voxels removed`,
    });

    // 11. associate
    t0 = now();
    let tracks: ReconstructionFrame["tracks"] = [];
    let detections: ReconstructionFrame["detections"] = [];
    const trackingOn = cfg.tracking.enabled && !cfg.pipeline.bypass.associate && modelStatus !== "unsupported";
    if (cfg.tracking.filter === "learned") {
      warnings.push("Learned temporal model is not implemented; tracking disabled rather than substituted.");
      st.associate.note = "learned temporal model not implemented";
    } else if (trackingOn && this.calibrated) {
      detections = detect(occOut, this.grid, cfg.tracking.detectionThreshold, cfg.tracking.maxDetections);
      this.tracker.configure(cfg.tracking, Math.round(cfg.privacy.trackHistorySeconds * cfg.dsp.frameRateHz));
      const r = this.tracker.step(detections, dt, frameT);
      tracks = r.tracks;
      events.push(...r.events);
      st.associate.note = `${cfg.tracking.filter} filter, gate ${cfg.tracking.gateM} m`;
    }
    Object.assign(st.associate, {
      inputShape: `${detections.length} detections`, outputShape: `${tracks.length} tracks`, dtype: "float64",
      durationMs: now() - t0, itemsIn: detections.length, itemsOut: tracks.length, bypassed: Boolean(cfg.pipeline.bypass.associate) || !cfg.tracking.enabled,
    });

    // Metrics against ground truth (simulation only).
    let gtOcc: Uint8Array | null = null;
    const metrics: FrameMetrics = {
      positionErrorM: null, floorIou: null, voxelIou: null, precision: null, recall: null, chamferM: null,
      meanConfidence: 0, observedFraction: 0, activeTracks: tracks.filter((t) => t.confirmed).length, confirmedTracks: tracks.filter((t) => t.confirmed).length,
      idSwitchesTotal: this.idSwitches.total, inputQuality: 0, meanSnrDb: null, packetDeliveryRatio: 0, processingMs: 0, endToEndMs: null,
    };
    let conf = 0;
    let obs = 0;
    for (let i = 0; i < varianceRatio.length; i++) {
      conf += 1 - varianceRatio[i];
      if (varianceRatio[i] < 0.8) obs++;
    }
    metrics.meanConfidence = conf / varianceRatio.length;
    metrics.observedFraction = obs / varianceRatio.length;
    const finiteSnr = Array.from(snrDb).filter(Number.isFinite);
    metrics.meanSnrDb = finiteSnr.length ? finiteSnr.reduce((a, b) => a + b, 0) / finiteSnr.length : null;
    metrics.packetDeliveryRatio = L ? Array.from(deliveryRatio).reduce((a, b) => a + b, 0) / L : 0;
    const snrFactor = metrics.meanSnrDb === null ? 1 : 1 / (1 + Math.exp(-(metrics.meanSnrDb - 10) / 3));
    metrics.inputQuality = metrics.packetDeliveryRatio * snrFactor;
    if (gt) {
      gtOcc = groundTruthOccupancy(this.grid, gt);
      if (modelStatus !== "unsupported" && this.calibrated) {
        const ev = evaluateTracks(tracks, gt);
        metrics.positionErrorM = ev.positionErrorM;
        metrics.precision = ev.precision;
        metrics.recall = ev.recall;
        for (const s of this.idSwitches.update(ev.matches)) events.push({ kind: "id-switch", timestampS: frameT, message: `Identity switch ${s}`, severity: "warning" });
        metrics.idSwitchesTotal = this.idSwitches.total;
        metrics.voxelIou = iou(occOut, gtOcc, cfg.recon.occupancyThreshold);
        metrics.floorIou = iou(floorFromVoxels(occOut, this.grid), floorFromVoxels(gtOcc, this.grid), cfg.recon.occupancyThreshold);
        metrics.chamferM = gt.length ? chamfer(filt.points, bodySurfacePoints(gt)) : null;
      }
    }
    if (metrics.inputQuality < 0.5) warnings.push(`Input quality ${metrics.inputQuality.toFixed(2)}: delivery ${(metrics.packetDeliveryRatio * 100).toFixed(0)} %, SNR ${metrics.meanSnrDb?.toFixed(1) ?? "N/A"} dB.`);

    // CSI snapshot and Doppler column for the selected link.
    let csi: ReconstructionFrame["csi"] = null;
    let dopplerColumn: Float32Array | null = null;
    let dopplerFreqsHz: Float32Array | null = null;
    const sel = this.lastPacket[this.selectedLink];
    if (sel) {
      csi = {
        linkIndex: this.selectedLink,
        magnitude: Float32Array.from(sel.san.mag),
        phaseRaw: Float32Array.from(sel.san.phaseRaw),
        phaseSanitized: Float32Array.from(sel.san.phaseSan),
        antennas: sel.p.antennas,
        subcarriers: sel.p.subcarriers,
        subcarrierOffsetsHz: Float32Array.from(this.source.subcarrierOffsetsHz),
        timestampS: sel.p.timestampS,
      };
      const h = this.hist[this.selectedLink].san;
      const nfft = 64;
      const n = Math.min(h.length, nfft);
      if (n >= 8) {
        const re = new Float64Array(n);
        const im = new Float64Array(n);
        const items = h.toArray().slice(-n);
        items.forEach((it, i) => {
          let sr = 0;
          let si = 0;
          for (let k = 0; k < K; k++) if (it.re[k] === it.re[k]) {
            sr += it.re[k];
            si += it.im[k];
          }
          re[i] = sr / K;
          im[i] = si / K;
        });
        dopplerColumn = Float32Array.from(dopplerSpectrum(re, im, nfft));
        dopplerFreqsHz = Float32Array.from(dopplerFreqs(nfft, rate));
      }
    }

    // 12. serialize
    t0 = now();
    const processingBeforeSerialize = now() - t0all;
    const frame: ReconstructionFrame = {
      seq: this.seq++,
      timestampS: frameT,
      ingestedAtMs: ctx.ingestedAtMs,
      emittedAtMs: 0,
      state: !this.calibrated ? "calibrating" : modelStatus !== "ok" || metrics.inputQuality < 0.5 ? "degraded" : "streaming",
      provenance: {
        sourceMode: this.source.mode,
        sourceId: this.source.id,
        scenario: this.source.mode === "synthetic" ? cfg.scenario : null,
        seed: this.source.mode === "synthetic" ? cfg.seed : null,
        modelId,
        modelVersion: MODEL_VERSIONS[modelId] ?? "unknown",
        preprocessingVersion: PREPROCESSING_VERSION,
        engine: this.opts.engine ?? "browser-worker",
        configHash: this.configHash,
      },
      grid: { nx: this.grid.nx, ny: this.grid.ny, nz: this.grid.nz, voxelSizeM: cfg.room.width / this.grid.nx, origin: [0, 0, 0] },
      occupancy: occOut.slice(),
      varianceRatio,
      image,
      pointsRaw: raw.points,
      pointsFiltered: filt.points,
      detections,
      tracks,
      groundTruth: gt,
      groundTruthOccupancy: gtOcc,
      features: { rssDb, deltaRssDb, motionEnergy, snrEstDb: snrDb, deliveryRatio },
      csi,
      dopplerColumn,
      dopplerFreqsHz,
      stages: [],
      propagation: null,
      metrics,
      events,
      capability: {
        skeleton: "unsupported",
        reason: "No registered model in this build infers joint coordinates from RF features. Any skeleton shown is synthetic ground truth.",
        modelStatus,
        modelMessage,
      },
      warnings,
      queues: { acquisitionDepth: ctx.acquisitionDepth, acquisitionCapacity: ctx.acquisitionCapacity, acquisitionDrops: ctx.acquisitionDrops, framesDropped: ctx.framesDropped },
    };
    const bytes = frame.occupancy.byteLength + frame.varianceRatio.byteLength + frame.image.byteLength + frame.pointsRaw.byteLength + frame.pointsFiltered.byteLength;
    Object.assign(st.serialize, {
      inputShape: "frame object", outputShape: `${(bytes / 1024).toFixed(1)} KiB transferable`, dtype: "float32 buffers",
      durationMs: now() - t0, itemsIn: 1, itemsOut: 1, note: "typed arrays transferred to the UI thread without copying",
    });
    frame.metrics.processingMs = processingBeforeSerialize + st.serialize.durationMs;
    frame.stages = (Object.keys(STAGE_LABELS) as StageId[]).map((id) => ({ ...st[id] }));
    frame.emittedAtMs = wallMs();
    return frame;
  }

  reset() {
    this.tracker.reset();
    this.idSwitches.reset();
    this.occState = null;
    this.rssFilt.fill(Number.NaN);
    this.seq = 0;
    this.lastFrameT = 0;
    for (const h of this.hist) {
      h.san.clear();
      h.rss.clear();
    }
  }
}

function normDiff(a: { re: Float64Array; im: Float64Array }, b: { re: Float64Array; im: Float64Array }) {
  let d = 0;
  let e = 0;
  for (let i = 0; i < a.re.length; i++) {
    const dr = b.re[i] - a.re[i];
    const di = b.im[i] - a.im[i];
    if (dr === dr && di === di) {
      d += dr * dr + di * di;
      e += b.re[i] * b.re[i] + b.im[i] * b.im[i];
    }
  }
  return e > 0 ? d / e : 0;
}

function normalizeImage(img: Float32Array): Float32Array {
  let max = 0;
  for (let i = 0; i < img.length; i++) if (img[i] > max) max = img[i];
  const out = new Float32Array(img.length);
  if (max <= 0) return out;
  for (let i = 0; i < img.length; i++) out[i] = Math.max(0, img[i]) / max;
  return out;
}
