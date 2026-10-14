import type { LinkDescriptor, Opening, Room, ScenarioConfig, SensorNode, Vec3 } from "@echospace/schemas";
import { MATERIAL_REFLECTIVITY } from "@echospace/schemas";
import { C_LIGHT, dist } from "./geometry";

export function wavelength(centerFreqHz: number) {
  return C_LIGHT / centerFreqHz;
}

const canTx = (s: SensorNode) => s.role === "tx" || s.role === "trx";
const canRx = (s: SensorNode) => s.role === "rx" || s.role === "trx";

/** Enumerates directed Tx→Rx links. A pair of transceivers forms a single link (lower index transmits). */
export function buildLinks(sensors: SensorNode[]): LinkDescriptor[] {
  const active = sensors.filter((s) => s.enabled);
  const links: LinkDescriptor[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = 0; j < active.length; j++) {
      if (i === j) continue;
      const a = active[i];
      const b = active[j];
      if (!canTx(a) || !canRx(b)) continue;
      if (a.role === "trx" && b.role === "trx" && j < i) continue;
      links.push({
        index: links.length,
        id: `${a.id}>${b.id}`,
        txId: a.id,
        rxId: b.id,
        tx: a.position,
        rx: b.position,
        lengthM: dist(a.position, b.position),
        antennas: b.antennas,
      });
    }
  }
  return links;
}

/** Positions of a receiver's antenna elements (uniform linear array, λ/2 spacing, perpendicular to boresight). */
export function antennaPositions(sensor: SensorNode, lambda: number): Vec3[] {
  const yaw = (sensor.yawDeg * Math.PI) / 180;
  const ax = -Math.sin(yaw);
  const ay = Math.cos(yaw);
  const out: Vec3[] = [];
  const m0 = (sensor.antennas - 1) / 2;
  for (let m = 0; m < sensor.antennas; m++) {
    const o = (m - m0) * (lambda / 2);
    out.push([sensor.position[0] + ax * o, sensor.position[1] + ay * o, sensor.position[2]]);
  }
  return out;
}

export interface Surface {
  name: "south" | "east" | "north" | "west" | "floor" | "ceiling";
  /** Axis normal to the surface and its coordinate. */
  axis: 0 | 1 | 2;
  value: number;
  reflectivity: number;
}

/** Room surfaces in a fixed order: south, east, north, west, floor, ceiling. */
export function roomSurfaces(room: Room): Surface[] {
  const g = room.wallReflectivity ?? MATERIAL_REFLECTIVITY[room.wallMaterial];
  return [
    { name: "south", axis: 1, value: 0, reflectivity: g },
    { name: "east", axis: 0, value: room.width, reflectivity: g },
    { name: "north", axis: 1, value: room.depth, reflectivity: g },
    { name: "west", axis: 0, value: 0, reflectivity: g },
    { name: "floor", axis: 2, value: 0, reflectivity: Math.min(1, g * 1.2) },
    { name: "ceiling", axis: 2, value: room.height, reflectivity: g * 0.8 },
  ];
}

export function mirror(p: Vec3, s: Surface): Vec3 {
  const q: Vec3 = [p[0], p[1], p[2]];
  q[s.axis] = 2 * s.value - p[s.axis];
  return q;
}

/** Returns the reflectivity multiplier at a wall hit point, accounting for doors (open) and windows (glass). */
export function openingReflectivity(openings: Opening[], s: Surface, hit: Vec3, base: number): number {
  if (s.axis === 2) return base;
  for (const o of openings) {
    if (o.wall !== s.name) continue;
    const along = s.name === "south" || s.name === "north" ? hit[0] : hit[1];
    if (Math.abs(along - o.offset) <= o.width / 2 && hit[2] >= o.sill && hit[2] <= o.sill + o.height) {
      return o.kind === "door" ? 0 : MATERIAL_REFLECTIVITY.glass;
    }
  }
  return base;
}

export interface VoxelGrid {
  nx: number;
  ny: number;
  nz: number;
  size: number;
  origin: Vec3;
  count: number;
  centers: Float64Array;
}

export function buildGrid(room: Room, voxelSize: number): VoxelGrid {
  const nx = Math.max(1, Math.round(room.width / voxelSize));
  const ny = Math.max(1, Math.round(room.depth / voxelSize));
  const nz = Math.max(1, Math.round(room.height / voxelSize));
  const sx = room.width / nx;
  const sy = room.depth / ny;
  const sz = room.height / nz;
  const count = nx * ny * nz;
  const centers = new Float64Array(count * 3);
  let idx = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        centers[idx * 3] = (i + 0.5) * sx;
        centers[idx * 3 + 1] = (j + 0.5) * sy;
        centers[idx * 3 + 2] = (k + 0.5) * sz;
        idx++;
      }
  return { nx, ny, nz, size: voxelSize, origin: [0, 0, 0], count, centers };
}

export function sensorById(config: ScenarioConfig, id: string): SensorNode {
  const s = config.sensors.find((x) => x.id === id);
  if (!s) throw new Error(`unknown sensor ${id}`);
  return s;
}

/** Short stable hash (FNV-1a 32-bit, hex) of a JSON-serializable value with sorted keys. */
export function stableHash(value: unknown): string {
  const json = canonicalJson(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}
