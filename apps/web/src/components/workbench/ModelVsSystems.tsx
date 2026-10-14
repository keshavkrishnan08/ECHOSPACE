"use client";
import { useState } from "react";
import type { ReconModelId } from "@echospace/schemas";
import { useSession } from "@/lib/store/session";
import { useOfflineRuns } from "@/lib/engine/useOffline";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { SelectField, SliderField } from "@/components/ui/controls";
import { fmt } from "@/lib/format";
import { MODEL_OPTIONS } from "@/components/lab/ScenePanel";

/** Accuracy and systems metrics for two model configurations on identical synthetic input. */
export function ModelVsSystems() {
  const config = useSession((s) => s.config);
  const [a, setA] = useState<ReconModelId>("rti-bayes");
  const [b, setB] = useState<ReconModelId>("ridge-floor");
  const [dur, setDur] = useState(20);
  const { run, results, running, errors } = useOfflineRuns();
  const go = () => run([{ id: "a", label: a, config: { ...config, recon: { ...config.recon, modelId: a } } }, { id: "b", label: b, config: { ...config, recon: { ...config.recon, modelId: b } } }], dur);
  const A = results.a;
  const B = results.b;
  const row = (label: string, fa: (r: NonNullable<typeof A>) => number | null, digits = 3) => (
    <tr className="border-t border-line-soft"><td className="py-0.5 text-left text-muted">{label}</td><td className="text-center">{A ? fmt(fa(A), digits) : "—"}</td><td className="text-center">{B ? fmt(fa(B), digits) : "—"}</td></tr>
  );
  const usable = MODEL_OPTIONS.filter((o) => o.value === "rti-bayes" || o.value === "bp-dsb" || o.value === "ridge-floor");
  return (
    <div className="space-y-3" data-testid="model-vs-systems">
      <Panel title="Model-versus-systems benchmark" dense>
        <div className="grid gap-3 md:grid-cols-4">
          <SelectField label="Configuration A" value={a} options={usable} onChange={(v) => setA(v as ReconModelId)} />
          <SelectField label="Configuration B" value={b} options={usable} onChange={(v) => setB(v as ReconModelId)} />
          <SliderField label="Stream duration" unit="s" min={5} max={60} step={5} value={dur} onChange={setDur} />
          <div className="flex items-end"><Button variant="primary" onClick={go} disabled={!!running}>{running ? `Running ${running.id}…` : "Run both"}</Button></div>
        </div>
        <p className="mt-2 text-2xs text-faint">Same scenario ({config.scenario}), seed {config.seed} and duration for both. Unimplemented model slots are excluded rather than simulated.</p>
      </Panel>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Accuracy (simulation metrics)">
          <table className="num w-full text-xs"><thead className="text-2xs text-faint"><tr><th className="text-left font-normal">metric</th><th className="font-normal">A · {a}</th><th className="font-normal">B · {b}</th></tr></thead>
            <tbody>
              {row("position error median (m)", (r) => r.accuracy.positionErrorM.median)}
              {row("floor IoU median", (r) => r.accuracy.floorIou.median)}
              {row("voxel IoU median", (r) => r.accuracy.voxelIou.median)}
              {row("recall (mean)", (r) => r.accuracy.recall.mean, 2)}
              {row("precision (mean)", (r) => r.accuracy.precision.mean, 2)}
              {row("chamfer median (m)", (r) => r.accuracy.chamferM.median)}
            </tbody>
          </table>
        </Panel>
        <Panel title="Systems (this browser, this machine)">
          <table className="num w-full text-xs"><thead className="text-2xs text-faint"><tr><th className="text-left font-normal">metric</th><th className="font-normal">A</th><th className="font-normal">B</th></tr></thead>
            <tbody>
              {row("initialisation (ms)", (r) => r.systems.initMs, 0)}
              {row("frame processing median (ms)", (r) => r.systems.frameMedianMs, 2)}
              {row("frame processing p95 (ms)", (r) => r.systems.frameP95Ms, 2)}
              {row("throughput (frames/s, unpaced)", (r) => r.systems.framesPerSecond, 1)}
              {row("JS heap after run (MB, Chrome only)", (r) => r.systems.heapMb, 1)}
              {row("frame payload (KiB)", (r) => r.systems.frameBytes / 1024, 1)}
            </tbody>
          </table>
        </Panel>
      </div>
      {(errors.a || errors.b) && <p className="text-xs text-err">{errors.a ?? errors.b}</p>}
    </div>
  );
}
