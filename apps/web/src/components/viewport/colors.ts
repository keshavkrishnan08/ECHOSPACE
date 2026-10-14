import * as THREE from "three";

export const C = {
  signal: new THREE.Color("#2dd4e6"),
  geometry: new THREE.Color("#5b8def"),
  track: new THREE.Color("#a78bfa"),
  ok: new THREE.Color("#5fbf8f"),
  warn: new THREE.Color("#e8b04b"),
  err: new THREE.Color("#e5636a"),
  truth: new THREE.Color("#f2f2f2"),
  line: new THREE.Color("#273244"),
  wall: new THREE.Color("#1b2536"),
};

function lerpStops(stops: Array<[number, THREE.Color]>, t: number, out: THREE.Color) {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      return out.copy(ca).lerp(cb, (x - a) / (b - a || 1));
    }
  }
  return out.copy(stops[stops.length - 1][1]);
}

const HEIGHT: Array<[number, THREE.Color]> = [[0, new THREE.Color("#1f3c88")], [0.5, new THREE.Color("#5b8def")], [0.8, new THREE.Color("#2dd4e6")], [1, new THREE.Color("#d8f6ff")]];
const CONF: Array<[number, THREE.Color]> = [[0, new THREE.Color("#e8b04b")], [0.5, new THREE.Color("#b8b86a")], [1, new THREE.Color("#5fbf8f")]];
const VEL: Array<[number, THREE.Color]> = [[0, new THREE.Color("#3a3f5c")], [0.5, new THREE.Color("#7c6bd6")], [1, new THREE.Color("#e2d9ff")]];
const OCC: Array<[number, THREE.Color]> = [[0, new THREE.Color("#22325a")], [0.6, new THREE.Color("#3f6fd8")], [1, new THREE.Color("#8fc2ff")]];

export const colormap = {
  height: (t: number, out: THREE.Color) => lerpStops(HEIGHT, t, out),
  confidence: (t: number, out: THREE.Color) => lerpStops(CONF, t, out),
  velocity: (t: number, out: THREE.Color) => lerpStops(VEL, t, out),
  occupancy: (t: number, out: THREE.Color) => lerpStops(OCC, t, out),
};

export const GRADIENTS = {
  height: "linear-gradient(90deg,#1f3c88,#5b8def,#2dd4e6,#d8f6ff)",
  confidence: "linear-gradient(90deg,#e8b04b,#b8b86a,#5fbf8f)",
  velocity: "linear-gradient(90deg,#3a3f5c,#7c6bd6,#e2d9ff)",
  occupancy: "linear-gradient(90deg,#22325a,#3f6fd8,#8fc2ff)",
};
