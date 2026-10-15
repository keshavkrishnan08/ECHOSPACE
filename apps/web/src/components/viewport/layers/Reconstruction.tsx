"use client";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import type { ReconstructionFrame, ScenarioConfig } from "@echospace/schemas";
import type { ColorBy, LayerState } from "@/lib/store/settings";
import { useSession } from "@/lib/store/session";
import { colormap } from "../colors";
import { pointInPolygon } from "../geometry";

const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

function gridSteps(f: ReconstructionFrame, config: ScenarioConfig) {
  return { sx: config.room.width / f.grid.nx, sy: config.room.depth / f.grid.ny, sz: config.room.height / f.grid.nz };
}

export function OccupancyVoxels({ frame, config, threshold, confidence, clip, interactive }: { frame: ReconstructionFrame; config: ScenarioConfig; threshold: number; confidence: number; clip: THREE.Plane[]; interactive: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const indexMap = useRef<Int32Array>(new Int32Array(0));
  const capacity = frame.grid.nx * frame.grid.ny * frame.grid.nz;
  const select = useSession((s) => s.select);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.55, roughness: 0.6, metalness: 0, depthWrite: false }), []);
  useEffect(() => {
    material.clippingPlanes = clip;
    material.needsUpdate = true;
  }, [clip, material]);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const { nx, ny } = frame.grid;
    const { sx, sy, sz } = gridSteps(frame, config);
    if (indexMap.current.length !== capacity) indexMap.current = new Int32Array(capacity);
    let n = 0;
    for (let i = 0; i < frame.occupancy.length; i++) {
      const p = frame.occupancy[i];
      const conf = 1 - frame.varianceRatio[i];
      if (p < threshold || conf < confidence || frame.varianceRatio[i] > 0.95) continue;
      const ix = i % nx;
      const iy = Math.floor(i / nx) % ny;
      const iz = Math.floor(i / (nx * ny));
      const s = 0.55 + 0.4 * p;
      tmpV.set((ix + 0.5) * sx, (iy + 0.5) * sy, (iz + 0.5) * sz);
      tmpS.set(sx * s, sy * s, sz * s);
      tmpM.compose(tmpV, tmpQ, tmpS);
      m.setMatrixAt(n, tmpM);
      colormap.occupancy((p - threshold) / Math.max(1e-6, 1 - threshold), tmpC);
      m.setColorAt(n, tmpC);
      indexMap.current[n] = i;
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [frame, config, threshold, confidence, capacity]);
  return (
    <instancedMesh
      key={capacity}
      ref={ref}
      args={[undefined, material, capacity]}
      frustumCulled={false}
      onClick={interactive ? (e) => { e.stopPropagation(); if (e.instanceId !== undefined) select({ kind: "voxel", index: indexMap.current[e.instanceId], seq: frame.seq }); } : undefined}
    >
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
}

/** Voxel centres whose posterior variance ratio is ≥ 0.8: the links do not constrain them. */
export function UnobservedOverlay({ frame, config }: { frame: ReconstructionFrame; config: ScenarioConfig }) {
  const geo = useMemo(() => {
    const { nx, ny } = frame.grid;
    const { sx, sy, sz } = gridSteps(frame, config);
    const pts: number[] = [];
    for (let i = 0; i < frame.varianceRatio.length; i++) {
      if (frame.varianceRatio[i] < 0.8) continue;
      pts.push(((i % nx) + 0.5) * sx, ((Math.floor(i / nx) % ny) + 0.5) * sy, (Math.floor(i / (nx * ny)) + 0.5) * sz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
    // coverage only changes with geometry; recompute when the variance buffer identity changes
  }, [frame.varianceRatio, frame.grid, config]);
  return (
    <points geometry={geo}>
      <pointsMaterial color="#e8b04b" size={0.035} sizeAttenuation transparent opacity={0.28} depthWrite={false} />
    </points>
  );
}

export function PointCloud({ frame, which, colorBy, size, density, confidenceFilter, clip, interactive, region, maxHeight, tint }: {
  frame: ReconstructionFrame;
  which: "raw" | "filtered";
  colorBy: ColorBy;
  /** Single colour for every point; overrides colorBy. */
  tint?: string;
  size: number;
  density: number;
  confidenceFilter: number;
  clip: THREE.Plane[];
  interactive: boolean;
  region: Array<[number, number]> | null;
  maxHeight: number;
}) {
  const CAP = 60000;
  const ref = useRef<THREE.Points>(null);
  const select = useSession((s) => s.select);
  const map = useRef(new Int32Array(CAP));
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const mat = useMemo(() => new THREE.PointsMaterial({ size, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: which === "raw" ? 0.55 : 0.95, depthWrite: false }), [which, size]);
  useEffect(() => {
    mat.clippingPlanes = clip;
    mat.needsUpdate = true;
  }, [clip, mat]);
  useEffect(() => {
    const src = which === "raw" ? frame.pointsRaw : frame.pointsFiltered;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const col = geo.getAttribute("color") as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const Cc = col.array as Float32Array;
    const total = src.length / 5;
    const stride = density >= 1 ? 1 : Math.max(1, Math.round(1 / Math.max(0.02, density)));
    const confirmed = frame.tracks.filter((t) => t.confirmed);
    let n = 0;
    for (let i = 0; i < total && n < CAP; i += stride) {
      const x = src[i * 5];
      const y = src[i * 5 + 1];
      const z = src[i * 5 + 2];
      const conf = src[i * 5 + 3];
      if (which === "filtered" && conf < confidenceFilter) continue;
      if (region && !pointInPolygon(x, y, region)) continue;
      P[n * 3] = x;
      P[n * 3 + 1] = y;
      P[n * 3 + 2] = z;
      if (tint) tmpC.set(tint);
      else if (which === "raw") tmpC.set("#7a8ba3");
      else if (colorBy === "height") colormap.height(z / maxHeight, tmpC);
      else if (colorBy === "confidence") colormap.confidence(conf, tmpC);
      else {
        let speed = 0;
        for (const t of confirmed) if (Math.hypot(t.position[0] - x, t.position[1] - y) < 0.6) speed = Math.hypot(t.velocity[0], t.velocity[1]);
        colormap.velocity(speed / 1.5, tmpC);
      }
      Cc[n * 3] = tmpC.r;
      Cc[n * 3 + 1] = tmpC.g;
      Cc[n * 3 + 2] = tmpC.b;
      map.current[n] = i;
      n++;
    }
    geo.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geo.computeBoundingSphere();
  }, [frame, which, colorBy, density, confidenceFilter, geo, region, maxHeight, tint]);
  return (
    <points
      ref={ref}
      geometry={geo}
      material={mat}
      frustumCulled={false}
      onClick={interactive ? (e) => { e.stopPropagation(); if (e.index !== undefined) select({ kind: "point", index: map.current[e.index], set: which, seq: frame.seq }); } : undefined}
    />
  );
}

/** Iso-surface of the occupancy field via marching cubes (three.js MarchingCubes, 28³ samples). */
export function Surface({ frame, config, threshold }: { frame: ReconstructionFrame; config: ScenarioConfig; threshold: number }) {
  const RES = 28;
  const mc = useMemo(() => {
    const m = new MarchingCubes(RES, new THREE.MeshStandardMaterial({ color: "#5b8def", transparent: true, opacity: 0.35, roughness: 0.5, side: THREE.DoubleSide, depthWrite: false }), false, false, 60000);
    m.isolation = 0.5;
    return m;
  }, []);
  useEffect(() => {
    const { nx, ny, nz } = frame.grid;
    const f = mc.field as Float32Array;
    for (let k = 0; k < RES; k++)
      for (let j = 0; j < RES; j++)
        for (let i = 0; i < RES; i++) {
          const gx = Math.min(nx - 1, Math.floor((i / (RES - 1)) * nx));
          const gy = Math.min(ny - 1, Math.floor((j / (RES - 1)) * ny));
          const gz = Math.min(nz - 1, Math.floor((k / (RES - 1)) * nz));
          const edge = i === 0 || j === 0 || k === 0 || i === RES - 1 || j === RES - 1 || k === RES - 1;
          const v = edge ? 0 : frame.occupancy[gx + nx * (gy + ny * gz)];
          f[i + RES * (j + RES * k)] = v;
        }
    mc.isolation = threshold;
    mc.update();
  }, [frame, mc, threshold]);
  const { width: W, depth: D, height: H } = config.room;
  return <primitive object={mc} position={[W / 2, D / 2, H / 2]} scale={[W / 2, D / 2, H / 2]} />;
}
