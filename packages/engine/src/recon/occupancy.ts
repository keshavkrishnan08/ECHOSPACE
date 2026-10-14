import { Rng } from "../sim/rng";
import type { VoxelGrid } from "../sim/scene";

/** Exponential moving average in place: state = a·state + (1−a)·x. a = 0 disables smoothing. */
export function emaInPlace(state: Float32Array, x: Float32Array, a: number) {
  if (a <= 0) {
    state.set(x);
    return;
  }
  for (let i = 0; i < state.length; i++) state[i] = a * state[i] + (1 - a) * x[i];
}

/** 3×3×3 box filter with edge renormalisation. */
export function boxFilter3d(src: Float32Array, g: VoxelGrid): Float32Array {
  const { nx, ny, nz } = g;
  const out = new Float32Array(src.length);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let s = 0;
        let n = 0;
        for (let dk = -1; dk <= 1; dk++) {
          const kk = k + dk;
          if (kk < 0 || kk >= nz) continue;
          for (let dj = -1; dj <= 1; dj++) {
            const jj = j + dj;
            if (jj < 0 || jj >= ny) continue;
            for (let di = -1; di <= 1; di++) {
              const ii = i + di;
              if (ii < 0 || ii >= nx) continue;
              s += src[ii + nx * (jj + ny * kk)];
              n++;
            }
          }
        }
        out[i + nx * (j + ny * k)] = s / n;
      }
  return out;
}

export interface PointCloudOptions {
  threshold: number;
  confidenceThreshold: number;
  maxPoints: number;
  outlierRemoval: boolean;
  seed: number;
}

/**
 * Samples a point cloud from a voxel field. Each voxel with value ≥ threshold (and, when given,
 * confidence 1 − varianceRatio ≥ confidenceThreshold) emits up to 4 points uniformly inside the
 * voxel, proportional to its value. Points are stride-5: x, y, z, confidence, value.
 * Outlier removal drops voxels with fewer than two qualifying 26-neighbours.
 */
export function samplePoints(field: Float32Array, varianceRatio: Float32Array | null, g: VoxelGrid, opt: PointCloudOptions): { points: Float32Array; removed: number } {
  const { nx, ny, nz } = g;
  const qualifies = new Uint8Array(field.length);
  for (let i = 0; i < field.length; i++) {
    const conf = varianceRatio ? 1 - varianceRatio[i] : 1;
    qualifies[i] = field[i] >= opt.threshold && conf >= opt.confidenceThreshold ? 1 : 0;
  }
  let removed = 0;
  if (opt.outlierRemoval) {
    const keep = new Uint8Array(field.length);
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const id = i + nx * (j + ny * k);
          if (!qualifies[id]) continue;
          let nb = 0;
          for (let dk = -1; dk <= 1; dk++)
            for (let dj = -1; dj <= 1; dj++)
              for (let di = -1; di <= 1; di++) {
                if (!di && !dj && !dk) continue;
                const ii = i + di;
                const jj = j + dj;
                const kk = k + dk;
                if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
                nb += qualifies[ii + nx * (jj + ny * kk)];
              }
          if (nb >= 2) keep[id] = 1;
          else removed++;
        }
    qualifies.set(keep);
  }
  const rng = new Rng(opt.seed);
  const pts: number[] = [];
  const dx = g.centers.length >= 6 && nx > 1 ? g.centers[3] - g.centers[0] : g.size;
  const dy = ny > 1 ? g.centers[nx * 3 + 1] - g.centers[1] : g.size;
  const dz = nz > 1 ? g.centers[nx * ny * 3 + 2] - g.centers[2] : g.size;
  for (let i = 0; i < field.length && pts.length / 5 < opt.maxPoints; i++) {
    if (!qualifies[i]) continue;
    const v = Math.min(1, Math.max(0, field[i]));
    const n = Math.max(1, Math.round(v * 4));
    const conf = varianceRatio ? 1 - varianceRatio[i] : 1;
    for (let p = 0; p < n; p++) {
      pts.push(
        g.centers[i * 3] + (rng.uniform() - 0.5) * dx,
        g.centers[i * 3 + 1] + (rng.uniform() - 0.5) * dy,
        g.centers[i * 3 + 2] + (rng.uniform() - 0.5) * dz,
        conf,
        v,
      );
    }
  }
  return { points: Float32Array.from(pts), removed };
}

/** Max-over-z floor projection of a voxel field (nx × ny). */
export function floorProjection(field: Float32Array, g: VoxelGrid): Float32Array {
  const out = new Float32Array(g.nx * g.ny);
  for (let k = 0; k < g.nz; k++)
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const v = field[i + g.nx * (j + g.ny * k)];
        const o = i + g.nx * j;
        if (v > out[o]) out[o] = v;
      }
  return out;
}
