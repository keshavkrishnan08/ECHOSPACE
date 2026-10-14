import type { GroundTruthSubject, LinkDescriptor, ScenarioConfig, SourceMode } from "@echospace/schemas";
import { ChannelSimulator, type CsiPacket, type PropagationPath } from "../sim/channel";
import { STREAM } from "../sim/rng";
import { compilePath, subjectStateAt, type CompiledPath, type SubjectState } from "../sim/trajectory";

export type AdapterKind = "synthetic" | "recorded-native" | "recorded-esp32" | "esp32-serial" | "sdr";

/** What a source declares about itself. Fields a source does not know are null. */
export interface SourceDescriptor {
  mode: SourceMode;
  adapter: AdapterKind;
  id: string;
  label: string;
  sampleFormat: string;
  links: LinkDescriptor[];
  antennas: number[];
  subcarriers: number;
  subcarrierOffsetsHz: Float64Array;
  centerFreqHz: number | null;
  packetRateHz: number | null;
  /** True when Tx/Rx positions are known in room coordinates (required for imaging). */
  geometryKnown: boolean;
  hasGroundTruth: boolean;
  timestampSource: string;
  notes: string[];
  /** Receive-antenna element positions per link, when known (needed by coherent imaging). */
  antennaPositions?: Array<Array<[number, number, number]>>;
}

export interface PacketSource {
  readonly descriptor: SourceDescriptor;
  /** Empty-room calibration capture, or null if the source has none. */
  calibration(): CsiPacket[] | null;
  /** Packets whose arrival time is ≤ untilS (each packet returned once). */
  pull(untilS: number): CsiPacket[];
  groundTruth(t: number): GroundTruthSubject[] | null;
  propagationPaths?(t: number, link: number): PropagationPath[];
  /** Total available stream time, seconds (Infinity for live/looping sources). */
  durationS(): number;
  reset(): void;
}

/**
 * Deterministic synthetic CSI source driven by a scenario configuration. Calibration uses a
 * separate random stream with the room empty, which mirrors how a physical deployment would
 * capture an empty-room baseline.
 */
export class SyntheticSource implements PacketSource {
  readonly descriptor: SourceDescriptor;
  private sim: ChannelSimulator;
  private paths: CompiledPath[];
  private nextSeq = 0;
  private scratch: { re: Float64Array; im: Float64Array };

  constructor(readonly config: ScenarioConfig) {
    this.sim = new ChannelSimulator(config);
    this.paths = config.subjects.map(compilePath);
    const maxN = Math.max(...this.sim.links.map((l) => l.antennas), 1) * this.sim.K;
    this.scratch = { re: new Float64Array(maxN), im: new Float64Array(maxN) };
    this.descriptor = {
      mode: "synthetic",
      adapter: "synthetic",
      id: `synthetic:${config.scenario}:${config.seed}`,
      label: `Synthetic scenario ${config.scenario} (seed ${config.seed})`,
      sampleFormat: "complex64 CSI [antenna × subcarrier] per link, normalized units",
      links: this.sim.links,
      antennas: this.sim.links.map((l) => l.antennas),
      subcarriers: this.sim.K,
      subcarrierOffsetsHz: this.sim.offsetsHz,
      centerFreqHz: config.signal.centerFreqHz,
      packetRateHz: config.signal.packetRateHz,
      geometryKnown: true,
      hasGroundTruth: true,
      timestampSource: "simulated receiver clock with configurable jitter",
      notes: ["Simplified analytic multipath model — see docs/simulation-model.md"],
      antennaPositions: this.sim.links.map((l) => this.sim.antennaPositions(l.index)),
    };
  }

  get simulator() {
    return this.sim;
  }

  subjectStates(t: number): SubjectState[] {
    return this.paths.map((p) => subjectStateAt(p, t));
  }

  calibration(): CsiPacket[] {
    const cal = new ChannelSimulator(this.config, STREAM.calibration);
    const n = Math.round(this.config.dsp.calibrationSeconds * this.config.signal.packetRateHz);
    const out: CsiPacket[] = [];
    const empty: SubjectState[] = [];
    for (let s = 0; s < n; s++) for (const p of cal.packets(s, empty, this.scratch)) if (p) out.push(p);
    return out;
  }

  pull(untilS: number): CsiPacket[] {
    const rate = this.config.signal.packetRateHz;
    const out: CsiPacket[] = [];
    while (this.nextSeq / rate <= untilS + 1e-9) {
      const t = this.nextSeq / rate;
      const states = this.subjectStates(t);
      for (const p of this.sim.packets(this.nextSeq, states, this.scratch)) if (p) out.push(p);
      this.nextSeq++;
    }
    return out;
  }

  groundTruth(t: number): GroundTruthSubject[] {
    const out: GroundTruthSubject[] = [];
    this.paths.forEach((p, i) => {
      const s = subjectStateAt(p, t);
      if (!s.present) return;
      const spec = this.config.subjects[i];
      out.push({
        id: spec.id,
        label: spec.label,
        position: s.position,
        velocity: s.velocity,
        headingRad: s.heading,
        posture: s.posture,
        joints: s.joints,
        heightM: spec.heightM,
        radiusM: spec.radiusM,
      });
    });
    return out;
  }

  propagationPaths(t: number, link: number): PropagationPath[] {
    return this.sim.paths(link, this.subjectStates(t));
  }

  durationS() {
    return this.config.durationS;
  }

  /** Continue generation from stream time t (used when a scenario is reconfigured mid-run). */
  seek(t: number) {
    this.nextSeq = Math.max(0, Math.ceil(t * this.config.signal.packetRateHz - 1e-9));
  }

  reset() {
    this.nextSeq = 0;
    this.sim.resetImpairments();
  }
}

/**
 * Replays a parsed recording. Arrival time is the packet timestamp relative to the first packet.
 * No ground truth and, unless the recording declares it, no geometry.
 */
export class RecordedSource implements PacketSource {
  private cursor = 0;
  constructor(readonly descriptor: SourceDescriptor, private packets: CsiPacket[], private calib: CsiPacket[] | null = null) {
    this.packets = [...packets].sort((a, b) => a.trueTimeS - b.trueTimeS);
  }
  calibration() {
    return this.calib;
  }
  pull(untilS: number): CsiPacket[] {
    const out: CsiPacket[] = [];
    while (this.cursor < this.packets.length && this.packets[this.cursor].trueTimeS <= untilS) out.push(this.packets[this.cursor++]);
    return out;
  }
  groundTruth() {
    return null;
  }
  durationS() {
    return this.packets.length ? this.packets[this.packets.length - 1].trueTimeS : 0;
  }
  reset() {
    this.cursor = 0;
  }
}

/** Source fed externally (e.g. by a Web Serial reader on the main thread). Bounded. */
export class PushSource implements PacketSource {
  private buf: CsiPacket[] = [];
  dropped = 0;
  constructor(readonly descriptor: SourceDescriptor, private capacity = 4096) {}
  push(p: CsiPacket) {
    if (this.buf.length >= this.capacity) {
      this.buf.shift();
      this.dropped++;
    }
    this.buf.push(p);
  }
  calibration() {
    return null;
  }
  pull(untilS: number) {
    const out: CsiPacket[] = [];
    while (this.buf.length && this.buf[0].trueTimeS <= untilS) out.push(this.buf.shift()!);
    return out;
  }
  groundTruth() {
    return null;
  }
  durationS() {
    return Number.POSITIVE_INFINITY;
  }
  reset() {
    this.buf = [];
  }
}
