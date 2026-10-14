"use client";
import type { FrameSummary } from "@/lib/engine/history";

/** Lightweight SVG multi-series sparkline (independent y-scales per series). */
export function MiniSeries({ rows, keys, height = 80 }: { rows: FrameSummary[]; keys: Array<{ k: keyof FrameSummary; color: string; label: string }>; height?: number }) {
  const W = 300;
  if (rows.length < 2) return <div className="flex items-center justify-center rounded border border-line-soft text-2xs text-faint" style={{ height }}>waiting for frames…</div>;
  const t0 = rows[0].t;
  const t1 = rows[rows.length - 1].t;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full rounded border border-line-soft bg-bg" style={{ height }} preserveAspectRatio="none" role="img" aria-label={keys.map((k) => k.label).join(", ")}>
        {keys.map(({ k, color }) => {
          const vals = rows.map((r) => r[k] as number | null);
          const fin = vals.filter((v): v is number => v !== null && Number.isFinite(v));
          if (!fin.length) return null;
          const lo = Math.min(0, ...fin);
          const hi = Math.max(...fin, lo + 1e-6);
          let d = "";
          let pen = false;
          rows.forEach((r, i) => {
            const v = vals[i];
            if (v === null || !Number.isFinite(v)) {
              pen = false;
              return;
            }
            const x = ((r.t - t0) / Math.max(1e-6, t1 - t0)) * W;
            const y = height - 4 - ((v - lo) / (hi - lo)) * (height - 8);
            d += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
            pen = true;
          });
          return <path key={String(k)} d={d} fill="none" stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-2xs text-muted">
        {keys.map(({ k, color, label }) => {
          const last = [...rows].reverse().find((r) => r[k] !== null && Number.isFinite(r[k] as number));
          return (
            <span key={String(k)} className="flex items-center gap-1">
              <span className="h-0.5 w-3" style={{ background: color }} />
              {label}: <span className="num text-fg">{last ? (last[k] as number).toFixed(2) : "N/A"}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
