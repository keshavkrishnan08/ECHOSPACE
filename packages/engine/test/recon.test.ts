import { describe, expect, it } from "vitest";
import { hungarian } from "../src/tracking/hungarian";
import { Tracker } from "../src/tracking/tracker";
import { RtiModel } from "../src/recon/rti";
import { spdInverse, normCdf } from "../src/recon/linalg";
import { baseConfig } from "../src/sim/scenarios";
import { buildGrid, buildLinks } from "../src/sim/scene";
import { chamfer, expectedCalibrationError, iou, percentile, IdSwitchCounter, evaluateTracks } from "../src/metrics/evaluate";
import { TrackingConfig } from "@echospace/schemas";

describe("linear algebra", () => {
  it("inverts an SPD matrix", () => {
    const a = Float64Array.from([4, 1, 0.5, 1, 3, 0.2, 0.5, 0.2, 2]);
    const inv = spdInverse(a, 3);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += a[i * 3 + k] * inv[k * 3 + j];
        expect(s).toBeCloseTo(i === j ? 1 : 0, 9);
      }
  });
  it("normal CDF", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
  });
});

describe("hungarian", () => {
  it("finds the optimal assignment", () => {
    expect(hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]])).toEqual([1, 0, 2]);
  });
  it("respects the gate", () => {
    expect(hungarian([[0.5, 9], [9, 9]], 1)).toEqual([0, -1]);
  });
  it("handles rectangular matrices", () => {
    expect(hungarian([[1, 0.1, 5]])).toEqual([1]);
  });
});

describe("RTI", () => {
  const cfg = baseConfig({ scenario: "custom", name: "x" });
  const grid = buildGrid(cfg.room, 0.5);
  const links = buildLinks(cfg.sensors);
  const rti = new RtiModel(grid, links, cfg.recon);
  it("reports unobserved voxels with variance ratio near 1 and observed ones lower", () => {
    const cov = rti.coverage();
    const min = Math.min(...cov);
    const max = Math.max(...cov);
    expect(max).toBeGreaterThan(0.95);
    expect(min).toBeLessThan(0.8);
  });
  it("zero attenuation gives no confident occupancy", () => {
    const r = rti.reconstruct(new Float64Array(links.length));
    expect(Math.max(...r.occupancy)).toBeLessThanOrEqual(0.5);
  });
  it("dropping links raises posterior variance", () => {
    const y = new Float64Array(links.length);
    const all = rti.reconstruct(y).varianceRatio;
    const y2 = y.slice();
    for (let i = 0; i < 20; i++) y2[i] = Number.NaN;
    const some = rti.reconstruct(y2).varianceRatio;
    const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(some)).toBeGreaterThan(mean(all));
  });
});

describe("tracker", () => {
  const cfg = TrackingConfig.parse({ birthHits: 3, maxMisses: 2 });
  it("confirms a steadily detected target and estimates velocity", () => {
    const t = new Tracker(cfg, 1, 10);
    let out;
    for (let i = 0; i < 20; i++) out = t.step([{ position: [1 + 0.1 * i, 2, 1], score: 0.9 }], 0.1, i * 0.1);
    expect(out!.tracks.length).toBe(1);
    expect(out!.tracks[0].confirmed).toBe(true);
    expect(out!.tracks[0].velocity[0]).toBeCloseTo(1, 0);
  });
  it("terminates a track after max misses", () => {
    const t = new Tracker(cfg, 1, 10);
    for (let i = 0; i < 5; i++) t.step([{ position: [1, 1, 1], score: 0.9 }], 0.1, i);
    let events: string[] = [];
    for (let i = 0; i < 5; i++) events = events.concat(t.step([], 0.1, 5 + i).events.map((e) => e.kind));
    expect(events).toContain("track-death");
  });
});

describe("metrics", () => {
  it("IoU", () => {
    expect(iou([1, 1, 0, 0], [1, 0, 1, 0], 0.5)).toBeCloseTo(1 / 3);
    expect(iou([0, 0], [0, 0], 0.5)).toBeNull();
  });
  it("chamfer distance of identical sets is zero", () => {
    const a = Float32Array.from([0, 0, 0, 1, 1, 1, 0, 0, 1, 1]);
    const b = Float64Array.from([0, 0, 0, 1, 0, 0]);
    expect(chamfer(a, b)).toBeCloseTo(0, 6);
  });
  it("ECE of a perfectly calibrated predictor is 0", () => {
    expect(expectedCalibrationError([0, 0, 1, 1], [0, 0, 1, 1]).ece).toBeCloseTo(0, 9);
  });
  it("percentile interpolates and needs data", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5);
    expect(percentile([], 0.5)).toBeNull();
  });
  it("counts identity switches", () => {
    const c = new IdSwitchCounter();
    c.update([{ gtId: "a", trackId: "T1", errorM: 0 }]);
    c.update([{ gtId: "a", trackId: "T2", errorM: 0 }]);
    expect(c.total).toBe(1);
  });
  it("evaluates precision/recall with the match radius", () => {
    const gt = [{ id: "s", label: "S", position: [1, 1, 1] as [number, number, number], velocity: [0, 0, 0] as [number, number, number], headingRad: 0, posture: "standing" as const, joints: new Float32Array(51), heightM: 1.7, radiusM: 0.2 }];
    const tr = (x: number) => ({ id: "T", position: [x, 1, 1] as [number, number, number], velocity: [0, 0, 0] as [number, number, number], covariance: [0, 0, 0] as [number, number, number], ageFrames: 1, hits: 3, misses: 0, confirmed: true, confidence: 1, trail: [] });
    expect(evaluateTracks([tr(1.2)], gt).recall).toBe(1);
    expect(evaluateTracks([tr(3)], gt).recall).toBe(0);
    expect(evaluateTracks([tr(3)], gt).precision).toBe(0);
  });
});
