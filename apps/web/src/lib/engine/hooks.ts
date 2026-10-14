"use client";
import { useEffect, useRef, useState } from "react";
import type { ReconstructionFrame } from "@echospace/schemas";
import { useSession } from "../store/session";
import { history } from "./history";

/**
 * Returns the frame at the session cursor (latest when live), re-rendering at most `hz` times
 * per second regardless of how fast frames arrive.
 */
export function useFrame(hz = 15): ReconstructionFrame | null {
  const cursor = useSession((s) => s.cursorSeq);
  const live = useSession((s) => s.live);
  const [frame, setFrame] = useState<ReconstructionFrame | null>(() => (live ? history.latest() : cursor !== null ? history.bySeq(cursor) : null));
  const last = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const pick = () => {
      const s = useSession.getState();
      setFrame(s.live ? history.latest() : s.cursorSeq !== null ? history.bySeq(s.cursorSeq) : history.latest());
    };
    pick();
    const period = 1000 / hz;
    const unsub = history.subscribe(() => {
      if (!useSession.getState().live) return;
      const now = performance.now();
      if (now - last.current >= period) {
        last.current = now;
        pick();
      } else if (!pending.current) {
        pending.current = setTimeout(() => {
          pending.current = null;
          last.current = performance.now();
          pick();
        }, period - (now - last.current));
      }
    });
    return () => {
      unsub();
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    };
  }, [hz, cursor, live]);
  return frame;
}

/** Re-renders when history changes, throttled; returns the history version. */
export function useHistoryVersion(hz = 4): number {
  const [v, setV] = useState(history.version);
  useEffect(() => {
    let last = 0;
    let t: ReturnType<typeof setTimeout> | null = null;
    const unsub = history.subscribe(() => {
      const now = performance.now();
      if (now - last > 1000 / hz) {
        last = now;
        setV(history.version);
      } else if (!t) {
        t = setTimeout(() => {
          t = null;
          last = performance.now();
          setV(history.version);
        }, 1000 / hz);
      }
    });
    return () => {
      unsub();
      if (t) clearTimeout(t);
    };
  }, [hz]);
  return v;
}

/** True when the session is playing live but no frame arrived within 3 frame periods (min 500 ms). */
export function useStale(): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      const s = useSession.getState();
      const period = 1000 / s.config.dsp.frameRateHz;
      const age = performance.timeOrigin + performance.now() - s.lastFrameAtMs;
      setStale(s.playing && s.live && s.lastFrameAtMs > 0 && age > Math.max(500, 3 * period));
    }, 250);
    return () => clearInterval(id);
  }, []);
  return stale;
}
