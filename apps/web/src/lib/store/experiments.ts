"use client";
import { ExperimentRecord, PREPROCESSING_VERSION, SOFTWARE_VERSION, type MetricSeries, type MetricSummary } from "@echospace/schemas";
import { canonicalJson, percentile, stableHash } from "@echospace/engine";
import { history, type FrameSummary } from "../engine/history";
import { apiFetch } from "../api/client";
import { useSession } from "./session";

/**
 * Experiment persistence. Records always go to the browser's IndexedDB; when the Python API is
 * reachable they are also POSTed there. The list view merges both and labels the origin.
 */
const DB = "echospace";
const STORE = "experiments";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const localExperiments = {
  async list(): Promise<ExperimentRecord[]> {
    const all = (await tx("readonly", (s) => s.getAll())) as unknown[];
    return all.map((x) => ExperimentRecord.parse(x)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  },
  async get(id: string): Promise<ExperimentRecord | null> {
    const r = await tx("readonly", (s) => s.get(id));
    return r ? ExperimentRecord.parse(r) : null;
  },
  async put(rec: ExperimentRecord) {
    await tx("readwrite", (s) => s.put(rec));
  },
  async remove(id: string) {
    await tx("readwrite", (s) => s.delete(id));
  },
};

const SERIES_KEYS: Array<keyof FrameSummary> = [
  "positionErrorM", "floorIou", "voxelIou", "precision", "recall", "chamferM", "meanConfidence", "observedFraction",
  "activeTracks", "idSwitchesTotal", "inputQuality", "packetDeliveryRatio", "meanSnrDb", "processingMs", "endToEndMs",
];

export function summarize(rows: FrameSummary[]): MetricSummary[] {
  return SERIES_KEYS.map((k) => {
    const vals = rows.map((r) => r[k] as number | null).filter((v): v is number => v !== null && Number.isFinite(v));
    const n = vals.length;
    return {
      id: k,
      n,
      mean: n ? vals.reduce((a, b) => a + b, 0) / n : null,
      median: percentile(vals, 0.5),
      p95: n >= 20 ? percentile(vals, 0.95) : null,
      min: n ? Math.min(...vals) : null,
      max: n ? Math.max(...vals) : null,
      last: n ? vals[n - 1] : null,
    };
  });
}

export function seriesFrom(rows: FrameSummary[], maxPoints = 1200): MetricSeries[] {
  const step = Math.max(1, Math.ceil(rows.length / maxPoints));
  const picked = rows.filter((_, i) => i % step === 0);
  return SERIES_KEYS.map((k) => ({ id: k, t: picked.map((r) => r.t), v: picked.map((r) => (r[k] as number | null) ?? null) }));
}

/** Digest of the first N frames: quantized occupancy + link features, hashed with SHA-256. */
export async function digestFrames(frames: Array<{ occupancy: Float32Array; features: { deltaRssDb: Float32Array } }>): Promise<string> {
  const parts: number[] = [];
  for (const f of frames) {
    for (let i = 0; i < f.occupancy.length; i += 7) parts.push(Math.round(f.occupancy[i] * 1e4));
    for (const v of f.features.deltaRssDb) parts.push(Number.isFinite(v) ? Math.round(v * 1e3) : -999999);
  }
  const buf = new TextEncoder().encode(parts.join(","));
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const DIGEST_FRAMES = 40;

export function machineInfo() {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }) : null;
  let gpu: string | null = null;
  try {
    const c = document.createElement("canvas").getContext("webgl");
    const ext = c?.getExtension("WEBGL_debug_renderer_info");
    gpu = ext && c ? String(c.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
  } catch {
    gpu = null;
  }
  return {
    userAgent: nav?.userAgent ?? null,
    hardwareConcurrency: nav?.hardwareConcurrency ?? null,
    deviceMemoryGb: nav?.deviceMemory ?? null,
    platform: nav?.platform ?? null,
    gpu,
  };
}

export async function buildExperiment(name: string, notes: string, tags: string[] = [], baselineOf: string | null = null): Promise<ExperimentRecord> {
  const s = useSession.getState();
  const frames = history.ordered();
  const rows = history.summaries;
  const firstFrames = frames.filter((f) => f.seq < DIGEST_FRAMES);
  const digestOk = firstFrames.length === DIGEST_FRAMES && firstFrames[0].seq === 0;
  const latest = history.latest();
  const id = `exp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return ExperimentRecord.parse({
    id,
    name,
    notes,
    sourceMode: s.sourceMode,
    config: s.launchConfig,
    configHash: stableHash(s.launchConfig),
    modelId: s.config.recon.modelId,
    modelVersion: latest?.provenance.modelVersion ?? "unknown",
    preprocessingVersion: PREPROCESSING_VERSION,
    engine: "browser-worker",
    inferenceDevice: "cpu (browser worker, JavaScript)",
    softwareVersion: SOFTWARE_VERSION,
    machine: machineInfo(),
    status: "completed",
    startedAt: new Date(s.startedAtMs ?? Date.now()).toISOString(),
    endedAt: new Date().toISOString(),
    simulatedDurationS: s.simTime,
    frames: rows.length,
    replayDigest: digestOk ? await digestFrames(firstFrames) : null,
    replayDigestFrames: digestOk ? DIGEST_FRAMES : 0,
    summaries: summarize(rows),
    series: seriesFrom(rows),
    events: history.events.slice(-500).map((e) => ({ t: e.t, kind: e.kind, message: e.message })),
    configChanges: s.configChanges,
    tags,
    baselineOf,
  });
}

export async function saveExperiment(rec: ExperimentRecord): Promise<{ local: boolean; api: boolean; apiError?: string }> {
  await localExperiments.put(rec);
  try {
    await apiFetch("/api/experiments", { method: "POST", body: canonicalJson(rec) });
    return { local: true, api: true };
  } catch (e) {
    return { local: true, api: false, apiError: e instanceof Error ? e.message : String(e) };
  }
}
