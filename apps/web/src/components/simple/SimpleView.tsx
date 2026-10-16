"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Pause, Play, SlidersHorizontal } from "lucide-react";
import type { ReconstructionFrame } from "@echospace/schemas";
import { useSession } from "@/lib/store/session";
import { useFrame } from "@/lib/engine/hooks";
import { history } from "@/lib/engine/history";
import { Logo } from "@/components/shell/Sidebar";
import { cn } from "@/lib/format";
import { CleanScene } from "./CleanScene";
import { detectedFloor, SITUATIONS } from "./situations";

const FLOOR_NAME = ["downstairs", "upstairs"];

/** Where the simulated person really is, from the feet of the ground truth skeleton. */
function trueFloor(floors: number[], joints: Float32Array): string {
  const feet = Math.min(joints[15 * 3 + 2], joints[16 * 3 + 2]) - 0.07;
  if (feet < 0.3) return "downstairs";
  if (feet > floors[1] - 0.3) return "upstairs";
  return "on the stairs";
}

function describe(frame: ReconstructionFrame | null, floors?: number[]): { headline: string; detail: string; tone: "ok" | "warn" | "muted" } {
  if (!frame) return { headline: "Starting", detail: "Calibrating on an empty room…", tone: "muted" };
  if (frame.state === "calibrating") return { headline: "Calibrating", detail: "Learning what the empty room looks like.", tone: "muted" };
  if (frame.capability.modelStatus === "unsupported") {
    return { headline: "Can't locate anyone", detail: /Insufficient/.test(frame.capability.modelMessage) ? "One radio link is not enough to tell where anyone is. The system says so instead of guessing." : frame.capability.modelMessage, tone: "warn" };
  }
  const people = frame.groundTruth?.length ?? 0;
  const found = frame.tracks.filter((t) => t.confirmed).length;
  const weak = frame.metrics.inputQuality < 0.5;
  if (people === 0) {
    return found === 0
      ? { headline: "Nobody here", detail: "Nothing detected. Noise alone does not produce a person.", tone: "ok" }
      : { headline: "False alarm", detail: `${found} detection${found > 1 ? "s" : ""} in an empty room.`, tone: "warn" };
  }
  const err = frame.metrics.positionErrorM;
  const head = `${people} ${people > 1 ? "people" : "person"} · ${found} detected`;
  const parts: string[] = [];
  if (err !== null && found > 0) parts.push(`${(err * 100).toFixed(0)} cm from the true position`);
  if (found < people) parts.push(found === 0 ? "not found yet" : `${people - found} missed`);
  if (found > people) parts.push(`${found - people} extra`);
  if (weak) parts.push("weak signal");
  if (floors && frame.groundTruth?.[0]) {
    const where = trueFloor(floors, frame.groundTruth[0].joints);
    const best = frame.tracks.filter((t) => t.confirmed).sort((a, b) => b.confidence - a.confidence)[0];
    parts.unshift(best ? `${where} · detected ${FLOOR_NAME[detectedFloor(floors, best.position[2])]}` : where);
  }
  return { headline: head, detail: parts.join(" · ") || "tracking", tone: found === people && !weak ? "ok" : "warn" };
}

interface RenderState {
  prev: ReconstructionFrame | null;
  cur: ReconstructionFrame | null;
  alpha: number;
  angle: number;
}

const nextFrame = (afterSeq: number) =>
  new Promise<ReconstructionFrame>((resolve) => {
    const un = history.subscribe(() => {
      const f = history.latest();
      if (f && f.seq !== afterSeq) {
        un();
        resolve(f);
      }
    });
  });

const paint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * `?render=1` hands the clock to a recording script: it steps the engine one frame at a time and
 * sets the blend and camera angle for each video frame, so the output is smooth at any speed.
 */
function useRenderDriver(enabled: boolean) {
  const [rv, setRv] = useState<RenderState>({ prev: null, cur: null, alpha: 1, angle: 0 });
  useEffect(() => {
    if (!enabled) return;
    const api = {
      async pick(id: string) {
        const x = SITUATIONS.find((q) => q.id === id) ?? SITUATIONS[0];
        useSession.getState().launch(x.build(), { scenarioKey: x.id, autoplay: false });
        while (!useSession.getState().info) await new Promise((r) => setTimeout(r, 50));
        setRv((v) => ({ ...v, prev: null, cur: null, alpha: 1 }));
      },
      async step() {
        const wait = nextFrame(history.latest()?.seq ?? -1);
        useSession.getState().step(1);
        const f = await wait;
        setRv((v) => ({ ...v, prev: v.cur, cur: f }));
        return f.state;
      },
      async view(alpha: number, angle: number) {
        setRv((v) => ({ ...v, alpha, angle }));
        await paint();
      },
    };
    (window as unknown as { __echo?: typeof api }).__echo = api;
  }, [enabled]);
  return enabled ? rv : null;
}

export function SimpleView() {
  const s = useSession();
  const params = useSearchParams();
  const rv = useRenderDriver(params.get("render") === "1");
  const live = useFrame(20);
  const frame = rv ? rv.cur : live;
  const current = SITUATIONS.find((x) => x.id === s.scenarioKey) ?? SITUATIONS[0];
  const status = describe(frame, current.floors);

  useEffect(() => {
    if (params.get("render") === "1") return;
    const want = SITUATIONS.find((x) => x.id === params.get("s"));
    const st = useSession.getState();
    if (want && st.scenarioKey !== want.id) st.launch(want.build(), { scenarioKey: want.id });
    else if (!SITUATIONS.some((x) => x.id === st.scenarioKey)) st.launch(SITUATIONS[0].build(), { scenarioKey: SITUATIONS[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative flex h-dvh w-full flex-col bg-bg" data-testid="simple-view">
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Logo size={20} />
          <span className="text-[13px] font-semibold tracking-[0.22em]">
            ECH<span className="text-signal">O</span>
          </span>
          <span className="ml-3 hidden text-xs text-muted sm:inline">Seeing a room through its Wi-Fi signals · simulated</span>
        </div>
        <Link href="/lab" className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted hover:bg-panel hover:text-fg" data-testid="open-advanced">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Advanced
        </Link>
      </header>

      <div className="min-h-0 flex-1">
        <CleanScene frame={frame} config={s.config} floors={current.floors} {...(rv ? { prev: rv.prev, alpha: rv.alpha, angle: rv.angle } : {})} />
      </div>

      <div className="pointer-events-none absolute left-5 top-16 max-w-sm">
        <div className="text-xs uppercase tracking-[0.14em] text-faint">{current.label}</div>
        <p className="mt-1 text-sm text-muted">{current.summary}</p>
      </div>

      <div className="pointer-events-none absolute bottom-28 left-5 max-w-md" aria-live="polite">
        <div className={cn("text-2xl font-light tracking-tight", status.tone === "warn" ? "text-warn" : status.tone === "ok" ? "text-fg" : "text-muted")} data-testid="simple-status">
          {status.headline}
        </div>
        <div className="mt-1 text-sm text-muted">{status.detail}</div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-faint">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#e9edf3]" /> simulated person</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-track" /> what ECHO detected</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ok" /> estimated occupancy</span>
        </div>
      </div>

      <nav aria-label="Situations" className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 overflow-x-auto px-5 pb-5 pt-3">
        {!rv && <button type="button" onClick={s.togglePlay} aria-label={s.playing ? "Pause" : "Play"} className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-fg hover:bg-panel">
          {s.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>}
        {SITUATIONS.map((x) => (
          <button
            key={x.id}
            type="button"
            data-testid={`situation-${x.id}`}
            aria-pressed={x.id === current.id}
            onClick={() => s.launch(x.build(), { scenarioKey: x.id })}
            className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-xs transition-colors", x.id === current.id ? "border-signal/60 bg-signal/10 text-fg" : "border-line text-muted hover:border-faint hover:text-fg")}
          >
            {x.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
