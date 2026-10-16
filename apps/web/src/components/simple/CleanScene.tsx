"use client";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { GroundTruthSubject, ReconstructionFrame, ScenarioConfig, Track } from "@echospace/schemas";
import { DEFAULT_LAYERS } from "@/lib/store/settings";
import { Room } from "@/components/viewport/layers/Room";
import { Sensors } from "@/components/viewport/layers/Sensors";
import { PointCloud } from "@/components/viewport/layers/Reconstruction";
import { DetectionMarker, SimulatedPerson } from "./Person";
import { ringHeight } from "./situations";

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const LAYERS = { ...DEFAULT_LAYERS, grid: true, axes: false, openings: true, furniture: true, orientation: false, links: false, propagation: false };
const NO_CLIP: THREE.Plane[] = [];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Ease people and detections from the previous frame to the current one (render mode only). */
function blendSubjects(cur: GroundTruthSubject[], prev: GroundTruthSubject[] | null | undefined, t: number): GroundTruthSubject[] {
  if (!prev || t >= 1) return cur;
  return cur.map((g) => {
    const p = prev.find((q) => q.id === g.id);
    if (!p || p.joints.length !== g.joints.length) return g;
    return { ...g, position: g.position.map((v, i) => mix(p.position[i], v, t)) as typeof g.position, joints: g.joints.map((v, i) => mix(p.joints[i], v, t)) as typeof g.joints };
  });
}
function blendTracks(cur: Track[], prev: Track[] | null | undefined, t: number): Track[] {
  if (!prev || t >= 1) return cur;
  return cur.map((k) => {
    const p = prev.find((q) => q.id === k.id && q.confirmed);
    return p ? { ...k, position: k.position.map((v, i) => mix(p.position[i], v, t)) as typeof k.position } : k;
  });
}

/** Fixed camera on an orbit angle, redrawn on demand; used for frame-by-frame video rendering. */
function CameraRig({ base, target, angle }: { base: THREE.Vector3; target: THREE.Vector3; angle: number }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    const v = base.clone().sub(target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
    camera.position.copy(target).add(v);
    camera.lookAt(target);
    invalidate();
  });
  return null;
}

/** Minimal scene: room, sensors, the simulated person and what the system detected. */
export function CleanScene({ frame, config, autoRotate = true, prev, alpha = 1, angle, floors }: {
  frame: ReconstructionFrame | null;
  config: ScenarioConfig;
  autoRotate?: boolean;
  /** Render mode: previous frame, blend factor towards `frame`, and a fixed orbit angle. */
  prev?: ReconstructionFrame | null;
  alpha?: number;
  angle?: number;
  /** Floor heights for multi-storey scenes. */
  floors?: number[];
}) {
  const { width: W, depth: D, height: H } = config.room;
  const cam = useMemo(() => {
    const R = Math.max(W, D);
    const tall = H > 3.2;
    const k = tall ? 1.2 : 1;
    return { pos: new THREE.Vector3(W / 2 - R * 0.75 * k, -R * 0.85 * k, R * 0.95 * k + (tall ? H * 0.25 : 0)), target: new THREE.Vector3(W / 2, D / 2, H * (tall ? 0.4 : 0.25)) };
  }, [W, D, H]);
  const rendering = angle !== undefined;
  const tracks = blendTracks(frame?.tracks.filter((t) => t.confirmed) ?? [], prev?.tracks, alpha);
  const people = blendSubjects(frame?.groundTruth ?? [], prev?.groundTruth, alpha);
  return (
    <Canvas frameloop={rendering ? "demand" : "always"} gl={{ antialias: true, preserveDrawingBuffer: true }} dpr={rendering ? 1 : [1, 2]} onCreated={({ gl }) => gl.setClearColor("#080b12")} aria-label="Simulated room">
      <PerspectiveCamera makeDefault fov={40} near={0.05} far={200} position={cam.pos} />
      {rendering ? (
        <CameraRig base={cam.pos} target={cam.target} angle={angle} />
      ) : (
        <OrbitControls makeDefault target={cam.target} enableDamping autoRotate={autoRotate} autoRotateSpeed={0.35} maxPolarAngle={Math.PI / 2.1} />
      )}
      <ambientLight intensity={0.6} />
      <directionalLight position={[W, -D, H * 3]} intensity={1.1} />
      <directionalLight position={[-W, D * 2, H * 2]} intensity={0.35} />
      <Room config={config} layers={LAYERS} interactive={false} gridLabels={false} />
      <Sensors config={config} layers={LAYERS} interactive={false} compact />
      {frame && <PointCloud frame={frame} which="filtered" colorBy="confidence" tint="#5fbf8f" size={0.07} density={1} confidenceFilter={0} clip={NO_CLIP} interactive={false} region={null} maxHeight={H} />}
      {people.map((g) => <SimulatedPerson key={g.id} subject={g} />)}
      {tracks.map((t) => <DetectionMarker key={t.id} track={t} floorZ={floors ? ringHeight(floors, t.position[2]) : 0} />)}
    </Canvas>
  );
}
