import { cn } from "@/lib/format";

const tones = {
  neutral: "border-line text-muted",
  signal: "border-signal/40 text-signal bg-signal/10",
  ok: "border-ok/40 text-ok bg-ok/10",
  warn: "border-warn/40 text-warn bg-warn/10",
  err: "border-err/40 text-err bg-err/10",
  track: "border-track/40 text-track bg-track/10",
  geometry: "border-geometry/40 text-geometry bg-geometry/10",
} as const;

export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded border px-1.5 text-2xs font-medium uppercase tracking-wide", tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="num inline-flex h-4 min-w-4 items-center justify-center rounded border border-line bg-panel px-1 text-[10px] text-muted">{children}</kbd>;
}
