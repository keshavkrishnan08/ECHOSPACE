"use client";
import { create } from "zustand";
import type { ExperimentRecord } from "@echospace/schemas";
import { deterministicDigest } from "../engine/digest";
import { useSession } from "./session";

type Status = "idle" | "running" | "verified" | "mismatch" | "unverifiable";

interface ReplayState {
  experimentId: string | null;
  expected: string | null;
  status: Status;
  actual: string | null;
  /** Whether the live replay itself ran without backpressure drops in the digest window. */
  liveClean: boolean | null;
  start(rec: ExperimentRecord): void;
}

/**
 * Replays an experiment: the stored launch configuration is relaunched live with its mid-run
 * changes scheduled at the recorded frame indices, and the deterministic digest of the first
 * frames is recomputed (unpaced, no backpressure) and compared with the stored one.
 */
export const useReplay = create<ReplayState>()((set) => ({
  experimentId: null,
  expected: null,
  status: "idle",
  actual: null,
  liveClean: null,
  start(rec) {
    set({ experimentId: rec.id, expected: rec.replayDigest, actual: null, liveClean: null, status: rec.replayDigest ? "running" : "unverifiable" });
    useSession.getState().launch(rec.config, { scenarioKey: rec.config.scenario, schedule: rec.configChanges, replayOf: rec.id });
    if (!rec.replayDigest) return;
    void deterministicDigest(rec.config, rec.configChanges, useSession.getState().ridge).then(
      (d) => set({ actual: d, status: d === rec.replayDigest ? "verified" : "mismatch" }),
      () => set({ status: "unverifiable" }),
    );
    const unsub = useSession.subscribe((st) => {
      if (st.replayOf !== rec.id || !st.replayDigest) return;
      unsub();
      set({ liveClean: st.replayDigestClean && st.replayDigest === rec.replayDigest });
    });
  },
}));
