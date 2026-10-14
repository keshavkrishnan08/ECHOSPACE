"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Markdown } from "@/components/catalog/Markdown";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/format";

export function DocsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const idx = useQuery({ queryKey: ["docs-index"], queryFn: async () => ((await (await fetch("/docs/index.json")).json()) as string[]) });
  const files = idx.data ?? [];
  const cur = params.get("doc") ?? (files.includes("architecture.md") ? "architecture.md" : files[0]);
  const doc = useQuery({ queryKey: ["doc", cur], enabled: !!cur, queryFn: async () => (await fetch(`/docs/${cur}`)).text() });
  return (
    <div className="grid h-full grid-cols-[220px_1fr]">
      <nav aria-label="Documents" className="overflow-y-auto border-r border-line bg-surface p-2">
        <h1 className="px-2 pb-2 text-2xs font-semibold uppercase tracking-[0.08em] text-muted">Documentation</h1>
        {files.map((f) => (
          <button key={f} type="button" onClick={() => router.replace(`/docs?doc=${f}`)} className={cn("block w-full truncate rounded px-2 py-1.5 text-left text-xs", f === cur ? "bg-signal/10 text-signal" : "text-muted hover:bg-panel hover:text-fg")}>
            {f.replace(/\.md$/, "").replace(/-/g, " ")}
          </button>
        ))}
      </nav>
      <div className="overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">{idx.isLoading || doc.isLoading ? <LoadingState /> : doc.data ? <Markdown source={doc.data} /> : <EmptyState title="No documents" />}</div>
      </div>
    </div>
  );
}
