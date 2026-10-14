import { describe, expect, it } from "vitest";
import { EchoEngine } from "../src/runtime/engine";
import { scenarioByKey } from "../src/sim/scenarios";
import type { ReconstructionFrame } from "@echospace/schemas";

function run(cfg: ReturnType<NonNullable<ReturnType<typeof scenarioByKey>>["build"]>, seconds: number) {
  const eng = new EchoEngine(cfg);
  const frames: ReconstructionFrame[] = [];
  eng.runOffline((f) => frames.push(f), seconds);
  return { eng, frames };
}

describe("end-to-end pipeline (synthetic)", () => {
  it("localises a walking subject in scenario B", () => {
    const { frames } = run(scenarioByKey("B")!.build(), 20);
    const errs = frames.filter((f) => f.timestampS > 3).map((f) => f.metrics.positionErrorM).filter((x): x is number => x !== null);
    expect(errs.length).toBeGreaterThan(100);
    const med = errs.sort((a, b) => a - b)[errs.length >> 1];
    expect(med).toBeLessThan(0.7);
  }, 60000);

  it("is reproducible frame-for-frame from the same configuration", () => {
    const cfg = scenarioByKey("B")!.build();
    const a = run(cfg, 3).frames;
    const b = run(cfg, 3).frames;
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(Array.from(a[i].occupancy)).toEqual(Array.from(b[i].occupancy));
      expect(Array.from(a[i].features.deltaRssDb)).toEqual(Array.from(b[i].features.deltaRssDb));
    }
  }, 60000);

  it("emits every stage record with measured durations", () => {
    const { frames } = run(scenarioByKey("A")!.build(), 1);
    const f = frames[frames.length - 1];
    expect(f.stages.length).toBe(12);
    expect(f.stages.find((s) => s.id === "estimate")!.applicable).toBe(false);
    expect(f.metrics.processingMs).toBeGreaterThan(0);
    expect(f.provenance.sourceMode).toBe("synthetic");
  }, 60000);

  it("empty room produces no confirmed tracks most of the time", () => {
    const { frames } = run(scenarioByKey("A")!.build(), 10);
    const withTracks = frames.filter((f) => f.tracks.some((t) => t.confirmed)).length;
    expect(withTracks / frames.length).toBeLessThan(0.2);
  }, 60000);

  it("reports insufficient observations instead of inventing output with two nodes", () => {
    const def = scenarioByKey("I")!;
    const cfg = def.variants!.find((v) => v.id === "insufficient")!.apply(def.build());
    const { frames } = run(cfg, 2);
    const f = frames[frames.length - 1];
    expect(f.capability.modelStatus).toBe("unsupported");
    expect(f.capability.modelMessage).toMatch(/Insufficient observations/);
    expect(f.tracks.length).toBe(0);
    expect(f.pointsFiltered.length).toBe(0);
  }, 60000);

  it("refuses unimplemented model slots", () => {
    const def = scenarioByKey("I")!;
    const cfg = def.variants!.find((v) => v.id === "transformer")!.apply(def.build());
    const f = run(cfg, 1).frames.at(-1)!;
    expect(f.capability.modelStatus).toBe("unsupported");
    expect(Math.max(...f.occupancy)).toBe(0);
  }, 60000);

  it("never claims skeleton support", () => {
    const f = run(scenarioByKey("B")!.build(), 1).frames.at(-1)!;
    expect(f.capability.skeleton).toBe("unsupported");
  }, 60000);

  it("higher noise degrades input quality", () => {
    const good = run(scenarioByKey("F")!.build(), 4).frames.at(-1)!;
    const cfg = scenarioByKey("F")!.build();
    cfg.signal.snrDb = 0;
    cfg.impairments.packetLoss = 0.5;
    const bad = run(cfg, 4).frames.at(-1)!;
    expect(bad.metrics.inputQuality).toBeLessThan(good.metrics.inputQuality);
    expect(bad.state).toBe("degraded");
  }, 60000);

  it("bounded acquisition queue drops under an injected inference delay", () => {
    const cfg = scenarioByKey("A")!.build();
    cfg.pipeline.injectedInferenceDelayMs = 40;
    cfg.pipeline.queueDepth = 4;
    const eng = new EchoEngine(cfg);
    let frames = 0;
    for (let i = 0; i < 10; i++) frames += eng.advance(0.5, 20).length;
    expect(eng.queueStats.depth).toBeLessThanOrEqual(eng.queueStats.capacity);
    expect(eng.queueStats.drops + eng.framesDropped).toBeGreaterThan(0);
    expect(frames).toBeGreaterThan(0);
  }, 60000);

  it("reconfigure applies non-structural changes without rebuilding the pipeline", () => {
    const cfg = scenarioByKey("B")!.build();
    const eng = new EchoEngine(cfg);
    eng.advance(1);
    const p = eng.pipeline;
    eng.reconfigure({ ...cfg, tracking: { ...cfg.tracking, gateM: 2 } });
    expect(eng.pipeline).toBe(p);
    eng.reconfigure({ ...cfg, recon: { ...cfg.recon, voxelSizeM: 0.5 } });
    expect(eng.pipeline).not.toBe(p);
  }, 60000);
});

describe("deterministic mid-run reconfiguration", () => {
  it("a live change and a scheduled replay of it produce identical frames", () => {
    const cfg = scenarioByKey("F")!.build();
    const noisy = { ...cfg, signal: { ...cfg.signal, snrDb: 8 } };
    const live = new EchoEngine(cfg);
    const a: ReconstructionFrame[] = [];
    // irregular wall-clock-like steps, change applied whenever the UI gets to it
    let applied = -1;
    while (live.simTime < 3) {
      a.push(...live.advance(0.137, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY));
      if (applied < 0 && live.framesProduced >= 12) applied = live.reconfigure(noisy);
    }
    const replay = new EchoEngine(cfg);
    replay.schedule([{ frameSeq: applied, config: noisy }]);
    const b: ReconstructionFrame[] = [];
    while (replay.simTime < 3) b.push(...replay.advance(0.25, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY));
    const n = Math.min(a.length, b.length);
    expect(n).toBeGreaterThan(25);
    for (let i = 0; i < n; i++) {
      expect(b[i].seq).toBe(a[i].seq);
      expect(Array.from(b[i].features.deltaRssDb)).toEqual(Array.from(a[i].features.deltaRssDb));
    }
  }, 60000);
});
