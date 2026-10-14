"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/badge";
import { NAV } from "./nav";

const LIST: Array<[string, string]> = [
  ["⌘/Ctrl K", "Command palette"],
  ["Space", "Play / pause"],
  [".", "Step one frame"],
  ["← / →", "Scrub one frame (pauses live view)"],
  ["L", "Return to live"],
  ["R", "Restart scenario"],
  ["S", "Save run as experiment"],
  ["1 … 0", "Go to page (Overview … Settings)"],
  ["T / F / I", "Camera top / front / isometric (viewport)"],
  ["?", "This help"],
];

export function useGlobalShortcuts() {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      const ui = useUi.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.setPalette(!ui.paletteOpen);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || ui.paletteOpen || ui.saveOpen) return;
      const s = useSession.getState();
      if (t && t.getAttribute("role") === "slider" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
      switch (e.key) {
        case " ":
          if (t && (t.tagName === "BUTTON" || t.getAttribute("role") === "switch" || t.getAttribute("role") === "radio")) return;
          e.preventDefault();
          s.togglePlay();
          break;
        case ".":
          s.step(1);
          break;
        case "l":
        case "L":
          s.goLive();
          break;
        case "r":
        case "R":
          s.restart();
          break;
        case "s":
        case "S":
          ui.setSave(true);
          break;
        case "?":
          ui.setShortcuts(true);
          break;
        case "ArrowLeft":
        case "ArrowRight": {
          const cur = s.cursorSeq;
          if (cur === null) break;
          e.preventDefault();
          s.scrub(Math.max(0, cur + (e.key === "ArrowLeft" ? -1 : 1)));
          break;
        }
        case "t":
          ui.view({ kind: "camera", preset: "top" });
          break;
        case "f":
          ui.view({ kind: "camera", preset: "front" });
          break;
        case "i":
          ui.view({ kind: "camera", preset: "iso" });
          break;
        default: {
          const n = NAV.find((x) => x.key === e.key);
          if (n) router.push(n.href);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
}

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const set = useUi((s) => s.setShortcuts);
  return (
    <Dialog open={open} onOpenChange={set} title="Keyboard shortcuts">
      <ul className="space-y-1.5 text-xs">
        {LIST.map(([k, d]) => (
          <li key={k} className="flex items-center justify-between">
            <span className="text-muted">{d}</span>
            <Kbd>{k}</Kbd>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
