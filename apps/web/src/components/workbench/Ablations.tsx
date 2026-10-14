"use client";
import { useMemo, useState } from "react";
import type { ScenarioConfig } from "@echospace/schemas";
import { SCENARIOS } from "@echospace/engine";
import { useSession } from "@/lib/store/session";
import { useOfflineRuns, type OfflineJob } from "@/lib/engine/useOffline";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { SelectField, SliderField } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { downloadBlob, fmt, toCsv } from "@/lib/format";

type Dim = "smoothing" | "voxel" | "filters" | "model" | "rate" | "bypass" | "device";

const clone = (c: ScenarioConfig, f: (d: ScenarioConfig) => void) => {
  const d = structuredClone(c);
  f(d);
  return d;
};

export const ABLATIONS: Record<Dim, { label: string; variants: (c: ScenarioConfig) => Array<{ label: string; config: ScenarioConfig | null; reason?: string }> }> = {
  smoothing: { label: "Temporal smoothing on / off", variants: (c) => [{ label: "EMA 0.5 + Kalman", config: clone(c, (d) => { d.recon.temporalSmoothing = 0.5; d.tracking.filter = "kalman"; }) }, { label: "no smoothing, no filter", config: clone(c, (d) => { d.recon.temporalSmoothing = 0; d.tracking.filter = "none"; }) }] },
  voxel: { label: "Voxel resolution", variants: (c) => [0.2, 0.25, 0.35, 0.5].map((v) => ({ label: `${v} m`, config: clone(c, (d) => void (d.recon.voxelSizeM = v)) })) },
  filters: { label: "Signal filters (Hampel + EMA)", variants: (c) => [{ label: "Hampel + EMA", config: clone(c, (d) => { d.dsp.hampel.enabled = true; d.dsp.lowpass.enabled = true; }) }, { label: "EMA only", config: clone(c, (d) => { d.dsp.hampel.enabled = false; d.dsp.lowpass.enabled = true; }) }, { label: "no filtering", config: clone(c, (d) => { d.dsp.hampel.enabled = false; d.dsp.lowpass.enabled = false; }) }] },
  model: { label: "Model architecture", variants: (c) => [
    { label: "rti-bayes", config: clone(c, (d) => void (d.recon.modelId = "rti-bayes")) },
    { label: "bp-dsb", config: clone(c, (d) => void (d.recon.modelId = "bp-dsb")) },
    { label: "ridge-floor", config: clone(c, (d) => void (d.recon.modelId = "ridge-floor")) },
    { label: "tcn-encoder", config: null, reason: "no trained weights — interface slot only" },
    { label: "transformer-encoder", config: null, reason: "no trained weights — interface slot only" },
  ] },
  rate: { label: "Observation rate", variants: (c) => [25, 50, 100, 200].map((r) => ({ label: `${r} Hz`, config: clone(c, (d) => void (d.signal.packetRateHz = r)) })) },
  bypass: { label: "Disable one processing stage", variants: (c) => [{ label: "all stages", config: c }, ...(["preprocess", "filter", "reconstruct"] as const).map((s) => ({ label: `bypass ${s}`, config: clone(c, (d) => void (d.pipeline.bypass = { ...d.pipeline.bypass, [s]: true })) }))] },
  device: { label: "CPU vs GPU inference", variants: (c) => [{ label: "CPU (browser worker)", config: c }, { label: "GPU", config: null, reason: "the browser engine has no GPU inference path; CUDA kernels in engine/cuda are unverified and not wired to this engine" }] },
};

export function Ablations() {
  const current = useSession((s) => s.config);
  const [scenario, setScenario] = useState<string>("current");
  const [dim, setDim] = useState<Dim>("smoothing");
  const [duration, setDuration] = useState(20);
  const { run, cancel, results, running, errors } = useOfflineRuns();
  const base = scenario === "current" ? current : SCENARIOS.find((s) => s.key === scenario)!.build();
  const variants = useMemo(() => ABLATIONS[dim].variants(base), [dim, base]);
  const jobs: OfflineJob[] = variants.filter((v) => v.config).map((v, i) => ({ id: `v${i}`, label: v.label, config: v.config! }));
  const rows = variants.map((v, i) => ({ v, r: results[`v${i}`], err: errors[`v${i}`], id: `v${i}` }));
  return (
    <div className="space-y-3" data-testid="ablations">
      <Panel title="Ablation study" dense>
        <div className="grid gap-3 md:grid-cols-4">
          <SelectField label="Base configuration" value={scenario} options={[{ value: "current", label: `Current session (${current.name})` }, ...SCENARIOS.map((s) => ({ value: s.key, label: `${s.key} · ${s.title}` }))]} onChange={setScenario} />
          <SelectField label="Dimension" value={dim} options={Object.entries(ABLATIONS).map(([k, v]) => ({ value: k, label: v.label }))} onChange={(v) => setDim(v as Dim)} />
          <SliderField label="Stream duration per variant" unit="s" min={5} max={60} step={5} value={duration} onChange={setDuration} />
          <div className="flex items-end gap-2">
            <Button variant="primary" disabled={!!running || !jobs.length} onClick={() => run(jobs, duration)} data-testid="run-ablation">{running ? `Running ${running.id} · t=${running.t.toFixed(0)} s` : `Run ${jobs.length} variants`}</Button>
            {running && <Button onClick={cancel}>Cancel</Button>}
          </div>
        </div>
        <p className="mt-2 text-2xs text-faint">Every variant uses seed {base.seed} and identical inputs except the ablated setting, run sequentially in one worker without real-time pacing. Accuracy metrics are simulation metrics; systems metrics describe this browser.</p>
      </Panel>
      <Panel title="Results" actions={<Button size="sm" variant="ghost" disabled={!Object.keys(results).length} onClick={() => downloadBlob(`echospace_ablation_${dim}.csv`, toCsv(rows.filter((x) => x.r).map(({ v, r }) => ({ variant: v.label, frames: r!.frames, pos_err_median_m: r!.accuracy.positionErrorM.median, floor_iou_median: r!.accuracy.floorIou.median, recall_mean: r!.accuracy.recall.mean, precision_mean: r!.accuracy.precision.mean, confidence_median: r!.accuracy.meanConfidence.median, frame_median_ms: r!.systems.frameMedianMs, frames_per_s: r!.systems.framesPerSecond, init_ms: r!.systems.initMs })), { dimension: dim, seed: String(base.seed), scenario: base.scenario, note: "simulation metrics against synthetic ground truth" }), "text/csv")}>CSV</Button>}>
        <table className="num w-full text-xs">
          <thead className="text-2xs text-faint">
            <tr>
              <th className="text-left font-normal">variant</th>
              <th className="font-normal">pos. err median (m)</th>
              <th className="font-normal">floor IoU median</th>
              <th className="font-normal">recall mean</th>
              <th className="font-normal">precision mean</th>
              <th className="font-normal">confidence</th>
              <th className="font-normal">frame ms (median)</th>
              <th className="font-normal">frames/s</th>
              <th className="font-normal">model status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, r, err, id }) => (
              <tr key={id} className="border-t border-line-soft">
                <td className="py-1 text-left">{v.label}</td>
                {!v.config ? (
                  <td colSpan={8} className="text-left text-2xs text-warn">not runnable: {v.reason}</td>
                ) : err ? (
                  <td colSpan={8} className="text-left text-err">{err}</td>
                ) : !r ? (
                  <td colSpan={8} className="text-left text-faint">{running?.id === id ? "running…" : "not run"}</td>
                ) : (
                  <>
                    <td className="text-center">{fmt(r.accuracy.positionErrorM.median, 3)}</td>
                    <td className="text-center">{fmt(r.accuracy.floorIou.median, 3)}</td>
                    <td className="text-center">{fmt(r.accuracy.recall.mean, 2)}</td>
                    <td className="text-center">{fmt(r.accuracy.precision.mean, 2)}</td>
                    <td className="text-center">{fmt(r.accuracy.meanConfidence.median, 3)}</td>
                    <td className="text-center">{fmt(r.systems.frameMedianMs, 2)}</td>
                    <td className="text-center">{r.systems.framesPerSecond.toFixed(1)}</td>
                    <td className="text-center">{Object.entries(r.modelStatus).map(([k, n]) => <Badge key={k} tone={k === "ok" ? "ok" : k === "degraded" ? "warn" : "err"} className="mr-0.5">{k} {n}</Badge>)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
