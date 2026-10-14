"use client";
import { create } from "zustand";

export type ViewCommand = { kind: "camera"; preset: "iso" | "top" | "front" | "side" | "reset" } | { kind: "screenshot" } | { kind: "export-scene" };

interface UiState {
  paletteOpen: boolean;
  saveOpen: boolean;
  shortcutsOpen: boolean;
  tourStep: number | null;
  viewCommand: { id: number; cmd: ViewCommand } | null;
  toasts: Array<{ id: number; tone: "ok" | "warn" | "err" | "info"; text: string }>;
  setPalette(o: boolean): void;
  setSave(o: boolean): void;
  setShortcuts(o: boolean): void;
  setTour(step: number | null): void;
  view(cmd: ViewCommand): void;
  toast(text: string, tone?: "ok" | "warn" | "err" | "info"): void;
  dismiss(id: number): void;
}

let toastId = 0;
let viewId = 0;

export const useUi = create<UiState>()((set) => ({
  paletteOpen: false,
  saveOpen: false,
  shortcutsOpen: false,
  tourStep: null,
  viewCommand: null,
  toasts: [],
  setPalette: (o) => set({ paletteOpen: o }),
  setSave: (o) => set({ saveOpen: o }),
  setShortcuts: (o) => set({ shortcutsOpen: o }),
  setTour: (step) => set({ tourStep: step }),
  view: (cmd) => set({ viewCommand: { id: ++viewId, cmd } }),
  toast: (text, tone = "info") => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, tone, text }].slice(-4) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
