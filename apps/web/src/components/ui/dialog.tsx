"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export function Dialog({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <D.Content className={`fixed left-1/2 top-[12vh] z-50 max-h-[76vh] w-[92vw] -translate-x-1/2 overflow-auto rounded-lg border border-line bg-surface p-4 shadow-2xl ${wide ? "max-w-3xl" : "max-w-lg"}`}>
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-sm font-semibold">{title}</D.Title>
              {description && <D.Description className="mt-0.5 text-xs text-muted">{description}</D.Description>}
            </div>
            <D.Close className="rounded p-1 text-muted hover:bg-panel hover:text-fg" aria-label="Close">
              <X className="h-4 w-4" />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
