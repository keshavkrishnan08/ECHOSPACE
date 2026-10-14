"use client";
import { ChevronLeft, ChevronRight, Pause, Play, Radio } from "lucide-react";
import { useMemo } from "react";
import { useSession } from "@/lib/store/session";
import { useHistoryVersion } from "@/lib/engine/hooks";
import { history } from "@/lib/engine/history";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/controls";
import { Tip } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

const EVENT_COLORS: Record<string, string> = {
  "track-birth": "#a78bfa",
  "track-confirmed": "#a78bfa",
  "track-death": "#6b5aa8",
  "id-switch": "#e5636a",
  "signal-warning": "#e8b04b",
  capability: "#e8b04b",
  "config-change": "#2dd4e6",
  error: "#e5636a",
};

/**
 * Synchronised timeline. Scrubbing moves the global session cursor, which the 3D view, signal
 * plots, metrics and inspectors all read — so every view shows the same timestamp.
 */
export function Timeline({ compact }: { compact?: boolean }) {
  const s = useSession();
  useHistoryVersion(6);
  const range = history.range();
  const cur = s.cursorSeq ?? range?.last ?? 0;
  const curFrame = range ? history.bySeq(cur) : null;
  const events = useMemo(() => {
    const ev = history.events.filter((e) => e.kind !== "track-confirmed");
    const changes = s.configChanges.map((c) => ({ t: c.t, seq: c.frameSeq, kind: "config-change", message: "Configuration changed", severity: "info" }));
    return [...ev, ...changes];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.version, s.configChanges]);
  const span = range ? Math.max(1, range.last - range.first) : 1;
  const pos = (seq: number) => (range ? ((seq - range.first) / span) * 100 : 0);
  const quality = history.summaries.slice(-(range ? range.last - range.first + 1 : 0));

  return (
    <div className="flex h-full flex-col gap-1.5" data-testid="timeline">
      <div className="flex items-center gap-1.5">
        <Button size="icon" variant={s.playing ? "active" : "default"} onClick={s.togglePlay} aria-label={s.playing ? "Pause" : "Play"}>
          {s.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
        <Tip content="Previous frame (←)">
          <Button size="icon" aria-label="Previous frame" disabled={!range} onClick={() => s.scrub(Math.max(range!.first, cur - 1))}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
        </Tip>
        <Tip content="Next frame (→); steps the engine when at the live edge">
          <Button size="icon" aria-label="Next frame" onClick={() => (range && cur < range.last ? s.scrub(cur + 1) : s.step(1))}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </Tip>
        <Segmented ariaLabel="Playback speed" value={String(s.speed)} onChange={(v) => s.setSpeed(Number(v))} options={[{ value: "0.25", label: "0.25×" }, { value: "0.5", label: "0.5×" }, { value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "4", label: "4×" }]} />
        {s.live ? (
          <Badge tone="ok" dot>Live</Badge>
        ) : (
          <button type="button" onClick={s.goLive} data-testid="go-live">
            <Badge tone="track">
              <Radio className="h-3 w-3" /> Historical · return to live
            </Badge>
          </button>
        )}
        <span className="num ml-auto text-2xs text-muted" data-testid="timeline-readout">
          {curFrame ? `frame ${curFrame.seq} · t ${curFrame.timestampS.toFixed(2)} s` : "no frames"}
          {range && ` · buffer ${(range.lastT - range.firstT).toFixed(1)} s`}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          aria-label="Timeline position"
          data-testid="timeline-scrubber"
          className="w-full accent-[#2dd4e6]"
          min={range?.first ?? 0}
          max={range?.last ?? 0}
          step={1}
          value={cur}
          disabled={!range}
          onChange={(e) => s.scrub(Number(e.target.value))}
        />
        {!compact && range && (
          <div className="pointer-events-none relative mt-0.5 h-3">
            {events.filter((e) => e.seq >= range.first).slice(-200).map((e, i) => (
              <Tip key={i} content={`${e.kind} @ ${e.t.toFixed(2)} s: ${e.message}`}>
                <span className="pointer-events-auto absolute top-0 h-3 w-[3px] -translate-x-1/2 rounded-sm" style={{ left: `${pos(e.seq)}%`, background: EVENT_COLORS[e.kind] ?? "#8b9ab0" }} />
              </Tip>
            ))}
          </div>
        )}
        {!compact && range && quality.length > 1 && (
          <svg className="mt-0.5 h-4 w-full" viewBox={`0 0 ${quality.length} 1`} preserveAspectRatio="none" aria-label="Input quality over the buffered window">
            {quality.map((q, i) => (
              <rect key={i} x={i} y={0} width={1} height={1} fill={q.inputQuality > 0.8 ? "#5fbf8f" : q.inputQuality > 0.5 ? "#e8b04b" : "#e5636a"} opacity={0.25 + 0.6 * (1 - q.inputQuality)} />
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
