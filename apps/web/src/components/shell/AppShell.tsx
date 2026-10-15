"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSession } from "@/lib/store/session";
import { useSettings } from "@/lib/store/settings";
import { CommandPalette } from "./CommandPalette";
import { ErrorBoundary } from "./ErrorBoundary";
import { SaveExperimentDialog } from "./SaveExperimentDialog";
import { ShortcutsDialog, useGlobalShortcuts } from "./Shortcuts";
import { Sidebar } from "./Sidebar";
import { Toasts } from "./Toasts";
import { TopBar } from "./TopBar";
import { TourOverlay } from "@/components/common/Tour";

function Inner({ children }: { children: React.ReactNode }) {
  useGlobalShortcuts();
  const ensureBooted = useSession((s) => s.ensureBooted);
  useEffect(() => {
    void useSettings.persist.rehydrate();
    ensureBooted();
  }, [ensureBooted]);
  const path = usePathname();
  if (path === "/") {
    return (
      <>
        <main id="main" className="h-dvh w-full overflow-hidden">
          <ErrorBoundary label="Page">{children}</ErrorBoundary>
        </main>
        <CommandPalette />
        <Toasts />
      </>
    );
  }
  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" className="min-h-0 flex-1 overflow-hidden">
          <ErrorBoundary label="Page">{children}</ErrorBoundary>
        </main>
      </div>
      <CommandPalette />
      <SaveExperimentDialog />
      <ShortcutsDialog />
      <TourOverlay />
      <Toasts />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <Inner>{children}</Inner>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
