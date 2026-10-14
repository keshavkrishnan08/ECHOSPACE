/**
 * Deterministic 32-bit PRNG (xoshiro128**) seeded through splitmix32.
 *
 * The Python reference simulator (services/simulator/echospace_sim/rng.py) implements the exact
 * same integer arithmetic so both engines produce identical random streams for a given seed.
 * Floats are derived as u32 / 2^32, normals with Box–Muller consuming two uniforms per sample.
 */

export function splitmix32(state: number): [value: number, next: number] {
  const next = (state + 0x9e3779b9) >>> 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return [(z ^ (z >>> 16)) >>> 0, next];
}

/** Mixes a base seed with stream identifiers into an independent 32-bit seed. */
export function deriveSeed(seed: number, ...parts: number[]): number {
  let state = seed >>> 0;
  let out: number;
  [out, state] = splitmix32(state);
  for (const p of parts) {
    state = (state ^ (p >>> 0)) >>> 0;
    [out, state] = splitmix32(state);
    state = (state ^ out) >>> 0;
  }
  return out >>> 0;
}

/** Stream identifiers. Keep in sync with the Python implementation. */
export const STREAM = {
  impairments: 1,
  calibration: 2,
  points: 3,
  scenario: 4,
  ghost: 5,
} as const;

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    let state = seed >>> 0;
    let v: number;
    [v, state] = splitmix32(state);
    this.s0 = v;
    [v, state] = splitmix32(state);
    this.s1 = v;
    [v, state] = splitmix32(state);
    this.s2 = v;
    [v, state] = splitmix32(state);
    this.s3 = v;
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform in [0, 1). */
  uniform(): number {
    return this.nextU32() / 4294967296;
  }

  /** Standard normal via Box–Muller (cosine branch only, two uniforms per call). */
  normal(): number {
    const u1 = 1 - this.uniform();
    const u2 = this.uniform();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}
