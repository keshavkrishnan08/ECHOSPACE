"use client";
import { useQuery } from "@tanstack/react-query";
import { ExperimentRecord } from "@echospace/schemas";
import { localExperiments } from "../store/experiments";
import { apiFetch } from "./client";

export interface ExperimentListItem {
  record: ExperimentRecord;
  origin: "browser" | "api" | "both";
}

/** Merges experiments from IndexedDB and (if reachable) the API, labelling where each lives. */
export function useExperiments() {
  return useQuery({
    queryKey: ["experiments"],
    queryFn: async (): Promise<{ items: ExperimentListItem[]; apiError: string | null }> => {
      const local = await localExperiments.list().catch(() => [] as ExperimentRecord[]);
      let remote: ExperimentRecord[] = [];
      let apiError: string | null = null;
      try {
        const r = await apiFetch<{ items: unknown[] }>("/api/experiments?full=true", { signal: AbortSignal.timeout(2500) });
        remote = r.items.map((x) => ExperimentRecord.parse(x));
      } catch (e) {
        apiError = e instanceof Error ? e.message : String(e);
      }
      const map = new Map<string, ExperimentListItem>();
      for (const r of local) map.set(r.id, { record: r, origin: "browser" });
      for (const r of remote) map.set(r.id, { record: map.get(r.id)?.record ?? r, origin: map.has(r.id) ? "both" : "api" });
      const items = [...map.values()].sort((a, b) => b.record.startedAt.localeCompare(a.record.startedAt));
      return { items, apiError };
    },
  });
}
