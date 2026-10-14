"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ModelCard } from "@echospace/schemas";
import { useSession } from "@/lib/store/session";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Markdown } from "./Markdown";

export function ModelsPage() {
  const reg = useQuery({
    queryKey: ["registry"],
    queryFn: async () => {
      const r = await fetch("/models/registry.json", { cache: "no-store" });
      if (!r.ok) throw new Error(`registry not found (${r.status}) — run node scripts/sync-models.mjs`);
      return (await r.json() as unknown[]).map((x) => ModelCard.parse(x));
    },
  });
  const [sel, setSel] = useState<string | null>(null);
  const card = useQuery({
    queryKey: ["card", sel],
    enabled: !!sel,
    queryFn: async () => {
      const r = await fetch(`/models/cards/${sel}.md`);
      return r.ok ? r.text() : null;
    },
  });
  const s = useSession();
  const active = s.config.recon.modelId;
  if (reg.isLoading) return <LoadingState />;
  if (reg.error) return <ErrorState title="Model registry unavailable">{String(reg.error)}</ErrorState>;
  const models = reg.data ?? [];
  const cur = models.find((m) => m.id === sel) ?? null;
  return (
    <div className="h-full overflow-y-auto p-4" data-testid="models-page">
      <div className="mb-3 flex items-baseline gap-3">
        <h1 className="text-base font-semibold">Model registry</h1>
        <p className="text-xs text-muted">Every model declares its schemas, confidence semantics, limitations and evaluation provenance. Slots without trained weights are listed but cannot run.</p>
      </div>
      <div className="grid gap-3 xl:grid-cols-[1fr_520px]">
        <div className="grid content-start gap-3 md:grid-cols-2">
          {models.map((m) => (
            <button key={m.id} type="button" onClick={() => setSel(m.id)} className={`rounded-md border bg-surface p-3 text-left transition-colors ${sel === m.id ? "border-signal/60" : "border-line hover:border-faint"}`} data-testid={`model-${m.id}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{m.name}</span>
                <Badge tone={m.status === "available" ? "ok" : m.status === "experimental" ? "warn" : "neutral"}>{m.status}</Badge>
                {active === m.id && <Badge tone="signal">active</Badge>}
              </div>
              <div className="num mt-0.5 text-2xs text-muted">{m.id}@{m.version} · {m.family}</div>
              <p className="mt-1.5 line-clamp-3 text-xs text-muted">{m.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">{m.supportedTasks.map((t) => <Badge key={t}>{t}</Badge>)}{m.providesJoints ? <Badge tone="track">joints</Badge> : <Badge>no joints</Badge>}</div>
            </button>
          ))}
        </div>
        <Panel title={cur ? `${cur.name} · model card` : "Model card"}>
          {!cur ? (
            <EmptyState title="Select a model" />
          ) : (
            <div className="space-y-3 text-xs">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {([
                  ["Identifier", `${cur.id}@${cur.version}`],
                  ["Input schema", cur.inputSchema],
                  ["Output schema", cur.outputSchema],
                  ["Preprocessing", cur.preprocessingVersion],
                  ["Inference device", cur.inferenceDevice],
                  ["Confidence semantics", cur.confidenceSemantics],
                  ["Training data", cur.trainingDataset ?? "none (no training)"],
                ] as Array<[string, string]>).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>)}
              </dl>
              <div>
                <div className="text-2xs uppercase tracking-wider text-muted">Known limitations</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">{cur.knownLimitations.map((l) => <li key={l}>{l}</li>)}</ul>
              </div>
              {cur.requirements.length > 0 && <div><div className="text-2xs uppercase tracking-wider text-muted">Requirements</div><ul className="mt-1 list-disc pl-4">{cur.requirements.map((l) => <li key={l}>{l}</li>)}</ul></div>}
              <div>
                <div className="text-2xs uppercase tracking-wider text-muted">Evaluation history</div>
                {cur.evaluation.length === 0 ? <p className="text-faint">No evaluations recorded.</p> : (
                  <table className="num mt-1 w-full text-2xs"><thead className="text-faint"><tr><th className="text-left font-normal">dataset</th><th className="font-normal">split</th><th className="font-normal">metric</th><th className="font-normal">value</th></tr></thead>
                    <tbody>{cur.evaluation.map((e, i) => <tr key={i} className="border-t border-line-soft"><td>{e.dataset}</td><td className="text-center">{e.split}</td><td className="text-center">{e.metric}</td><td className="text-center">{e.value.toFixed(3)}</td></tr>)}</tbody>
                  </table>
                )}
                {cur.evaluation.some((e) => e.note) && <p className="mt-1 text-2xs text-faint">{cur.evaluation.find((e) => e.note)?.note}</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="primary" disabled={cur.status === "unavailable" || active === cur.id} onClick={() => s.applyConfig({ ...s.config, recon: { ...s.config.recon, modelId: cur.id as typeof s.config.recon.modelId } })}>Use in current session</Button>
              </div>
              {card.data && <div className="border-t border-line pt-3"><Markdown source={card.data} /></div>}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
