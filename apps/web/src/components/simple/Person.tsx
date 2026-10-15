"use client";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { COCO_BONES } from "@echospace/engine";
import type { GroundTruthSubject, Track } from "@echospace/schemas";

const UP = new THREE.Vector3(0, 0, 1);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpD = new THREE.Vector3();

/** Solid figure built from the simulator's 17-joint ground truth: capsules along bones plus a head. */
export function SimulatedPerson({ subject }: { subject: GroundTruthSubject }) {
  const bones = useRef<Array<THREE.Mesh | null>>([]);
  const head = useRef<THREE.Mesh>(null);
  const torso = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#e9edf3", roughness: 0.55, metalness: 0.05 }), []);
  const s = subject.heightM / 1.75;
  const limbGeo = useMemo(() => new THREE.CylinderGeometry(0.045 * s, 0.045 * s, 1, 10).rotateX(Math.PI / 2), [s]);
  const torsoGeo = useMemo(() => new THREE.CylinderGeometry(0.16 * s, 0.13 * s, 1, 16).rotateX(Math.PI / 2), [s]);
  const j = subject.joints;
  useLayoutEffect(() => {
    const p = (i: number, v: THREE.Vector3) => v.set(j[i * 3], j[i * 3 + 1], j[i * 3 + 2]);
    COCO_BONES.forEach(([a, b], k) => {
      const m = bones.current[k];
      if (!m) return;
      if (a <= 4 || b <= 4) {
        m.visible = false;
        return;
      }
      p(a, tmpA);
      p(b, tmpB);
      tmpD.subVectors(tmpB, tmpA);
      const len = tmpD.length();
      m.visible = len > 1e-3;
      m.position.copy(tmpA).addScaledVector(tmpD, 0.5);
      m.quaternion.setFromUnitVectors(UP, tmpD.normalize());
      m.scale.set(1, 1, len);
    });
    if (head.current) {
      head.current.position.set((j[3 * 3] + j[4 * 3]) / 2, (j[3 * 3 + 1] + j[4 * 3 + 1]) / 2, (j[3 * 3 + 2] + j[4 * 3 + 2]) / 2);
    }
    if (torso.current) {
      p(5, tmpA).add(p(6, tmpD)).multiplyScalar(0.5);
      p(11, tmpB).add(p(12, tmpD)).multiplyScalar(0.5);
      tmpD.subVectors(tmpA, tmpB);
      const len = tmpD.length();
      torso.current.position.copy(tmpB).addScaledVector(tmpD, 0.5);
      torso.current.quaternion.setFromUnitVectors(UP, tmpD.normalize());
      torso.current.scale.set(1, 1, len);
    }
  }, [j]);
  return (
    <group>
      {COCO_BONES.map((_, k) => (
        <mesh key={k} ref={(m) => void (bones.current[k] = m)} material={material} geometry={limbGeo} />
      ))}
      <mesh ref={torso} material={material} geometry={torsoGeo} />
      <mesh ref={head} material={material}>
        <sphereGeometry args={[0.11 * s, 20, 16]} />
      </mesh>
      <mesh position={[subject.position[0], subject.position[1], 0.005]} rotation={[0, 0, 0]}>
        <circleGeometry args={[0.28, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

/** What ECHOSPACE detected: a ring on the floor sized by 2σ uncertainty and a soft beam. */
export function DetectionMarker({ track }: { track: Track }) {
  const r = Math.max(0.25, 2 * Math.sqrt(Math.max(track.covariance[0], track.covariance[2])));
  const [x, y] = track.position;
  return (
    <group position={[x, y, 0]}>
      <mesh position={[0, 0, 0.02]}>
        <ringGeometry args={[r * 0.9, r, 48]} />
        <meshBasicMaterial color="#a78bfa" transparent opacity={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 0.015]}>
        <circleGeometry args={[r * 0.9, 48]} />
        <meshBasicMaterial color="#a78bfa" transparent opacity={0.12} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 1.1]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 2.2, 8]} />
        <meshBasicMaterial color="#a78bfa" transparent opacity={0.45} />
      </mesh>
    </group>
  );
}
