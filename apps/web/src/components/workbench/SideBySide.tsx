"use client";
import { useState } from "react";
import * as THREE from "three";
import type { ReconModelId } from "@echospace/schemas";
import { useFrame } from "@/lib/engine/hooks";
import { useSession } from "@/lib/store/session";
import { useCompareRunner } from "@/lib/engine/useCompare";
import { SceneViewport } from "@/components/viewport/SceneViewport";
import { Panel } from "@/components/ui/panel";
import { SelectField } from "@/components/ui/controls";
import { Timeline } from "@/components/timeline/Timeline";
import { fmt } from "@/lib/format";
import { MODEL_OPTIONS } from "@/components/lab/ScenePanel";

const GT_ONLY = { occupancy: false, pointsFiltered: false, pointsRaw: false, tracks: false, surface: false, groundTruth: true, groundTruthSkeleton: true, propagation: false };
const OUTPUT_ONLY = { groundTruth: false, groundTruthSkeleton: false, propagation: false };

/** Ground truth, baseline model and current model at the same timestamp with a shared camera. */
export function SideBySide() {
  const frame = useFrame(10);
  const config = useSession((s) => s.config);
  const info = useSession((s) => s.info);
  const [baseModel, setBaseModel] = useState<ReconModelId>(config.recon.modelId === "rti-bayes" ? "bp-dsb" : "rti-bayes");
  const baseCfg = { ...config, recon: { ...config.recon, modelId: baseModel } };
  const cmp = useCompareRunner(baseCfg, frame);
  const [cam, setCam] = useState<{ position: THREE.Vector3; target: THREE.Vector3; version: number } | null>(null);
  const onCamera = (position: THREE.Vector3, target: THREE.Vector3) => setCam((c) => ({ position, target, version: (c?.version ?? 0) + 1 }));
  const synthetic = frame?.provenance.sourceMode === "synthetic";
  return (
    <div className="space-y-3" data-testid="side-by-side">
      <Panel title="Side-by-side reconstruction" dense actions={<div className="w-64"><SelectField value={baseModel} options={MODEL_OPTIONS} onChange={(v) => setBaseModel(v as ReconModelId)} /></div>}>
        <p className="text-2xs text-muted">Left: synthetic ground truth. Middle: baseline model ({baseModel}) on the same seed. Right: current session ({config.recon.modelId}). Camera and timeline are shared; scrub the timeline to move all three.</p>
      </Panel>
      <div className="grid gap-2 lg:grid-cols-3">
        {[
          { title: "Ground truth (synthetic)", f: synthetic ? frame : null, override: GT_ONLY, note: synthetic ? null : "No ground truth for this source." },
          { title: `Baseline · ${baseModel}`, f: cmp.frame, override: OUTPUT_ONLY, note: cmp.error },
          { title: `Current · ${config.recon.modelId}`, f: frame, override: OUTPUT_ONLY, note: null },
        ].map((v) => (
          <div key={v.title} className="space-y-1">
            <div className="h-[380px] overflow-hidden rounded-md border border-line">
              {v.note ? <p className="p-3 text-xs text-warn">{v.note}</p> : <SceneViewport frame={v.f} config={config} info={info} variant="preview" layerOverride={v.override} syncCamera={cam} onCamera={onCamera} title={v.title} />}
            </div>
            <div className="num flex justify-between px-1 text-2xs text-muted">
              <span>pos. err {fmt(v.f?.metrics.positionErrorM, 2, "m")}</span>
              <span>floor IoU {fmt(v.f?.metrics.floorIou, 2)}</span>
              <span>{v.f ? v.f.capability.modelStatus : v.note ? "-" : "computing… (catching up unpaced)"}</span>
            </div>
          </div>
        ))}
      </div>
      <Panel title="Timeline" dense><Timeline compact /></Panel>
    </div>
  );
}
