import type { SubjectSpec, Vec2, Vec3 } from "@echospace/schemas";

/**
 * Synthetic subject motion. A subject executes a list of actions (walk / stop / turn / sit),
 * optionally looping back to its start. Everything here is *ground truth*: it drives the channel
 * simulator and the evaluation metrics, and must never be presented as an inferred output.
 */

type Segment =
  | { kind: "walk"; t0: number; t1: number; from: Vec2; to: Vec2; heading: number; speed: number; d0: number }
  | { kind: "stop"; t0: number; t1: number; at: Vec2; heading: number }
  | { kind: "turn"; t0: number; t1: number; at: Vec2; h0: number; h1: number }
  | { kind: "sit"; t0: number; t1: number; at: Vec2; heading: number };

export interface CompiledPath {
  spec: SubjectSpec;
  segments: Segment[];
  period: number;
}

export type Posture = "standing" | "walking" | "sitting" | "turning";

export interface SubjectState {
  present: boolean;
  position: Vec3;
  velocity: Vec3;
  heading: number;
  posture: Posture;
  /** 0 = standing, 1 = fully seated. */
  sitBlend: number;
  gaitPhase: number;
  joints: Float32Array;
  /** Scatter centres (x, y, z, rcs fraction) used by the channel model. */
  scatterers: Array<[number, number, number, number]>;
  /** Vertical body axis for shadowing: bottom and top z. */
  axisBottom: number;
  axisTop: number;
}

const STRIDE_M = 1.4;
const SIT_TRANSITION_S = 0.8;

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function compilePath(spec: SubjectSpec): CompiledPath {
  const segments: Segment[] = [];
  let t = 0;
  let pos: Vec2 = [spec.start[0], spec.start[1]];
  let heading = (spec.startHeadingDeg * Math.PI) / 180;
  let walked = 0;
  const actions = [...spec.actions];
  if (spec.loop) {
    const end = simulateEnd(spec);
    if (Math.hypot(end[0] - spec.start[0], end[1] - spec.start[1]) > 1e-6) {
      actions.push({ type: "walk", to: [spec.start[0], spec.start[1]], speed: 1.0 });
    }
  }
  for (const a of actions) {
    if (a.type === "walk") {
      const dx = a.to[0] - pos[0];
      const dy = a.to[1] - pos[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const h = Math.atan2(dy, dx);
      const dur = len / a.speed;
      segments.push({ kind: "walk", t0: t, t1: t + dur, from: pos, to: [a.to[0], a.to[1]], heading: h, speed: a.speed, d0: walked });
      walked += len;
      t += dur;
      pos = [a.to[0], a.to[1]];
      heading = h;
    } else if (a.type === "stop") {
      if (a.durationS <= 0) continue;
      segments.push({ kind: "stop", t0: t, t1: t + a.durationS, at: pos, heading });
      t += a.durationS;
    } else if (a.type === "turn") {
      const h1 = (a.headingDeg * Math.PI) / 180;
      segments.push({ kind: "turn", t0: t, t1: t + a.durationS, at: pos, h0: heading, h1: heading + wrapAngle(h1 - heading) });
      t += a.durationS;
      heading = h1;
    } else if (a.type === "sit") {
      if (a.durationS <= 0) continue;
      segments.push({ kind: "sit", t0: t, t1: t + a.durationS, at: pos, heading });
      t += a.durationS;
    }
  }
  if (segments.length === 0) {
    segments.push({ kind: "stop", t0: 0, t1: 1, at: pos, heading });
    t = 1;
  }
  return { spec, segments, period: t };
}

function simulateEnd(spec: SubjectSpec): Vec2 {
  let p: Vec2 = [spec.start[0], spec.start[1]];
  for (const a of spec.actions) if (a.type === "walk") p = [a.to[0], a.to[1]];
  return p;
}

export function subjectStateAt(path: CompiledPath, time: number): SubjectState {
  const spec = path.spec;
  const local = time - spec.startDelayS;
  if (local < 0 || (!spec.loop && local > path.period)) {
    return absentState();
  }
  const tt = spec.loop ? ((local % path.period) + path.period) % path.period : Math.min(local, path.period);
  let seg = path.segments[path.segments.length - 1];
  for (const s of path.segments) {
    if (tt >= s.t0 && tt < s.t1) {
      seg = s;
      break;
    }
  }
  let x: number;
  let y: number;
  let heading: number;
  let vx = 0;
  let vy = 0;
  let posture: Posture = "standing";
  let sitBlend = 0;
  let gaitPhase = 0;
  switch (seg.kind) {
    case "walk": {
      const f = Math.min(1, Math.max(0, (tt - seg.t0) / (seg.t1 - seg.t0)));
      x = seg.from[0] + (seg.to[0] - seg.from[0]) * f;
      y = seg.from[1] + (seg.to[1] - seg.from[1]) * f;
      heading = seg.heading;
      vx = Math.cos(heading) * seg.speed;
      vy = Math.sin(heading) * seg.speed;
      posture = "walking";
      const travelled = seg.d0 + seg.speed * (tt - seg.t0);
      gaitPhase = ((travelled / STRIDE_M) * 2 * Math.PI) % (2 * Math.PI);
      break;
    }
    case "stop":
      [x, y] = seg.at;
      heading = seg.heading;
      break;
    case "turn": {
      const f = Math.min(1, Math.max(0, (tt - seg.t0) / (seg.t1 - seg.t0)));
      [x, y] = seg.at;
      heading = seg.h0 + (seg.h1 - seg.h0) * f;
      posture = "turning";
      break;
    }
    case "sit": {
      [x, y] = seg.at;
      heading = seg.heading;
      const dur = seg.t1 - seg.t0;
      const tr = Math.min(SIT_TRANSITION_S, dur / 2);
      const e = tt - seg.t0;
      sitBlend = e < tr ? e / tr : e > dur - tr ? (dur - e) / tr : 1;
      sitBlend = Math.min(1, Math.max(0, sitBlend));
      posture = sitBlend > 0.5 ? "sitting" : "standing";
      break;
    }
  }
  const joints = skeleton(x, y, heading, spec.heightM, gaitPhase, posture === "walking", sitBlend);
  const centreZ = (joints[5 * 3 + 2] + joints[6 * 3 + 2] + joints[11 * 3 + 2] + joints[12 * 3 + 2]) / 4;
  const J = (i: number): [number, number, number] => [joints[i * 3], joints[i * 3 + 1], joints[i * 3 + 2]];
  const torso: [number, number, number] = [
    (joints[5 * 3] + joints[6 * 3] + joints[11 * 3] + joints[12 * 3]) / 4,
    (joints[5 * 3 + 1] + joints[6 * 3 + 1] + joints[11 * 3 + 1] + joints[12 * 3 + 1]) / 4,
    centreZ,
  ];
  const scatterers: Array<[number, number, number, number]> = [
    [...torso, 0.5],
    [...J(0), 0.1],
    [...J(13), 0.15],
    [...J(14), 0.15],
    [...J(9), 0.05],
    [...J(10), 0.05],
  ];
  return {
    present: true,
    position: [x, y, centreZ],
    velocity: [vx, vy, 0],
    heading,
    posture,
    sitBlend,
    gaitPhase,
    joints,
    scatterers,
    axisBottom: 0.05,
    axisTop: joints[2] + 0.08,
  };
}

function absentState(): SubjectState {
  return {
    present: false,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    heading: 0,
    posture: "standing",
    sitBlend: 0,
    gaitPhase: 0,
    joints: new Float32Array(51),
    scatterers: [],
    axisBottom: 0,
    axisTop: 0,
  };
}

/** COCO-17 joint order. */
export const COCO_JOINTS = [
  "nose", "left_eye", "right_eye", "left_ear", "right_ear",
  "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
  "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
] as const;

export const COCO_BONES: Array<[number, number]> = [
  [0, 1], [0, 2], [1, 3], [2, 4], [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
];

/** Parametric 17-joint skeleton in world coordinates (synthetic ground truth only). */
export function skeleton(x: number, y: number, heading: number, h: number, phase: number, walking: boolean, sit: number): Float32Array {
  const s = h / 1.75;
  const out = new Float32Array(51);
  const ch = Math.cos(heading);
  const sh = Math.sin(heading);
  const swing = walking ? 0.38 * Math.sin(phase) : 0;
  const armSwing = walking ? 0.3 * Math.sin(phase) : 0;
  const hipZStand = 0.52 * h;
  const hipZ = hipZStand + (0.47 - hipZStand) * sit;
  const lift = hipZ - hipZStand;
  const thigh = 0.245 * h;
  const shin = 0.245 * h;
  // local frame: f = forward, l = left, z = up
  const local: Array<[number, number, number]> = [];
  local[0] = [0.09 * s, 0, 0.935 * h + lift];
  local[1] = [0.08 * s, 0.03 * s, 0.955 * h + lift];
  local[2] = [0.08 * s, -0.03 * s, 0.955 * h + lift];
  local[3] = [0.0, 0.075 * s, 0.945 * h + lift];
  local[4] = [0.0, -0.075 * s, 0.945 * h + lift];
  local[5] = [0, 0.2 * s, 0.82 * h + lift];
  local[6] = [0, -0.2 * s, 0.82 * h + lift];
  const upper = 0.17 * h;
  const fore = 0.15 * h;
  for (const [side, sh0, el, wr, sign] of [[1, 5, 7, 9, 1], [-1, 6, 8, 10, -1]] as const) {
    const a = armSwing * -sign;
    const sp = local[sh0];
    const e: [number, number, number] = [sp[0] + upper * Math.sin(a), sp[1] + 0.02 * side * s, sp[2] - upper * Math.cos(a)];
    const forearm = a + (walking ? 0.25 : 0.1) + 0.9 * sit;
    local[el] = e;
    local[wr] = [e[0] + fore * Math.sin(forearm), e[1], e[2] - fore * Math.cos(forearm)];
  }
  local[11] = [0, 0.1 * s, hipZ];
  local[12] = [0, -0.1 * s, hipZ];
  for (const [hip, knee, ankle, sign] of [[11, 13, 15, 1], [12, 14, 16, -1]] as const) {
    const hp = local[hip];
    const thighAngle = swing * sign * (1 - sit) + (Math.PI / 2) * sit;
    const k: [number, number, number] = [hp[0] + thigh * Math.sin(thighAngle), hp[1], hp[2] - thigh * Math.cos(thighAngle)];
    const bend = walking ? Math.max(0, 0.7 * Math.sin(phase * sign + Math.PI / 2)) : 0;
    const shinAngle = thighAngle * (1 - sit) - bend * (1 - sit);
    local[knee] = k;
    local[ankle] = [k[0] + shin * Math.sin(shinAngle), k[1], Math.max(0.03, k[2] - shin * Math.cos(shinAngle))];
  }
  for (let i = 0; i < 17; i++) {
    const [f, l, z] = local[i];
    out[i * 3] = x + f * ch - l * sh;
    out[i * 3 + 1] = y + f * sh + l * ch;
    out[i * 3 + 2] = z;
  }
  return out;
}
