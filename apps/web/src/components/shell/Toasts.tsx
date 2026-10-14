"use client";
import { X } from "lucide-react";
import { useUi } from "@/lib/store/ui";
import { cn } from "@/lib/format";

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cn("pointer-events-auto flex items-start gap-2 rounded-md border bg-panel-2 p-2.5 text-xs shadow-xl", t.tone === "ok" ? "border-ok/40" : t.tone === "warn" ? "border-warn/40" : t.tone === "err" ? "border-err/40" : "border-line")}>
          <span className="flex-1">{t.text}</span>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-muted hover:text-fg">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
