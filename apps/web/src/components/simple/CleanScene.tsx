"use client";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import type { ReconstructionFrame, ScenarioConfig } from "@echospace/schemas";
import { DEFAULT_LAYERS } from "@/lib/store/settings";
import { Room } from "@/components/viewport/layers/Room";
import { Sensors } from "@/components/viewport/layers/Sensors";
import { PointCloud } from "@/components/viewport/layers/Reconstruction";
import { DetectionMarker, SimulatedPerson } from "./Person";

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const LAYERS = { ...DEFAULT_LAYERS, grid: true, axes: false, openings: true, furniture: true, orientation: false, links: false, propagation: false };
const NO_CLIP: THREE.Plane[] = [];

/** Minimal scene: room, sensors, the simulated person and what the system detected. */
export function CleanScene({ frame, config, autoRotate = true }: { frame: ReconstructionFrame | null; config: ScenarioConfig; autoRotate?: boolean }) {
  const { width: W, depth: D, height: H } = config.room;
  const cam = useMemo(() => {
    const R = Math.max(W, D);
    return { pos: new THREE.Vector3(W / 2 - R * 0.75, -R * 0.85, R * 0.95), target: new THREE.Vector3(W / 2, D / 2, H * 0.25) };
  }, [W, D, H]);
  const tracks = frame?.tracks.filter((t) => t.confirmed) ?? [];
  return (
    <Canvas gl={{ antialias: true, preserveDrawingBuffer: true }} dpr={[1, 2]} onCreated={({ gl }) => gl.setClearColor("#080b12")} aria-label="Simulated room">
      <PerspectiveCamera makeDefault fov={40} near={0.05} far={200} position={cam.pos} />
      <OrbitControls makeDefault target={cam.target} enableDamping autoRotate={autoRotate} autoRotateSpeed={0.35} maxPolarAngle={Math.PI / 2.1} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[W, -D, H * 3]} intensity={1.1} />
      <directionalLight position={[-W, D * 2, H * 2]} intensity={0.35} />
      <Room config={config} layers={LAYERS} interactive={false} gridLabels={false} />
      <Sensors config={config} layers={LAYERS} interactive={false} compact />
      {frame && <PointCloud frame={frame} which="filtered" colorBy="confidence" tint="#5fbf8f" size={0.07} density={1} confidenceFilter={0} clip={NO_CLIP} interactive={false} region={null} maxHeight={H} />}
      {frame?.groundTruth?.map((g) => <SimulatedPerson key={g.id} subject={g} />)}
      {tracks.map((t) => <DetectionMarker key={t.id} track={t} />)}
    </Canvas>
  );
}
