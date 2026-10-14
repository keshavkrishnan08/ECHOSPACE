"use client";
import Link from "next/link";
import type { ReconstructionFrame } from "@echospace/schemas";
import { Tip } from "@/components/ui/tooltip";

/** Compact stacked bar of measured stage durations for the current frame. */
export function PipelineMini({ frame }: { frame: ReconstructionFrame | null }) {
  if (!frame) return <div className="text-2xs text-faint">pipeline: waiting…</div>;
  const total = frame.stages.reduce((a, s) => a + s.durationMs, 0) || 1;
  const palette = ["#2dd4e6", "#26b8c9", "#1f9cad", "#5b8def", "#4f7bd6", "#4469bd", "#7c6bd6", "#a78bfa", "#c4b5fd", "#5fbf8f", "#a78bfa", "#8b9ab0"];
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-2xs text-muted">
        <span>Pipeline · measured stage time this frame</span>
        <span className="num">
          Σ {total.toFixed(2)} ms · queue {frame.queues.acquisitionDepth}/{frame.queues.acquisitionCapacity} · drops {frame.queues.acquisitionDrops} · skipped frames {frame.queues.framesDropped}
          <Link href="/studio?tab=pipeline" className="ml-2 text-signal hover:underline">inspect →</Link>
        </span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-sm bg-panel" role="img" aria-label="Stage durations">
        {frame.stages.map((s, i) => (
          <Tip key={s.id} content={`${s.label}: ${s.durationMs.toFixed(3)} ms${s.applicable ? "" : " (not applicable)"}${s.bypassed ? " (bypassed)" : ""}`}>
            <div style={{ width: `${(s.durationMs / total) * 100}%`, background: palette[i] }} className="h-full min-w-[1px]" />
          </Tip>
        ))}
      </div>
    </div>
  );
}
