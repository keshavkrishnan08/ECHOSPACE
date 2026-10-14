"use client";
import { Command, History, Pause, Play, RotateCcw, Save, SkipForward } from "lucide-react";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { useStale } from "@/lib/engine/hooks";
import { Button } from "@/components/ui/button";
import { Kbd, Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { Segmented } from "@/components/ui/controls";
import { useApiHealth } from "@/lib/api/client";
import { useReplay } from "@/lib/store/replay";
import { SourceBadge, StateBadge } from "./StatusIndicators";

export function TopBar() {
  const s = useSession();
  const ui = useUi();
  const stale = useStale();
  const api = useApiHealth();
  const replay = useReplay();
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <span className="text-muted">Project</span>
        <span className="font-medium">Default</span>
        <span className="text-faint">/</span>
        <Tip content="Ephemeral session identifier. Not linked to any person.">
          <span className="num text-2xs text-muted" data-testid="session-id">
            {s.sessionId}
          </span>
        </Tip>
      </div>
      <SourceBadge mode={s.sourceMode} />
      <StateBadge state={s.status} stale={stale} />
      {!s.live && (
        <Tip content="You are viewing a historical frame. Press L or click to return to live.">
          <button type="button" onClick={s.goLive} className="focus-visible:outline-signal">
            <Badge tone="track">
              <History className="h-3 w-3" /> Historical
            </Badge>
          </button>
        </Tip>
      )}
      {s.replayOf && (
        <Badge tone={replay.status === "verified" ? "ok" : replay.status === "mismatch" ? "err" : "geometry"}>
          Replay of {s.replayOf}
          {replay.status === "verified" ? " · reproduced" : replay.status === "mismatch" ? " · digest mismatch" : replay.status === "running" ? " · verifying" : ""}
        </Badge>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        <span className="num hidden text-2xs text-muted lg:inline">t = {s.simTime.toFixed(1)} s</span>
        <Tip content={s.playing ? "Pause (Space)" : "Play (Space)"}>
          <Button size="icon" variant={s.playing ? "active" : "default"} onClick={s.togglePlay} aria-label={s.playing ? "Pause" : "Play"} data-testid="play-toggle">
            {s.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
        </Tip>
        <Tip content="Step one frame (.)">
          <Button size="icon" onClick={() => s.step(1)} aria-label="Step one frame">
            <SkipForward className="h-3.5 w-3.5" />
          </Button>
        </Tip>
        <Tip content="Restart scenario with the same seed and configuration">
          <Button size="icon" onClick={s.restart} aria-label="Restart">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </Tip>
        <Segmented
          ariaLabel="Playback speed"
          value={String(s.speed)}
          onChange={(v) => s.setSpeed(Number(v))}
          options={[{ value: "0.25", label: "¼×" }, { value: "0.5", label: "½×" }, { value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "4", label: "4×" }]}
        />
        <Button onClick={() => ui.setSave(true)} data-testid="save-experiment">
          <Save className="h-3.5 w-3.5" /> Save run
        </Button>
        <Tip content={api.isSuccess ? `API ${api.data.version} connected` : "Python API not reachable — running fully in the browser with local storage"}>
          <span className={`h-2 w-2 rounded-full ${api.isSuccess ? "bg-ok" : "bg-faint"}`} aria-label={api.isSuccess ? "API connected" : "API offline"} />
        </Tip>
        <Button variant="ghost" onClick={() => ui.setPalette(true)} aria-label="Open command palette">
          <Command className="h-3.5 w-3.5" />
          <Kbd>⌘K</Kbd>
        </Button>
      </div>
    </header>
  );
}
