"use client";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import type { Material, ObstacleKind, ReconModelId, SensorRole } from "@echospace/schemas";
import { perimeterSensors } from "@echospace/engine";
import { useConfigEditor } from "@/lib/store/useConfigEditor";
import { useSession } from "@/lib/store/session";
import { useSettings, type LayerState } from "@/lib/store/settings";
import { Section } from "@/components/ui/panel";
import { NumberInput, SelectField, SliderField, Segmented, Toggle } from "@/components/ui/controls";
import { Button } from "@/components/ui/button";

const MATERIALS: Material[] = ["fabric", "glass", "wood", "drywall", "brick", "concrete", "metal"];
const KINDS: ObstacleKind[] = ["table", "sofa", "cabinet", "shelf", "partition", "bed", "desk", "box"];

export const MODEL_OPTIONS: Array<{ value: ReconModelId; label: string; disabled?: boolean }> = [
  { value: "rti-bayes", label: "RTI (Bayesian attenuation) · classical" },
  { value: "bp-dsb", label: "Coherent back-projection · classical" },
  { value: "ridge-floor", label: "Ridge floor occupancy · shallow learned" },
  { value: "tcn-encoder", label: "TCN encoder · not trained" },
  { value: "transformer-encoder", label: "Transformer encoder · not trained" },
];

const LAYER_GROUPS: Array<{ title: string; items: Array<[keyof LayerState, string, string?]> }> = [
  { title: "Environment", items: [["room", "Room"], ["walls", "Walls"], ["floorCeiling", "Floor & ceiling"], ["furniture", "Furniture & obstacles"], ["openings", "Doors & windows"], ["grid", "Metric grid"], ["axes", "Coordinate axes"]] },
  { title: "RF instrumentation", items: [["sensors", "Sensors", "#7fe3f0"], ["orientation", "Orientation & antennas"], ["links", "Link lines"], ["propagation", "Modelled paths (selected link)", "#2dd4e6"], ["signalOverlay", "Link attenuation overlay", "#e8b04b"]] },
  { title: "Reconstruction", items: [["pointsRaw", "Raw image points", "#7a8ba3"], ["pointsFiltered", "Filtered point cloud", "#5fbf8f"], ["occupancy", "Occupancy voxels", "#3f6fd8"], ["unobserved", "Unobserved regions", "#e8b04b"], ["surface", "Iso-surface", "#5b8def"], ["groundTruth", "Ground truth (synthetic)", "#f2f2f2"]] },
  { title: "Motion", items: [["tracks", "Estimated positions", "#a78bfa"], ["velocity", "Velocity vectors"], ["trails", "Temporal trails"], ["trackIds", "Track identifiers"], ["uncertainty", "Uncertainty ellipses"], ["groundTruthSkeleton", "Ground-truth skeleton (synthetic)"]] },
];

export function ScenePanel() {
  const { draft: c, patch } = useConfigEditor();
  const restart = useSession((s) => s.restart);
  const launch = useSession((s) => s.launch);
  const recalibrate = useSession((s) => s.recalibrate);
  const selectedLink = useSession((s) => s.selectedLink);
  const selectLink = useSession((s) => s.selectLink);
  const info = useSession((s) => s.info);
  const st = useSettings();
  const synthetic = useSession((s) => s.sourceMode === "synthetic");

  return (
    <div className="text-xs" data-testid="scene-panel">
      <Section title="Scenario">
        <div className="text-fg">{c.name}</div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <NumberInput label="#" value={c.seed} step={1} min={0} max={4294967295} onChange={(v) => patch((d) => void (d.seed = Math.round(v)))} />
          </div>
          <Button size="sm" onClick={() => launch({ ...c, seed: (c.seed * 1103515245 + 12345) >>> 0 }, { scenarioKey: c.scenario })} title="New random seed">
            <RefreshCw className="h-3 w-3" /> New seed
          </Button>
          <Button size="sm" onClick={restart}>Restart</Button>
        </div>
        <p className="text-2xs text-faint">Seed controls every random draw (noise, loss, CFO). Same seed + config ⇒ identical run.</p>
        {synthetic && <Button size="sm" variant="ghost" onClick={recalibrate}>Recalibrate empty-room baseline</Button>}
      </Section>

      <Section title="Room" defaultOpen={false}>
        <SliderField label="Width" unit="m" min={3} max={12} step={0.5} value={c.room.width} onChange={(v) => patch((d) => { d.room.width = v; d.sensors = d.sensors.map((s) => ({ ...s, position: [Math.min(v - 0.15, s.position[0]), s.position[1], s.position[2]] })); })} />
        <SliderField label="Depth" unit="m" min={3} max={12} step={0.5} value={c.room.depth} onChange={(v) => patch((d) => { d.room.depth = v; d.sensors = d.sensors.map((s) => ({ ...s, position: [s.position[0], Math.min(v - 0.15, s.position[1]), s.position[2]] })); })} />
        <SliderField label="Height" unit="m" min={2.2} max={5} step={0.1} value={c.room.height} onChange={(v) => patch((d) => void (d.room.height = v))} />
        <SliderField label="Wall thickness" unit="m" min={0.05} max={0.5} step={0.01} value={c.room.wallThickness} onChange={(v) => patch((d) => void (d.room.wallThickness = v))} />
        <SelectField label="Wall material" value={c.room.wallMaterial} options={MATERIALS.map((m) => ({ value: m, label: m }))} onChange={(v) => patch((d) => void (d.room.wallMaterial = v as Material))} />
        <SliderField label="Wall reflectivity |Γ| (override)" min={0} max={0.95} step={0.05} value={c.room.wallReflectivity ?? 0} format={(v) => (c.room.wallReflectivity === null ? "material default" : v.toFixed(2))} onChange={(v) => patch((d) => void (d.room.wallReflectivity = v))} />
      </Section>

      <Section
        title={`Sensors (${c.sensors.length}) · ${info?.links.length ?? 0} links`}
        defaultOpen={false}
        right={
          <Button size="iconSm" variant="ghost" aria-label="Add sensor" onClick={() => patch((d) => void d.sensors.push({ id: `N${d.sensors.length + 1}`, label: "", role: "trx", position: [d.room.width / 2, 0.15, 1.2], yawDeg: 90, antennas: 3, enabled: true }))}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        }
      >
        <div className="flex items-center gap-1">
          <span className="text-muted">Layout</span>
          {[2, 4, 6, 8, 10].map((n) => (
            <Button key={n} size="sm" variant={c.sensors.length === n ? "active" : "ghost"} onClick={() => patch((d) => void (d.sensors = perimeterSensors(n, d.room.width, d.room.depth)))}>
              {n}
            </Button>
          ))}
        </div>
        {c.sensors.map((s, i) => (
          <div key={i} className="space-y-1 rounded border border-line-soft p-2">
            <div className="flex items-center gap-1.5">
              <span className="num w-7 text-signal">{s.id}</span>
              <div className="w-20">
                <SelectField value={s.role} options={[{ value: "trx", label: "tx+rx" }, { value: "tx", label: "tx" }, { value: "rx", label: "rx" }]} onChange={(v) => patch((d) => void (d.sensors[i].role = v as SensorRole))} />
              </div>
              <Toggle label="" checked={s.enabled} onChange={(v) => patch((d) => void (d.sensors[i].enabled = v))} />
              <Button size="iconSm" variant="ghost" className="ml-auto" aria-label={`Remove ${s.id}`} disabled={c.sensors.length <= 2} onClick={() => patch((d) => void d.sensors.splice(i, 1))}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <NumberInput label="x" value={s.position[0]} step={0.05} min={0} max={c.room.width} onChange={(v) => patch((d) => void (d.sensors[i].position[0] = v))} />
              <NumberInput label="y" value={s.position[1]} step={0.05} min={0} max={c.room.depth} onChange={(v) => patch((d) => void (d.sensors[i].position[1] = v))} />
              <NumberInput label="z" value={s.position[2]} step={0.05} min={0} max={c.room.height} onChange={(v) => patch((d) => void (d.sensors[i].position[2] = v))} />
            </div>
            <div className="grid grid-cols-2 gap-1">
              <NumberInput label="ψ" unit="°" value={s.yawDeg} step={5} min={-360} max={360} onChange={(v) => patch((d) => void (d.sensors[i].yawDeg = v))} />
              <NumberInput label="M" value={s.antennas} step={1} min={1} max={4} onChange={(v) => patch((d) => void (d.sensors[i].antennas = Math.round(v)))} />
            </div>
          </div>
        ))}
        {info && (
          <SelectField label="Inspected link (Studio, paths)" value={String(selectedLink)} options={info.links.map((l) => ({ value: String(l.index), label: `${l.id} · ${l.lengthM.toFixed(2)} m` }))} onChange={(v) => selectLink(Number(v))} />
        )}
      </Section>

      <Section
        title={`Obstacles (${c.obstacles.length})`}
        defaultOpen={false}
        right={
          <Button size="iconSm" variant="ghost" aria-label="Add obstacle" onClick={() => patch((d) => void d.obstacles.push({ id: `obj${d.obstacles.length + 1}`, kind: "box", min: [d.room.width / 2 - 0.3, d.room.depth / 2 - 0.3, 0], max: [d.room.width / 2 + 0.3, d.room.depth / 2 + 0.3, 1.0], material: "wood", attenuationDb: null }))}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        }
      >
        {c.obstacles.length === 0 && <p className="text-faint">No obstacles.</p>}
        {c.obstacles.map((o, i) => (
          <div key={o.id} className="space-y-1 rounded border border-line-soft p-2">
            <div className="flex items-center gap-1.5">
              <span className="num flex-1 truncate">{o.id}</span>
              <div className="w-24"><SelectField value={o.kind} options={KINDS.map((k) => ({ value: k, label: k }))} onChange={(v) => patch((d) => void (d.obstacles[i].kind = v as ObstacleKind))} /></div>
              <div className="w-24"><SelectField value={o.material} options={MATERIALS.map((k) => ({ value: k, label: k }))} onChange={(v) => patch((d) => void (d.obstacles[i].material = v as Material))} /></div>
              <Button size="iconSm" variant="ghost" aria-label={`Remove ${o.id}`} onClick={() => patch((d) => void d.obstacles.splice(i, 1))}><Trash2 className="h-3 w-3" /></Button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {[0, 1, 2].map((a) => (
                <NumberInput key={`min${a}`} label={["x", "y", "z"][a]} value={o.min[a]} step={0.05} min={0} max={a === 0 ? c.room.width : a === 1 ? c.room.depth : c.room.height} onChange={(v) => patch((d) => void (d.obstacles[i].min[a] = Math.min(v, d.obstacles[i].max[a] - 0.02)))} />
              ))}
              {[0, 1, 2].map((a) => (
                <NumberInput key={`max${a}`} label={["X", "Y", "Z"][a]} value={o.max[a]} step={0.05} min={0} max={a === 0 ? c.room.width : a === 1 ? c.room.depth : c.room.height} onChange={(v) => patch((d) => void (d.obstacles[i].max[a] = Math.max(v, d.obstacles[i].min[a] + 0.02)))} />
              ))}
            </div>
          </div>
        ))}
        {synthetic && <p className="text-2xs text-faint">Moving furniture invalidates the empty-room baseline; the view will warn until you recalibrate.</p>}
      </Section>

      <Section title="Signal & impairments" defaultOpen={false}>
        <SliderField label="SNR" unit="dB" min={-5} max={45} step={1} value={c.signal.snrDb} onChange={(v) => patch((d) => void (d.signal.snrDb = v))} help="Mean static channel power over complex noise power per CSI sample." />
        <SliderField label="Packet rate" unit="Hz" min={10} max={400} step={10} value={c.signal.packetRateHz} onChange={(v) => patch((d) => void (d.signal.packetRateHz = v))} />
        <SliderField label="Packet loss" min={0} max={0.9} step={0.01} value={c.impairments.packetLoss} format={(v) => `${(v * 100).toFixed(0)} %`} onChange={(v) => patch((d) => void (d.impairments.packetLoss = v))} />
        <SliderField label="Phase instability" unit="rad" min={0} max={3} step={0.05} value={c.impairments.phaseInstabilityRad} onChange={(v) => patch((d) => void (d.impairments.phaseInstabilityRad = v))} />
        <SliderField label="Body shadowing (peak)" unit="dB" min={0} max={20} step={0.5} value={c.signal.bodyShadowDb} onChange={(v) => patch((d) => void (d.signal.bodyShadowDb = v))} />
        <SelectField label="Subcarriers / bandwidth" value={`${c.signal.subcarriers}/${c.signal.bandwidthHz / 1e6}`} options={[{ value: "30/20", label: "30 sc · 20 MHz" }, { value: "30/40", label: "30 sc · 40 MHz" }, { value: "56/80", label: "56 sc · 80 MHz" }, { value: "114/160", label: "114 sc · 160 MHz" }]} onChange={(v) => patch((d) => { const [k, b] = v.split("/").map(Number); d.signal.subcarriers = k; d.signal.bandwidthHz = b * 1e6; })} />
        <Toggle label="Subject scatter paths" checked={c.signal.subjectScatter} onChange={(v) => patch((d) => void (d.signal.subjectScatter = v))} />
        <Toggle label="Body shadowing" checked={c.signal.subjectShadowing} onChange={(v) => patch((d) => void (d.signal.subjectShadowing = v))} />
      </Section>

      <Section title="Reconstruction">
        <SelectField label="Model" value={c.recon.modelId} options={MODEL_OPTIONS} onChange={(v) => patch((d) => void (d.recon.modelId = v as ReconModelId))} />
        <SliderField label="Voxel resolution" unit="m" min={0.15} max={0.5} step={0.05} value={c.recon.voxelSizeM} onChange={(v) => patch((d) => void (d.recon.voxelSizeM = v))} />
        <SliderField label="Detection threshold z₀" min={1} max={8} step={0.25} value={c.recon.detectionZ} onChange={(v) => patch((d) => void (d.recon.detectionZ = v))} help="Occupancy = Φ(z − z₀), z = posterior mean / its null-hypothesis std-dev." />
        <SliderField label="Occupancy threshold" min={0.1} max={0.95} step={0.05} value={c.recon.occupancyThreshold} onChange={(v) => patch((d) => void (d.recon.occupancyThreshold = v))} />
        <SliderField label="Confidence threshold" min={0} max={0.6} step={0.01} value={c.recon.confidenceThreshold} onChange={(v) => patch((d) => void (d.recon.confidenceThreshold = v))} />
        <SliderField label="Temporal smoothing" min={0} max={0.95} step={0.05} value={c.recon.temporalSmoothing} onChange={(v) => patch((d) => void (d.recon.temporalSmoothing = v))} />
        <SliderField label="Update frequency" unit="Hz" min={2} max={20} step={1} value={c.dsp.frameRateHz} onChange={(v) => patch((d) => void (d.dsp.frameRateHz = v))} />
        <Toggle label="Spatial filtering (3×3×3)" checked={c.recon.spatialFilter} onChange={(v) => patch((d) => void (d.recon.spatialFilter = v))} />
        <Toggle label="Outlier removal" checked={c.recon.outlierRemoval} onChange={(v) => patch((d) => void (d.recon.outlierRemoval = v))} />
      </Section>

      <Section title="Tracking & privacy" defaultOpen={false}>
        <SelectField label="Temporal filter" value={c.tracking.filter} options={[{ value: "kalman", label: "Kalman (constant velocity)" }, { value: "ema", label: "Exponential smoothing" }, { value: "none", label: "None" }, { value: "learned", label: "Learned (not implemented)" }]} onChange={(v) => patch((d) => void (d.tracking.filter = v as typeof d.tracking.filter))} />
        <SliderField label="Association gate" unit="m" min={0.3} max={3} step={0.1} value={c.tracking.gateM} onChange={(v) => patch((d) => void (d.tracking.gateM = v))} />
        <SliderField label="Hits to confirm" min={1} max={10} step={1} value={c.tracking.birthHits} onChange={(v) => patch((d) => void (d.tracking.birthHits = v))} />
        <Toggle label="Coarse privacy mode" checked={c.privacy.mode === "coarse"} onChange={(v) => patch((d) => { d.privacy.mode = v ? "coarse" : "standard"; d.privacy.showSkeleton = !v; d.privacy.trackHistorySeconds = v ? 0 : 10; })} help="Hides skeletons, trails and velocity; shortens track retention to zero." />
        <Toggle label="Show synthetic skeletons" checked={c.privacy.showSkeleton} disabled={c.privacy.mode === "coarse"} onChange={(v) => patch((d) => void (d.privacy.showSkeleton = v))} />
        <SliderField label="Track history retention" unit="s" min={0} max={30} step={1} value={c.privacy.trackHistorySeconds} onChange={(v) => patch((d) => void (d.privacy.trackHistorySeconds = v))} />
      </Section>

      <Section title="Display">
        <div className="flex items-center justify-between">
          <span className="text-muted">Colour points by</span>
          <Segmented value={st.colorBy} onChange={(v) => st.set("colorBy", v)} options={[{ value: "height", label: "Height" }, { value: "confidence", label: "Confidence" }, { value: "velocity", label: "Velocity" }]} />
        </div>
        <SliderField label="Point size" unit="m" min={0.01} max={0.2} step={0.01} value={st.pointSize} onChange={(v) => st.set("pointSize", v)} />
        <SliderField label="Point density" min={0.05} max={1} step={0.05} value={st.pointDensity} format={(v) => `${(v * 100).toFixed(0)} %`} onChange={(v) => st.set("pointDensity", v)} />
        <SliderField label="Voxel view threshold" min={0.1} max={0.99} step={0.01} value={st.occupancyThresholdView} onChange={(v) => st.set("occupancyThresholdView", v)} />
        <SliderField label="Confidence filter (view)" min={0} max={0.6} step={0.01} value={st.confidenceFilter} onChange={(v) => st.set("confidenceFilter", v)} />
        <SliderField label="Display rate" unit="Hz" min={2} max={60} step={1} value={st.displayHz} onChange={(v) => st.set("displayHz", v)} help="How often the viewport redraws from the latest frame; independent of the engine's processing rate." />
        <Toggle label="Clipping plane" checked={st.clipping.enabled} onChange={(v) => st.set("clipping", { ...st.clipping, enabled: v })} />
        {st.clipping.enabled && (
          <>
            <Segmented value={st.clipping.axis} onChange={(v) => st.set("clipping", { ...st.clipping, axis: v })} options={[{ value: "x", label: "x" }, { value: "y", label: "y" }, { value: "z", label: "z" }]} />
            <SliderField label="Clip at" unit="m" min={0} max={st.clipping.axis === "x" ? c.room.width : st.clipping.axis === "y" ? c.room.depth : c.room.height} step={0.05} value={st.clipping.value} onChange={(v) => st.set("clipping", { ...st.clipping, value: v })} />
          </>
        )}
      </Section>

      {LAYER_GROUPS.map((g) => (
        <Section key={g.title} title={`Layers · ${g.title}`} defaultOpen={g.title === "Reconstruction" || g.title === "Motion"}>
          {g.items.map(([k, label, color]) => (
            <Toggle key={k} label={label} color={color} checked={st.layers[k]} onChange={(v) => st.setLayer(k, v)} />
          ))}
        </Section>
      ))}
    </div>
  );
}
