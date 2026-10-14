"use client";
import { Fragment, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ExperimentRecord } from "@echospace/schemas";
import { METRICS } from "@echospace/schemas";
import { useExperiments } from "@/lib/api/experiments";
import { Panel } from "@/components/ui/panel";
import { SelectField } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { downloadBlob, fmt, toCsv } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { diffPaths, short } from "./diff";

const COLORS = ["#2dd4e6", "#a78bfa", "#e8b04b", "#5fbf8f", "#e5636a", "#5b8def"];
const GROUPS: Array<{ title: string; ids: string[] }> = [
  { title: "Input quality", ids: ["inputQuality", "packetDeliveryRatio", "meanSnrDb"] },
  { title: "Reconstruction error (simulation)", ids: ["positionErrorM", "floorIou", "voxelIou", "chamferM", "precision", "recall"] },
  { title: "Confidence", ids: ["meanConfidence", "observedFraction"] },
  { title: "Tracking", ids: ["activeTracks", "idSwitchesTotal"] },
  { title: "Systems", ids: ["processingMs", "endToEndMs"] },
];

export function CompareExperiments({ ids, setIds }: { ids: string[]; setIds: (ids: string[]) => void }) {
  const exps = useExperiments();
  const [metric, setMetric] = useState("positionErrorM");
  const all = exps.data?.items.map((x) => x.record) ?? [];
  const sel = ids.map((id) => all.find((r) => r.id === id)).filter((r): r is ExperimentRecord => !!r);
  const base = sel[0];
  const chart = useMemo(() => {
    const rows = new Map<number, Record<string, number | null>>();
    sel.forEach((r, i) => {
      const s = r.series.find((x) => x.id === metric);
      s?.t.forEach((t, j) => {
        const k = Math.round(t * 10) / 10;
        rows.set(k, { ...(rows.get(k) ?? { t: k }), [`e${i}`]: s.v[j] });
      });
    });
    return [...rows.values()].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  }, [sel, metric]);
  const diffs = useMemo(() => (sel.length >= 2 ? sel.slice(1).map((r) => ({ id: r.id, d: diffPaths(base.config, r.config) })) : []), [sel, base]);
  const exportCsv = () => {
    const rows = GROUPS.flatMap((g) =>
      g.ids.map((id) => {
        const row: Record<string, unknown> = { group: g.title, metric: id };
        for (const r of sel) row[r.id] = r.summaries.find((x) => x.id === id)?.median ?? null;
        return row;
      }),
    );
    downloadBlob("echospace_comparison.csv", toCsv(rows, { baseline: base?.id ?? "", note: "medians; simulation metrics are against synthetic ground truth" }), "text/csv");
  };
  if (!all.length) return <EmptyState title="No experiments to compare">Save at least two runs first.</EmptyState>;
  return (
    <div className="space-y-3" data-testid="compare-experiments">
      <Panel title="Selection" dense>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {sel.map((r, i) => (
            <Badge key={r.id} tone={i === 0 ? "signal" : "neutral"}>
              <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              {i === 0 ? "baseline · " : ""}{r.name}
              <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setIds(ids.filter((x) => x !== r.id))} className="ml-1 text-muted hover:text-fg">×</button>
            </Badge>
          ))}
          <div className="w-72">
            <SelectField value="" options={[{ value: "", label: "Add experiment…", disabled: true }, ...all.filter((r) => !ids.includes(r.id)).map((r) => ({ value: r.id, label: `${r.name} (${r.id})` }))]} onChange={(v) => v && setIds([...ids, v])} />
          </div>
        </div>
        <p className="mt-2 text-2xs text-faint">The first experiment is the baseline for deltas. Inputs are comparable only when seeds and scenarios match; differing configuration is listed below.</p>
      </Panel>
      {sel.length < 2 ? (
        <EmptyState title="Select two or more experiments" />
      ) : (
        <>
          <Panel title="Synchronised metric over stream time" actions={<div className="w-56"><SelectField value={metric} options={Object.values(METRICS).filter((m) => sel[0].series.some((s) => s.id === m.id)).map((m) => ({ value: m.id, label: `${m.label} [${m.unit}]` }))} onChange={setMetric} /></div>}>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={chart} margin={{ left: 0, right: 12, top: 8, bottom: 0 }} syncId="cmp">
                  <CartesianGrid stroke="#1a2332" />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} stroke="#5c6b81" fontSize={10} unit=" s" />
                  <YAxis stroke="#5c6b81" fontSize={10} width={44} />
                  <Tooltip contentStyle={{ background: "#1a2333", border: "1px solid #273244", fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {sel.map((r, i) => <Line key={r.id} name={r.name} dataKey={`e${i}`} dot={false} stroke={COLORS[i % COLORS.length]} strokeWidth={1.3} isAnimationActive={false} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Metric deltas vs baseline (medians)" actions={<Button size="sm" variant="ghost" onClick={exportCsv}>CSV</Button>}>
            <table className="num w-full text-xs">
              <thead className="text-2xs text-faint"><tr><th className="text-left font-normal">metric</th>{sel.map((r, i) => <th key={r.id} className="font-normal" style={{ color: COLORS[i % COLORS.length] }}>{i === 0 ? "baseline" : r.id}</th>)}</tr></thead>
              <tbody>
                {GROUPS.map((g) => (
                  <Fragment key={g.title}>
                    <tr><td colSpan={sel.length + 1} className="pt-2 text-2xs uppercase tracking-wider text-muted">{g.title}</td></tr>
                    {g.ids.map((id) => {
                      const b = base.summaries.find((x) => x.id === id)?.median ?? null;
                      const better = METRICS[id]?.better;
                      return (
                        <tr key={id} className="border-t border-line-soft">
                          <td className="py-0.5 text-left text-muted">{METRICS[id]?.label ?? id}</td>
                          {sel.map((r, i) => {
                            const v = r.summaries.find((x) => x.id === id)?.median ?? null;
                            const d = i > 0 && v !== null && b !== null ? v - b : null;
                            const good = d !== null && d !== 0 && better !== "none" ? (better === "lower" ? d < 0 : d > 0) : null;
                            return <td key={r.id} className="text-center">{fmt(v, 3)}{d !== null && <span className={good === null ? "text-faint" : good ? "text-ok" : "text-err"}> ({d >= 0 ? "+" : ""}{d.toFixed(3)})</span>}</td>;
                          })}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
                <tr><td colSpan={sel.length + 1} className="pt-2 text-2xs uppercase tracking-wider text-muted">Failure events</td></tr>
                <tr className="border-t border-line-soft"><td className="text-left text-muted">capability / error events</td>{sel.map((r) => <td key={r.id} className="text-center">{r.events.filter((e) => e.kind === "capability" || e.kind === "error").length}</td>)}</tr>
              </tbody>
            </table>
          </Panel>
          <Panel title="Configuration differences">
            {diffs.map(({ id, d }) => (
              <div key={id} className="mb-2">
                <div className="text-xs text-muted">baseline → {id}: {d.length ? `${d.length} differing fields` : "identical configuration"}</div>
                <ul className="num mt-1 space-y-0.5 text-2xs">
                  {d.slice(0, 40).map((x) => <li key={x.path}><span className="text-signal">{x.path}</span>: {short(x.a)} → {short(x.b)}</li>)}
                </ul>
              </div>
            ))}
          </Panel>
        </>
      )}
    </div>
  );
}
