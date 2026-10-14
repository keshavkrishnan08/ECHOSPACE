import { describe, expect, it } from "vitest";
import { Rng, deriveSeed } from "../src/sim/rng";

describe("Rng", () => {
  it("is deterministic for a seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it("matches the frozen reference stream shared with the Python engine", () => {
    const r = new Rng(12345);
    const seq = Array.from({ length: 5 }, () => r.nextU32());
    // Values are pinned in services/simulator/tests/test_rng.py as well.
    expect(seq).toMatchSnapshot();
  });

  it("produces roughly standard normals", () => {
    const r = new Rng(7);
    let s = 0;
    let s2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const x = r.normal();
      s += x;
      s2 += x * x;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.03);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.05);
  });

  it("derives independent seeds per stream", () => {
    expect(deriveSeed(1, 1, 0)).not.toBe(deriveSeed(1, 1, 1));
    expect(deriveSeed(1, 1, 0)).toBe(deriveSeed(1, 1, 0));
  });
});
