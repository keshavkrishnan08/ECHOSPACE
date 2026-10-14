"use client";
import { useMemo, useState } from "react";
import type { ReconstructionFrame } from "@echospace/schemas";
import { SOFTWARE_VERSION, PREPROCESSING_VERSION } from "@echospace/schemas";
import { percentile, stableHash } from "@echospace/engine";
import { history } from "@/lib/engine/history";
import { useHistoryVersion } from "@/lib/engine/hooks";
import { useSession } from "@/lib/store/session";
import { machineInfo } from "@/lib/store/experiments";
import type { BenchResult } from "@/lib/engine/bench.worker";
import { EChart, axisStyle, tooltipStyle, zoomControls } from "@/components/charts/EChart";
import { Button } from "@/components/ui/button";
import { SliderField } from "@/components/ui/controls";
import { downloadBlob, fmt } from "@/lib/format";
import { PlotFrame } from "./PlotFrame";

const sum = (f: ReconstructionFrame, ids: string[]) => f.stages.filter((s) => ids.includes(s.id)).reduce((a, s) => a + s.durationMs, 0);

export function PerformanceView({ frame }: { frame: ReconstructionFrame | null }) {
  const v = useHistoryVersion(3);
  const session = useSession();
  const frames = useMemo(() => history.ordered(), [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = history.summaries.slice(-600);
  const proc = rows.map((r) => r.processingMs);
  const e2e = rows.map((r) => r.endToEndMs).filter((x): x is number => x !== null && Number.isFinite(x));
  const stat = (a: number[]) => ({ n: a.length, med: percentile(a, 0.5), p95: a.length >= 20 ? percentile(a, 0.95) : null, p99: a.length >= 100 ? percentile(a, 0.99) : null });
  const sp = stat(proc);
  const se = stat(e2e);
  const last = frame;
  const breakdown: Array<[string, string, string]> = last
    ? [
        ["Acquisition → ingestion", session.sourceMode === "synthetic" ? "N/A" : "N/A", session.sourceMode === "synthetic" ? "Synthetic packets are generated on demand; there is no acquisition latency to measure." : "Device clocks are not synchronised with the browser clock."],
        ["Buffering / queue delay", fmt(last.stages[0].queueDelayMs, 2, "ms"), "Wall time the oldest packet of the frame waited in the bounded acquisition queue."],
        ["DSP (validate → features)", fmt(sum(last, ["validate", "align", "buffer", "estimate", "preprocess", "filter", "features"]), 3, "ms"), "Sum of measured stage durations."],
        ["Model inference (spatial + inference)", fmt(sum(last, ["spatial", "inference"]), 3, "ms"), "Includes any injected delay."],
        ["Post-processing (reconstruct + associate)", fmt(sum(last, ["reconstruct", "associate"]), 3, "ms"), ""],
        ["Serialization", fmt(sum(last, ["serialize"]), 3, "ms"), "Frame assembly; transfer is zero-copy."],
        ["Transfer (worker → UI)", fmt(rows.length ? rows[rows.length - 1].receivedAtMs - last.emittedAtMs : null, 2, "ms"), "UI receive time − worker emit time (both performance.timeOrigin-based)."],
        ["Render update delay", "N/A", "Not instrumented: the viewport redraws at the display rate, independent of frame arrival."],
        ["End-to-end (wall clock)", fmt(last.metrics.endToEndMs, 2, "ms"), "UI receive − ingest of the frame's newest packet. Includes queueing and pacing, unlike processing time."],
      ]
    : [];

  return (
    <div className="space-y-3" data-testid="performance-view">
      <div className="grid gap-3 xl:grid-cols-2">
        <PlotFrame title="Rolling latency" kind="derived" units="ms" csv={() => rows.map((r) => ({ t_s: r.t, processing_ms: r.processingMs, end_to_end_ms: r.endToEndMs }))} note="Processing = sum of stage durations (CPU time in the worker). End-to-end = wall-clock incl. queueing and transfer.">
          <EChart option={{ grid: { left: 48, right: 12, top: 24, bottom: 44 }, legend: { top: 0, textStyle: { color: "#8b9ab0", fontSize: 10 } }, tooltip: { trigger: "axis", ...tooltipStyle }, xAxis: { type: "value", min: "dataMin", max: "dataMax", name: "stream time (s)", nameLocation: "middle", nameGap: 22, ...axisStyle }, yAxis: { type: "value", name: "ms", ...axisStyle }, dataZoom: zoomControls(0), series: [{ name: "processing", type: "line", showSymbol: false, data: rows.map((r) => [r.t, r.processingMs]), lineStyle: { color: "#2dd4e6", width: 1 } }, { name: "end-to-end", type: "line", showSymbol: false, data: rows.map((r) => [r.t, r.endToEndMs]), lineStyle: { color: "#a78bfa", width: 1 } }] }} height={240} testId="plot-latency" />
          <table className="num mt-2 w-full text-2xs">
            <thead className="text-faint"><tr><th className="text-left font-normal">window</th><th className="font-normal">n</th><th className="font-normal">median</th><th className="font-normal">p95</th><th className="font-normal">p99</th></tr></thead>
            <tbody>
              <tr><td>processing</td><td className="text-center">{sp.n}</td><td className="text-center">{fmt(sp.med, 2)}</td><td className="text-center">{sp.p95 === null ? "n<20" : fmt(sp.p95, 2)}</td><td className="text-center">{sp.p99 === null ? "n<100" : fmt(sp.p99, 2)}</td></tr>
              <tr><td>end-to-end</td><td className="text-center">{se.n}</td><td className="text-center">{fmt(se.med, 2)}</td><td className="text-center">{se.p95 === null ? "n<20" : fmt(se.p95, 2)}</td><td className="text-center">{se.p99 === null ? "n<100" : fmt(se.p99, 2)}</td></tr>
            </tbody>
          </table>
        </PlotFrame>
        <PlotFrame title="Latency breakdown · current frame" kind="derived" units="ms">
          <table className="w-full text-xs">
            <tbody>
              {breakdown.map(([k, val, note]) => (
                <tr key={k} className="border-b border-line-soft align-top">
                  <td className="py-1 pr-2 text-muted">{k}</td>
                  <td className="num py-1 pr-2 text-right">{val}</td>
                  <td className="py-1 text-2xs text-faint">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PlotFrame>
      </div>
      <PlotFrame title="Stage durations (stacked) over buffered frames" kind="derived" units="ms">
        <EChart option={{ grid: { left: 48, right: 12, top: 28, bottom: 44 }, legend: { top: 0, type: "scroll", textStyle: { color: "#8b9ab0", fontSize: 10 } }, tooltip: { trigger: "axis", ...tooltipStyle }, xAxis: { type: "value", min: "dataMin", max: "dataMax", ...axisStyle }, yAxis: { type: "value", name: "ms", ...axisStyle }, dataZoom: zoomControls(0), series: (frames[0]?.stages ?? []).map((s, i) => ({ name: s.label, type: "line" as const, stack: "t", areaStyle: { opacity: 0.6 }, showSymbol: false, lineStyle: { width: 0 }, color: ["#2dd4e6", "#26b8c9", "#1f9cad", "#5b8def", "#4f7bd6", "#4469bd", "#7c6bd6", "#a78bfa", "#c4b5fd", "#5fbf8f", "#e8b04b", "#8b9ab0"][i], data: frames.map((f) => [f.timestampS, f.stages[i]?.durationMs ?? 0]) })) }} height={240} />
      </PlotFrame>
      <Benchmark />
    </div>
  );
}

function Benchmark() {
  const config = useSession((s) => s.config);
  const [warmup, setWarmup] = useState(20);
  const [iters, setIters] = useState(200);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<BenchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setResult(null);
    setError(null);
    setProgress(0);
    const w = new Worker(new URL("../../lib/engine/bench.worker.ts", import.meta.url), { type: "module", name: "echospace-bench" });
    w.onmessage = (e: MessageEvent<{ type: string; done?: number; total?: number; result?: BenchResult; message?: string }>) => {
      if (e.data.type === "progress") setProgress((e.data.done ?? 0) / (e.data.total ?? 1));
      if (e.data.type === "done") {
        setResult(e.data.result!);
        setProgress(null);
        w.terminate();
      }
      if (e.data.type === "error") {
        setError(e.data.message ?? "benchmark failed");
        setProgress(null);
        w.terminate();
      }
    };
    w.postMessage({ config: { ...config, pipeline: { ...config.pipeline, injectedInferenceDelayMs: 0 } }, warmup, iterations: iters });
  };
  const exportJson = () => {
    if (!result) return;
    downloadBlob(`echospace_benchmark_${stableHash(config)}_${Date.now()}.json`, JSON.stringify({ kind: "echospace.benchmark", version: 1, measuredAt: new Date().toISOString(), software: SOFTWARE_VERSION, preprocessing: PREPROCESSING_VERSION, engine: "browser-worker (TypeScript)", model: `${config.recon.modelId}`, configHash: stableHash(config), scenario: config.scenario, seed: config.seed, machine: machineInfo(), methodology: { warmupFrames: warmup, measuredFrames: iters, pacing: "none (as fast as possible)", timer: "performance.now() in a dedicated worker" }, result, config }, null, 2), "application/json");
  };
  return (
    <PlotFrame title="Benchmark mode" kind="derived" units="fixed input, repeated frames, warm-up excluded" note="Runs the current configuration and seed in a separate worker without real-time pacing. Results describe this browser on this machine only; they are not portable performance claims.">
      <div className="grid gap-3 md:grid-cols-[260px_1fr]">
        <div className="space-y-2.5">
          <SliderField label="Warm-up frames" min={0} max={200} step={10} value={warmup} onChange={setWarmup} />
          <SliderField label="Measured frames" min={20} max={1000} step={20} value={iters} onChange={setIters} />
          <div className="flex gap-2">
            <Button variant="primary" onClick={run} disabled={progress !== null} data-testid="run-benchmark">{progress !== null ? `Running… ${(progress * 100).toFixed(0)} %` : "Run benchmark"}</Button>
            <Button onClick={exportJson} disabled={!result}>Export JSON</Button>
          </div>
          {error && <p className="text-xs text-err">{error}</p>}
        </div>
        {result ? (
          <div className="text-xs" data-testid="benchmark-result">
            <dl className="num grid grid-cols-3 gap-2 md:grid-cols-6">
              {([["init", `${result.initMs.toFixed(0)} ms`], ["frames/s", result.framesPerSecond.toFixed(1)], ["median", `${fmt(result.frame.median, 2)} ms`], ["p95", result.frame.p95 === null ? "n<20" : `${fmt(result.frame.p95, 2)} ms`], ["p99", result.frame.p99 === null ? "n<100" : `${fmt(result.frame.p99, 2)} ms`], ["timer res.", `${fmt(result.timerResolutionMs, 3)} ms`]] as Array<[string, string]>).map(([k, val]) => (
                <div key={k} className="rounded border border-line-soft bg-panel/60 p-2"><dt className="text-2xs text-muted">{k}</dt><dd className="text-sm">{val}</dd></div>
              ))}
            </dl>
            <table className="num mt-2 w-full text-2xs">
              <thead className="text-faint"><tr><th className="text-left font-normal">stage</th><th className="text-right font-normal">median ms</th><th className="text-right font-normal">p95 ms</th></tr></thead>
              <tbody>{result.stages.map((s) => <tr key={s.id} className="border-t border-line-soft"><td>{s.label}</td><td className="text-right">{fmt(s.median, 3)}</td><td className="text-right">{s.p95 === null ? "n<20" : fmt(s.p95, 3)}</td></tr>)}</tbody>
            </table>
          </div>
        ) : (
          <p className="self-center text-xs text-muted">No benchmark run in this session yet.</p>
        )}
      </div>
    </PlotFrame>
  );
}
