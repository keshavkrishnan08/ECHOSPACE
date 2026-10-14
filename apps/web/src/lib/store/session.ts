"use client";
import { create } from "zustand";
import type { ProcessingState, ReconstructionFrame, ScenarioConfig, SourceMode } from "@echospace/schemas";
import type { CsiPacket, RidgeWeights, SourceDescriptor } from "@echospace/engine";
import { demoScenario } from "@echospace/engine";
import { EngineClient } from "../engine/client";
import { history } from "../engine/history";
import type { EngineInfo } from "../engine/protocol";
import { useSettings } from "./settings";

export type Selection =
  | { kind: "none" }
  | { kind: "point"; index: number; set: "filtered" | "raw"; seq: number }
  | { kind: "voxel"; index: number; seq: number }
  | { kind: "track"; id: string }
  | { kind: "region"; polygon: Array<[number, number]>; mode: "box" | "lasso" }
  | { kind: "sensor"; id: string }
  | { kind: "obstacle"; id: string }
  | { kind: "wall"; name: string };

export interface SessionState {
  sessionId: string;
  sourceMode: SourceMode;
  sourceLabel: string;
  config: ScenarioConfig;
  /** Configuration at launch/restart; with `configChanges` it reproduces the run. */
  launchConfig: ScenarioConfig;
  scenarioKey: string;
  variantId: string | null;
  info: EngineInfo | null;
  status: ProcessingState;
  statusMessage: string;
  playing: boolean;
  finished: boolean;
  simTime: number;
  speed: number;
  live: boolean;
  cursorSeq: number | null;
  selectedLink: number;
  selection: Selection;
  frameRate: number;
  lastFrameAtMs: number;
  displayDrops: number;
  startedAtMs: number | null;
  error: string | null;
  booted: boolean;
  ridge: RidgeWeights | null;
  /** Mid-run reconfigurations with the frame sequence at which they took effect. */
  configChanges: Array<{ frameSeq: number; t: number; config: ScenarioConfig }>;
  /** Experiment id when this session is a replay. */
  replayOf: string | null;
  launch(config: ScenarioConfig, opts?: { scenarioKey?: string; variantId?: string | null; autoplay?: boolean; schedule?: Array<{ frameSeq: number; t: number; config: ScenarioConfig }>; replayOf?: string }): void;
  loadRecording(config: ScenarioConfig, descriptor: SourceDescriptor, packets: CsiPacket[], calibration: CsiPacket[] | null): void;
  startPush(config: ScenarioConfig, descriptor: SourceDescriptor): void;
  pushPackets(packets: CsiPacket[]): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  setSpeed(s: number): void;
  step(n?: number): void;
  restart(): void;
  applyConfig(c: ScenarioConfig): void;
  recalibrate(): void;
  selectLink(i: number): void;
  scrub(seq: number): void;
  goLive(): void;
  select(s: Selection): void;
  ensureBooted(): void;
}

const newSessionId = () => `ses_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

let client: EngineClient | null = null;
const pendingConfigs: ScenarioConfig[] = [];
const arrivals: number[] = [];

async function loadRidge(): Promise<RidgeWeights | null> {
  try {
    const r = await fetch("/models/ridge_floor/weights.json", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as RidgeWeights;
  } catch {
    return null;
  }
}

export const useSession = create<SessionState>()((set, get) => {
  const c = () => {
    if (client) return client;
    client = new EngineClient({
      onReady: (info) => set({ info, status: info.calibrated ? "streaming" : "calibrating", error: null }),
      onReconfigured: (frameSeq, t) => {
        const cfg = pendingConfigs.shift();
        if (cfg) set((st) => ({ configChanges: [...st.configChanges, { frameSeq, t, config: cfg }].slice(-200) }));
      },
      onFrames: (frames: ReconstructionFrame[], meta) => {
        history.push(frames, meta.receivedAtMs);
        const now = meta.receivedAtMs;
        for (let i = 0; i < frames.length; i++) arrivals.push(now);
        while (arrivals.length && now - arrivals[0] > 2000) arrivals.shift();
        const last = frames[frames.length - 1];
        set({
          simTime: meta.simTime,
          displayDrops: meta.displayDrops,
          lastFrameAtMs: now,
          frameRate: arrivals.length / 2,
          status: last.state,
          ...(get().live ? { cursorSeq: last.seq } : {}),
        });
      },
      onStatus: (s) => set({ playing: s.playing, simTime: s.simTime, finished: s.finished, statusMessage: s.message ?? "", ...(s.playing ? {} : { status: get().status === "streaming" ? "paused" : get().status }) }),
      onError: (message, fatal) => set({ error: message, ...(fatal ? { status: "error", playing: false } : {}) }),
    });
    return client;
  };

  return {
    sessionId: "ses_——————",
    sourceMode: "synthetic",
    sourceLabel: "Synthetic simulation",
    config: demoScenario(),
    launchConfig: demoScenario(),
    scenarioKey: "B",
    variantId: null,
    info: null,
    status: "idle",
    statusMessage: "",
    playing: false,
    finished: false,
    simTime: 0,
    speed: 1,
    live: true,
    cursorSeq: null,
    selectedLink: 0,
    selection: { kind: "none" },
    frameRate: 0,
    lastFrameAtMs: 0,
    displayDrops: 0,
    startedAtMs: null,
    error: null,
    booted: false,
    ridge: null,
    configChanges: [],
    replayOf: null,

    ensureBooted() {
      if (get().booted) return;
      set({ booted: true });
      get().launch(get().config, { scenarioKey: get().scenarioKey });
    },

    launch(config, opts = {}) {
      history.resize(Math.round(useSettings.getState().historySeconds * config.dsp.frameRateHz));
      history.clear();
      arrivals.length = 0;
      set({
        config, launchConfig: config, scenarioKey: opts.scenarioKey ?? config.scenario, variantId: opts.variantId ?? null, sessionId: newSessionId(),
        sourceMode: "synthetic", sourceLabel: `Synthetic simulation · scenario ${config.scenario} · seed ${config.seed}`,
        status: "initializing", info: null, playing: false, finished: false, simTime: 0, live: true, cursorSeq: null,
        selection: { kind: "none" }, startedAtMs: Date.now(), error: null, booted: true, displayDrops: 0, configChanges: opts.schedule ?? [], replayOf: opts.replayOf ?? null,
      });
      const max = useSettings.getState().maxInFlightFrames;
      const go = (ridge: RidgeWeights | null) => {
        set({ ridge });
        c().init(config, ridge, get().selectedLink, max, opts.schedule);
        c().send({ type: "speed", speed: get().speed });
        if (opts.autoplay !== false) get().play();
      };
      const r = get().ridge;
      if (r) go(r);
      else void loadRidge().then(go);
    },

    loadRecording(config, descriptor, packets, calibration) {
      history.clear();
      set({
        config, launchConfig: config, scenarioKey: "custom", variantId: null, sessionId: newSessionId(), sourceMode: "recorded", sourceLabel: descriptor.label,
        status: "initializing", info: null, playing: false, finished: false, simTime: 0, live: true, cursorSeq: null, startedAtMs: Date.now(), error: null, booted: true,
      });
      c().initRecorded(config, descriptor, packets, calibration, useSettings.getState().maxInFlightFrames);
    },

    startPush(config, descriptor) {
      history.clear();
      set({
        config, launchConfig: config, scenarioKey: "custom", variantId: null, sessionId: newSessionId(), sourceMode: "hardware", sourceLabel: descriptor.label,
        status: "initializing", info: null, playing: false, finished: false, simTime: 0, live: true, cursorSeq: null, startedAtMs: Date.now(), error: null, booted: true,
      });
      c().initPush(config, descriptor, useSettings.getState().maxInFlightFrames);
      get().play();
    },

    pushPackets(packets) {
      c().send({ type: "push-packets", packets });
    },

    play() {
      c().send({ type: "play" });
      set({ live: true });
    },
    pause() {
      c().send({ type: "pause" });
    },
    togglePlay() {
      if (get().playing) get().pause();
      else get().play();
    },
    setSpeed(s) {
      set({ speed: s });
      c().send({ type: "speed", speed: s });
    },
    step(n = 1) {
      set({ live: true });
      c().send({ type: "step", frames: n });
    },
    restart() {
      history.clear();
      arrivals.length = 0;
      set((st) => ({ simTime: 0, finished: false, cursorSeq: null, live: true, startedAtMs: Date.now(), status: "initializing", configChanges: [], launchConfig: st.config }));
      c().send({ type: "restart" });
    },
    applyConfig(cfg) {
      pendingConfigs.push(cfg);
      set({ config: cfg });
      c().send({ type: "reconfigure", config: cfg });
    },
    recalibrate() {
      c().send({ type: "recalibrate" });
    },
    selectLink(i) {
      set({ selectedLink: i });
      c().send({ type: "select-link", index: i });
    },
    scrub(seq) {
      set({ live: false, cursorSeq: seq });
    },
    goLive() {
      const l = history.latest();
      set({ live: true, cursorSeq: l?.seq ?? null });
    },
    select(s) {
      set({ selection: s });
    },
  };
});
