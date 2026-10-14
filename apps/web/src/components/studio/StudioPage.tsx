"use client";
import { useRouter, useSearchParams } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";
import { useFrame } from "@/lib/engine/hooks";
import { useSession } from "@/lib/store/session";
import { Timeline } from "@/components/timeline/Timeline";
import { SelectField } from "@/components/ui/controls";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { SIGNAL_TABS, SignalPlots, type SignalTab } from "./SignalPlots";
import { PipelineView } from "./PipelineView";
import { PerformanceView } from "./PerformanceView";
import { SourcesView } from "./SourcesView";
import { cn } from "@/lib/format";

const TOP = [
  { value: "signals", label: "Signal monitoring" },
  { value: "pipeline", label: "DSP pipeline" },
  { value: "performance", label: "Performance profiling" },
  { value: "sources", label: "Sources & recordings" },
];

export function StudioPage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") ?? "signals";
  const sig = (params.get("signal") ?? "amplitude") as SignalTab;
  const frame = useFrame(8);
  const info = useSession((s) => s.info);
  const selectedLink = useSession((s) => s.selectedLink);
  const selectLink = useSession((s) => s.selectLink);
  const go = (t: string, extra = "") => router.replace(`/studio?tab=${t}${extra}`, { scroll: false });
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <h1 className="text-sm font-semibold">RF Signal Studio</h1>
        <Tabs.Root value={tab} onValueChange={(v) => go(v)}>
          <Tabs.List className="flex gap-0.5 rounded-md border border-line bg-panel p-0.5" aria-label="Studio sections">
            {TOP.map((t) => (
              <Tabs.Trigger key={t.value} value={t.value} className="rounded px-2.5 py-1 text-xs text-muted data-[state=active]:bg-signal/15 data-[state=active]:text-signal" data-testid={`studio-tab-${t.value}`}>
                {t.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
        {info && (
          <div className="ml-auto w-64">
            <SelectField value={String(selectedLink)} options={info.links.map((l) => ({ value: String(l.index), label: `Link ${l.id} · ${l.lengthM.toFixed(2)} m` }))} onChange={(v) => selectLink(Number(v))} />
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ErrorBoundary label="Studio view">
          {tab === "signals" && (
            <div className="grid gap-3 lg:grid-cols-[200px_1fr]">
              <nav aria-label="Signal views" className="flex flex-row flex-wrap gap-1 lg:flex-col">
                {SIGNAL_TABS.map((t) => (
                  <button key={t.value} type="button" onClick={() => go("signals", `&signal=${t.value}`)} aria-current={sig === t.value ? "true" : undefined} className={cn("rounded px-2 py-1.5 text-left text-xs", sig === t.value ? "bg-signal/10 text-signal" : "text-muted hover:bg-panel hover:text-fg")} data-testid={`signal-${t.value}`}>
                    {t.label}
                  </button>
                ))}
              </nav>
              <SignalPlots tab={sig} frame={frame} />
            </div>
          )}
          {tab === "pipeline" && <PipelineView frame={frame} />}
          {tab === "performance" && <PerformanceView frame={frame} />}
          {tab === "sources" && <SourcesView />}
        </ErrorBoundary>
      </div>
      <div className="shrink-0 border-t border-line bg-surface px-4 py-2">
        <Timeline compact />
      </div>
    </div>
  );
}
