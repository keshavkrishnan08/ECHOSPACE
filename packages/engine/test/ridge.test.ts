import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ReconstructionFrame } from "@echospace/schemas";
import { EchoEngine } from "../src/runtime/engine";
import { geometryKey, ridgePredict, type RidgeWeights } from "../src/recon/ridge";
import { scenarioByKey } from "../src/sim/scenarios";

// Exported by models/baselines/ridge_floor/train.py.
const weights = JSON.parse(
  readFileSync(new URL("../../../models/baselines/ridge_floor/weights.json", import.meta.url), "utf8"),
) as RidgeWeights;

function ridgeConfig(key: "B" | "I", variant?: string) {
  const def = scenarioByKey(key)!;
  let cfg = def.build();
  if (variant) cfg = def.variants!.find((v) => v.id === variant)!.apply(cfg);
  cfg.recon.modelId = "ridge-floor";
  return cfg;
}

function run(cfg: ReturnType<typeof ridgeConfig>, seconds: number) {
  const frames: ReconstructionFrame[] = [];
  new EchoEngine(cfg, { ridge: weights }).runOffline((f) => frames.push(f), seconds);
  return frames;
}

describe("ridge-floor weights", () => {
  it("match the RidgeWeights interface and the scenario B geometry", () => {
    const cfg = ridgeConfig("B");
    expect(weights.id).toBe("ridge-floor");
    expect(weights.geometryKey).toBe(geometryKey(cfg.room, cfg.sensors));
    expect(weights.links).toBe(28);
    const F = weights.featureNames.length;
    const C = weights.grid.nx * weights.grid.ny;
    expect(F).toBe(2 * weights.links);
    expect(weights.mean.length).toBe(F);
    expect(weights.std.length).toBe(F);
    expect(weights.b.length).toBe(C);
    expect(weights.W.length).toBe(F * C);
    expect(weights.grid.nx * weights.grid.cellM).toBeCloseTo(cfg.room.width, 9);
    expect(weights.grid.ny * weights.grid.cellM).toBeCloseTo(cfg.room.depth, 9);
    expect(weights.oodMaxMeanAbsZ).toBeGreaterThan(0);
    // The training mean is an in-distribution input: z = 0, scores = clip(b).
    const out = ridgePredict(weights, Float64Array.from(weights.mean));
    expect(out.meanAbsZ).toBe(0);
    expect(out.ood).toBe(false);
  });

  it("runs on scenario B and localises the subject on the floor", () => {
    const frames = run(ridgeConfig("B"), 15).filter((f) => f.timestampS > 3);
    const statuses = new Set(frames.map((f) => f.capability.modelStatus));
    expect(statuses.has("unsupported")).toBe(false);
    for (const s of statuses) expect(["ok", "degraded"]).toContain(s);
    const iou = frames.map((f) => f.metrics.floorIou).filter((x): x is number => x !== null).sort((a, b) => a - b);
    expect(iou.length).toBeGreaterThan(100);
    expect(iou[iou.length >> 1]).toBeGreaterThan(0);
  }, 120000);

  it("refuses to run in a different room geometry (scenario I, 'geometry' variant)", () => {
    const f = run(ridgeConfig("I", "geometry"), 2).at(-1)!;
    expect(f.capability.modelStatus).toBe("unsupported");
    expect(f.capability.modelMessage).toMatch(/Unexpected scene geometry/);
    expect(Math.max(...f.occupancy)).toBe(0);
  }, 60000);
});
