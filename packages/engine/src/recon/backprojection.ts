import type { LinkDescriptor } from "@echospace/schemas";
import { C_LIGHT } from "../sim/geometry";
import type { VoxelGrid } from "../sim/scene";

/**
 * Coherent delay-and-sum back-projection ("bp-dsb").
 *
 * For each link, the dynamic channel D_m(f_k) = H_m(f_k) − B_m(f_k) (sanitized CSI minus the
 * empty-room background) is matched against the single-bounce hypothesis for every voxel v:
 *   I(v) = Σ_l |Σ_m Σ_k D_lmk · exp(+j 2π f_k (|tx−v| + |v−rx_m| − L_l0) / c)|² / N_l
 * where L_l0 is the line-of-sight length to antenna 0 (the reference removed by phase
 * sanitization) and N_l normalises by the calibration-window image energy of the link.
 * Multipath that is not single-bounce through v produces ghost energy by construction.
 */
export class BackProjectionModel {
  readonly V: number;
  /** Excess delay τ per (voxel, link, antenna) in seconds, [(v*L + l)*Mmax + m]. */
  private readonly tau: Float64Array;
  private readonly Mmax: number;

  constructor(readonly grid: VoxelGrid, readonly links: LinkDescriptor[], readonly antennas: Array<Array<[number, number, number]>>, readonly freqs: Float64Array) {
    this.V = grid.count;
    this.Mmax = Math.max(...antennas.map((a) => a.length));
    const L = links.length;
    this.tau = new Float64Array(this.V * L * this.Mmax);
    const c = grid.centers;
    for (let v = 0; v < this.V; v++) {
      const x = c[v * 3];
      const y = c[v * 3 + 1];
      const z = c[v * 3 + 2];
      for (let l = 0; l < L; l++) {
        const tx = links[l].tx;
        const ants = antennas[l];
        const d1 = Math.hypot(x - tx[0], y - tx[1], z - tx[2]);
        const l0 = Math.hypot(ants[0][0] - tx[0], ants[0][1] - tx[1], ants[0][2] - tx[2]);
        for (let m = 0; m < ants.length; m++) {
          const d2 = Math.hypot(x - ants[m][0], y - ants[m][1], z - ants[m][2]);
          this.tau[(v * L + l) * this.Mmax + m] = (d1 + d2 - l0) / C_LIGHT;
        }
      }
    }
  }

  /**
   * dyn[l] holds the dynamic CSI of link l as interleaved re/im arrays of length M*K, or null
   * when the link has no data. norm[l] is the per-link normaliser.
   */
  image(dyn: Array<{ re: Float64Array; im: Float64Array } | null>, norm: Float64Array): Float32Array {
    const L = this.links.length;
    const K = this.freqs.length;
    const f0 = this.freqs[0];
    const df = K > 1 ? this.freqs[1] - this.freqs[0] : 0;
    const out = new Float32Array(this.V);
    for (let v = 0; v < this.V; v++) {
      let total = 0;
      for (let l = 0; l < L; l++) {
        const d = dyn[l];
        if (!d) continue;
        const M = this.antennas[l].length;
        let sr = 0;
        let si = 0;
        for (let m = 0; m < M; m++) {
          const t = this.tau[(v * L + l) * this.Mmax + m];
          const p0 = 2 * Math.PI * f0 * t;
          const dp = 2 * Math.PI * df * t;
          let cr = Math.cos(p0);
          let ci = Math.sin(p0);
          const wr = Math.cos(dp);
          const wi = Math.sin(dp);
          const base = m * K;
          for (let k = 0; k < K; k++) {
            const ar = d.re[base + k];
            const ai = d.im[base + k];
            if (ar === ar) {
              sr += ar * cr - ai * ci;
              si += ar * ci + ai * cr;
            }
            const nr = cr * wr - ci * wi;
            ci = cr * wi + ci * wr;
            cr = nr;
          }
        }
        total += (sr * sr + si * si) / (norm[l] || 1);
      }
      out[v] = total;
    }
    return out;
  }
}
