"use client";
import { PanelBottomClose, PanelBottomOpen, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback, useRef } from "react";
import { useSettings } from "@/lib/store/settings";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/format";

function useDrag(onDelta: (dx: number, dy: number) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return useCallback(
    (e: React.PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY };
      const move = (ev: PointerEvent) => {
        if (!start.current) return;
        onDelta(ev.clientX - start.current.x, ev.clientY - start.current.y);
        start.current = { x: ev.clientX, y: ev.clientY };
      };
      const up = () => {
        start.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onDelta],
  );
}

/** Three-panel instrument workspace; sizes and collapsed state persist in settings. */
export function Workspace({ left, center, right, bottom, leftTitle, rightTitle }: { left: React.ReactNode; center: React.ReactNode; right: React.ReactNode; bottom: React.ReactNode; leftTitle: string; rightTitle: string }) {
  const p = useSettings((s) => s.panels);
  const setPanels = useSettings((s) => s.setPanels);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const dragLeft = useDrag(useCallback((dx) => setPanels({ left: clamp(useSettings.getState().panels.left + dx, 220, 520) }), [setPanels]));
  const dragRight = useDrag(useCallback((dx) => setPanels({ right: clamp(useSettings.getState().panels.right - dx, 240, 560) }), [setPanels]));
  const dragBottom = useDrag(useCallback((_dx, dy) => setPanels({ bottom: clamp(useSettings.getState().panels.bottom - dy, 120, 420) }), [setPanels]));
  const handle = "shrink-0 bg-line-soft hover:bg-signal/50 transition-colors";
  return (
    <div className="flex h-full min-h-0">
      {p.leftOpen && (
        <>
          <aside aria-label={leftTitle} className="flex shrink-0 flex-col border-r border-line bg-surface" style={{ width: p.left }}>
            <div className="flex h-8 shrink-0 items-center justify-between border-b border-line px-3 text-2xs font-semibold uppercase tracking-[0.08em] text-muted">
              {leftTitle}
              <Button size="iconSm" variant="ghost" onClick={() => setPanels({ leftOpen: false })} aria-label={`Collapse ${leftTitle}`}>
                <PanelLeftClose className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{left}</div>
          </aside>
          <div role="separator" aria-orientation="vertical" aria-label="Resize left panel" onPointerDown={dragLeft} className={cn(handle, "w-1 cursor-col-resize")} />
        </>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          {center}
          <div className="absolute bottom-2 right-2 flex gap-1">
            {!p.leftOpen && <Button size="iconSm" onClick={() => setPanels({ leftOpen: true })} aria-label={`Show ${leftTitle}`}><PanelLeftOpen className="h-3.5 w-3.5" /></Button>}
            <Button size="iconSm" onClick={() => setPanels({ bottomOpen: !p.bottomOpen })} aria-label={p.bottomOpen ? "Hide timeline" : "Show timeline"}>
              {p.bottomOpen ? <PanelBottomClose className="h-3.5 w-3.5" /> : <PanelBottomOpen className="h-3.5 w-3.5" />}
            </Button>
            {!p.rightOpen && <Button size="iconSm" onClick={() => setPanels({ rightOpen: true })} aria-label={`Show ${rightTitle}`}><PanelRightOpen className="h-3.5 w-3.5" /></Button>}
          </div>
        </div>
        {p.bottomOpen && (
          <>
            <div role="separator" aria-orientation="horizontal" aria-label="Resize timeline" onPointerDown={dragBottom} className={cn(handle, "h-1 cursor-row-resize")} />
            <div className="shrink-0 overflow-hidden border-t border-line bg-surface" style={{ height: p.bottom }}>
              {bottom}
            </div>
          </>
        )}
      </div>
      {p.rightOpen && (
        <>
          <div role="separator" aria-orientation="vertical" aria-label="Resize right panel" onPointerDown={dragRight} className={cn(handle, "w-1 cursor-col-resize")} />
          <aside aria-label={rightTitle} className="flex shrink-0 flex-col border-l border-line bg-surface" style={{ width: p.right }}>
            <div className="flex h-8 shrink-0 items-center justify-between border-b border-line px-3 text-2xs font-semibold uppercase tracking-[0.08em] text-muted">
              {rightTitle}
              <Button size="iconSm" variant="ghost" onClick={() => setPanels({ rightOpen: false })} aria-label={`Collapse ${rightTitle}`}>
                <PanelRightClose className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{right}</div>
          </aside>
        </>
      )}
    </div>
  );
}
