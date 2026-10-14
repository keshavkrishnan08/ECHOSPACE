"use client";
import * as T from "@radix-ui/react-tooltip";
import { useHydrated } from "@/lib/useHydrated";

export const TooltipProvider = T.Provider;


export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  const hydrated = useHydrated();
  if (!content || !hydrated) return <>{children}</>;
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded border border-line bg-panel-2 px-2.5 py-1.5 text-2xs leading-relaxed text-fg shadow-xl">
          {content}
          <T.Arrow className="fill-panel-2" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
