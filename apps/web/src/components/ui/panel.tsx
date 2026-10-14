"use client";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/format";

export function Panel({ title, actions, children, className, bodyClassName, dense }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string; dense?: boolean }) {
  return (
    <section className={cn("flex min-h-0 flex-col rounded-md border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line-soft px-3">
          <h2 className="truncate text-2xs font-semibold uppercase tracking-[0.08em] text-muted">{title}</h2>
          <div className="flex items-center gap-1">{actions}</div>
        </header>
      )}
      <div className={cn("min-h-0 flex-1", dense ? "p-2" : "p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line-soft">
      <div className="flex items-center">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-8 flex-1 items-center gap-1.5 px-3 text-left text-2xs font-semibold uppercase tracking-[0.08em] text-muted hover:text-fg">
          <ChevronDown className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")} />
          {title}
        </button>
        {right && <div className="pr-2">{right}</div>}
      </div>
      {open && <div className="space-y-2.5 px-3 pb-3">{children}</div>}
    </div>
  );
}
