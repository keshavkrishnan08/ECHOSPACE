"use client";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { downloadBlob, toCsv } from "@/lib/format";
import { useSession } from "@/lib/store/session";

export type DataKind = "measured" | "derived" | "simulated";

/** Every plot states what its data is and can export it as CSV with provenance headers. */
export function PlotFrame({ title, kind, units, children, csv, note, selection }: { title: string; kind: DataKind; units: string; children: React.ReactNode; csv?: () => Array<Record<string, unknown>>; note?: string; selection?: string | null }) {
  const s = useSession();
  const realKind: DataKind = kind === "measured" && s.sourceMode === "synthetic" ? "simulated" : kind;
  return (
    <section className="rounded-md border border-line bg-surface">
      <header className="flex h-8 items-center gap-2 border-b border-line-soft px-3">
        <h3 className="truncate text-2xs font-semibold uppercase tracking-[0.08em] text-muted">{title}</h3>
        <Badge tone={realKind === "simulated" ? "signal" : realKind === "derived" ? "track" : "geometry"}>{realKind === "simulated" ? "simulated" : realKind}</Badge>
        <span className="num truncate text-2xs text-faint">{units}</span>
        {selection && <span className="num truncate text-2xs text-signal">sel: {selection}</span>}
        {csv && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              const rows = csv();
              downloadBlob(
                `echospace_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${s.sessionId}.csv`,
                toCsv(rows, { title, data_kind: realKind, units, source: s.sourceLabel, session: s.sessionId, exported: new Date().toISOString() }),
                "text/csv",
              );
            }}
          >
            <Download className="h-3 w-3" /> CSV
          </Button>
        )}
      </header>
      <div className="p-2">{children}</div>
      {note && <p className="px-3 pb-2 text-2xs text-faint">{note}</p>}
    </section>
  );
}
