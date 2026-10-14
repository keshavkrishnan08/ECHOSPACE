import type { Room, SensorNode } from "@echospace/schemas";

/**
 * Shallow learned baseline: ridge regression from per-link features to a coarse floor-plane
 * occupancy score grid. Trained offline by models/baselines/ridge_floor/train.py on synthetic
 * data for ONE fixed geometry; the weights declare that geometry and the model refuses to run
 * anywhere else.
 */
export interface RidgeWeights {
  id: string;
  version: string;
  geometryKey: string;
  links: number;
  featureNames: string[];
  mean: number[];
  std: number[];
  /** Row-major (features × cells). */
  W: number[];
  b: number[];
  grid: { nx: number; ny: number; cellM: number };
  oodMaxMeanAbsZ: number;
  trainedOn: string;
}

export function geometryKey(room: Room, sensors: SensorNode[]): string {
  const r = `${room.width.toFixed(2)}x${room.depth.toFixed(2)}x${room.height.toFixed(2)}`;
  const s = sensors
    .filter((n) => n.enabled)
    .map((n) => n.position.map((v) => v.toFixed(2)).join(","))
    .join(";");
  return `${r}|${s}`;
}

export interface RidgeOutput {
  floor: Float32Array;
  meanAbsZ: number;
  ood: boolean;
}

export function ridgePredict(w: RidgeWeights, features: Float64Array): RidgeOutput {
  const F = w.mean.length;
  const C = w.b.length;
  const z = new Float64Array(F);
  let sumAbs = 0;
  for (let i = 0; i < F; i++) {
    const v = Number.isFinite(features[i]) ? features[i] : w.mean[i];
    z[i] = (v - w.mean[i]) / (w.std[i] || 1);
    sumAbs += Math.abs(z[i]);
  }
  const floor = new Float32Array(C);
  for (let c = 0; c < C; c++) {
    let s = w.b[c];
    for (let i = 0; i < F; i++) s += z[i] * w.W[i * C + c];
    floor[c] = Math.min(1, Math.max(0, s));
  }
  const meanAbsZ = sumAbs / F;
  return { floor, meanAbsZ, ood: meanAbsZ > w.oodMaxMeanAbsZ };
}
