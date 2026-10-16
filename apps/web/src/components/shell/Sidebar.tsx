"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSettings } from "@/lib/store/settings";
import { cn } from "@/lib/format";
import { Tip } from "@/components/ui/tooltip";
import { NAV, SECONDARY } from "./nav";

export function Sidebar() {
  const path = usePathname();
  const collapsed = useSettings((s) => s.navCollapsed);
  const set = useSettings((s) => s.set);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const item = (n: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }, primary = false) => {
    const Icon = n.icon;
    const active = isActive(n.href);
    const link = (
      <Link
        key={n.href}
        href={n.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex h-8 items-center gap-2.5 rounded-[5px] px-2 text-xs transition-colors",
          active ? "bg-signal/10 text-fg" : "text-muted hover:bg-panel hover:text-fg",
          primary && !active && "text-fg/90",
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-signal" : primary ? "text-signal/70" : "text-faint group-hover:text-muted")} />
        {!collapsed && <span className={cn("truncate", primary && "font-medium")}>{n.label}</span>}
      </Link>
    );
    return collapsed ? (
      <Tip key={n.href} content={n.label} side="right">
        {link}
      </Tip>
    ) : (
      link
    );
  };
  return (
    <nav aria-label="Primary" className={cn("flex h-full shrink-0 flex-col border-r border-line bg-surface transition-[width]", collapsed ? "w-12" : "w-52")}>
      <div className="flex h-11 items-center gap-2 border-b border-line px-3">
        <Logo />
        {!collapsed && (
          <span className="text-[13px] font-semibold tracking-[0.18em]">
            ECH<span className="text-signal">O</span>
          </span>
        )}
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {NAV.slice(0, 1).map((n) => item(n))}
        <div className={cn("pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint", collapsed ? "text-center" : "px-2")}>{collapsed ? "·" : "Instruments"}</div>
        {NAV.slice(1, 4).map((n) => item(n, true))}
        <div className={cn("pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint", collapsed ? "text-center" : "px-2")}>{collapsed ? "·" : "Research"}</div>
        {NAV.slice(4, 8).map((n) => item(n))}
        <div className={cn("pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint", collapsed ? "text-center" : "px-2")}>{collapsed ? "·" : "System"}</div>
        {NAV.slice(8).map((n) => item(n))}
        {SECONDARY.map((n) => item(n))}
      </div>
      <button
        type="button"
        onClick={() => set("navCollapsed", !collapsed)}
        className="flex h-9 items-center gap-2 border-t border-line px-3 text-2xs text-muted hover:text-fg"
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
      >
        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        {!collapsed && "Collapse"}
      </button>
    </nav>
  );
}

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <circle cx="12" cy="12" r="2.2" fill="#2dd4e6" />
      <path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4" stroke="#2dd4e6" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.8" />
      <path d="M3.5 3.5a12 12 0 0 0 0 17M20.5 3.5a12 12 0 0 1 0 17" stroke="#5b8def" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}
