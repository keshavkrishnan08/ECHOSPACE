"use client";
import { Line } from "@react-three/drei";
import { TextSprite } from "../TextSprite";
import { useMemo } from "react";
import * as THREE from "three";
import type { ScenarioConfig } from "@echospace/schemas";
import { MATERIAL_PENETRATION_DB } from "@echospace/schemas";
import type { LayerState } from "@/lib/store/settings";
import { useSession } from "@/lib/store/session";

const WALLS = ["south", "east", "north", "west"] as const;

export function Room({ config, layers, interactive, gridLabels = true }: { config: ScenarioConfig; layers: LayerState; interactive: boolean; gridLabels?: boolean }) {
  const { width: W, depth: D, height: H, wallThickness: T } = config.room;
  const select = useSession((s) => s.select);
  const selection = useSession((s) => s.selection);

  const gridLines = useMemo(() => {
    const minor: number[] = [];
    const major: number[] = [];
    for (let x = 0; x <= W + 1e-6; x += 0.5) (Math.abs(x - Math.round(x)) < 1e-6 ? major : minor).push(x, 0, 0.001, x, D, 0.001);
    for (let y = 0; y <= D + 1e-6; y += 0.5) (Math.abs(y - Math.round(y)) < 1e-6 ? major : minor).push(0, y, 0.001, W, y, 0.001);
    const mk = (a: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(a, 3));
      return g;
    };
    return { minor: mk(minor), major: mk(major) };
  }, [W, D]);

  const wallGeo = (name: (typeof WALLS)[number]): { pos: [number, number, number]; size: [number, number, number] } => {
    switch (name) {
      case "south":
        return { pos: [W / 2, -T / 2, H / 2], size: [W + 2 * T, T, H] };
      case "north":
        return { pos: [W / 2, D + T / 2, H / 2], size: [W + 2 * T, T, H] };
      case "west":
        return { pos: [-T / 2, D / 2, H / 2], size: [T, D, H] };
      case "east":
        return { pos: [W + T / 2, D / 2, H / 2], size: [T, D, H] };
    }
  };

  if (!layers.room) return null;
  return (
    <group>
      {layers.floorCeiling && (
        <>
          <mesh position={[W / 2, D / 2, -0.002]} receiveShadow>
            <planeGeometry args={[W, D]} />
            <meshStandardMaterial color="#0c121c" roughness={1} />
          </mesh>
          <lineSegments position={[0, 0, H]}>
            <edgesGeometry args={[new THREE.PlaneGeometry(W, D).translate(W / 2, D / 2, 0)]} />
            <lineBasicMaterial color="#273244" transparent opacity={0.6} />
          </lineSegments>
        </>
      )}
      {layers.grid && (
        <>
          <lineSegments geometry={gridLines.minor}>
            <lineBasicMaterial color="#1a2332" />
          </lineSegments>
          <lineSegments geometry={gridLines.major}>
            <lineBasicMaterial color="#2a3850" />
          </lineSegments>
          {gridLabels && Array.from({ length: Math.floor(W) + 1 }, (_, i) => (
            <TextSprite key={`gx${i}`} text={`${i} m`} position={[i, -0.25, 0.01]} color="#5c6b81" bg={null} height={0.12} />
          ))}
          {gridLabels && Array.from({ length: Math.floor(D) + 1 }, (_, i) =>
            i === 0 ? null : (
              <TextSprite key={`gy${i}`} text={`${i} m`} position={[-0.3, i, 0.01]} color="#5c6b81" bg={null} height={0.12} />
            ),
          )}
        </>
      )}
      {layers.axes && <axesHelper args={[1]} />}
      {layers.walls &&
        WALLS.map((name) => {
          const g = wallGeo(name);
          const selected = selection.kind === "wall" && selection.name === name;
          return (
            <group key={name} position={g.pos}>
              <mesh
                onClick={interactive ? (e) => { e.stopPropagation(); select({ kind: "wall", name }); } : undefined}
                renderOrder={-1}
              >
                <boxGeometry args={g.size} />
                <meshBasicMaterial color={selected ? "#2dd4e6" : "#1b2536"} transparent opacity={selected ? 0.18 : 0.07} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>
              <lineSegments>
                <edgesGeometry args={[new THREE.BoxGeometry(...g.size)]} />
                <lineBasicMaterial color={selected ? "#2dd4e6" : "#33425a"} transparent opacity={0.8} />
              </lineSegments>
            </group>
          );
        })}
      {layers.openings &&
        config.openings.map((o) => {
          const along = o.wall === "south" || o.wall === "north";
          const y = o.wall === "south" ? 0 : o.wall === "north" ? D : o.offset;
          const x = o.wall === "west" ? 0 : o.wall === "east" ? W : o.offset;
          const zc = o.sill + o.height / 2;
          const hw = o.width / 2;
          const hh = o.height / 2;
          const pts: Array<[number, number, number]> = along
            ? [[x - hw, y, zc - hh], [x + hw, y, zc - hh], [x + hw, y, zc + hh], [x - hw, y, zc + hh], [x - hw, y, zc - hh]]
            : [[x, y - hw, zc - hh], [x, y + hw, zc - hh], [x, y + hw, zc + hh], [x, y - hw, zc + hh], [x, y - hw, zc - hh]];
          return <Line key={o.id} points={pts} color={o.kind === "door" ? "#e8b04b" : "#8fc2ff"} lineWidth={1.5} />;
        })}
      {layers.furniture &&
        config.obstacles.map((o) => {
          const size: [number, number, number] = [o.max[0] - o.min[0], o.max[1] - o.min[1], Math.max(0.02, o.max[2] - o.min[2])];
          const pos: [number, number, number] = [(o.min[0] + o.max[0]) / 2, (o.min[1] + o.max[1]) / 2, (o.min[2] + o.max[2]) / 2];
          const selected = selection.kind === "obstacle" && selection.id === o.id;
          const dense = (o.attenuationDb ?? MATERIAL_PENETRATION_DB[o.material]) >= 8;
          return (
            <group key={o.id} position={pos}>
              <mesh onClick={interactive ? (e) => { e.stopPropagation(); select({ kind: "obstacle", id: o.id }); } : undefined}>
                <boxGeometry args={size} />
                <meshStandardMaterial color={dense ? "#3a3326" : "#1e2a3c"} transparent opacity={selected ? 0.55 : 0.35} roughness={0.9} depthWrite={false} />
              </mesh>
              <lineSegments>
                <edgesGeometry args={[new THREE.BoxGeometry(...size)]} />
                <lineBasicMaterial color={selected ? "#2dd4e6" : dense ? "#8a7146" : "#3c4e6a"} />
              </lineSegments>
            </group>
          );
        })}
    </group>
  );
}
