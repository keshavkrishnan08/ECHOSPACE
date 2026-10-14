"use client";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ColorBy = "height" | "confidence" | "velocity";
export type CameraPreset = "iso" | "top" | "front" | "side";

export interface LayerState {
  room: boolean;
  walls: boolean;
  floorCeiling: boolean;
  furniture: boolean;
  openings: boolean;
  grid: boolean;
  axes: boolean;
  sensors: boolean;
  orientation: boolean;
  links: boolean;
  propagation: boolean;
  signalOverlay: boolean;
  pointsRaw: boolean;
  pointsFiltered: boolean;
  occupancy: boolean;
  unobserved: boolean;
  surface: boolean;
  groundTruth: boolean;
  groundTruthSkeleton: boolean;
  tracks: boolean;
  velocity: boolean;
  trails: boolean;
  trackIds: boolean;
  uncertainty: boolean;
}

export const DEFAULT_LAYERS: LayerState = {
  room: true, walls: true, floorCeiling: true, furniture: true, openings: true, grid: true, axes: false,
  sensors: true, orientation: true, links: false, propagation: true, signalOverlay: false,
  pointsRaw: false, pointsFiltered: true, occupancy: true, unobserved: false, surface: false,
  groundTruth: true, groundTruthSkeleton: true,
  tracks: true, velocity: true, trails: true, trackIds: true, uncertainty: true,
};

export interface SettingsState {
  layers: LayerState;
  colorBy: ColorBy;
  pointSize: number;
  pointDensity: number;
  occupancyThresholdView: number;
  confidenceFilter: number;
  orthographic: boolean;
  clipping: { enabled: boolean; axis: "x" | "y" | "z"; value: number };
  displayHz: number;
  historySeconds: number;
  panels: { left: number; right: number; bottom: number; leftOpen: boolean; rightOpen: boolean; bottomOpen: boolean };
  navCollapsed: boolean;
  apiBaseUrl: string;
  engineKind: "browser-worker" | "python-reference";
  maxInFlightFrames: number;
  showMetricHelp: boolean;
  recordingsOptIn: boolean;
  set: <K extends keyof SettingsState>(k: K, v: SettingsState[K]) => void;
  setLayer: (k: keyof LayerState, v: boolean) => void;
  setPanels: (p: Partial<SettingsState["panels"]>) => void;
  reset: () => void;
}

const defaults = {
  layers: DEFAULT_LAYERS,
  colorBy: "confidence" as ColorBy,
  pointSize: 0.06,
  pointDensity: 1,
  occupancyThresholdView: 0.6,
  confidenceFilter: 0,
  orthographic: false,
  clipping: { enabled: false, axis: "z" as const, value: 2.0 },
  displayHz: 30,
  historySeconds: 60,
  panels: { left: 300, right: 320, bottom: 200, leftOpen: true, rightOpen: true, bottomOpen: true },
  navCollapsed: false,
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  engineKind: "browser-worker" as const,
  maxInFlightFrames: 2,
  showMetricHelp: true,
  recordingsOptIn: false,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      set: (k, v) => set({ [k]: v } as Partial<SettingsState>),
      setLayer: (k, v) => set((s) => ({ layers: { ...s.layers, [k]: v } })),
      setPanels: (p) => set((s) => ({ panels: { ...s.panels, ...p } })),
      reset: () => set(defaults),
    }),
    {
      name: "echospace.settings.v1",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return { ...current, ...p, layers: { ...DEFAULT_LAYERS, ...(p.layers ?? {}) }, panels: { ...current.panels, ...(p.panels ?? {}) } };
      },
    },
  ),
);
