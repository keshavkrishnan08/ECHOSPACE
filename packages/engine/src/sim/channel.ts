import type { LinkDescriptor, Obstacle, ScenarioConfig, Vec3 } from "@echospace/schemas";
import { MATERIAL_PENETRATION_DB } from "@echospace/schemas";
import { C_LIGHT, dist, segmentBoxOverlap, segmentSegmentDistance } from "./geometry";
import { Rng, STREAM, deriveSeed } from "./rng";
import { antennaPositions, buildLinks, mirror, openingReflectivity, roomSurfaces, sensorById, wavelength } from "./scene";
import type { SubjectState } from "./trajectory";

/**
 * Simplified multipath channel-state-information (CSI) generator.
 *
 * Model (see docs/simulation-model.md for assumptions and omissions):
 *   H_m(f_k) = Σ_p g_p(t) · a_{p,m} · exp(−j 2π f_k L_{p,m} / c)  +  impairments  +  noise
 * Paths p: line of sight, first-order specular reflections from the six room surfaces
 * (image method), and single-bounce scattering from points on each synthetic subject.
 * g_p(t) is a body-shadowing gain derived from a Fresnel-zone-weighted distance between the
 * path and each subject's body axis. Amplitudes are normalized (1.0 = free-space LoS at 1 m);
 * they are *not* calibrated received power.
 */

export interface CsiPacket {
  link: number;
  seq: number;
  /** Reported timestamp in seconds; NaN when the source omitted it. */
  timestampS: number;
  /** Simulation time the packet represents (ground truth; not visible to the DSP pipeline). */
  trueTimeS: number;
  antennas: number;
  subcarriers: number;
  /** [antenna * subcarriers + k] */
  re: Float32Array;
  im: Float32Array;
}

interface PathSegment {
  a: Vec3;
  b: Vec3;
  len: number;
}

interface StaticPath {
  kind: "los" | "reflection";
  surface: string | null;
  segments: PathSegment[];
  /** Unshadowed complex field, interleaved [m*K + k]. */
  re: Float64Array;
  im: Float64Array;
  lengthM: number;
}

export interface PropagationPath {
  linkIndex: number;
  kind: "los" | "reflection" | "scatter";
  points: Vec3[];
  /** Mean amplitude (normalized) including obstacle and shadowing losses at time t. */
  amplitude: number;
  lengthM: number;
  surface: string | null;
}

function segmentsOf(points: Vec3[]): PathSegment[] {
  const out: PathSegment[] = [];
  for (let i = 0; i + 1 < points.length; i++) out.push({ a: points[i], b: points[i + 1], len: dist(points[i], points[i + 1]) });
  return out;
}

function obstacleLossDb(segs: PathSegment[], obstacles: Obstacle[]): number {
  let loss = 0;
  for (const s of segs) {
    for (const o of obstacles) {
      const overlap = segmentBoxOverlap(s.a, s.b, o.min, o.max);
      if (overlap > 0) {
        const db = o.attenuationDb ?? MATERIAL_PENETRATION_DB[o.material];
        loss += db * Math.min(1, overlap / 0.05);
      }
    }
  }
  return loss;
}

export class ChannelSimulator {
  readonly links: LinkDescriptor[];
  readonly lambda: number;
  readonly freqs: Float64Array;
  readonly offsetsHz: Float64Array;
  readonly K: number;
  private readonly staticPaths: StaticPath[][];
  private readonly rxAntennas: Vec3[][];
  readonly noiseVar: Float64Array;
  readonly staticPower: Float64Array;
  private readonly cfg: ScenarioConfig;
  private burstRemaining: Int32Array;
  private rngs: Rng[];
  private readonly missing: Array<Set<number>>;

  constructor(config: ScenarioConfig, rngStream: number = STREAM.impairments) {
    this.cfg = config;
    this.links = buildLinks(config.sensors);
    const sig = config.signal;
    this.lambda = wavelength(sig.centerFreqHz);
    this.K = sig.subcarriers;
    this.freqs = new Float64Array(this.K);
    this.offsetsHz = new Float64Array(this.K);
    const df = sig.bandwidthHz / this.K;
    for (let k = 0; k < this.K; k++) {
      this.offsetsHz[k] = (k - (this.K - 1) / 2) * df;
      this.freqs[k] = sig.centerFreqHz + this.offsetsHz[k];
    }
    const surfaces = roomSurfaces(config.room).slice(0, sig.maxReflectionOrder >= 1 ? sig.reflectingSurfaces : 0);
    this.rxAntennas = [];
    this.staticPaths = [];
    this.staticPower = new Float64Array(this.links.length);
    this.noiseVar = new Float64Array(this.links.length);
    this.missing = [];
    for (const link of this.links) {
      const rxNode = sensorById(config, link.rxId);
      const ants = antennaPositions(rxNode, this.lambda);
      this.rxAntennas.push(ants);
      const M = ants.length;
      const paths: StaticPath[] = [];
      const tx = link.tx;
      // Line of sight.
      {
        const segs = segmentsOf([tx, ants[0]]);
        const lossDb = obstacleLossDb(segs, config.obstacles);
        const g = Math.pow(10, -lossDb / 20);
        const re = new Float64Array(M * this.K);
        const im = new Float64Array(M * this.K);
        for (let m = 0; m < M; m++) {
          const L = dist(tx, ants[m]);
          this.fillField(re, im, m, (g * 1) / L, L);
        }
        paths.push({ kind: "los", surface: null, segments: segs, re, im, lengthM: dist(tx, ants[0]) });
      }
      // First-order reflections (image method).
      for (const s of surfaces) {
        const img = mirror(tx, s);
        const re = new Float64Array(M * this.K);
        const im = new Float64Array(M * this.K);
        let valid = true;
        let segs0: PathSegment[] = [];
        let len0 = 0;
        for (let m = 0; m < M; m++) {
          const r = ants[m];
          const denom = r[s.axis] - img[s.axis];
          if (Math.abs(denom) < 1e-9) {
            valid = false;
            break;
          }
          const t = (s.value - img[s.axis]) / denom;
          if (t <= 0 || t >= 1) {
            valid = false;
            break;
          }
          const hit: Vec3 = [img[0] + (r[0] - img[0]) * t, img[1] + (r[1] - img[1]) * t, img[2] + (r[2] - img[2]) * t];
          const inside = hit[0] >= -1e-9 && hit[0] <= config.room.width + 1e-9 && hit[1] >= -1e-9 && hit[1] <= config.room.depth + 1e-9 && hit[2] >= -1e-9 && hit[2] <= config.room.height + 1e-9;
          if (!inside) {
            valid = false;
            break;
          }
          const gamma = openingReflectivity(config.openings, s, hit, s.reflectivity);
          const segs = segmentsOf([tx, hit, r]);
          const lossDb = obstacleLossDb(segs, config.obstacles);
          const L = dist(img, r);
          this.fillField(re, im, m, (gamma * Math.pow(10, -lossDb / 20)) / L, L);
          if (m === 0) {
            segs0 = segs;
            len0 = L;
          }
        }
        if (valid) paths.push({ kind: "reflection", surface: s.name, segments: segs0, re, im, lengthM: len0 });
      }
      this.staticPaths.push(paths);
      let p = 0;
      const sumRe = new Float64Array(M * this.K);
      const sumIm = new Float64Array(M * this.K);
      for (const path of paths) {
        for (let i = 0; i < M * this.K; i++) {
          sumRe[i] += path.re[i];
          sumIm[i] += path.im[i];
        }
      }
      for (let i = 0; i < M * this.K; i++) p += sumRe[i] * sumRe[i] + sumIm[i] * sumIm[i];
      p /= M * this.K;
      this.staticPower[link.index] = p;
      this.noiseVar[link.index] = p / Math.pow(10, sig.snrDb / 10);
      const miss = new Set<number>();
      for (const f of config.impairments.missingAntennas) if (f.sensorId === link.rxId && f.antenna < M) miss.add(f.antenna);
      this.missing.push(miss);
    }
    this.burstRemaining = new Int32Array(this.links.length);
    this.rngs = this.links.map((l) => new Rng(deriveSeed(config.seed, rngStream, l.index)));
  }

  /** Writes a·exp(−j2πf_k L/c) for all subcarriers of antenna m into (re, im), accumulating. */
  private fillField(re: Float64Array, im: Float64Array, m: number, a: number, L: number) {
    const base = m * this.K;
    const ph0 = (-2 * Math.PI * this.freqs[0] * L) / C_LIGHT;
    const dph = (-2 * Math.PI * (this.freqs.length > 1 ? this.freqs[1] - this.freqs[0] : 0) * L) / C_LIGHT;
    let cr = Math.cos(ph0);
    let ci = Math.sin(ph0);
    const sr = Math.cos(dph);
    const si = Math.sin(dph);
    for (let k = 0; k < this.K; k++) {
      re[base + k] += a * cr;
      im[base + k] += a * ci;
      const nr = cr * sr - ci * si;
      ci = cr * si + ci * sr;
      cr = nr;
    }
  }

  private shadowLossDb(segs: PathSegment[], subjects: SubjectState[], skip: number): number {
    const sig = this.cfg.signal;
    if (!sig.subjectShadowing) return 0;
    let loss = 0;
    for (let j = 0; j < subjects.length; j++) {
      if (j === skip) continue;
      const s = subjects[j];
      if (!s.present) continue;
      const r = this.cfg.subjects[j]?.radiusM ?? 0.22;
      const q0: Vec3 = [s.position[0], s.position[1], s.axisBottom];
      const q1: Vec3 = [s.position[0], s.position[1], s.axisTop];
      for (const seg of segs) {
        const { d, s: u } = segmentSegmentDistance(seg.a, seg.b, q0, q1);
        const d1 = u * seg.len;
        const d2 = (1 - u) * seg.len;
        const rf2 = seg.len > 0 ? (this.lambda * d1 * d2) / seg.len : 0;
        const reff2 = r * r + rf2;
        loss += sig.bodyShadowDb * Math.exp(-(d * d) / (2 * reff2));
      }
    }
    return loss;
  }

  /** Noiseless channel of one link for the given subject states. Writes into outRe/outIm (length M*K). */
  channel(linkIndex: number, subjects: SubjectState[], outRe: Float64Array, outIm: Float64Array) {
    const link = this.links[linkIndex];
    const ants = this.rxAntennas[linkIndex];
    const M = ants.length;
    const n = M * this.K;
    outRe.fill(0, 0, n);
    outIm.fill(0, 0, n);
    const anyPresent = subjects.some((s) => s.present);
    for (const path of this.staticPaths[linkIndex]) {
      const g = anyPresent ? Math.pow(10, -this.shadowLossDb(path.segments, subjects, -1) / 20) : 1;
      for (let i = 0; i < n; i++) {
        outRe[i] += g * path.re[i];
        outIm[i] += g * path.im[i];
      }
    }
    if (!this.cfg.signal.subjectScatter) return;
    for (let j = 0; j < subjects.length; j++) {
      const s = subjects[j];
      if (!s.present) continue;
      const rcs = this.cfg.subjects[j]?.rcsM2 ?? 1;
      for (const sc of s.scatterers) {
        const p: Vec3 = [sc[0], sc[1], sc[2]];
        const d1 = dist(link.tx, p);
        const segs = segmentsOf([link.tx, p, ants[0]]);
        const lossDb = obstacleLossDb(segs, this.cfg.obstacles) + this.shadowLossDb(segs, subjects, j);
        const g = Math.pow(10, -lossDb / 20);
        const amp0 = Math.sqrt((rcs * sc[3]) / (4 * Math.PI));
        for (let m = 0; m < M; m++) {
          const d2 = dist(p, ants[m]);
          this.fillField(outRe, outIm, m, (g * amp0) / (d1 * d2), d1 + d2);
        }
      }
    }
  }

  /** Geometric propagation paths of a link at the current subject state, for visualization. */
  paths(linkIndex: number, subjects: SubjectState[]): PropagationPath[] {
    const link = this.links[linkIndex];
    const out: PropagationPath[] = [];
    for (const p of this.staticPaths[linkIndex]) {
      const g = Math.pow(10, -this.shadowLossDb(p.segments, subjects, -1) / 20);
      let a = 0;
      for (let k = 0; k < this.K; k++) a += Math.hypot(p.re[k], p.im[k]);
      out.push({
        linkIndex,
        kind: p.kind,
        points: [p.segments[0].a, ...p.segments.map((s) => s.b)],
        amplitude: (g * a) / this.K,
        lengthM: p.lengthM,
        surface: p.surface,
      });
    }
    if (this.cfg.signal.subjectScatter) {
      const ant0 = this.rxAntennas[linkIndex][0];
      subjects.forEach((s, j) => {
        if (!s.present) return;
        const p: Vec3 = [s.scatterers[0][0], s.scatterers[0][1], s.scatterers[0][2]];
        const d1 = dist(link.tx, p);
        const d2 = dist(p, ant0);
        const rcs = this.cfg.subjects[j]?.rcsM2 ?? 1;
        out.push({ linkIndex, kind: "scatter", points: [link.tx, p, ant0], amplitude: Math.sqrt(rcs / (4 * Math.PI)) / (d1 * d2), lengthM: d1 + d2, surface: null });
      });
    }
    return out;
  }

  antennaPositions(linkIndex: number): Vec3[] {
    return this.rxAntennas[linkIndex];
  }

  resetImpairments(rngStream: number = STREAM.impairments) {
    this.burstRemaining = new Int32Array(this.links.length);
    this.rngs = this.links.map((l) => new Rng(deriveSeed(this.cfg.seed, rngStream, l.index)));
  }

  /**
   * Produces one packet per link for sequence number `seq`. Random draws happen in a fixed order
   * whether or not the packet is dropped, so the stream stays aligned across configurations.
   * Returns null entries for dropped packets.
   */
  packets(seq: number, subjects: SubjectState[], scratch?: { re: Float64Array; im: Float64Array }): Array<CsiPacket | null> {
    const cfg = this.cfg;
    const imp = cfg.impairments;
    const rate = cfg.signal.packetRateHz;
    const t = seq / rate;
    const out: Array<CsiPacket | null> = [];
    const maxN = Math.max(...this.rxAntennas.map((a) => a.length)) * this.K;
    const re = scratch?.re ?? new Float64Array(maxN);
    const im = scratch?.im ?? new Float64Array(maxN);
    for (const link of this.links) {
      const rng = this.rngs[link.index];
      const M = this.rxAntennas[link.index].length;
      const uLoss = rng.uniform();
      const uBurst = rng.uniform();
      const nJit = rng.normal();
      const uMissTs = rng.uniform();
      const uCfo = rng.uniform();
      const uSto = rng.uniform();
      const nAgc = rng.normal();
      const phaseJit = new Float64Array(M);
      for (let m = 0; m < M; m++) phaseJit[m] = rng.normal();
      const noise = new Float64Array(2 * M * this.K);
      for (let i = 0; i < 2 * M * this.K; i++) noise[i] = rng.normal();

      let dropped = uLoss < imp.packetLoss;
      if (this.burstRemaining[link.index] > 0) {
        this.burstRemaining[link.index]--;
        dropped = true;
      } else if (uBurst < imp.burstRateHz / rate) {
        this.burstRemaining[link.index] = imp.burstLengthPackets - 1;
        dropped = true;
      }
      if (dropped) {
        out.push(null);
        continue;
      }
      this.channel(link.index, subjects, re, im);
      const gain = Math.pow(10, (nAgc * imp.agcSigmaDb) / 20);
      const cfo = imp.cfo ? 2 * Math.PI * uCfo : 0;
      const sto = imp.sto ? (uSto - 0.5) * 100e-9 : 0;
      const sigma = Math.sqrt(this.noiseVar[link.index] / 2);
      const pr = new Float32Array(M * this.K);
      const pi = new Float32Array(M * this.K);
      const miss = this.missing[link.index];
      for (let m = 0; m < M; m++) {
        const pj = phaseJit[m] * imp.phaseInstabilityRad;
        for (let k = 0; k < this.K; k++) {
          const i = m * this.K + k;
          if (miss.has(m)) {
            pr[i] = Number.NaN;
            pi[i] = Number.NaN;
            continue;
          }
          const ph = cfo + pj - 2 * Math.PI * this.offsetsHz[k] * sto;
          const c = Math.cos(ph);
          const s = Math.sin(ph);
          const hr = gain * (re[i] * c - im[i] * s) + sigma * noise[2 * i];
          const hi = gain * (re[i] * s + im[i] * c) + sigma * noise[2 * i + 1];
          pr[i] = hr;
          pi[i] = hi;
        }
      }
      const ts = uMissTs < imp.missingTimestampProb ? Number.NaN : t + (nJit * imp.timestampJitterMs) / 1000;
      out.push({ link: link.index, seq, timestampS: ts, trueTimeS: t, antennas: M, subcarriers: this.K, re: pr, im: pi });
    }
    return out;
  }
}
