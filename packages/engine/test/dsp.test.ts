import { describe, expect, it } from "vitest";
import { BoundedQueue } from "../src/dsp/queue";
import { fft, hann, dopplerSpectrum, dopplerFreqs } from "../src/dsp/fft";
import { hampel } from "../src/dsp/hampel";
import { sanitizePacket, unwrap } from "../src/dsp/sanitize";
import { alignLink } from "../src/dsp/align";
import { validatePackets } from "../src/dsp/validate";
import type { CsiPacket } from "../src/sim/channel";

describe("BoundedQueue", () => {
  it("never exceeds capacity and counts drops (drop-oldest)", () => {
    const q = new BoundedQueue<number>(3, "drop-oldest");
    for (let i = 0; i < 10; i++) q.push(i);
    expect(q.length).toBe(3);
    expect(q.drops).toBe(7);
    expect(q.toArray()).toEqual([7, 8, 9]);
  });
  it("drop-newest keeps the oldest items", () => {
    const q = new BoundedQueue<number>(2, "drop-newest");
    [1, 2, 3].forEach((x) => q.push(x));
    expect(q.toArray()).toEqual([1, 2]);
    expect(q.shift()).toBe(1);
  });
});

describe("fft", () => {
  it("matches a direct DFT", () => {
    const n = 16;
    const re = new Float64Array(n).map((_, i) => Math.sin(i * 0.7) + 0.3 * i);
    const im = new Float64Array(n).map((_, i) => Math.cos(i * 1.3));
    const r2 = re.slice();
    const i2 = im.slice();
    fft(r2, i2);
    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      for (let t = 0; t < n; t++) {
        const a = (-2 * Math.PI * k * t) / n;
        sr += re[t] * Math.cos(a) - im[t] * Math.sin(a);
        si += re[t] * Math.sin(a) + im[t] * Math.cos(a);
      }
      expect(r2[k]).toBeCloseTo(sr, 9);
      expect(i2[k]).toBeCloseTo(si, 9);
    }
  });
  it("round-trips through the inverse", () => {
    const re = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const im = new Float64Array(8);
    fft(re, im);
    fft(re, im, true);
    expect(Array.from(re).map((x) => Math.round(x * 1e9) / 1e9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("hann window is symmetric and zero at the ends", () => {
    const w = hann(9);
    expect(w[0]).toBeCloseTo(0);
    expect(w[8]).toBeCloseTo(0);
    expect(w[4]).toBeCloseTo(1);
  });
  it("locates a Doppler tone", () => {
    const fs = 100;
    const f0 = 12.5;
    const n = 64;
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * f0 * i) / fs));
    const im = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * f0 * i) / fs));
    const p = dopplerSpectrum(re, im, 64);
    const f = dopplerFreqs(64, fs);
    let best = 0;
    for (let i = 1; i < p.length; i++) if (p[i] > p[best]) best = i;
    expect(f[best]).toBeCloseTo(f0, 5);
  });
});

describe("hampel", () => {
  it("replaces an isolated spike and leaves clean data", () => {
    const x = Float64Array.from([1, 1.1, 0.9, 1, 25, 1, 1.05, 0.95, 1]);
    const { y, replaced } = hampel(x, 3, 3);
    expect(replaced).toBe(1);
    expect(y[4]).toBeCloseTo(1, 1);
    expect(y[0]).toBe(1);
  });
});

describe("phase sanitization", () => {
  it("unwraps a linear ramp", () => {
    const ramp = Float64Array.from({ length: 30 }, (_, k) => 0.5 * k);
    const wrapped = ramp.map((v) => Math.atan2(Math.sin(v), Math.cos(v)));
    const u = unwrap(wrapped);
    u.forEach((v, k) => expect(v - u[0]).toBeCloseTo(ramp[k] - ramp[0], 9));
  });
  it("removes common CFO/STO phase and preserves inter-antenna phase", () => {
    const K = 30;
    const M = 2;
    const x = Float64Array.from({ length: K }, (_, k) => k - 14.5);
    const re = new Float64Array(M * K);
    const im = new Float64Array(M * K);
    const antDelta = 0.8;
    for (let m = 0; m < M; m++)
      for (let k = 0; k < K; k++) {
        const ph = 1.7 + 0.21 * x[k] + m * antDelta + 0.05 * Math.sin(k);
        re[m * K + k] = Math.cos(ph);
        im[m * K + k] = Math.sin(ph);
      }
    const s = sanitizePacket(re, im, M, K, x, true);
    expect(s.slope).toBeCloseTo(0.21, 2);
    for (let k = 0; k < K; k++) {
      const d = Math.atan2(s.im[K + k], s.re[K + k]) - Math.atan2(s.im[k], s.re[k]);
      expect(Math.atan2(Math.sin(d), Math.cos(d))).toBeCloseTo(antDelta, 9);
      expect(Math.abs(s.phaseSan[k])).toBeLessThan(0.1);
    }
  });
});

const pkt = (link: number, seq: number, ts: number, M = 1, K = 4, fill = 1): CsiPacket => ({
  link, seq, timestampS: ts, trueTimeS: seq / 100, antennas: M, subcarriers: K,
  re: new Float32Array(M * K).fill(fill), im: new Float32Array(M * K),
});

describe("alignment and validation", () => {
  it("reconstructs missing timestamps from sequence numbers and reorders", () => {
    const ps = [pkt(0, 2, 0.02), pkt(0, 1, Number.NaN), pkt(0, 3, 0.03), pkt(0, 5, 0.05)];
    const r = alignLink(ps, 100);
    expect(r.packets.map((p) => p.seq)).toEqual([1, 2, 3, 5]);
    expect(r.packets[0].timestampS).toBeCloseTo(0.01, 9);
    expect(r.reconstructedTimestamps).toBe(1);
    expect(r.gaps).toBe(1);
    expect(r.reordered).toBe(1);
  });
  it("rejects malformed packets and reports non-finite antennas", () => {
    const bad = pkt(0, 0, 0, 2, 4);
    bad.re[0] = Number.NaN;
    const allBad = pkt(0, 1, 0, 2, 4, Number.NaN);
    const wrongShape = pkt(0, 2, 0, 1, 4);
    const r = validatePackets([bad, allBad, wrongShape, pkt(5, 0, 0)], { links: 1, antennas: [2], subcarriers: 4 });
    expect(r.accepted.length).toBe(1);
    expect(r.rejected).toBe(3);
    expect([...r.missingAntennas.get(0)!]).toContain(0);
  });
});
