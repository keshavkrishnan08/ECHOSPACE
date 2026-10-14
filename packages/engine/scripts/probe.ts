import { EchoEngine, scenarioByKey } from "../src";

const key = (process.argv[2] ?? "B") as never;
const secs = Number(process.argv[3] ?? 30);
const cfg = scenarioByKey(key)!.build();
const t0 = performance.now();
const eng = new EchoEngine(cfg);
console.log("init ms", (performance.now() - t0).toFixed(0), "links", eng.source.descriptor.links.length, "voxels", eng.pipeline.grid.count);
const errs: number[] = [];
let n = 0;
const proc: number[] = [];
eng.runOffline((f) => {
  n++;
  proc.push(f.metrics.processingMs);
  if (f.metrics.positionErrorM !== null) errs.push(f.metrics.positionErrorM);
  if (n % 20 === 0) {
    const gt = f.groundTruth?.map((g) => `${g.position[0].toFixed(1)},${g.position[1].toFixed(1)}`).join(" ");
    const tr = f.tracks.filter((t) => t.confirmed).map((t) => `${t.position[0].toFixed(1)},${t.position[1].toFixed(1)}`).join(" ");
    const maxOcc = Math.max(...f.occupancy);
    const maxImg = Math.max(...f.image);
    const dr = Array.from(f.features.deltaRssDb).map((x) => x.toFixed(1)).slice(0, 8).join(" ");
    console.log(`t=${f.timestampS.toFixed(1)} st=${f.state} gt=[${gt}] tr=[${tr}] err=${f.metrics.positionErrorM?.toFixed(2)} fiou=${f.metrics.floorIou?.toFixed(2)} rec=${f.metrics.recall} maxOcc=${maxOcc.toFixed(2)} maxImg=${maxImg.toFixed(2)} pts=${f.pointsFiltered.length / 5} conf=${f.metrics.meanConfidence.toFixed(2)} snr=${f.metrics.meanSnrDb?.toFixed(1)} dRSS=${dr} ${f.capability.modelMessage.slice(0, 60)}`);
  }
}, secs);
errs.sort((a, b) => a - b);
proc.sort((a, b) => a - b);
console.log("frames", n, "median err", errs[errs.length >> 1]?.toFixed(2), "matched frames", errs.length, "median proc ms", proc[proc.length >> 1].toFixed(1), "total s", ((performance.now() - t0) / 1000).toFixed(1));
