import type { LinkDescriptor, ReconConfig } from "@echospace/schemas";
import type { VoxelGrid } from "../sim/scene";
import { normCdf, spdInverse } from "./linalg";

/**
 * Bayesian radio tomographic imaging (RTI) baseline.
 *
 * Measurement model (Wilson & Patwari, 2010):  y = W x + n,
 *   y_l  calibrated attenuation of link l (dB), x  per-voxel attenuation density,
 *   W_lj = 1/√d_l if voxel j lies inside the ellipsoid d1 + d2 < d_l + λ_e, else 0.
 * Prior x ~ N(0, C), C_ij = σ_x² exp(−|v_i − v_j| / δ) truncated at |v_i − v_j| > c·δ;
 * noise n ~ N(0, σ_n² I).
 *
 * Posterior mean  x̂ = Π y,  Π = C Wᵀ (W C Wᵀ + σ_n² I)⁻¹  (computed in the L×L dual form)
 * Posterior variance ratio  r_i = (C_ii − [Π W C]_ii) / σ_x²   (1 = unconstrained / unobserved)
 * Null z-score  z_i = x̂_i / (σ_n ‖Π_i‖)   — the std-dev of x̂_i when y is pure noise.
 *
 * Reported occupancy = Φ(z_i − z₀) for constrained voxels and 0.5 ("unknown") where r_i > 0.95.
 * That is a detection confidence under the stated noise model, not a calibrated probability.
 */
export class RtiModel {
  readonly L: number;
  readonly V: number;
  readonly support: Int32Array[];
  readonly weights: Float64Array[];
  /** C Wᵀ, V×L row-major. */
  private readonly cwT: Float64Array;
  private cache = new Map<string, { pi: Float64Array; varRatio: Float32Array; nullStd: Float64Array }>();
  readonly priorVar: number;

  constructor(readonly grid: VoxelGrid, readonly links: LinkDescriptor[], readonly cfg: ReconConfig) {
    this.L = links.length;
    this.V = grid.count;
    this.priorVar = cfg.priorStd * cfg.priorStd;
    const c = grid.centers;
    const { nx, ny, nz } = grid;
    this.support = [];
    this.weights = [];
    for (const link of links) {
      const idx: number[] = [];
      const w: number[] = [];
      const inv = 1 / Math.sqrt(Math.max(link.lengthM, 1e-3));
      for (let j = 0; j < this.V; j++) {
        const x = c[j * 3];
        const y = c[j * 3 + 1];
        const z = c[j * 3 + 2];
        const d1 = Math.hypot(x - link.tx[0], y - link.tx[1], z - link.tx[2]);
        const d2 = Math.hypot(x - link.rx[0], y - link.rx[1], z - link.rx[2]);
        if (d1 + d2 < link.lengthM + cfg.ellipseExcessM) {
          idx.push(j);
          w.push(inv);
        }
      }
      this.support.push(Int32Array.from(idx));
      this.weights.push(Float64Array.from(w));
    }
    // Truncated exponential kernel on integer voxel offsets (the grid is regular).
    const sx = nx > 1 ? c[3] - c[0] : grid.size;
    const sy = ny > 1 ? c[nx * 3 + 1] - c[1] : grid.size;
    const sz = nz > 1 ? c[nx * ny * 3 + 2] - c[2] : grid.size;
    const R = cfg.kernelCutoff * cfg.priorCorrelationM;
    const ri = Math.floor(R / sx);
    const rj = Math.floor(R / sy);
    const rk = Math.floor(R / sz);
    const offs: number[] = [];
    for (let dk = -rk; dk <= rk; dk++)
      for (let dj = -rj; dj <= rj; dj++)
        for (let di = -ri; di <= ri; di++) {
          const d = Math.hypot(di * sx, dj * sy, dk * sz);
          if (d <= R) offs.push(di, dj, dk, this.priorVar * Math.exp(-d / cfg.priorCorrelationM));
        }
    this.cwT = new Float64Array(this.V * this.L);
    for (let l = 0; l < this.L; l++) {
      const sup = this.support[l];
      const wl = this.weights[l];
      for (let q = 0; q < sup.length; q++) {
        const j = sup[q];
        const ji = j % nx;
        const jj = Math.floor(j / nx) % ny;
        const jk = Math.floor(j / (nx * ny));
        for (let o = 0; o < offs.length; o += 4) {
          const ii = ji + offs[o];
          const ij = jj + offs[o + 1];
          const ik = jk + offs[o + 2];
          if (ii < 0 || ij < 0 || ik < 0 || ii >= nx || ij >= ny || ik >= nz) continue;
          this.cwT[(ii + nx * (ij + ny * ik)) * this.L + l] += offs[o + 3] * wl[q];
        }
      }
    }
  }

  private operator(active: number[]) {
    const key = active.join(",");
    const hit = this.cache.get(key);
    if (hit) return hit;
    const n = active.length;
    const A = new Float64Array(n * n);
    const noise = this.cfg.noiseStdDb * this.cfg.noiseStdDb;
    for (let a = 0; a < n; a++) {
      const sup = this.support[active[a]];
      const w = this.weights[active[a]];
      for (let b = 0; b < n; b++) {
        let s = 0;
        for (let q = 0; q < sup.length; q++) s += w[q] * this.cwT[sup[q] * this.L + active[b]];
        A[a * n + b] = s;
      }
    }
    for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) {
      const m = 0.5 * (A[a * n + b] + A[b * n + a]);
      A[a * n + b] = m;
      A[b * n + a] = m;
    }
    for (let a = 0; a < n; a++) A[a * n + a] += noise;
    const Ainv = spdInverse(A, n);
    const pi = new Float64Array(this.V * n);
    const varRatio = new Float32Array(this.V);
    const nullStd = new Float64Array(this.V);
    const sn = this.cfg.noiseStdDb;
    for (let i = 0; i < this.V; i++) {
      let reduction = 0;
      let norm2 = 0;
      for (let b = 0; b < n; b++) {
        let s = 0;
        for (let a = 0; a < n; a++) s += this.cwT[i * this.L + active[a]] * Ainv[a * n + b];
        pi[i * n + b] = s;
        norm2 += s * s;
        reduction += s * this.cwT[i * this.L + active[b]];
      }
      varRatio[i] = Math.max(0, Math.min(1, (this.priorVar - reduction) / this.priorVar));
      nullStd[i] = sn * Math.sqrt(norm2);
    }
    const op = { pi, varRatio, nullStd };
    if (this.cache.size > 32) this.cache.clear();
    this.cache.set(key, op);
    return op;
  }

  reconstruct(y: Float32Array | Float64Array): { image: Float32Array; zScore: Float32Array; varianceRatio: Float32Array; occupancy: Float32Array; activeLinks: number } {
    const active: number[] = [];
    for (let l = 0; l < this.L; l++) if (Number.isFinite(y[l])) active.push(l);
    const image = new Float32Array(this.V);
    const zScore = new Float32Array(this.V);
    const occupancy = new Float32Array(this.V).fill(0.5);
    if (active.length === 0) return { image, zScore, varianceRatio: new Float32Array(this.V).fill(1), occupancy, activeLinks: 0 };
    const { pi, varRatio, nullStd } = this.operator(active);
    const n = active.length;
    const z0 = this.cfg.detectionZ;
    for (let i = 0; i < this.V; i++) {
      let s = 0;
      for (let a = 0; a < n; a++) s += pi[i * n + a] * y[active[a]];
      image[i] = s;
      const z = nullStd[i] > 1e-12 ? s / nullStd[i] : 0;
      zScore[i] = z;
      occupancy[i] = varRatio[i] > 0.95 ? 0.5 : normCdf(z - z0);
    }
    return { image, zScore, varianceRatio: varRatio, occupancy, activeLinks: n };
  }

  coverage(): Float32Array {
    return this.operator(Array.from({ length: this.L }, (_, i) => i)).varRatio;
  }
}
