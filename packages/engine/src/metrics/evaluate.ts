import type { GroundTruthSubject, Track } from "@echospace/schemas";
import type { VoxelGrid } from "../sim/scene";
import { hungarian } from "../tracking/hungarian";

/**
 * Evaluation against synthetic ground truth. All functions here are only called when the
 * source provides ground truth (synthetic scenarios); their outputs are simulation metrics.
 */

export const MATCH_RADIUS_M = 0.75;

/** Ground-truth body occupancy: voxel centres inside each subject's vertical body cylinder. */
export function groundTruthOccupancy(g: VoxelGrid, subjects: GroundTruthSubject[]): Uint8Array {
  const out = new Uint8Array(g.count);
  for (const s of subjects) {
    const top = maxJointZ(s) + 0.08;
    const r = s.radiusM;
    for (let i = 0; i < g.count; i++) {
      const dx = g.centers[i * 3] - s.position[0];
      const dy = g.centers[i * 3 + 1] - s.position[1];
      const z = g.centers[i * 3 + 2];
      if (dx * dx + dy * dy <= r * r + 0.25 * g.size * g.size && z <= top) out[i] = 1;
    }
  }
  return out;
}

function maxJointZ(s: GroundTruthSubject) {
  let m = 0;
  for (let i = 0; i < 17; i++) m = Math.max(m, s.joints[i * 3 + 2]);
  return m || s.heightM;
}

export function iou(pred: ArrayLike<number>, truth: ArrayLike<number>, threshold: number): number | null {
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < pred.length; i++) {
    const p = pred[i] >= threshold;
    const t = truth[i] > 0;
    if (p && t) inter++;
    if (p || t) uni++;
  }
  return uni ? inter / uni : null;
}

export function floorFromVoxels(field: ArrayLike<number>, g: VoxelGrid): Float32Array {
  const out = new Float32Array(g.nx * g.ny);
  for (let k = 0; k < g.nz; k++)
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const v = field[i + g.nx * (j + g.ny * k)];
        if (v > out[i + g.nx * j]) out[i + g.nx * j] = v;
      }
  return out;
}

/** Deterministic samples on each subject's body cylinder surface (32 around × 6 heights). */
export function bodySurfacePoints(subjects: GroundTruthSubject[]): Float64Array {
  const pts: number[] = [];
  for (const s of subjects) {
    const top = maxJointZ(s);
    for (let h = 0; h < 6; h++) {
      const z = ((h + 0.5) / 6) * top;
      for (let a = 0; a < 32; a++) {
        const th = (a / 32) * 2 * Math.PI;
        pts.push(s.position[0] + s.radiusM * Math.cos(th), s.position[1] + s.radiusM * Math.sin(th), z);
      }
    }
  }
  return Float64Array.from(pts);
}

/** Symmetric mean nearest-neighbour (Chamfer) distance; `a` is stride-5, `b` stride-3. */
export function chamfer(a: Float32Array, b: Float64Array, maxA = 800): number | null {
  const na = a.length / 5;
  const nb = b.length / 3;
  if (!na || !nb) return null;
  const step = Math.max(1, Math.floor(na / maxA));
  let sumA = 0;
  let cntA = 0;
  const minB = new Float64Array(nb).fill(Number.POSITIVE_INFINITY);
  for (let i = 0; i < na; i += step) {
    let best = Number.POSITIVE_INFINITY;
    const x = a[i * 5];
    const y = a[i * 5 + 1];
    const z = a[i * 5 + 2];
    for (let j = 0; j < nb; j++) {
      const d = (x - b[j * 3]) ** 2 + (y - b[j * 3 + 1]) ** 2 + (z - b[j * 3 + 2]) ** 2;
      if (d < best) best = d;
      if (d < minB[j]) minB[j] = d;
    }
    sumA += Math.sqrt(best);
    cntA++;
  }
  let sumB = 0;
  for (let j = 0; j < nb; j++) sumB += Math.sqrt(minB[j]);
  return 0.5 * (sumA / cntA + sumB / nb);
}

export interface TrackEvaluation {
  positionErrorM: number | null;
  precision: number | null;
  recall: number | null;
  matches: Array<{ gtId: string; trackId: string; errorM: number }>;
}

export function evaluateTracks(tracks: Track[], gt: GroundTruthSubject[]): TrackEvaluation {
  const confirmed = tracks.filter((t) => t.confirmed);
  if (!gt.length) {
    return { positionErrorM: null, precision: confirmed.length ? 0 : null, recall: null, matches: [] };
  }
  const cost = gt.map((s) => confirmed.map((t) => Math.hypot(t.position[0] - s.position[0], t.position[1] - s.position[1])));
  const assign = confirmed.length ? hungarian(cost, MATCH_RADIUS_M) : gt.map(() => -1);
  const matches: TrackEvaluation["matches"] = [];
  assign.forEach((ti, gi) => {
    if (ti >= 0) matches.push({ gtId: gt[gi].id, trackId: confirmed[ti].id, errorM: cost[gi][ti] });
  });
  const err = matches.length ? matches.reduce((s, m) => s + m.errorM, 0) / matches.length : null;
  return {
    positionErrorM: err,
    precision: confirmed.length ? matches.length / confirmed.length : null,
    recall: matches.length / gt.length,
    matches,
  };
}

/** Counts identity switches: a ground-truth subject matched to a different track than before. */
export class IdSwitchCounter {
  private last = new Map<string, string>();
  total = 0;
  update(matches: TrackEvaluation["matches"]): string[] {
    const switched: string[] = [];
    for (const m of matches) {
      const prev = this.last.get(m.gtId);
      if (prev && prev !== m.trackId) {
        this.total++;
        switched.push(`${m.gtId}: ${prev} → ${m.trackId}`);
      }
      this.last.set(m.gtId, m.trackId);
    }
    return switched;
  }
  reset() {
    this.last.clear();
    this.total = 0;
  }
}

/** Expected calibration error with equal-width bins, for voxel probabilities vs. binary truth. */
export function expectedCalibrationError(p: ArrayLike<number>, truth: ArrayLike<number>, bins = 10): { ece: number; bins: Array<{ lo: number; hi: number; meanP: number; freq: number; n: number }> } {
  const acc = Array.from({ length: bins }, () => ({ sp: 0, st: 0, n: 0 }));
  for (let i = 0; i < p.length; i++) {
    const b = Math.min(bins - 1, Math.floor(p[i] * bins));
    acc[b].sp += p[i];
    acc[b].st += truth[i] > 0 ? 1 : 0;
    acc[b].n++;
  }
  let ece = 0;
  const out = acc.map((a, i) => {
    const meanP = a.n ? a.sp / a.n : 0;
    const freq = a.n ? a.st / a.n : 0;
    ece += (a.n / Math.max(1, p.length)) * Math.abs(meanP - freq);
    return { lo: i / bins, hi: (i + 1) / bins, meanP, freq, n: a.n };
  });
  return { ece, bins: out };
}

export function percentile(values: number[], q: number): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}
