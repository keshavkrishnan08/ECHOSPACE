"use client";
import type { ScenarioConfig, SensorNode } from "@echospace/schemas";
import { ScenarioConfig as Schema } from "@echospace/schemas";
import { parseRecording, SyntheticSource, toNative, type ParsedRecording } from "@echospace/engine";
import { useSession } from "../store/session";
import { downloadBlob } from "../format";

/** Builds the scene configuration implied by a recording (room + endpoints when declared). */
export function configForRecording(rec: ParsedRecording, base: ScenarioConfig): ScenarioConfig {
  const header = rec.header as { room?: { width: number; depth: number; height: number } | null };
  const room = header.room ? { ...base.room, ...header.room } : base.room;
  const sensors: SensorNode[] = [];
  if (rec.descriptor.geometryKnown) {
    for (const l of rec.descriptor.links) {
      for (const [id, pos, role] of [[l.txId, l.tx, "tx"], [l.rxId, l.rx, "rx"]] as const) {
        const ex = sensors.find((s) => s.id === id);
        if (ex) {
          if (ex.role !== role) ex.role = "trx";
          continue;
        }
        sensors.push({ id, label: id, role, position: pos, yawDeg: 0, antennas: role === "rx" ? l.antennas : 1, enabled: true });
      }
    }
  }
  return Schema.parse({
    ...base,
    scenario: "custom",
    name: rec.descriptor.label,
    room,
    obstacles: [],
    openings: [],
    subjects: [],
    sensors: sensors.length >= 2 ? sensors : base.sensors,
    signal: { ...base.signal, packetRateHz: Math.min(1000, Math.max(10, Math.round(rec.descriptor.packetRateHz ?? 100))), subcarriers: Math.min(128, Math.max(8, rec.descriptor.subcarriers)) },
  });
}

export async function importRecordingFile(file: File): Promise<ParsedRecording> {
  const text = await file.text();
  const rec = parseRecording(text, file.name);
  const base = useSession.getState().config;
  useSession.getState().loadRecording(configForRecording(rec, base), rec.descriptor, rec.packets, null);
  return rec;
}

/** Writes a short sample of the current synthetic scenario in echospace-csi-v1 for testing the import path. */
export function exportSyntheticSample(seconds = 3) {
  const cfg = useSession.getState().config;
  const src = new SyntheticSource(cfg);
  const packets = src.pull(seconds);
  downloadBlob(`echospace_sample_${cfg.scenario}_seed${cfg.seed}_${seconds}s.jsonl`, toNative(cfg, src.descriptor, packets), "application/x-ndjson");
}
