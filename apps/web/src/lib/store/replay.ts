"use client";
import { create } from "zustand";
import type { ExperimentRecord } from "@echospace/schemas";
import { history } from "../engine/history";
import { DIGEST_FRAMES, digestFrames } from "./experiments";
import { useSession } from "./session";

type Status = "idle" | "running" | "verified" | "mismatch" | "unverifiable";

interface ReplayState {
  experimentId: string | null;
  expected: string | null;
  status: Status;
  actual: string | null;
  start(rec: ExperimentRecord): void;
}

/**
 * Replays an experiment by relaunching its launch configuration with its mid-run changes
 * scheduled at the recorded frame indices, then compares a digest of the first N frames with
 * the stored one.
 */
export const useReplay = create<ReplayState>()((set) => ({
  experimentId: null,
  expected: null,
  status: "idle",
  actual: null,
  start(rec) {
    set({ experimentId: rec.id, expected: rec.replayDigest, actual: null, status: rec.replayDigest ? "running" : "unverifiable" });
    useSession.getState().launch(rec.config, { scenarioKey: rec.config.scenario, schedule: rec.configChanges, replayOf: rec.id });
    if (!rec.replayDigest) return;
    const unsub = history.subscribe(() => {
      const frames = history.ordered().filter((f) => f.seq < DIGEST_FRAMES);
      if (frames.length < DIGEST_FRAMES) return;
      unsub();
      void digestFrames(frames).then((d) => set({ actual: d, status: d === rec.replayDigest ? "verified" : "mismatch" }));
    });
  },
}));
