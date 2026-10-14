"use client";
import { useCallback, useRef, useState } from "react";
import type { ScenarioConfig } from "@echospace/schemas";
import type { OfflineResult } from "./offline.worker";
import { useSession } from "../store/session";

export interface OfflineJob {
  id: string;
  label: string;
  config: ScenarioConfig;
}

/** Runs jobs sequentially in one worker (so timings don't compete for cores). */
export function useOfflineRuns() {
  const ridge = useSession((s) => s.ridge);
  const [results, setResults] = useState<Record<string, OfflineResult>>({});
  const [running, setRunning] = useState<{ id: string; t: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const worker = useRef<Worker | null>(null);

  const run = useCallback(
    async (jobs: OfflineJob[], durationS: number) => {
      worker.current?.terminate();
      const w = new Worker(new URL("./offline.worker.ts", import.meta.url), { type: "module", name: "echospace-offline" });
      worker.current = w;
      setResults({});
      setErrors({});
      for (const job of jobs) {
        setRunning({ id: job.id, t: 0 });
        await new Promise<void>((resolve) => {
          w.onmessage = (e: MessageEvent<{ type: string; id: string; t?: number; result?: OfflineResult; message?: string }>) => {
            if (e.data.type === "progress") setRunning({ id: e.data.id, t: e.data.t ?? 0 });
            if (e.data.type === "done") {
              setResults((r) => ({ ...r, [job.id]: e.data.result! }));
              resolve();
            }
            if (e.data.type === "error") {
              setErrors((r) => ({ ...r, [job.id]: e.data.message ?? "failed" }));
              resolve();
            }
          };
          w.postMessage({ id: job.id, config: job.config, durationS, ridge });
        });
      }
      setRunning(null);
      w.terminate();
      worker.current = null;
    },
    [ridge],
  );
  const cancel = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    setRunning(null);
  }, []);
  return { run, cancel, results, running, errors };
}
