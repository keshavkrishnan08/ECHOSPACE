import { EchoEngine, scenarioByKey } from "../src";
for (const key of ["B", "E"] as const) for (const det of [0.55, 0.8, 0.95]) for (const z of [3, 4]) {
  const cfg = scenarioByKey(key)!.build();
  cfg.tracking.detectionThreshold = det;
  cfg.recon.detectionZ = z;
  cfg.recon.confidenceThreshold = 0.1;
  const eng = new EchoEngine(cfg);
  const acc = { err: [] as number[], prec: [] as number[], rec: [] as number[], fiou: [] as number[], pts: 0, n: 0, sw: 0 };
  eng.runOffline((f) => {
    if (f.timestampS < 3) return;
    acc.n++;
    if (f.metrics.positionErrorM !== null) acc.err.push(f.metrics.positionErrorM);
    if (f.metrics.precision !== null) acc.prec.push(f.metrics.precision);
    if (f.metrics.recall !== null) acc.rec.push(f.metrics.recall);
    if (f.metrics.floorIou !== null) acc.fiou.push(f.metrics.floorIou);
    acc.pts += f.pointsFiltered.length / 5;
    acc.sw = f.metrics.idSwitchesTotal;
  }, 40);
  const m = (a: number[]) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : "NA");
  console.log(key, "det", det, "z0", z, "err", m(acc.err), "prec", m(acc.prec), "rec", m(acc.rec), "fiou", m(acc.fiou), "pts/frame", (acc.pts / acc.n).toFixed(0), "idsw", acc.sw);
}
