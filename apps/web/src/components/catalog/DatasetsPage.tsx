"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DatasetManifest } from "@echospace/schemas";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { exportSyntheticSample } from "@/lib/recording/import";
import Link from "next/link";

async function loadManifests(): Promise<Array<{ file: string; manifest: DatasetManifest | null; error: string | null }>> {
  const idx = await fetch("/datasets/index.json", { cache: "no-store" });
  if (!idx.ok) return [];
  const files = (await idx.json()) as string[];
  return Promise.all(
    files.map(async (file) => {
      try {
        const r = await fetch(`/datasets/${file}`);
        const parsed = DatasetManifest.safeParse(await r.json());
        return parsed.success ? { file, manifest: parsed.data, error: null } : { file, manifest: null, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
      } catch (e) {
        return { file, manifest: null, error: String(e) };
      }
    }),
  );
}

export function DatasetsPage() {
  const q = useQuery({ queryKey: ["datasets"], queryFn: loadManifests });
  const [sel, setSel] = useState<string | null>(null);
  const items = q.data ?? [];
  const cur = items.find((x) => x.file === sel)?.manifest ?? items.find((x) => x.manifest)?.manifest ?? null;
  return (
    <div className="h-full overflow-y-auto p-4" data-testid="datasets-page">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h1 className="text-base font-semibold">Datasets</h1>
        <p className="text-xs text-muted">Manifests record provenance, licence, usage restrictions, capture method, consent and splits. Public datasets are never assumed to permit every use.</p>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => exportSyntheticSample(3)}>Generate 3 s synthetic sample</Button>
          <Link href="/studio?tab=sources"><Button>Import a recording…</Button></Link>
        </div>
      </div>
      {q.isLoading ? <LoadingState /> : !items.length ? (
        <EmptyState title="No dataset manifests found">Add manifests to datasets/manifests/ and run node scripts/sync-models.mjs.</EmptyState>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[1fr_480px]">
          <Panel title="Manifests" bodyClassName="p-0">
            <table className="w-full text-xs">
              <thead className="text-left text-2xs uppercase tracking-wider text-faint">
                <tr><th className="px-3 py-2 font-medium">Name</th><th className="font-medium">Source</th><th className="font-medium">Format</th><th className="font-medium">Duration</th><th className="font-medium">Channels</th><th className="font-medium">Rate</th><th className="font-medium">Splits</th><th className="font-medium">Validation</th></tr>
              </thead>
              <tbody>
                {items.map(({ file, manifest: m, error }) => (
                  <tr key={file} onClick={() => setSel(file)} className="cursor-pointer border-t border-line-soft hover:bg-panel">
                    {m ? (
                      <>
                        <td className="px-3 py-1.5">{m.name} <span className="num text-faint">v{m.version}</span></td>
                        <td><Badge tone={m.source === "synthetic" ? "signal" : "geometry"}>{m.source}</Badge></td>
                        <td className="max-w-[180px] truncate">{m.sampleFormat}</td>
                        <td className="num">{m.durationS !== null ? `${(m.durationS / 60).toFixed(1)} min` : "unknown"}</td>
                        <td className="num">{m.channelCount ?? "unknown"}</td>
                        <td className="num">{m.sampleRateHz !== null ? `${m.sampleRateHz} Hz` : "unknown"}</td>
                        <td className="num">{Object.keys(m.splits).join(" / ") || "-"}</td>
                        <td><Badge tone={m.validation.status === "valid" ? "ok" : m.validation.status === "invalid" ? "err" : "warn"}>{m.validation.status}</Badge></td>
                      </>
                    ) : (
                      <td colSpan={8} className="px-3 py-1.5 text-err">{file}: invalid manifest, {error}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title={cur ? cur.name : "Details"}>
            {cur && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {([
                  ["Identifier", cur.id],
                  ["Licence", cur.license],
                  ["Usage restrictions", cur.usageRestrictions],
                  ["Capture methodology", cur.captureMethodology],
                  ["Consent", cur.consent],
                  ["Annotations", cur.annotations.join(", ") || "none"],
                  ["Scene metadata", JSON.stringify(cur.sceneMetadata)],
                  ["Splits", Object.entries(cur.splits).map(([k, v]) => `${k}: ${v.length}`).join(" · ")],
                  ["Checksum", cur.checksum ?? "n/a (regenerated deterministically)"],
                  ["Validated", cur.validation.checkedAt ?? "never"],
                  ["Issues", cur.validation.issues.join("; ") || "none"],
                ] as Array<[string, string]>).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-words">{v}</dd></div>)}
              </dl>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
