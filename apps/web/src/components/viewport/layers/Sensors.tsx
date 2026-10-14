"use client";
import { Line } from "@react-three/drei";
import { TextSprite } from "../TextSprite";
import type { ReconstructionFrame, ScenarioConfig } from "@echospace/schemas";
import { antennaPositions, wavelength } from "@echospace/engine";
import type { LayerState } from "@/lib/store/settings";
import { useSession } from "@/lib/store/session";
import type { EngineInfo } from "@/lib/engine/protocol";

export function Sensors({ config, layers, interactive, compact }: { config: ScenarioConfig; layers: LayerState; interactive: boolean; compact?: boolean }) {
  const select = useSession((s) => s.select);
  const selection = useSession((s) => s.selection);
  const lambda = wavelength(config.signal.centerFreqHz);
  if (!layers.sensors) return null;
  return (
    <group>
      {config.sensors.filter((s) => s.enabled).map((s) => {
        const yaw = (s.yawDeg * Math.PI) / 180;
        const selected = selection.kind === "sensor" && selection.id === s.id;
        const color = s.role === "tx" ? "#2dd4e6" : s.role === "rx" ? "#5b8def" : "#7fe3f0";
        const tip: [number, number, number] = [s.position[0] + 0.35 * Math.cos(yaw), s.position[1] + 0.35 * Math.sin(yaw), s.position[2]];
        return (
          <group key={s.id}>
            <mesh position={s.position} onClick={interactive ? (e) => { e.stopPropagation(); select({ kind: "sensor", id: s.id }); } : undefined}>
              <octahedronGeometry args={[selected ? 0.11 : 0.08]} />
              <meshBasicMaterial color={selected ? "#ffffff" : color} />
            </mesh>
            <Line points={[[s.position[0], s.position[1], 0], s.position]} color="#33425a" lineWidth={1} dashed dashSize={0.05} gapSize={0.05} />
            {layers.orientation && <Line points={[s.position, tip]} color={color} lineWidth={1.5} transparent opacity={0.8} />}
            {layers.orientation && antennaPositions(s, lambda).map((a, i) => (
              <mesh key={i} position={a}>
                <sphereGeometry args={[0.015]} />
                <meshBasicMaterial color="#d8f6ff" />
              </mesh>
            ))}
            {!compact && (
              <TextSprite text={s.id} position={[s.position[0], s.position[1], s.position[2] + 0.22]} color="#2dd4e6" height={0.12} />
            )}
          </group>
        );
      })}
    </group>
  );
}

/** Link lines; when the signal overlay is on, colour/opacity encode the calibrated attenuation ΔRSS. */
export function Links({ info, config, frame, layers, selectedLink }: { info: EngineInfo | null; config: ScenarioConfig; frame: ReconstructionFrame | null; layers: LayerState; selectedLink: number }) {
  if (!info || (!layers.links && !layers.signalOverlay)) return null;
  const byId = new Map(config.sensors.map((s) => [s.id, s.position]));
  return (
    <group>
      {info.links.map((l) => {
        const a = byId.get(l.txId);
        const b = byId.get(l.rxId);
        if (!a || !b) return null;
        const d = frame?.features.deltaRssDb[l.index];
        const atten = Number.isFinite(d) ? Math.max(0, Math.min(1, (d as number) / 6)) : 0;
        const sel = l.index === selectedLink;
        const color = layers.signalOverlay ? (atten > 0.15 ? "#e8b04b" : "#2dd4e6") : sel ? "#2dd4e6" : "#3c4e6a";
        const opacity = layers.signalOverlay ? 0.15 + 0.85 * atten : sel ? 0.9 : 0.35;
        return <Line key={l.id} points={[a, b]} color={color} lineWidth={sel ? 1.6 : 1} transparent opacity={opacity} />;
      })}
    </group>
  );
}

export function Propagation({ frame, layers }: { frame: ReconstructionFrame | null; layers: LayerState }) {
  if (!layers.propagation || !frame?.propagation) return null;
  const maxA = Math.max(1e-9, ...frame.propagation.map((p) => p.amplitude));
  return (
    <group>
      {frame.propagation.map((p, i) => {
        const rel = p.amplitude / maxA;
        const color = p.kind === "los" ? "#2dd4e6" : p.kind === "reflection" ? "#5b8def" : "#a78bfa";
        return (
          <Line
            key={i}
            points={p.points}
            color={color}
            lineWidth={p.kind === "los" ? 1.8 : 1.2}
            transparent
            opacity={0.25 + 0.7 * Math.sqrt(rel)}
            dashed={p.kind === "reflection"}
            dashSize={0.12}
            gapSize={0.08}
          />
        );
      })}
    </group>
  );
}
