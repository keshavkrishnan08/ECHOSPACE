import { EchoEngine, scenarioByKey } from "../src";
const cfg = scenarioByKey("B")!.build();
let t = performance.now();
const eng = new EchoEngine(cfg);
console.log("init", (performance.now() - t).toFixed(0));
eng.runOffline((f) => {
  if (Math.abs(f.timestampS - 12) > 0.05 && Math.abs(f.timestampS - 22) > 0.05) return;
  const g = f.grid;
  const gt = f.groundTruth![0];
  const i = Math.floor(gt.position[0] / (6 / g.nx));
  const j = Math.floor(gt.position[1] / (5 / g.ny));
  const col = [] as string[];
  for (let k = 0; k < g.nz; k++) {
    const id = i + g.nx * (j + g.ny * k);
    col.push(`${f.image[id].toFixed(2)}/${Math.sqrt(f.varianceRatio[id]).toFixed(2)}`);
  }
  let mx = 0, mi = 0;
  for (let q = 0; q < f.image.length; q++) if (f.image[q] > mx) { mx = f.image[q]; mi = q; }
  console.log("t", f.timestampS.toFixed(1), "col img/sd:", col.join(" "));
  console.log(" max img", mx.toFixed(2), "at", mi % g.nx, Math.floor(mi / g.nx) % g.ny, Math.floor(mi / g.nx / g.ny), "gt", i, j);
  const vr = Array.from(f.varianceRatio).sort((a,b)=>a-b);
  console.log(" var ratio quantiles", [0.01,0.1,0.5,0.9].map(q=>vr[Math.floor(q*vr.length)].toFixed(2)).join(" "));
}, 23);
