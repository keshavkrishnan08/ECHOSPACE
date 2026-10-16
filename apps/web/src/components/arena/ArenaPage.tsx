"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, GraduationCap, Play, RotateCcw, Save, SplitSquareHorizontal, Undo2 } from "lucide-react";
import type { EChartsOption } from "echarts";
import type { ScenarioConfig, ScenarioKey } from "@echospace/schemas";
import { METRICS, SOFTWARE_VERSION } from "@echospace/schemas";
import { SCENARIOS, scenarioByKey, type ScenarioControl } from "@echospace/engine";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { useFrame, useHistoryVersion } from "@/lib/engine/hooks";
import { history } from "@/lib/engine/history";
import { useCompareRunner } from "@/lib/engine/useCompare";
import { summarize } from "@/lib/store/experiments";
import { SceneViewport } from "@/components/viewport/SceneViewport";
import { Timeline } from "@/components/timeline/Timeline";
import { EChart, axisStyle, tooltipStyle } from "@/components/charts/EChart";
import { Metric } from "@/components/ui/metric";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectField, SliderField, Toggle } from "@/components/ui/controls";
import { Panel } from "@/components/ui/panel";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { downloadBlob, fmt, pct } from "@/lib/format";
import { cn } from "@/lib/format";
import { filterQuality, floorCoverage } from "./analysis";
import { INSTRUCTOR } from "./instructor";

const DIFF_TONE = { baseline: "ok", moderate: "signal", hard: "warn", failure: "err" } as const;

function ControlView({ ctl, config, onChange }: { ctl: ScenarioControl; config: ScenarioConfig; onChange: (c: ScenarioConfig) => void }) {
  const v = ctl.get(config);
  if (ctl.kind === "slider") return <SliderField label={ctl.label} unit={ctl.unit} help={ctl.help} min={ctl.min!} max={ctl.max!} step={ctl.step!} value={Number(v)} onChange={(x) => onChange(ctl.set(config, x))} />;
  if (ctl.kind === "toggle") return <Toggle label={ctl.label} help={ctl.help} checked={Boolean(v)} onChange={(x) => onChange(ctl.set(config, x))} />;
  return <SelectField label={ctl.label} help={ctl.help} value={String(v)} options={ctl.options!} onChange={(x) => onChange(ctl.set(config, x))} />;
}

export function ArenaPage() {
  const params = useSearchParams();
  const router = useRouter();
  const key = (params.get("s") ?? "B") as ScenarioKey;
  const def = scenarioByKey(key) ?? SCENARIOS[1];
  const s = useSession();
  const toast = useUi((u) => u.toast);
  const setSave = useUi((u) => u.setSave);
  const frame = useFrame(15);
  const v = useHistoryVersion(3);
  const [instructor, setInstructor] = useState<number | null>(null);
  const [compare, setCompare] = useState(false);
  const [draft, setDraft] = useState<ScenarioConfig>(s.config);
  const running = s.scenarioKey === def.key && s.sourceMode === "synthetic";
  const baseline = useMemo(() => def.build(s.config.seed), [def, s.config.seed]);
  const cmp = useCompareRunner(compare && running ? baseline : null, compare ? frame : null);

  useEffect(() => {
    if (!running) s.launch(def.build(), { scenarioKey: def.key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.key]);
  useEffect(() => setDraft(s.config), [s.config]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apply = (c: ScenarioConfig) => {
    setDraft(c);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => useSession.getState().applyConfig(c), 200);
  };
  const frames = useMemo(() => history.ordered(), [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const fq = useMemo(() => filterQuality(frames.slice(-300)), [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const steps = INSTRUCTOR[def.key] ?? [];

  const exportSummary = () => {
    const sums = summarize(history.summaries);
    const md = [
      `# ECHO simulation summary — scenario ${def.key}: ${def.title}`,
      "",
      `> SIMULATION RESULTS. Computed against synthetic ground truth produced by the ECHO simulator (${SOFTWARE_VERSION}); not physical measurements.`,
      "",
      `- Objective: ${def.objective}`,
      `- Seed: ${s.config.seed} · config hash: ${frame?.provenance.configHash ?? "n/a"} · model: ${frame?.provenance.modelId}@${frame?.provenance.modelVersion}`,
      `- Stream time: ${s.simTime.toFixed(1)} s · frames: ${history.summaries.length} · mid-run changes: ${s.configChanges.length}`,
      "",
      "| metric | unit | n | median | p95 | mean |",
      "|---|---|---|---|---|---|",
      ...sums.map((m) => `| ${METRICS[m.id]?.label ?? m.id} | ${METRICS[m.id]?.unit ?? ""} | ${m.n} | ${fmt(m.median, 3)} | ${m.p95 === null ? "n<20" : fmt(m.p95, 3)} | ${fmt(m.mean, 3)} |`),
      "",
      `Track jitter: ${fmt(fq.jitterM, 3, "m")} · lag: ${fmt(fq.lagS, 3, "s")}`,
      "",
      "## Events",
      ...history.events.slice(-40).map((e) => `- ${e.t.toFixed(2)} s · ${e.kind}: ${e.message}`),
    ].join("\n");
    downloadBlob(`echospace_summary_${def.key}_seed${s.config.seed}.md`, md, "text/markdown");
    downloadBlob(`echospace_summary_${def.key}_seed${s.config.seed}.json`, JSON.stringify({ kind: "echospace.simulation-summary", label: "SIMULATION — synthetic ground truth", scenario: def.key, config: s.launchConfig, configChanges: s.configChanges, summaries: sums, filterQuality: fq, events: history.events.slice(-200) }, null, 2), "application/json");
    toast("Exported Markdown + JSON summary", "ok");
  };

  // ΔRSS heatmap: links × time
  const heat: EChartsOption | null = useMemo(() => {
    const fr = frames.slice(-150);
    if (fr.length < 2 || !s.info) return null;
    const L = s.info.links.length;
    const data: Array<[number, number, number]> = [];
    fr.forEach((f, i) => {
      for (let l = 0; l < L; l++) {
        const d = f.features.deltaRssDb[l];
        if (Number.isFinite(d)) data.push([i, l, d]);
      }
    });
    return {
      grid: { left: 64, right: 52, top: 8, bottom: 28 },
      tooltip: { ...tooltipStyle },
      xAxis: { type: "category", data: fr.map((f) => f.timestampS.toFixed(1)), ...axisStyle, splitLine: { show: false } },
      yAxis: { type: "category", data: s.info.links.map((l) => l.id), ...axisStyle, axisLabel: { ...axisStyle.axisLabel, fontSize: 8 }, splitLine: { show: false } },
      visualMap: { min: -2, max: 6, right: 0, top: 8, itemHeight: 110, calculable: true, textStyle: { color: "#8b9ab0", fontSize: 9 }, inRange: { color: ["#1f3c88", "#080b12", "#e8b04b", "#fff3d6"] } },
      series: [{ type: "heatmap", data }],
    };
  }, [v, s.info]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = frame?.metrics;
  return (
    <div className="flex h-full min-h-0">
      <aside aria-label="Scenarios" className="w-60 shrink-0 overflow-y-auto border-r border-line bg-surface p-2">
        <h2 className="px-2 pb-2 pt-1 text-2xs font-semibold uppercase tracking-[0.08em] text-muted">Scenarios</h2>
        <ul className="space-y-1">
          {SCENARIOS.map((sc) => (
            <li key={sc.key}>
              <button
                type="button"
                onClick={() => router.push(`/arena?s=${sc.key}`)}
                aria-current={sc.key === def.key ? "true" : undefined}
                data-testid={`scenario-${sc.key}`}
                className={cn("w-full rounded-md border px-2.5 py-2 text-left", sc.key === def.key ? "border-signal/50 bg-signal/10" : "border-transparent hover:border-line hover:bg-panel")}
              >
                <div className="flex items-center gap-2">
                  <span className="num text-signal">{sc.key}</span>
                  <span className="flex-1 truncate text-xs font-medium">{sc.title}</span>
                </div>
                <div className="mt-1"><Badge tone={DIFF_TONE[sc.difficulty]}>{sc.difficulty}</Badge></div>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="space-y-2 border-b border-line bg-surface px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="num text-lg text-signal">{def.key}</span>
              <h1 className="text-base font-semibold">{def.title}</h1>
              <Badge tone="signal">Synthetic simulation</Badge>
              {s.variantId && <Badge tone="err">variant: {s.variantId}</Badge>}
            </div>
            <p className="mt-1 max-w-3xl text-xs text-muted"><span className="text-fg">Objective.</span> {def.objective}</p>
            <p className="mt-0.5 max-w-3xl text-xs text-faint"><span className="text-muted">Expected lesson.</span> {def.lesson}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="primary" onClick={() => s.launch(def.build(s.config.seed), { scenarioKey: def.key })} data-testid="arena-launch"><Play className="h-3.5 w-3.5" /> {running ? "Relaunch defaults" : "Launch"}</Button>
            <Button onClick={s.restart}><RotateCcw className="h-3.5 w-3.5" /> Restart</Button>
            <Button onClick={() => apply(baseline)} title="Reset all controls to the scenario baseline"><Undo2 className="h-3.5 w-3.5" /> Reset to baseline</Button>
            <Button onClick={() => setSave(true)}><Save className="h-3.5 w-3.5" /> Save experiment</Button>
            <Button onClick={exportSummary} data-testid="export-summary"><Download className="h-3.5 w-3.5" /> Export summary</Button>
            <Button variant={instructor !== null ? "active" : "default"} onClick={() => setInstructor(instructor === null ? 0 : null)} aria-pressed={instructor !== null}><GraduationCap className="h-3.5 w-3.5" /> Instructor mode</Button>
            <Button variant={compare ? "active" : "default"} onClick={() => setCompare(!compare)} aria-pressed={compare} data-testid="compare-toggle"><SplitSquareHorizontal className="h-3.5 w-3.5" /> Compare with baseline</Button>
          </div>
        </header>
        {instructor !== null && steps.length > 0 && (
          <div className="mx-4 mt-3 flex items-start gap-3 rounded-md border border-signal/40 bg-signal/5 p-3 text-xs" role="note" data-testid="instructor">
            <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
            <div className="flex-1">
              <div className="text-2xs uppercase tracking-wider text-signal">Step {instructor + 1} / {steps.length}</div>
              <p className="mt-0.5 text-fg">{steps[instructor].text}</p>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={instructor === 0} onClick={() => setInstructor(instructor - 1)}>Back</Button>
              {instructor < steps.length - 1 ? (
                <Button size="sm" variant="primary" onClick={() => { const nx = steps[instructor + 1]; if (nx.apply) apply(nx.apply(s.config)); setInstructor(instructor + 1); }}>Next{steps[instructor + 1].apply ? " (applies change)" : ""}</Button>
              ) : (
                <Button size="sm" onClick={() => setInstructor(null)}>Done</Button>
              )}
            </div>
          </div>
        )}
        <div className="grid gap-3 p-4 2xl:grid-cols-[1fr_340px]">
          <div className="space-y-3">
            <div className={cn("grid gap-3", compare && "lg:grid-cols-2")}>
              <Panel title={compare ? "Current configuration" : "Live view"} className="h-[440px]" bodyClassName="p-0">
                <ErrorBoundary label="Arena viewport">
                  <SceneViewport frame={frame} config={s.config} info={s.info} hideToolbar={compare} />
                </ErrorBoundary>
              </Panel>
              {compare && (
                <Panel title="Baseline (same seed, default controls)" className="h-[440px]" bodyClassName="p-0">
                  {cmp.error ? <p className="p-3 text-xs text-err">{cmp.error}</p> : <SceneViewport frame={cmp.frame} config={baseline} info={null} variant="preview" />}
                </Panel>
              )}
            </div>
            {compare && (
              <Panel title="Current vs baseline at the same timestamp" dense>
                <table className="num w-full text-xs" data-testid="compare-table">
                  <thead className="text-2xs text-faint"><tr><th className="text-left font-normal">metric</th><th className="font-normal">current</th><th className="font-normal">baseline</th></tr></thead>
                  <tbody>
                    {(["inputQuality", "meanConfidence", "positionErrorM", "floorIou", "recall", "precision", "processingMs"] as const).map((k) => (
                      <tr key={k} className="border-t border-line-soft">
                        <td className="py-0.5 text-muted">{METRICS[k]?.label ?? k}</td>
                        <td className="text-center">{fmt(frame?.metrics[k] as number | null, 3)}</td>
                        <td className="text-center">{fmt(cmp.frame?.metrics[k] as number | null, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            )}
            <Panel title="Calibrated attenuation ΔRSS · links × time (derived)" dense>
              {heat ? <EChart option={heat} height={Math.min(420, 60 + (s.info?.links.length ?? 4) * 9)} testId="arena-heatmap" /> : <p className="p-2 text-xs text-muted">Waiting for frames…</p>}
            </Panel>
            <Panel title="Timeline" dense><Timeline /></Panel>
          </div>
          <div className="space-y-3">
            <Panel title="Simulation metrics" dense>
              <div className="grid grid-cols-2 gap-1.5" data-testid="arena-metrics">
                <Metric id="positionErrorM" value={fmt(m?.positionErrorM, 2, "m")} />
                <Metric id="recall" value={fmt(m?.recall, 2)} />
                <Metric id="precision" value={fmt(m?.precision, 2)} />
                <Metric id="floorIou" value={fmt(m?.floorIou, 2)} />
                <Metric id="idSwitchesTotal" value={m ? String(m.idSwitchesTotal) : "N/A"} />
                <Metric id="activeTracks" value={m ? String(m.activeTracks) : "N/A"} tone="track" />
                <Metric id="meanConfidence" value={m ? m.meanConfidence.toFixed(3) : "N/A"} />
                <Metric id="inputQuality" value={m ? m.inputQuality.toFixed(2) : "N/A"} tone={m && m.inputQuality < 0.5 ? "warn" : undefined} />
                <Metric id="coverage" value={frame ? pct(floorCoverage(frame)) : "N/A"} />
                <Metric id="endToEndMs" label="Update delay" value={fmt(m?.endToEndMs, 0, "ms")} />
                <Metric id="jitterM" value={fmt(fq.jitterM, 3, "m")} />
                <Metric id="lagS" value={fmt(fq.lagS, 2, "s")} />
              </div>
              <p className="mt-2 text-2xs text-faint">Simulation metrics: computed from this run’s synthetic ground truth and model output.</p>
              {frame && frame.capability.modelStatus !== "ok" && <p className="mt-2 rounded border border-warn/30 bg-warn/5 p-2 text-2xs text-warn" data-testid="arena-capability">{frame.capability.modelMessage}</p>}
            </Panel>
            <Panel title="Parameters" dense>
              <div className="space-y-2.5">
                {def.controls.map((c) => <ControlView key={c.id} ctl={c} config={draft} onChange={apply} />)}
              </div>
            </Panel>
            {def.variants && (
              <Panel title="Failure variants" dense>
                <ul className="space-y-1.5">
                  {def.variants.map((vr) => (
                    <li key={vr.id}>
                      <button type="button" data-testid={`variant-${vr.id}`} onClick={() => s.launch(vr.apply(def.build(s.config.seed)), { scenarioKey: def.key, variantId: vr.id })} className={cn("w-full rounded border p-2 text-left text-xs", s.variantId === vr.id ? "border-err/50 bg-err/5" : "border-line-soft hover:border-line")}>
                        <div className="font-medium">{vr.label}</div>
                        <div className="text-2xs text-muted">{vr.description}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            <Panel title="Event log" dense>
              <ul className="max-h-64 space-y-0.5 overflow-y-auto text-2xs" data-testid="event-log">
                {history.events.length === 0 && <li className="text-faint">No events yet.</li>}
                {history.events.slice(-60).reverse().map((e, i) => (
                  <li key={i} className={e.severity === "error" ? "text-err" : e.severity === "warning" ? "text-warn" : "text-muted"}>
                    <span className="num text-faint">{e.t.toFixed(2)}s</span> {e.message}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
