import type { ReconstructionFrame } from "@echospace/schemas";

/** Jitter and lag of matched tracks versus synthetic ground truth (see METRICS.jitterM / lagS). */
export function filterQuality(frames: ReconstructionFrame[]): { jitterM: number | null; lagS: number | null; n: number } {
  const pos: Array<[number, number] | null> = [];
  let lagSum = 0;
  let lagN = 0;
  for (const f of frames) {
    const g = f.groundTruth?.[0];
    const t = f.tracks.filter((x) => x.confirmed);
    if (!g || !t.length) {
      pos.push(null);
      continue;
    }
    const best = t.reduce((a, b) => (Math.hypot(a.position[0] - g.position[0], a.position[1] - g.position[1]) < Math.hypot(b.position[0] - g.position[0], b.position[1] - g.position[1]) ? a : b));
    const err = Math.hypot(best.position[0] - g.position[0], best.position[1] - g.position[1]);
    if (err > 1.0) {
      pos.push(null);
      continue;
    }
    pos.push([best.position[0], best.position[1]]);
    const sp = Math.hypot(g.velocity[0], g.velocity[1]);
    if (sp > 0.3) {
      const along = ((best.position[0] - g.position[0]) * g.velocity[0] + (best.position[1] - g.position[1]) * g.velocity[1]) / sp;
      lagSum += -along / sp;
      lagN++;
    }
  }
  let s2 = 0;
  let n2 = 0;
  for (let i = 2; i < pos.length; i++) {
    const a = pos[i - 2];
    const b = pos[i - 1];
    const c = pos[i];
    if (!a || !b || !c) continue;
    s2 += (c[0] - 2 * b[0] + a[0]) ** 2 + (c[1] - 2 * b[1] + a[1]) ** 2;
    n2++;
  }
  return { jitterM: n2 >= 10 ? Math.sqrt(s2 / n2) : null, lagS: lagN >= 10 ? lagSum / lagN : null, n: n2 };
}

export function floorCoverage(f: ReconstructionFrame): number {
  const { nx, ny, nz } = f.grid;
  let obs = 0;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let min = 1;
      for (let k = 0; k < nz; k++) min = Math.min(min, f.varianceRatio[i + nx * (j + ny * k)]);
      if (min < 0.8) obs++;
    }
  return obs / (nx * ny);
}
