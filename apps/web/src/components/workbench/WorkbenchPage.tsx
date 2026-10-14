"use client";
import { useRouter, useSearchParams } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { CompareExperiments } from "./CompareExperiments";
import { Ablations } from "./Ablations";
import { ModelVsSystems } from "./ModelVsSystems";
import { SideBySide } from "./SideBySide";

const TABS = [
  { value: "compare", label: "Compare experiments" },
  { value: "ablations", label: "Ablations" },
  { value: "sidebyside", label: "Side-by-side reconstruction" },
  { value: "benchmark", label: "Model vs systems" },
];

export function WorkbenchPage() {
  const params = useSearchParams();
  const router = useRouter();
  const ids = (params.get("compare") ?? "").split(",").filter(Boolean);
  const tab = params.get("tab") ?? (ids.length ? "compare" : "compare");
  const setParam = (t: string, cmp = ids) => router.replace(`/workbench?tab=${t}${cmp.length ? `&compare=${cmp.join(",")}` : ""}`, { scroll: false });
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <h1 className="text-sm font-semibold">Research Workbench</h1>
        <Tabs.Root value={tab} onValueChange={(t) => setParam(t)}>
          <Tabs.List className="flex gap-0.5 rounded-md border border-line bg-panel p-0.5" aria-label="Workbench sections">
            {TABS.map((t) => (
              <Tabs.Trigger key={t.value} value={t.value} data-testid={`wb-tab-${t.value}`} className="rounded px-2.5 py-1 text-xs text-muted data-[state=active]:bg-signal/15 data-[state=active]:text-signal">{t.label}</Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ErrorBoundary label="Workbench">
          {tab === "compare" && <CompareExperiments ids={ids} setIds={(n) => setParam("compare", n)} />}
          {tab === "ablations" && <Ablations />}
          {tab === "sidebyside" && <SideBySide />}
          {tab === "benchmark" && <ModelVsSystems />}
        </ErrorBoundary>
      </div>
    </div>
  );
}
