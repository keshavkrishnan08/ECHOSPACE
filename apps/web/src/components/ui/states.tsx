import { AlertTriangle, Loader2, PlugZap, Inbox } from "lucide-react";
import { cn } from "@/lib/format";

export function EmptyState({ title, children, icon, className }: { title: string; children?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 p-6 text-center", className)}>
      <div className="text-faint">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <div className="text-sm text-fg">{title}</div>
      {children && <div className="max-w-sm text-xs text-muted">{children}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("flex items-center justify-center gap-2 p-6 text-xs text-muted", className)}>
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ title, children, className }: { title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 p-6 text-center", className)}>
      <AlertTriangle className="h-6 w-6 text-err" />
      <div className="text-sm text-fg">{title}</div>
      {children && <div className="max-w-md text-xs text-muted">{children}</div>}
    </div>
  );
}

export function DisconnectedState({ what, children }: { what: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded border border-warn/30 bg-warn/5 p-3 text-xs">
      <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
      <div>
        <div className="font-medium text-warn">{what} disconnected</div>
        {children && <div className="mt-0.5 text-muted">{children}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-panel", className)} />;
}
