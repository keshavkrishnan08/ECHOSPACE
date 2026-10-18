"use client";
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { ReconstructionFrame, StageId, StageRecord } from "@echospace/schemas";
import { percentile } from "@echospace/engine";
import { history } from "@/lib/engine/history";
import { useHistoryVersion } from "@/lib/engine/hooks";
import { useSession } from "@/lib/store/session";
import { useConfigEditor } from "@/lib/store/useConfigEditor";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/controls";
import { EChart, axisStyle, tooltipStyle } from "@/components/charts/EChart";
import { cn, fmt } from "@/lib/format";
import { contributingLinks } from "@/components/lab/Inspector";
import { PlotFrame } from "./PlotFrame";

/** Stages the pipeline can actually bypass; the rest are structurally required. */
const BYPASSABLE: Partial<Record<StageId, string>> = {
  preprocess: "Skips phase sanitization (raw phase flows downstream).",
  filter: "Skips Hampel outlier replacement and EMA smoothing of RSS.",
  reconstruct: "Skips temporal EMA and 3×3×3 spatial smoothing of occupancy.",
  associate: "Skips detection and tracking.",
};

function stageStats(id: StageId) {
  const frames = history.ordered();
  const d = frames.map((f) => f.stages.find((s) => s.id === id)?.durationMs ?? Number.NaN).filter(Number.isFinite);
  return { n: d.length, median: percentile(d, 0.5), p95: d.length >= 20 ? percentile(d, 0.95) : null, p99: d.length >= 100 ? percentile(d, 0.99) : null, series: frames.map((f) => [f.timestampS, f.stages.find((s) => s.id === id)?.durationMs ?? null]) };
}

export function PipelineView({ frame }: { frame: ReconstructionFrame | null }) {
  const [sel, setSel] = useState<StageId>("preprocess");
  const v = useHistoryVersion(3);
  const { draft, patch } = useConfigEditor(50);
  const stats = useMemo(() => stageStats(sel), [sel, v]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!frame) return null;
  const stage = frame.stages.find((s) => s.id === sel)!;
  const rate = draft.dsp.frameRateHz;
  return (
    <div className="space-y-3" data-testid="pipeline-view">
      <div className="overflow-x-auto pb-1">
        <ol className="flex min-w-max items-stretch gap-1">
          {frame.stages.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSel(s.id)}
                aria-pressed={sel === s.id}
                data-testid={`stage-${s.id}`}
                className={cn(
                  "w-[148px] rounded-md border p-2 text-left transition-colors",
                  sel === s.id ? "border-signal/60 bg-signal/10" : "border-line bg-surface hover:border-faint",
                  (!s.applicable || s.bypassed) && "opacity-60",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="num text-2xs text-faint">{String(i + 1).padStart(2, "0")}</span>
                  {!s.applicable ? <Badge>n/a</Badge> : s.bypassed ? <Badge tone="warn">bypassed</Badge> : s.errors > 0 ? <Badge tone="err">{s.errors} err</Badge> : <Badge tone="ok">on</Badge>}
                </div>
                <div className="mt-1 truncate text-xs font-medium">{s.label}</div>
                <div className="num mt-1 text-[15px] text-signal">{s.durationMs.toFixed(3)}<span className="text-2xs text-muted"> ms</span></div>
                <div className="num truncate text-[10px] text-faint" title={s.outputShape}>{s.outputShape}</div>
              </button>
              {i < frame.stages.length - 1 && <ArrowRight className="h-3 w-3 shrink-0 text-faint" />}
            </li>
          ))}
        </ol>
      </div>
      <div className="grid gap-3 xl:grid-cols-[380px_1fr]">
        <section className="rounded-md border border-line bg-surface p-3 text-xs" data-testid="stage-inspector">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{stage.label}</h3>
            <span className="num text-2xs text-faint">{stage.id}</span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {([
              ["Input shape", stage.inputShape],
              ["Output shape", stage.outputShape],
              ["Data type", stage.dtype],
              ["Execution (this frame)", `${stage.durationMs.toFixed(3)} ms`],
              ["Queue delay", `${stage.queueDelayMs.toFixed(2)} ms`],
              ["Throughput", stage.durationMs > 0 ? `${(stage.itemsIn / (stage.durationMs / 1000)).toExponential(2)} items/s (in-stage)` : "N/A"],
              ["Items in / out", `${stage.itemsIn} / ${stage.itemsOut}`],
              ["Drops", stage.drops],
              ["Errors (cumulative)", stage.errors],
              ["Status", !stage.applicable ? "not applicable to this source" : stage.bypassed ? "bypassed" : "enabled"],
            ] as Array<[string, React.ReactNode]>).map(([k, val]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="num truncate">{val}</dd>
              </div>
            ))}
          </dl>
          {stage.note && <p className="mt-2 rounded border border-line-soft bg-panel/50 p-2 text-2xs text-muted">{stage.note}</p>}
          {BYPASSABLE[sel] ? (
            <div className="mt-2">
              <Toggle label="Bypass this stage" checked={Boolean(draft.pipeline.bypass[sel])} onChange={(on) => patch((d) => void (d.pipeline.bypass = { ...d.pipeline.bypass, [sel]: on }))} help={BYPASSABLE[sel]} />
            </div>
          ) : (
            stage.applicable && <p className="mt-2 text-2xs text-faint">Required stage; cannot be bypassed.</p>
          )}
          <StageConfig id={sel} />
          <div className="mt-3 text-2xs uppercase tracking-wider text-muted">Timing over buffered frames</div>
          <dl className="num mt-1 grid grid-cols-4 gap-1 text-2xs">
            <div><dt className="text-faint">n</dt><dd>{stats.n}</dd></div>
            <div><dt className="text-faint">median</dt><dd>{fmt(stats.median, 3)}</dd></div>
            <div><dt className="text-faint">p95</dt><dd>{stats.p95 === null ? "n<20" : fmt(stats.p95, 3)}</dd></div>
            <div><dt className="text-faint">p99</dt><dd>{stats.p99 === null ? "n<100" : fmt(stats.p99, 3)}</dd></div>
          </dl>
          <p className="mt-1 text-2xs text-faint">Measured with performance.now() inside the engine worker at {rate} Hz frames. Browser timer resolution is coarsened (typically 0.1 ms or worse).</p>
        </section>
        <StageSample id={sel} frame={frame} stats={stats.series as Array<[number, number | null]>} />
      </div>
    </div>
  );
}

function StageConfig({ id }: { id: StageId }) {
  const cfg = useSession((s) => s.config);
  const rows: Array<[string, string]> =
    id === "validate" ? [["Expected shape", "links × antennas × subcarriers"], ["Policy", "reject packets with every antenna non-finite"]]
    : id === "align" ? [["Clock model", "ts ≈ offset + seq / rate (LS fit)"], ["Nominal rate", `${cfg.signal.packetRateHz} Hz`]]
    : id === "buffer" ? [["History", `${cfg.dsp.bufferSeconds} s per link`], ["Acquisition queue", `${cfg.pipeline.queueDepth} × links, ${cfg.pipeline.dropPolicy}`]]
    : id === "preprocess" ? [["Phase sanitization", String(cfg.dsp.phaseSanitize)], ["Reference", "first finite antenna"]]
    : id === "filter" ? [["Hampel", `±${cfg.dsp.hampel.halfWindow}, ${cfg.dsp.hampel.nSigma}σ, ${cfg.dsp.hampel.enabled ? "on" : "off"}`], ["EMA α", String(cfg.dsp.lowpass.alpha)]]
    : id === "features" ? [["Features", "RSS, ΔRSS, motion energy, delivery"], ["Calibration", `${cfg.dsp.calibrationSeconds} s empty room`]]
    : id === "spatial" ? [["Model", cfg.recon.modelId], ["Voxel", `${cfg.recon.voxelSizeM} m`], ["Ellipse excess λ_e", `${cfg.recon.ellipseExcessM} m`], ["Prior σ, δ", `${cfg.recon.priorStd}, ${cfg.recon.priorCorrelationM} m`], ["Noise σ_n", `${cfg.recon.noiseStdDb} dB`]]
    : id === "inference" ? [["Mapping", "Φ(z − z₀)"], ["z₀", String(cfg.recon.detectionZ)], ["Injected delay", `${cfg.pipeline.injectedInferenceDelayMs} ms`]]
    : id === "reconstruct" ? [["Temporal EMA", String(cfg.recon.temporalSmoothing)], ["Spatial filter", String(cfg.recon.spatialFilter)], ["Thresholds", `occ ${cfg.recon.occupancyThreshold}, conf ${cfg.recon.confidenceThreshold}`]]
    : id === "associate" ? [["Filter", cfg.tracking.filter], ["Gate", `${cfg.tracking.gateM} m`], ["Birth / death", `${cfg.tracking.birthHits} hits / ${cfg.tracking.maxMisses} misses`]]
    : id === "serialize" ? [["Transport", "postMessage with transferable ArrayBuffers"], ["Max in flight", String(cfg.pipeline.maxInFlightFrames)]]
    : [["Status", "Not applicable for CSI sources"]];
  return (
    <>
      <div className="mt-3 text-2xs uppercase tracking-wider text-muted">Configuration</div>
      <dl className="num mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-2xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-faint">{k}</dt>
            <dd className="truncate">{v}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function StageSample({ id, frame, stats }: { id: StageId; frame: ReconstructionFrame; stats: Array<[number, number | null]> }) {
  const cfg = useSession((s) => s.config);
  const timing = (
    <PlotFrame title="Stage execution time" kind="derived" units="ms per frame (performance.now)" csv={() => stats.map(([t, d]) => ({ t_s: t, duration_ms: d }))}>
      <EChart option={{ grid: { left: 48, right: 12, top: 12, bottom: 28 }, tooltip: { trigger: "axis", ...tooltipStyle }, xAxis: { type: "value", min: "dataMin", max: "dataMax", ...axisStyle }, yAxis: { type: "value", name: "ms", ...axisStyle }, series: [{ type: "line", showSymbol: false, data: stats, lineStyle: { color: "#2dd4e6", width: 1 } }] }} height={160} />
    </PlotFrame>
  );
  let sample: React.ReactNode = null;
  const csi = frame.csi;
  if ((id === "preprocess" || id === "validate" || id === "align" || id === "buffer") && csi) {
    const K = csi.subcarriers;
    const x = Array.from(csi.subcarrierOffsetsHz, (f) => f / 1e6);
    sample = (
      <PlotFrame title="Sample input → output (selected link, antenna 0 phase)" kind="derived" units="radians vs subcarrier offset (MHz)">
        <EChart option={{ grid: { left: 48, right: 12, top: 24, bottom: 28 }, legend: { top: 0, textStyle: { color: "#8b9ab0", fontSize: 10 } }, tooltip: { trigger: "axis", ...tooltipStyle }, xAxis: { type: "value", min: "dataMin", max: "dataMax", ...axisStyle }, yAxis: { type: "value", scale: true, ...axisStyle }, series: [{ name: "input: raw wrapped phase", type: "line" as const, showSymbol: false, data: x.map((f, k) => [f, csi.phaseRaw[k]]), lineStyle: { color: "#8b9ab0" } }, { name: "output: sanitized phase", type: "line" as const, showSymbol: false, data: x.map((f, k) => [f, csi.phaseSanitized[k]]), lineStyle: { color: "#2dd4e6" } }].slice(0, K ? 2 : 0) }} height={220} />
      </PlotFrame>
    );
  } else if (id === "filter" || id === "features") {
    const L = frame.features.rssDb.length;
    sample = (
      <PlotFrame title="Output: per-link features" kind="derived" units="ΔRSS dB · motion energy (× calibration level)">
        <EChart option={{ grid: { left: 48, right: 48, top: 24, bottom: 28 }, legend: { top: 0, textStyle: { color: "#8b9ab0", fontSize: 10 } }, tooltip: { trigger: "axis", ...tooltipStyle }, xAxis: { type: "category", data: Array.from({ length: L }, (_, i) => String(i)), name: "link", ...axisStyle }, yAxis: [{ type: "value", name: "ΔRSS dB", ...axisStyle }, { type: "value", name: "motion", ...axisStyle, splitLine: { show: false } }], series: [{ name: "ΔRSS", type: "bar", data: Array.from(frame.features.deltaRssDb, (v) => (Number.isFinite(v) ? v : null)), itemStyle: { color: "#e8b04b" } }, { name: "motion energy", type: "line", yAxisIndex: 1, data: Array.from(frame.features.motionEnergy, (v) => (Number.isFinite(v) ? v : null)), lineStyle: { color: "#a78bfa" } }] }} height={220} />
      </PlotFrame>
    );
  } else if (id === "spatial" || id === "inference" || id === "reconstruct") {
    const { nx, ny, nz } = frame.grid;
    const src = id === "spatial" ? frame.image : frame.occupancy;
    const data: Array<[number, number, number]> = [];
    let hi = 1e-9;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let m = 0;
        for (let k = 0; k < nz; k++) m = Math.max(m, src[i + nx * (j + ny * k)]);
        data.push([i, j, m]);
        hi = Math.max(hi, m);
      }
    sample = (
      <PlotFrame title={id === "spatial" ? "Output: posterior image (max over height)" : "Output: occupancy (max over height)"} kind="derived" units={id === "spatial" ? "model units (dB attenuation density)" : "detection confidence 0-1"}>
        <EChart option={{ grid: { left: 40, right: 60, top: 8, bottom: 28 }, tooltip: { ...tooltipStyle }, xAxis: { type: "category", data: Array.from({ length: nx }, (_, i) => ((i + 0.5) * (cfg.room.width / nx)).toFixed(1)), ...axisStyle, splitLine: { show: false } }, yAxis: { type: "category", data: Array.from({ length: ny }, (_, j) => ((j + 0.5) * (cfg.room.depth / ny)).toFixed(1)), ...axisStyle, splitLine: { show: false } }, visualMap: { min: 0, max: id === "spatial" ? hi : 1, right: 0, top: 8, itemHeight: 120, calculable: true, textStyle: { color: "#8b9ab0", fontSize: 9 }, inRange: { color: ["#080b12", "#22325a", "#3f6fd8", "#8fc2ff"] } }, series: [{ type: "heatmap", data }] }} height={240} />
      </PlotFrame>
    );
  } else if (id === "associate") {
    sample = (
      <PlotFrame title="Detections → tracks" kind="derived" units="metres (floor plane)">
        <EChart option={{ grid: { left: 40, right: 12, top: 24, bottom: 28 }, legend: { top: 0, textStyle: { color: "#8b9ab0", fontSize: 10 } }, tooltip: { trigger: "item", ...tooltipStyle }, xAxis: { type: "value", min: 0, max: cfg.room.width, ...axisStyle }, yAxis: { type: "value", min: 0, max: cfg.room.depth, ...axisStyle }, series: [{ name: "detections", type: "scatter", data: frame.detections.map((d) => [d.position[0], d.position[1], d.score]), itemStyle: { color: "#2dd4e6" } }, { name: "tracks", type: "scatter", symbolSize: 14, data: frame.tracks.map((t) => ({ value: [t.position[0], t.position[1]], name: t.id })), itemStyle: { color: "#a78bfa" } }, ...(frame.groundTruth ? [{ name: "ground truth (sim)", type: "scatter" as const, symbol: "emptyCircle", symbolSize: 14, data: frame.groundTruth.map((g) => [g.position[0], g.position[1]]), itemStyle: { color: "#f2f2f2" } }] : [])] }} height={240} />
      </PlotFrame>
    );
  } else if (id === "estimate") {
    sample = <div className="rounded-md border border-line bg-surface p-3 text-xs text-muted">This source provides channel state information directly, so least-squares channel estimation from preambles (needed for raw SDR I/Q) does not run. The SDR adapter interface is defined in packages/engine/src/runtime/source.ts but not implemented in this build.</div>;
  } else {
    const voxel = frame.detections[0];
    sample = <div className="rounded-md border border-line bg-surface p-3 text-xs text-muted">Frame #{frame.seq} serialized with transferable buffers. {voxel ? `First detection contributing links: ${contributingLinks(cfg, voxel.position).length}.` : ""}</div>;
  }
  return (
    <div className="space-y-3">
      {sample}
      {timing}
    </div>
  );
}

export type { StageRecord };
