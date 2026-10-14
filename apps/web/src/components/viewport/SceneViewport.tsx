"use client";
import { Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ReconstructionFrame, ScenarioConfig } from "@echospace/schemas";
import { useSettings } from "@/lib/store/settings";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import type { EngineInfo } from "@/lib/engine/protocol";
import { downloadBlob } from "@/lib/format";
import { Room } from "./layers/Room";
import { Links, Propagation, Sensors } from "./layers/Sensors";
import { OccupancyVoxels, PointCloud, Surface, UnobservedOverlay } from "./layers/Reconstruction";
import { GroundTruth, Tracks } from "./layers/Motion";
import { boxPolygon } from "./geometry";
import { Legend } from "./Legend";
import { ViewportToolbar, type Tool } from "./Toolbar";
import { exportPly, exportSceneJson } from "./exporters";

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

type OrbitControlsImpl = React.ComponentRef<typeof OrbitControls>;

export interface ViewportProps {
  frame: ReconstructionFrame | null;
  config: ScenarioConfig;
  info: EngineInfo | null;
  variant?: "full" | "preview";
  className?: string;
  /** Optional per-viewport layer override (e.g. side-by-side comparisons). */
  layerOverride?: Partial<import("@/lib/store/settings").LayerState>;
  syncCamera?: { position: THREE.Vector3; target: THREE.Vector3; version: number } | null;
  onCamera?: (position: THREE.Vector3, target: THREE.Vector3) => void;
  hideToolbar?: boolean;
  title?: string;
}

function presetPose(preset: "iso" | "top" | "front" | "side" | "reset", c: ScenarioConfig) {
  const { width: W, depth: D, height: H } = c.room;
  const target = new THREE.Vector3(W / 2, D / 2, H * 0.35);
  const R = Math.max(W, D) * 1.35;
  switch (preset) {
    case "top":
      return { pos: new THREE.Vector3(W / 2, D / 2 - 0.001, R * 1.4), target: new THREE.Vector3(W / 2, D / 2, 0) };
    case "front":
      return { pos: new THREE.Vector3(W / 2, -R, H * 0.55), target };
    case "side":
      return { pos: new THREE.Vector3(W + R, D / 2, H * 0.55), target };
    default:
      return { pos: new THREE.Vector3(W / 2 - R * 0.55, -R * 0.65, R * 0.75), target };
  }
}

function CameraRig({ config, controls, syncCamera, onCamera }: { config: ScenarioConfig; controls: React.RefObject<OrbitControlsImpl | null>; syncCamera?: ViewportProps["syncCamera"]; onCamera?: ViewportProps["onCamera"] }) {
  const camera = useThree((s) => s.camera);
  const viewCommand = useUi((s) => s.viewCommand);
  const roomKey = `${config.room.width}x${config.room.depth}x${config.room.height}`;
  const apply = (preset: "iso" | "top" | "front" | "side" | "reset") => {
    const p = presetPose(preset, config);
    camera.position.copy(p.pos);
    camera.up.set(0, 0, 1);
    if (preset === "top") camera.up.set(0, 1, 0);
    camera.lookAt(p.target);
    if (controls.current) {
      controls.current.target.copy(p.target);
      controls.current.update();
    }
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = 60;
      camera.updateProjectionMatrix();
    }
  };
  useEffect(() => {
    apply("iso");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey, camera]);
  useEffect(() => {
    if (viewCommand?.cmd.kind === "camera") apply(viewCommand.cmd.preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewCommand]);
  useEffect(() => {
    if (!syncCamera || !controls.current) return;
    camera.position.copy(syncCamera.position);
    controls.current.target.copy(syncCamera.target);
    controls.current.update();
  }, [syncCamera, camera, controls]);
  useEffect(() => {
    const c = controls.current;
    if (!c || !onCamera) return;
    const h = () => onCamera(camera.position.clone(), c.target.clone());
    c.addEventListener("end", h);
    return () => c.removeEventListener("end", h);
  }, [controls, camera, onCamera]);
  return null;
}

function Capture({ onReady }: { onReady: (gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    onReady(gl, scene, camera);
  }, [gl, scene, camera, onReady]);
  return null;
}

export function SceneViewport({ frame, config, info, variant = "full", className, layerOverride, syncCamera, onCamera, hideToolbar, title }: ViewportProps) {
  const settings = useSettings();
  const layers = { ...settings.layers, ...(layerOverride ?? {}) };
  const selection = useSession((s) => s.selection);
  const select = useSession((s) => s.select);
  const selectedLink = useSession((s) => s.selectedLink);
  const viewCommand = useUi((s) => s.viewCommand);
  const interactive = variant === "full";
  const controls = useRef<OrbitControlsImpl | null>(null);
  const glRef = useRef<{ gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera } | null>(null);
  const [tool, setTool] = useState<Tool>("orbit");
  const [cursor, setCursor] = useState<[number, number, number] | null>(null);
  const [drag, setDrag] = useState<Array<[number, number]> | null>(null);
  const [measure, setMeasure] = useState<Array<[number, number, number]>>([]);
  const [isolate, setIsolate] = useState(false);
  const coarse = config.privacy.mode === "coarse";
  const { width: W, depth: D, height: H } = config.room;

  const clip = useMemo(() => {
    if (!settings.clipping.enabled) return [] as THREE.Plane[];
    const n = settings.clipping.axis === "x" ? new THREE.Vector3(-1, 0, 0) : settings.clipping.axis === "y" ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, -1);
    return [new THREE.Plane(n, settings.clipping.value)];
  }, [settings.clipping.enabled, settings.clipping.axis, settings.clipping.value]);

  useEffect(() => {
    if (!viewCommand || !interactive) return;
    const g = glRef.current;
    if (viewCommand.cmd.kind === "screenshot" && g) {
      g.gl.render(g.scene, g.camera);
      g.gl.domElement.toBlob((b) => b && downloadBlob(`echospace_view_${frame?.provenance.sourceMode ?? "none"}_t${frame?.timestampS.toFixed(1) ?? 0}.png`, b, "image/png"));
    }
    if (viewCommand.cmd.kind === "export-scene") downloadBlob(`echospace_scene_${config.scenario}_${config.seed}.json`, exportSceneJson(config, frame), "application/json");
  }, [viewCommand, interactive, frame, config]);

  const region = selection.kind === "region" ? selection.polygon : null;
  const onCaptureReady = useCallback((gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => {
    glRef.current = { gl, scene, camera };
  }, []);

  const floorEvent = (e: ThreeEvent<PointerEvent>): [number, number, number] => [e.point.x, e.point.y, e.point.z];
  const onFloorDown = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive) return;
    const p = floorEvent(e);
    if (tool === "box" || tool === "lasso") {
      e.stopPropagation();
      (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
      setDrag([[p[0], p[1]]]);
    } else if (tool === "measure") {
      e.stopPropagation();
      setMeasure((m) => (m.length >= 2 ? [p] : [...m, p]));
    } else if (tool === "select") {
      select({ kind: "none" });
    }
  };
  const onFloorMove = (e: ThreeEvent<PointerEvent>) => {
    const p = floorEvent(e);
    setCursor(p);
    if (drag && (tool === "box" || tool === "lasso")) {
      if (tool === "box") setDrag([drag[0], [p[0], p[1]]]);
      else {
        const last = drag[drag.length - 1];
        if (Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.08) setDrag([...drag, [p[0], p[1]]]);
      }
    }
  };
  const onFloorUp = () => {
    if (!drag) return;
    if (tool === "box" && drag.length === 2) select({ kind: "region", polygon: boxPolygon(drag[0], drag[1]), mode: "box" });
    if (tool === "lasso" && drag.length >= 3) select({ kind: "region", polygon: drag, mode: "lasso" });
    setDrag(null);
  };

  const dragOutline: Array<[number, number, number]> | null = drag
    ? tool === "box" && drag.length === 2
      ? [...boxPolygon(drag[0], drag[1]), boxPolygon(drag[0], drag[1])[0]].map(([x, y]) => [x, y, 0.03])
      : drag.map(([x, y]) => [x, y, 0.03])
    : null;

  return (
    <div className={`relative h-full w-full overflow-hidden bg-bg ${className ?? ""}`} data-testid={variant === "full" ? "viewport" : "viewport-preview"}>
      <Canvas
        gl={{ antialias: true, preserveDrawingBuffer: true, localClippingEnabled: true, alpha: false }}
        dpr={[1, 2]}
        onCreated={({ gl }) => {
          gl.setClearColor("#080b12");
          gl.localClippingEnabled = true;
        }}
        onPointerMissed={() => interactive && tool === "select" && select({ kind: "none" })}
        aria-label="3D reconstruction viewport"
      >
        {settings.orthographic ? <OrthographicCamera makeDefault zoom={60} near={-100} far={200} position={[0, 0, 10]} /> : <PerspectiveCamera makeDefault fov={45} near={0.05} far={200} position={[0, 0, 10]} />}
        <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} enabled={tool === "orbit" || tool === "select" || tool === "measure"} enableRotate={tool === "orbit" || tool === "select" || tool === "measure"} />
        <CameraRig config={config} controls={controls} syncCamera={syncCamera} onCamera={onCamera} />
        <Capture onReady={onCaptureReady} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[W, -D, H * 3]} intensity={0.9} />
        <Room config={config} layers={layers} interactive={interactive} />
        <Sensors config={config} layers={layers} interactive={interactive} compact={variant === "preview"} />
        <Links info={info} config={config} frame={frame} layers={layers} selectedLink={selectedLink} />
        <Propagation frame={frame} layers={layers} />
        {frame && (
          <>
            {layers.unobserved && <UnobservedOverlay frame={frame} config={config} />}
            {layers.occupancy && <OccupancyVoxels frame={frame} config={config} threshold={settings.occupancyThresholdView} confidence={settings.confidenceFilter} clip={clip} interactive={interactive} />}
            {layers.surface && <Surface frame={frame} config={config} threshold={settings.occupancyThresholdView} />}
            {layers.pointsRaw && <PointCloud frame={frame} which="raw" colorBy={settings.colorBy} size={settings.pointSize * 0.8} density={settings.pointDensity} confidenceFilter={0} clip={clip} interactive={interactive} region={isolate ? region : null} maxHeight={H} />}
            {layers.pointsFiltered && <PointCloud frame={frame} which="filtered" colorBy={settings.colorBy} size={settings.pointSize} density={settings.pointDensity} confidenceFilter={settings.confidenceFilter} clip={clip} interactive={interactive} region={isolate ? region : null} maxHeight={H} />}
            <Tracks frame={frame} layers={layers} coarse={coarse} interactive={interactive} />
            <GroundTruth frame={frame} layers={layers} showSkeleton={config.privacy.showSkeleton && !coarse} />
          </>
        )}
        <mesh position={[W / 2, D / 2, 0]} onPointerDown={onFloorDown} onPointerMove={onFloorMove} onPointerUp={onFloorUp} onPointerLeave={() => setCursor(null)} visible={false}>
          <planeGeometry args={[W + 40, D + 40]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
        {region && <Line points={[...region, region[0]].map(([x, y]) => [x, y, 0.025] as [number, number, number])} color="#2dd4e6" lineWidth={1.5} dashed dashSize={0.1} gapSize={0.06} />}
        {dragOutline && <Line points={dragOutline} color="#2dd4e6" lineWidth={1.5} />}
        {measure.length >= 1 && (
          <>
            {measure.map((p, i) => (
              <mesh key={i} position={p}>
                <sphereGeometry args={[0.03]} />
                <meshBasicMaterial color="#e8b04b" />
              </mesh>
            ))}
            {measure.length === 2 && (
              <>
                <Line points={measure} color="#e8b04b" lineWidth={2} />
                <Html position={[(measure[0][0] + measure[1][0]) / 2, (measure[0][1] + measure[1][1]) / 2, 0.15]} center>
                  <span className="num rounded border border-warn/50 bg-bg/90 px-1.5 text-2xs text-warn" data-testid="measure-readout">
                    {Math.hypot(measure[1][0] - measure[0][0], measure[1][1] - measure[0][1], measure[1][2] - measure[0][2]).toFixed(3)} m
                  </span>
                </Html>
              </>
            )}
          </>
        )}
      </Canvas>

      {title && <div className="pointer-events-none absolute left-2 top-2 rounded bg-bg/70 px-1.5 py-0.5 text-2xs font-medium text-muted">{title}</div>}
      {interactive && !hideToolbar && (
        <ViewportToolbar
          tool={tool}
          setTool={(t) => {
            setTool(t);
            if (t !== "measure") setMeasure([]);
          }}
          isolate={isolate}
          setIsolate={setIsolate}
          hasRegion={!!region}
          onExportPly={() => frame && downloadBlob(`echospace_points_${frame.provenance.sourceMode}_${config.scenario}_seq${frame.seq}.ply`, exportPly(frame, config), "text/plain")}
        />
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 flex flex-col gap-1">
        {interactive && (
          <div className="num rounded bg-bg/80 px-1.5 py-0.5 text-2xs text-muted" data-testid="cursor-readout">
            {cursor ? `x ${cursor[0].toFixed(2)}  y ${cursor[1].toFixed(2)}  z ${cursor[2].toFixed(2)} m` : "cursor: —"}
          </div>
        )}
        {frame && (
          <div className="num rounded bg-bg/80 px-1.5 py-0.5 text-2xs text-faint">
            frame {frame.seq} · t {frame.timestampS.toFixed(2)} s · {frame.provenance.modelId}@{frame.provenance.modelVersion}
          </div>
        )}
      </div>
      <Legend layers={layers} colorBy={settings.colorBy} frame={frame} compact={variant === "preview"} />
    </div>
  );
}
