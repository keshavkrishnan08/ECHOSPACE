"use client";
import { useEffect, useRef, useState } from "react";
import type { ReconstructionFrame, ScenarioConfig } from "@echospace/schemas";
import { stableHash } from "@echospace/engine";
import { useSession } from "../store/session";

/**
 * Runs `config` in a secondary worker, kept in step with the primary session's cursor.
 * Returns the comparison frame for the same sequence number as `primary`.
 */
export function useCompareRunner(config: ScenarioConfig | null, primary: ReconstructionFrame | null) {
  const ridge = useSession((s) => s.ridge);
  const worker = useRef<Worker | null>(null);
  const busy = useRef(false);
  const [frame, setFrame] = useState<ReconstructionFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = config ? stableHash(config) : null;

  useEffect(() => {
    if (!config) return;
    const w = new Worker(new URL("./compare.worker.ts", import.meta.url), { type: "module", name: "echospace-compare" });
    worker.current = w;
    busy.current = true;
    setFrame(null);
    w.onmessage = (e: MessageEvent<{ type: string; frame?: ReconstructionFrame | null; message?: string }>) => {
      busy.current = false;
      if (e.data.type === "frame") setFrame(e.data.frame ?? null);
      if (e.data.type === "error") setError(e.data.message ?? "comparison engine failed");
    };
    w.postMessage({ type: "init", config, ridge });
    return () => {
      w.terminate();
      worker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ridge]);

  useEffect(() => {
    if (!primary || !worker.current || busy.current) return;
    busy.current = true;
    worker.current.postMessage({ type: "advance", toTime: primary.timestampS + 1e-6, want: primary.seq });
  }, [primary]);

  return { frame, error };
}
