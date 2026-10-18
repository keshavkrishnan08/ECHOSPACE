"use client";
import { METRICS } from "@echospace/schemas";
import { cn } from "@/lib/format";
import { Tip } from "./tooltip";

/**
 * A metric readout bound to a catalogue definition. The tooltip always shows unit, definition
 * and data source; values that are unknown render as N/A.
 */
export function Metric({ id, value, sub, tone, className, label, demo }: { id: string; value: string; sub?: string; tone?: "ok" | "warn" | "err" | "signal" | "track"; className?: string; label?: string; demo?: boolean }) {
  const def = METRICS[id];
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "err" ? "text-err" : tone === "signal" ? "text-signal" : tone === "track" ? "text-track" : "text-fg";
  const body = (
    <div tabIndex={0} className={cn("min-w-0 rounded border border-line-soft bg-panel/60 px-2.5 py-2 outline-none hover:border-line", className)}>
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-2xs text-muted">{label ?? def?.label ?? id}</span>
        {def?.kind === "simulation" && <span className="text-[9px] uppercase tracking-wide text-faint">sim</span>}
      </div>
      <div className={cn("num mt-0.5 truncate text-[15px] leading-5", value === "N/A" ? "text-faint" : color)}>{value}</div>
      {sub && <div className="num truncate text-2xs text-faint">{sub}</div>}
      {demo && <div className="text-[9px] uppercase tracking-wide text-warn">demo value</div>}
    </div>
  );
  if (!def) return body;
  return (
    <Tip
      content={
        <div className="space-y-1">
          <div className="font-semibold">
            {def.label} <span className="num text-muted">[{def.unit}]</span>
          </div>
          <div>{def.definition}</div>
          <div className="text-muted">Source: {def.source}</div>
          {def.kind === "simulation" && <div className="text-warn">Simulation metric, computed against synthetic ground truth.</div>}
        </div>
      }
    >
      {body}
    </Tip>
  );
}
