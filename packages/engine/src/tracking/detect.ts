import type { Detection } from "@echospace/schemas";
import type { VoxelGrid } from "../sim/scene";

/**
 * Detections from an occupancy field: local maxima of the max-over-z floor projection above
 * `threshold`, refined by a value-weighted centroid over a 0.5 m neighbourhood, with greedy
 * non-maximum suppression at `nmsRadius`. Height is the value-weighted mean z of the column.
 */
export function detect(field: Float32Array, g: VoxelGrid, threshold: number, maxDetections: number, nmsRadius = 0.7): Detection[] {
  const { nx, ny, nz } = g;
  const dx = nx > 1 ? g.centers[3] - g.centers[0] : g.size;
  const dy = ny > 1 ? g.centers[nx * 3 + 1] - g.centers[1] : g.size;
  const floor = new Float32Array(nx * ny);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v = field[i + nx * (j + ny * k)];
        if (v > floor[i + nx * j]) floor[i + nx * j] = v;
      }
  const cands: Array<{ i: number; j: number; v: number }> = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const v = floor[i + nx * j];
      if (v < threshold) continue;
      let isMax = true;
      for (let dj = -1; dj <= 1 && isMax; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          const w = floor[ii + nx * jj];
          if (w > v || (w === v && (dj < 0 || (dj === 0 && di < 0)))) {
            isMax = false;
            break;
          }
        }
      if (isMax) cands.push({ i, j, v });
    }
  cands.sort((a, b) => b.v - a.v);
  const out: Detection[] = [];
  const ri = Math.max(1, Math.round(0.5 / dx));
  const rj = Math.max(1, Math.round(0.5 / dy));
  for (const c of cands) {
    let sw = 0;
    let sx = 0;
    let sy = 0;
    for (let dj = -rj; dj <= rj; dj++)
      for (let di = -ri; di <= ri; di++) {
        const ii = c.i + di;
        const jj = c.j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const w = Math.max(0, floor[ii + nx * jj] - threshold * 0.5);
        const id = ii + nx * jj;
        sw += w;
        sx += w * g.centers[id * 3];
        sy += w * g.centers[id * 3 + 1];
      }
    const x = sw > 0 ? sx / sw : g.centers[(c.i + nx * c.j) * 3];
    const y = sw > 0 ? sy / sw : g.centers[(c.i + nx * c.j) * 3 + 1];
    if (out.some((d) => Math.hypot(d.position[0] - x, d.position[1] - y) < nmsRadius)) continue;
    let zw = 0;
    let zs = 0;
    for (let k = 0; k < nz; k++) {
      const id = c.i + nx * (c.j + ny * k);
      const w = field[id];
      zw += w;
      zs += w * g.centers[id * 3 + 2];
    }
    out.push({ position: [x, y, zw > 0 ? zs / zw : 1], score: c.v });
    if (out.length >= maxDetections) break;
  }
  return out;
}
