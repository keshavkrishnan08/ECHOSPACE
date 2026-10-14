"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScenarioConfig } from "@echospace/schemas";
import { ScenarioConfig as Schema } from "@echospace/schemas";
import { useSession } from "./session";
import { useUi } from "./ui";

/**
 * Local draft of the scenario configuration with debounced, validated application to the
 * running engine. Structural edits (geometry, voxel size) rebuild the imaging operator in the
 * worker, so slider drags are debounced.
 */
export function useConfigEditor(delayMs = 250) {
  const config = useSession((s) => s.config);
  const applyConfig = useSession((s) => s.applyConfig);
  const toast = useUi((s) => s.toast);
  const [draft, setDraft] = useState(config);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(config);

  useEffect(() => {
    setDraft(config);
    latest.current = config;
  }, [config]);

  const commit = useCallback(
    (next: ScenarioConfig) => {
      const r = Schema.safeParse(next);
      if (!r.success) {
        toast(`Invalid configuration: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`, "err");
        return;
      }
      applyConfig(r.data);
    },
    [applyConfig, toast],
  );

  const edit = useCallback(
    (fn: (c: ScenarioConfig) => ScenarioConfig) => {
      const next = fn(latest.current);
      latest.current = next;
      setDraft(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => commit(latest.current), delayMs);
    },
    [commit, delayMs],
  );

  /** Immutable deep update helper. */
  const patch = useCallback((mut: (d: ScenarioConfig) => void) => edit((c) => {
    const d = structuredClone(c);
    mut(d);
    return d;
  }), [edit]);

  return { draft, edit, patch };
}
