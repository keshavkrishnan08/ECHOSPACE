import { describe, expect, it } from "vitest";
import { ChannelSimulator } from "../src/sim/channel";
import { baseConfig, scenarioByKey, SCENARIOS } from "../src/sim/scenarios";
import { buildLinks, buildGrid } from "../src/sim/scene";
import { compilePath, subjectStateAt } from "../src/sim/trajectory";
import { segmentBoxOverlap, segmentSegmentDistance } from "../src/sim/geometry";

describe("geometry", () => {
  it("computes segment–box overlap", () => {
    expect(segmentBoxOverlap([0, 0.5, 0.5], [3, 0.5, 0.5], [1, 0, 0], [2, 1, 1])).toBeCloseTo(1, 9);
    expect(segmentBoxOverlap([0, 2, 0.5], [3, 2, 0.5], [1, 0, 0], [2, 1, 1])).toBe(0);
  });
  it("computes segment–segment distance", () => {
    const r = segmentSegmentDistance([0, 0, 1], [2, 0, 1], [1, 1, 0], [1, 1, 2]);
    expect(r.d).toBeCloseTo(1, 9);
    expect(r.s).toBeCloseTo(0.5, 9);
  });
});

describe("scenarios", () => {
  it("every preset validates and has links", () => {
    for (const s of SCENARIOS) {
      const c = s.build();
      expect(buildLinks(c.sensors).length).toBeGreaterThan(0);
      for (const v of s.variants ?? []) expect(() => v.apply(c)).not.toThrow();
    }
  });
  it("links: n transceivers give n(n-1)/2 links", () => {
    const c = baseConfig({ scenario: "custom", name: "x" });
    expect(buildLinks(c.sensors).length).toBe(28);
  });
  it("grid covers the room", () => {
    const g = buildGrid(baseConfig({ scenario: "custom", name: "x" }).room, 0.25);
    expect([g.nx, g.ny, g.nz]).toEqual([24, 20, 11]);
  });
});

describe("trajectory", () => {
  it("walks at the configured speed and loops back", () => {
    const c = scenarioByKey("B")!.build();
    const p = compilePath(c.subjects[0]);
    const s0 = subjectStateAt(p, 0);
    const s1 = subjectStateAt(p, 1);
    expect(Math.hypot(s1.position[0] - s0.position[0], s1.position[1] - s0.position[1])).toBeCloseTo(1, 6);
    const end = subjectStateAt(p, p.period - 1e-6);
    expect(Math.hypot(end.position[0] - 1.2, end.position[1] - 1.2)).toBeLessThan(0.05);
    expect(s0.joints.length).toBe(51);
  });
  it("is absent before its start delay", () => {
    const c = scenarioByKey("E")!.build();
    expect(subjectStateAt(compilePath(c.subjects[2]), 1).present).toBe(false);
  });
});

describe("channel simulator", () => {
  it("is deterministic for a seed", () => {
    const c = scenarioByKey("B")!.build();
    const a = new ChannelSimulator(c);
    const b = new ChannelSimulator(c);
    const st = [subjectStateAt(compilePath(c.subjects[0]), 3)];
    for (let s = 0; s < 5; s++) {
      const pa = a.packets(s, st);
      const pb = b.packets(s, st);
      pa.forEach((p, i) => {
        expect(p === null).toBe(pb[i] === null);
        if (p && pb[i]) expect(Array.from(p.re)).toEqual(Array.from(pb[i]!.re));
      });
    }
  });
  it("a different seed changes the noise", () => {
    const c = scenarioByKey("A")!.build();
    const a = new ChannelSimulator(c).packets(0, [])[0]!;
    const b = new ChannelSimulator({ ...c, seed: c.seed + 1 }).packets(0, [])[0]!;
    expect(a.re[0]).not.toBe(b.re[0]);
  });
  it("body shadowing attenuates the line of sight", () => {
    const c = baseConfig({ scenario: "custom", name: "x", obstacles: [], sensors: [
      { id: "a", label: "", role: "tx", position: [0.5, 2.5, 1.2], yawDeg: 0, antennas: 1, enabled: true },
      { id: "b", label: "", role: "rx", position: [5.5, 2.5, 1.2], yawDeg: 180, antennas: 1, enabled: true },
    ], signal: { maxReflectionOrder: 0, subjectScatter: false } });
    const sim = new ChannelSimulator(c);
    const re = new Float64Array(30);
    const im = new Float64Array(30);
    sim.channel(0, [], re, im);
    const p0 = re.reduce((s, v, i) => s + v * v + im[i] * im[i], 0);
    const blocker = subjectStateAt(compilePath({ id: "s", label: "S", heightM: 1.75, radiusM: 0.22, rcsM2: 1, start: [3, 2.5], startHeadingDeg: 0, startDelayS: 0, actions: [], loop: false }), 0);
    sim.channel(0, [blocker], re, im);
    const p1 = re.reduce((s, v, i) => s + v * v + im[i] * im[i], 0);
    const lossDb = 10 * Math.log10(p0 / p1);
    expect(lossDb).toBeGreaterThan(5);
    expect(lossDb).toBeLessThan(9);
  });
  it("packet loss drops approximately the configured fraction", () => {
    const c = scenarioByKey("A")!.build();
    c.impairments.packetLoss = 0.3;
    const sim = new ChannelSimulator(c);
    let n = 0;
    let dropped = 0;
    for (let s = 0; s < 200; s++) for (const p of sim.packets(s, [])) {
      n++;
      if (!p) dropped++;
    }
    expect(dropped / n).toBeGreaterThan(0.25);
    expect(dropped / n).toBeLessThan(0.35);
  });
  it("marks missing antennas as non-finite", () => {
    const c = scenarioByKey("I")!.variants!.find((v) => v.id === "channels")!.apply(scenarioByKey("I")!.build());
    c.impairments.packetLoss = 0;
    const sim = new ChannelSimulator(c);
    const link = sim.links.findIndex((l) => l.rxId === "N2");
    const p = sim.packets(0, [])[link]!;
    expect(Number.isNaN(p.re[0])).toBe(true);
  });
});
