"use client";
import type { ReconstructionFrame } from "@echospace/schemas";
import { Metric } from "@/components/ui/metric";
import { useSession } from "@/lib/store/session";
import { duration, fmt, pct } from "@/lib/format";

/** Live system metrics from the active session. Unknown values render as N/A. */
export function SessionMetrics({ frame, columns = 4 }: { frame: ReconstructionFrame | null; columns?: number }) {
  const fr = useSession((s) => s.frameRate);
  const simTime = useSession((s) => s.simTime);
  const cfg = useSession((s) => s.config);
  const validate = frame?.stages.find((s) => s.id === "validate");
  const inputRate = validate ? validate.itemsOut * cfg.dsp.frameRateHz : null;
  const loss = frame ? 1 - frame.metrics.packetDeliveryRatio : null;
  const conf = frame?.metrics.meanConfidence ?? null;
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} data-testid="session-metrics">
      <Metric id="frameRate" value={frame ? fmt(fr, 1, "Hz") : "N/A"} sub={`target ${cfg.dsp.frameRateHz} Hz`} />
      <Metric id="endToEndMs" value={fmt(frame?.metrics.endToEndMs, 1, "ms")} sub={frame ? `proc ${fmt(frame.metrics.processingMs, 1, "ms")}` : undefined} />
      <Metric id="inputRate" value={inputRate === null ? "N/A" : `${inputRate.toFixed(0)} pkt/s`} />
      <Metric id="packetDeliveryRatio" label="Packet loss" value={pct(loss, 1)} tone={loss !== null && loss > 0.2 ? "warn" : undefined} />
      <Metric id="gpuUtilization" value="N/A" sub="not exposed by browsers" />
      <Metric id="meanConfidence" value={conf === null ? "N/A" : conf.toFixed(3)} tone={conf !== null && conf < 0.05 ? "warn" : undefined} />
      <Metric id="activeTracks" value={frame ? String(frame.metrics.activeTracks) : "N/A"} tone="track" />
      <Metric id="sessionDuration" value={frame ? duration(simTime) : "N/A"} />
    </div>
  );
}
