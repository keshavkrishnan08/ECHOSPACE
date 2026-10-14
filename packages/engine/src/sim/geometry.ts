import type { Vec3 } from "@echospace/schemas";

export const C_LIGHT = 299_792_458;

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3) => Math.sqrt(dot(a, a));
export const dist = (a: Vec3, b: Vec3) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/** Length of segment p0→p1 that lies inside the axis-aligned box, metres (0 when disjoint). */
export function segmentBoxOverlap(p0: Vec3, p1: Vec3, min: Vec3, max: Vec3): number {
  let t0 = 0;
  let t1 = 1;
  for (let a = 0; a < 3; a++) {
    const d = p1[a] - p0[a];
    if (Math.abs(d) < 1e-12) {
      if (p0[a] < min[a] || p0[a] > max[a]) return 0;
      continue;
    }
    let ta = (min[a] - p0[a]) / d;
    let tb = (max[a] - p0[a]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 >= t1) return 0;
  }
  return (t1 - t0) * dist(p0, p1);
}

/**
 * Closest distance between segment [p0,p1] and segment [q0,q1].
 * Returns the distance and the parameter s along [p0,p1] of the closest point.
 */
export function segmentSegmentDistance(p0: Vec3, p1: Vec3, q0: Vec3, q1: Vec3): { d: number; s: number } {
  const u = sub(p1, p0);
  const v = sub(q1, q0);
  const w = sub(p0, q0);
  const a = dot(u, u);
  const b = dot(u, v);
  const c = dot(v, v);
  const d = dot(u, w);
  const e = dot(v, w);
  const D = a * c - b * b;
  let sN: number;
  let sD = D;
  let tN: number;
  let tD = D;
  if (D < 1e-12) {
    sN = 0;
    sD = 1;
    tN = e;
    tD = c;
  } else {
    sN = b * e - c * d;
    tN = a * e - b * d;
    if (sN < 0) {
      sN = 0;
      tN = e;
      tD = c;
    } else if (sN > sD) {
      sN = sD;
      tN = e + b;
      tD = c;
    }
  }
  if (tN < 0) {
    tN = 0;
    if (-d < 0) sN = 0;
    else if (-d > a) sN = sD;
    else {
      sN = -d;
      sD = a;
    }
  } else if (tN > tD) {
    tN = tD;
    if (-d + b < 0) sN = 0;
    else if (-d + b > a) sN = sD;
    else {
      sN = -d + b;
      sD = a;
    }
  }
  const sc = Math.abs(sN) < 1e-12 ? 0 : sN / sD;
  const tc = Math.abs(tN) < 1e-12 ? 0 : tN / tD;
  const dP = sub(add(w, scale(u, sc)), scale(v, tc));
  return { d: norm(dP), s: sc };
}

export function clamp(x: number, lo: number, hi: number) {
  return x < lo ? lo : x > hi ? hi : x;
}
