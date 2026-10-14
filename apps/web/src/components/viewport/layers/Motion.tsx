"use client";
import { Line } from "@react-three/drei";
import { TextSprite } from "../TextSprite";
import { useMemo } from "react";
import * as THREE from "three";
import { COCO_BONES } from "@echospace/engine";
import type { ReconstructionFrame } from "@echospace/schemas";
import type { LayerState } from "@/lib/store/settings";
import { useSession } from "@/lib/store/session";
import { covarianceEllipse } from "../geometry";

export function Tracks({ frame, layers, coarse, interactive }: { frame: ReconstructionFrame; layers: LayerState; coarse: boolean; interactive: boolean }) {
  const select = useSession((s) => s.select);
  const selection = useSession((s) => s.selection);
  if (!layers.tracks) return null;
  return (
    <group>
      {frame.tracks.map((t) => {
        const selected = selection.kind === "track" && selection.id === t.id;
        const col = t.confirmed ? "#a78bfa" : "#6b5aa8";
        const [x, y] = t.position;
        const z = Math.max(0.2, t.position[2]);
        const ell = covarianceEllipse(t.covariance, 2).map(([dx, dy]) => [x + dx, y + dy, 0.02] as [number, number, number]);
        const speed = Math.hypot(t.velocity[0], t.velocity[1]);
        return (
          <group key={t.id}>
            <mesh position={[x, y, z]} onClick={interactive ? (e) => { e.stopPropagation(); select({ kind: "track", id: t.id }); } : undefined}>
              <sphereGeometry args={[coarse ? 0.22 : selected ? 0.14 : 0.11, 20, 14]} />
              <meshStandardMaterial color={col} emissive={col} emissiveIntensity={selected ? 0.6 : 0.25} transparent opacity={t.confirmed ? 0.95 : 0.45} />
            </mesh>
            <Line points={[[x, y, 0.02], [x, y, z]]} color={col} lineWidth={1} transparent opacity={0.5} />
            {layers.uncertainty && <Line points={ell} color={col} lineWidth={1.2} transparent opacity={0.8} />}
            {layers.velocity && !coarse && speed > 0.05 && (
              <Line points={[[x, y, z], [x + t.velocity[0] * 0.6, y + t.velocity[1] * 0.6, z]]} color="#e2d9ff" lineWidth={2} />
            )}
            {layers.trails && !coarse && t.trail.length > 1 && <Line points={t.trail.map((p) => [p[0], p[1], 0.03] as [number, number, number])} color={col} lineWidth={1.5} transparent opacity={0.6} />}
            {layers.trackIds && (
              <TextSprite text={`${t.id}${t.confirmed ? "" : " ?"}`} position={[x, y, z + 0.32]} color="#a78bfa" border="rgba(167,139,250,0.5)" height={0.13} />
            )}
          </group>
        );
      })}
    </group>
  );
}

function DashedCylinder({ x, y, r, h }: { x: number; y: number; r: number; h: number }) {
  const geo = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const n = 32;
    for (const z of [0.01, h]) {
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        pts.push(new THREE.Vector3(r * Math.cos(a0), r * Math.sin(a0), z), new THREE.Vector3(r * Math.cos(a1), r * Math.sin(a1), z));
      }
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      pts.push(new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), 0.01), new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), h));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return g;
  }, [r, h]);
  const line = useMemo(() => {
    const l = new THREE.LineSegments(geo, new THREE.LineDashedMaterial({ color: "#f2f2f2", dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0.75 }));
    l.computeLineDistances();
    return l;
  }, [geo]);
  return <primitive object={line} position={[x, y, 0]} />;
}

/** Synthetic ground truth: always dashed white outlines, never solid like inferred output. */
export function GroundTruth({ frame, layers, showSkeleton }: { frame: ReconstructionFrame; layers: LayerState; showSkeleton: boolean }) {
  if (!layers.groundTruth || !frame.groundTruth) return null;
  return (
    <group>
      {frame.groundTruth.map((g) => {
        const top = Math.max(...Array.from({ length: 17 }, (_, i) => g.joints[i * 3 + 2])) + 0.08;
        return (
          <group key={g.id}>
            <DashedCylinder x={g.position[0]} y={g.position[1]} r={g.radiusM} h={top} />
            {showSkeleton && layers.groundTruthSkeleton &&
              COCO_BONES.map(([a, b], i) => (
                <Line
                  key={i}
                  points={[[g.joints[a * 3], g.joints[a * 3 + 1], g.joints[a * 3 + 2]], [g.joints[b * 3], g.joints[b * 3 + 1], g.joints[b * 3 + 2]]]}
                  color="#f2f2f2"
                  lineWidth={1.4}
                  dashed
                  dashSize={0.04}
                  gapSize={0.03}
                  transparent
                  opacity={0.85}
                />
              ))}
            <TextSprite text={`GT ${g.label} (synthetic)`} position={[g.position[0], g.position[1], top + 0.18]} color="#f2f2f2" border="rgba(242,242,242,0.45)" height={0.12} />
          </group>
        );
      })}
    </group>
  );
}
