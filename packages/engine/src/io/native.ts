import type { LinkDescriptor, ScenarioConfig, Vec3 } from "@echospace/schemas";
import type { CsiPacket } from "../sim/channel";
import type { SourceDescriptor } from "../runtime/source";
import { dist } from "../sim/geometry";

/**
 * echospace-csi-v1: a line-delimited JSON recording format.
 *   line 1: header {format, centerFreqHz, subcarrierOffsetsHz, packetRateHz?, links[], room?, device?, consent, notes?}
 *   lines : {link, seq, t (seconds, or null), re: number[], im: number[]}  — [antenna*K + k]
 * Geometry (tx/rx positions and room) is optional; without it the recording can be inspected
 * in the Signal Studio but not imaged.
 */
export interface NativeHeader {
  format: "echospace-csi-v1";
  centerFreqHz: number;
  subcarrierOffsetsHz: number[];
  packetRateHz: number | null;
  links: Array<{ id: string; tx: Vec3 | null; rx: Vec3 | null; antennas: number }>;
  room: { width: number; depth: number; height: number } | null;
  device: string;
  consent: "obtained" | "not-applicable" | "unknown";
  synthetic: boolean;
  notes?: string;
}

export interface ParsedRecording {
  descriptor: SourceDescriptor;
  packets: CsiPacket[];
  warnings: string[];
  header: Record<string, unknown>;
}

export class RecordingFormatError extends Error {}

export function parseNative(text: string, name = "recording"): ParsedRecording {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) throw new RecordingFormatError("empty file");
  let header: NativeHeader;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    throw new RecordingFormatError("first line is not a JSON header");
  }
  if (header.format !== "echospace-csi-v1") throw new RecordingFormatError(`unsupported format "${String(header.format)}" (expected echospace-csi-v1)`);
  const K = header.subcarrierOffsetsHz?.length ?? 0;
  if (!K || !Array.isArray(header.links) || !header.links.length) throw new RecordingFormatError("header must declare subcarrierOffsetsHz and links");
  const warnings: string[] = [];
  const packets: CsiPacket[] = [];
  let t0: number | null = null;
  for (let i = 1; i < lines.length; i++) {
    let r: { link: number; seq: number; t: number | null; re: number[]; im: number[] };
    try {
      r = JSON.parse(lines[i]);
    } catch {
      warnings.push(`line ${i + 1}: invalid JSON, skipped`);
      continue;
    }
    const M = header.links[r.link]?.antennas;
    if (M === undefined) {
      warnings.push(`line ${i + 1}: unknown link ${r.link}, skipped`);
      continue;
    }
    const ts = r.t === null || r.t === undefined ? Number.NaN : r.t;
    if (t0 === null && Number.isFinite(ts)) t0 = ts;
    const rate = header.packetRateHz ?? 100;
    packets.push({
      link: r.link,
      seq: r.seq,
      timestampS: ts,
      trueTimeS: Number.isFinite(ts) ? ts - (t0 ?? 0) : r.seq / rate,
      antennas: M,
      subcarriers: K,
      re: Float32Array.from(r.re, (v) => (v === null ? Number.NaN : v)),
      im: Float32Array.from(r.im, (v) => (v === null ? Number.NaN : v)),
    });
  }
  const geometryKnown = Boolean(header.room) && header.links.every((l) => l.tx && l.rx);
  const links: LinkDescriptor[] = header.links.map((l, index) => ({
    index,
    id: l.id,
    txId: l.id.split(">")[0] ?? `tx${index}`,
    rxId: l.id.split(">")[1] ?? `rx${index}`,
    tx: l.tx ?? [0, 0, 0],
    rx: l.rx ?? [0, 0, 0],
    lengthM: l.tx && l.rx ? dist(l.tx, l.rx) : 0,
    antennas: l.antennas,
  }));
  return {
    header: header as unknown as Record<string, unknown>,
    warnings,
    packets,
    descriptor: {
      mode: "recorded",
      adapter: "recorded-native",
      id: `recorded:${name}`,
      label: `Recording ${name}${header.synthetic ? " (synthetic origin)" : ""}`,
      sampleFormat: `echospace-csi-v1: complex CSI, ${K} subcarriers`,
      links,
      antennas: header.links.map((l) => l.antennas),
      subcarriers: K,
      subcarrierOffsetsHz: Float64Array.from(header.subcarrierOffsetsHz),
      centerFreqHz: header.centerFreqHz ?? null,
      packetRateHz: header.packetRateHz ?? null,
      geometryKnown,
      hasGroundTruth: false,
      timestampSource: "recording timestamps (device clock)",
      notes: [`device: ${header.device}`, `consent: ${header.consent}`, ...(header.synthetic ? ["This recording was produced by the ECHOSPACE simulator, not by hardware."] : []), ...(header.notes ? [header.notes] : [])],
    },
  };
}

/** Serialises synthetic packets to echospace-csi-v1 (used to produce sample recordings). */
export function toNative(config: ScenarioConfig, descriptor: SourceDescriptor, packets: CsiPacket[]): string {
  const header: NativeHeader = {
    format: "echospace-csi-v1",
    centerFreqHz: descriptor.centerFreqHz ?? config.signal.centerFreqHz,
    subcarrierOffsetsHz: Array.from(descriptor.subcarrierOffsetsHz),
    packetRateHz: descriptor.packetRateHz,
    links: descriptor.links.map((l) => ({ id: l.id, tx: l.tx, rx: l.rx, antennas: l.antennas })),
    room: { width: config.room.width, depth: config.room.depth, height: config.room.height },
    device: "ECHOSPACE synthetic simulator",
    consent: "not-applicable",
    synthetic: true,
    notes: `scenario ${config.scenario}, seed ${config.seed}`,
  };
  const r6 = (v: number) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null);
  const body = packets.map((p) => JSON.stringify({ link: p.link, seq: p.seq, t: Number.isFinite(p.timestampS) ? r6(p.timestampS) : null, re: Array.from(p.re, r6), im: Array.from(p.im, r6) }));
  return [JSON.stringify(header), ...body].join("\n") + "\n";
}
