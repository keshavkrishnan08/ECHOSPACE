"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCircle2, Copy, Download, PlayCircle, Trash2, XCircle } from "lucide-react";
import type { ExperimentRecord } from "@echospace/schemas";
import { METRICS } from "@echospace/schemas";
import { canonicalJson } from "@echospace/engine";
import { useExperiments } from "@/lib/api/experiments";
import { localExperiments } from "@/lib/store/experiments";
import { useReplay } from "@/lib/store/replay";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { apiFetch } from "@/lib/api/client";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { downloadBlob, duration, fmt, timeAgo, toCsv } from "@/lib/format";
import { cn } from "@/lib/format";

export function reportMarkdown(r: ExperimentRecord): string {
  return [
    `# Experiment report — ${r.name}`,
    "",
    r.sourceMode === "synthetic" ? "> SIMULATION: all metrics are computed against synthetic ground truth from the ECHOSPACE simulator. They are not physical measurements." : `> Source: ${r.sourceMode}. Simulation metrics are unavailable without ground truth.`,
    "",
    "| field | value |",
    "|---|---|",
    `| id | ${r.id} |`,
    `| scenario / seed | ${r.config.scenario} / ${r.config.seed} |`,
    `| config hash | ${r.configHash} |`,
    `| model | ${r.modelId}@${r.modelVersion} |`,
    `| preprocessing | ${r.preprocessingVersion} |`,
    `| engine / device | ${r.engine} / ${r.inferenceDevice} |`,
    `| software | ${r.softwareVersion} |`,
    `| started / ended | ${r.startedAt} / ${r.endedAt ?? "—"} |`,
    `| stream time / frames | ${r.simulatedDurationS.toFixed(1)} s / ${r.frames} |`,
    `| mid-run changes | ${r.configChanges.length} |`,
    `| replay digest (${r.replayDigestFrames} frames) | ${r.replayDigest ?? "not available"} |`,
    `| machine | ${r.machine?.userAgent ?? "unknown"}; ${r.machine?.hardwareConcurrency ?? "?"} threads; GPU ${r.machine?.gpu ?? "unknown"} |`,
    "",
    "## Metrics",
    "",
    "| metric | unit | n | median | p95 | mean | min | max |",
    "|---|---|---|---|---|---|---|---|",
    ...r.summaries.map((m) => `| ${METRICS[m.id]?.label ?? m.id} | ${METRICS[m.id]?.unit ?? ""} | ${m.n} | ${fmt(m.median, 3)} | ${m.p95 === null ? "n<20" : fmt(m.p95, 3)} | ${fmt(m.mean, 3)} | ${fmt(m.min, 3)} | ${fmt(m.max, 3)} |`),
    "",
    "## Metric definitions",
    ...r.summaries.map((m) => `- **${METRICS[m.id]?.label ?? m.id}** — ${METRICS[m.id]?.definition ?? "n/a"}`),
    "",
    "## Notes",
    r.notes || "_none_",
    "",
    "## Events (last 50)",
    ...r.events.slice(-50).map((e) => `- ${e.t.toFixed(2)} s · ${e.kind}: ${e.message}`),
  ].join("\n");
}

function ReplayBadge({ id }: { id: string }) {
  const r = useReplay();
  if (r.experimentId !== id) return null;
  if (r.status === "running") return <Badge tone="signal">Replaying… verifying first 40 frames</Badge>;
  if (r.status === "verified") return <Badge tone="ok"><CheckCircle2 className="h-3 w-3" /> Replay reproduced (digest match)</Badge>;
  if (r.status === "mismatch") return <Badge tone="err"><XCircle className="h-3 w-3" /> Replay digest mismatch</Badge>;
  if (r.status === "unverifiable") return <Badge tone="warn">Replayed — no stored digest to verify</Badge>;
  return null;
}

export function ExperimentsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const sel = params.get("id");
  const exps = useExperiments();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const replay = useReplay((s) => s.start);
  const [checked, setChecked] = useState<string[]>([]);
  const items = exps.data?.items ?? [];
  const cur = items.find((x) => x.record.id === sel)?.record ?? items[0]?.record ?? null;

  const remove = async (r: ExperimentRecord) => {
    await localExperiments.remove(r.id);
    try {
      await apiFetch(`/api/experiments/${r.id}`, { method: "DELETE" });
    } catch {
      /* API optional */
    }
    await qc.invalidateQueries({ queryKey: ["experiments"] });
    toast(`Deleted ${r.id}`, "ok");
    router.replace("/experiments");
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[360px_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-line bg-surface">
        <div className="flex h-10 items-center justify-between border-b border-line px-3">
          <h1 className="text-sm font-semibold">Experiments</h1>
          <Button size="sm" disabled={checked.length < 2} onClick={() => router.push(`/workbench?compare=${checked.join(",")}`)} data-testid="compare-selected">Compare {checked.length || ""}</Button>
        </div>
        {exps.data?.apiError && <p className="border-b border-line-soft px-3 py-1.5 text-2xs text-faint">API offline — showing experiments stored in this browser.</p>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {exps.isLoading ? <LoadingState /> : !items.length ? (
            <EmptyState title="No experiments yet">Run a scenario and press Save run (S).</EmptyState>
          ) : (
            <ul>
              {items.map(({ record: r, origin }) => (
                <li key={r.id} className={cn("flex items-start gap-2 border-b border-line-soft px-3 py-2", cur?.id === r.id && "bg-signal/5")}>
                  <input type="checkbox" aria-label={`Select ${r.name} for comparison`} className="mt-1 accent-[#2dd4e6]" checked={checked.includes(r.id)} onChange={(e) => setChecked(e.target.checked ? [...checked, r.id] : checked.filter((x) => x !== r.id))} />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => router.replace(`/experiments?id=${r.id}`)} data-testid={`experiment-${r.id}`}>
                    <div className="truncate text-xs font-medium">{r.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-2xs text-muted">
                      <Badge tone={r.sourceMode === "synthetic" ? "signal" : "geometry"}>{r.sourceMode}</Badge>
                      <span className="num">{r.modelId}</span>
                      <span>· {timeAgo(r.startedAt)}</span>
                      <span className="text-faint">· {origin}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
      <div className="min-h-0 overflow-y-auto p-4">
        {!cur ? (
          <EmptyState title="Select an experiment" />
        ) : (
          <div className="space-y-3" data-testid="experiment-detail">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{cur.name}</h2>
              <Badge tone={cur.status === "completed" ? "ok" : "warn"}>{cur.status}</Badge>
              <ReplayBadge id={cur.id} />
              <div className="ml-auto flex flex-wrap gap-1.5">
                <Button variant="primary" onClick={() => { replay(cur); router.push("/lab"); }} data-testid="replay-experiment"><PlayCircle className="h-3.5 w-3.5" /> Replay</Button>
                <Button onClick={() => { useSession.getState().launch(cur.config, { scenarioKey: cur.config.scenario }); toast("Configuration loaded into a new session", "ok"); }}><Copy className="h-3.5 w-3.5" /> Reproduce config</Button>
                <Button onClick={() => downloadBlob(`${cur.id}_config.json`, JSON.stringify({ kind: "echospace.experiment-config", experimentId: cur.id, configHash: cur.configHash, sourceMode: cur.sourceMode, config: cur.config, configChanges: cur.configChanges }, null, 2), "application/json")}><Download className="h-3.5 w-3.5" /> Config JSON</Button>
                <Button onClick={() => downloadBlob(`${cur.id}_metrics.csv`, toCsv(cur.series.length ? cur.series[0].t.map((t, i) => Object.fromEntries([["t_s", t], ...cur.series.map((s) => [s.id, s.v[i]])])) : [], { experiment: cur.id, source_mode: cur.sourceMode, simulation_metrics: cur.sourceMode === "synthetic" ? "computed against synthetic ground truth" : "n/a", model: `${cur.modelId}@${cur.modelVersion}` }), "text/csv")}>CSV</Button>
                <Button onClick={() => downloadBlob(`${cur.id}_report.md`, reportMarkdown(cur), "text/markdown")} data-testid="export-report">Report</Button>
                <Button onClick={() => downloadBlob(`${cur.id}.json`, canonicalJson({ kind: "echospace.experiment", ...cur }), "application/json")}>Full JSON</Button>
                <Button variant="danger" onClick={() => remove(cur)} aria-label="Delete experiment"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
            <div className="grid gap-3 xl:grid-cols-3">
              <Panel title="Configuration & provenance">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  {([
                    ["Scenario", `${cur.config.scenario} · ${cur.config.name}`],
                    ["Seed", cur.config.seed],
                    ["Source", cur.sourceMode],
                    ["Sensors / links", `${cur.config.sensors.length} nodes`],
                    ["Model", `${cur.modelId}@${cur.modelVersion}`],
                    ["Preprocessing", cur.preprocessingVersion],
                    ["Engine", cur.engine],
                    ["Device", cur.inferenceDevice],
                    ["Software", cur.softwareVersion],
                    ["Config hash", cur.configHash],
                    ["Mid-run changes", cur.configChanges.length],
                    ["Replay digest", cur.replayDigest ? `${cur.replayDigest.slice(0, 16)}… (${cur.replayDigestFrames} frames)` : "not available"],
                    ["Live run reproducible", cur.liveRunReproducible === null ? "unknown" : cur.liveRunReproducible ? "yes" : "no (backpressure dropped data under load)"],
                    ["Duration", duration(cur.simulatedDurationS)],
                    ["Machine", `${cur.machine?.hardwareConcurrency ?? "?"} threads · ${cur.machine?.gpu ?? "GPU unknown"}`],
                  ] as Array<[string, React.ReactNode]>).map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="num truncate">{v}</dd></div>
                  ))}
                </dl>
                {cur.notes && <p className="mt-2 text-xs text-muted">{cur.notes}</p>}
              </Panel>
              <Panel title="Metric summaries" className="xl:col-span-2">
                <table className="num w-full text-xs">
                  <thead className="text-2xs text-faint"><tr><th className="text-left font-normal">metric</th><th className="font-normal">n</th><th className="font-normal">median</th><th className="font-normal">p95</th><th className="font-normal">mean</th><th className="font-normal">last</th></tr></thead>
                  <tbody>
                    {cur.summaries.map((m) => (
                      <tr key={m.id} className="border-t border-line-soft">
                        <td className="py-0.5 text-left text-muted">{METRICS[m.id]?.label ?? m.id} <span className="text-faint">[{METRICS[m.id]?.unit}]</span>{METRICS[m.id]?.kind === "simulation" && <span className="ml-1 text-[9px] text-warn">SIM</span>}</td>
                        <td className="text-center">{m.n}</td>
                        <td className="text-center">{fmt(m.median, 3)}</td>
                        <td className="text-center">{m.p95 === null ? "n<20" : fmt(m.p95, 3)}</td>
                        <td className="text-center">{fmt(m.mean, 3)}</td>
                        <td className="text-center">{fmt(m.last, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {(["positionErrorM", "meanConfidence", "inputQuality", "processingMs"] as const).map((k) => {
                const s = cur.series.find((x) => x.id === k);
                const data = s ? s.t.map((t, i) => ({ t: Number(t.toFixed(2)), v: s.v[i] })) : [];
                return (
                  <Panel key={k} title={`${METRICS[k]?.label ?? k} [${METRICS[k]?.unit}]`}>
                    <div className="h-44">
                      <ResponsiveContainer>
                        <LineChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                          <CartesianGrid stroke="#1a2332" />
                          <XAxis dataKey="t" stroke="#5c6b81" fontSize={10} type="number" domain={["dataMin", "dataMax"]} />
                          <YAxis stroke="#5c6b81" fontSize={10} width={40} />
                          <Tooltip contentStyle={{ background: "#1a2333", border: "1px solid #273244", fontSize: 11 }} />
                          <Line dataKey="v" dot={false} stroke={k === "positionErrorM" ? "#f2f2f2" : k === "meanConfidence" ? "#5fbf8f" : k === "inputQuality" ? "#2dd4e6" : "#a78bfa"} strokeWidth={1.2} isAnimationActive={false} connectNulls={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </Panel>
                );
              })}
            </div>
            <Panel title={`Events (${cur.events.length})`}>
              <ul className="max-h-60 space-y-0.5 overflow-y-auto text-2xs">
                {cur.events.slice(-120).map((e, i) => <li key={i} className="text-muted"><span className="num text-faint">{e.t.toFixed(2)}s</span> {e.kind}: {e.message}</li>)}
              </ul>
            </Panel>
            <p className="text-2xs text-faint">Compare runs in the <Link className="text-signal hover:underline" href={`/workbench?compare=${cur.id}`}>Research Workbench</Link>.</p>
          </div>
        )}
      </div>
    </div>
  );
}
