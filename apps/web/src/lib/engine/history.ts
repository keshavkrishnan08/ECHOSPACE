import type { ReconstructionFrame } from "@echospace/schemas";

export interface FrameSummary {
  seq: number;
  t: number;
  receivedAtMs: number;
  positionErrorM: number | null;
  floorIou: number | null;
  voxelIou: number | null;
  precision: number | null;
  recall: number | null;
  chamferM: number | null;
  meanConfidence: number;
  observedFraction: number;
  activeTracks: number;
  idSwitchesTotal: number;
  inputQuality: number;
  packetDeliveryRatio: number;
  meanSnrDb: number | null;
  processingMs: number;
  endToEndMs: number | null;
  state: ReconstructionFrame["state"];
  modelStatus: ReconstructionFrame["capability"]["modelStatus"];
}

type Listener = () => void;

/**
 * Bounded history of full frames (for scrubbing) plus an unbounded-but-capped list of compact
 * summaries (for metrics, experiment export and timeline markers). Lives outside React state so
 * high-rate updates never trigger re-renders by themselves.
 */
export class FrameHistory {
  private ring: ReconstructionFrame[] = [];
  private start = 0;
  summaries: FrameSummary[] = [];
  events: Array<{ t: number; seq: number; kind: string; message: string; severity: string }> = [];
  version = 0;
  private listeners = new Set<Listener>();

  constructor(public capacity: number, public summaryCapacity = 36000) {}

  push(frames: ReconstructionFrame[], receivedAtMs: number) {
    for (const f of frames) {
      if (this.ring.length < this.capacity) this.ring.push(f);
      else {
        this.ring[this.start] = f;
        this.start = (this.start + 1) % this.capacity;
      }
      const m = f.metrics;
      this.summaries.push({
        seq: f.seq, t: f.timestampS, receivedAtMs, positionErrorM: m.positionErrorM, floorIou: m.floorIou, voxelIou: m.voxelIou,
        precision: m.precision, recall: m.recall, chamferM: m.chamferM, meanConfidence: m.meanConfidence, observedFraction: m.observedFraction,
        activeTracks: m.activeTracks, idSwitchesTotal: m.idSwitchesTotal, inputQuality: m.inputQuality, packetDeliveryRatio: m.packetDeliveryRatio,
        meanSnrDb: m.meanSnrDb, processingMs: m.processingMs, endToEndMs: m.endToEndMs, state: f.state, modelStatus: f.capability.modelStatus,
      });
      if (this.summaries.length > this.summaryCapacity) this.summaries.splice(0, this.summaries.length - this.summaryCapacity);
      for (const e of f.events) {
        if (e.kind === "capability" && this.events.length && this.events[this.events.length - 1].message === e.message) continue;
        this.events.push({ t: e.timestampS, seq: f.seq, kind: e.kind, message: e.message, severity: e.severity });
      }
      if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
    }
    this.version++;
    this.emit();
  }

  get length() {
    return this.ring.length;
  }

  /** Frames in chronological order. */
  /** Frames in chronological order (always a fresh array, safe to memoise on). */
  ordered(): ReconstructionFrame[] {
    return this.ring.length < this.capacity ? this.ring.slice() : [...this.ring.slice(this.start), ...this.ring.slice(0, this.start)];
  }

  latest(): ReconstructionFrame | null {
    if (!this.ring.length) return null;
    return this.ring.length < this.capacity ? this.ring[this.ring.length - 1] : this.ring[(this.start + this.capacity - 1) % this.capacity];
  }

  bySeq(seq: number): ReconstructionFrame | null {
    const o = this.ordered();
    if (!o.length) return null;
    const first = o[0].seq;
    const idx = seq - first;
    if (idx >= 0 && idx < o.length && o[idx].seq === seq) return o[idx];
    let best = o[0];
    for (const f of o) if (Math.abs(f.seq - seq) < Math.abs(best.seq - seq)) best = f;
    return best;
  }

  range(): { first: number; last: number; firstT: number; lastT: number } | null {
    const o = this.ordered();
    if (!o.length) return null;
    return { first: o[0].seq, last: o[o.length - 1].seq, firstT: o[0].timestampS, lastT: o[o.length - 1].timestampS };
  }

  clear() {
    this.ring = [];
    this.start = 0;
    this.summaries = [];
    this.events = [];
    this.version++;
    this.emit();
  }

  resize(capacity: number) {
    const o = this.ordered();
    this.capacity = Math.max(10, capacity);
    this.ring = o.slice(-this.capacity);
    this.start = 0;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

export const history = new FrameHistory(600);
