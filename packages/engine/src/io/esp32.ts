import type { LinkDescriptor } from "@echospace/schemas";
import type { CsiPacket } from "../sim/channel";
import type { SourceDescriptor } from "../runtime/source";
import { RecordingFormatError, parseNative, type ParsedRecording } from "./native";

/**
 * Parser for CSV logs in the layout written by the ESP32-CSI-Tool firmware
 * (https://github.com/StevenMHernandez/ESP32-CSI-Tool): rows beginning with "CSI_DATA",
 * a header naming the columns, and a bracketed list of signed integers where each subcarrier
 * contributes (imaginary, real). Columns are located by header name.
 *
 * Status: implemented against the published format description and tested with synthetic rows.
 * It has not been validated against a physical ESP32 capture in this repository.
 */
const DEFAULT_HEADER = ["type", "role", "mac", "rssi", "rate", "sig_mode", "mcs", "bandwidth", "smoothing", "not_sounding", "aggregation", "stbc", "fec_coding", "sgi", "noise_floor", "ampdu_cnt", "channel", "secondary_channel", "local_timestamp", "ant", "sig_len", "rx_state", "real_time_set", "real_timestamp", "len", "CSI_DATA"];

const CHANNEL_MHZ = (ch: number) => (ch >= 1 && ch <= 13 ? 2407 + 5 * ch : ch === 14 ? 2484 : 5000 + 5 * ch);

export function parseEsp32Csv(text: string, name = "esp32"): ParsedRecording {
  const lines = text.split(/\r?\n/);
  let header = DEFAULT_HEADER;
  const warnings: string[] = [];
  const rows: Array<{ mac: string; ts: number; rssi: number; ch: number; values: number[] }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith("type,")) {
      header = line.split(",").map((s) => s.trim());
      continue;
    }
    if (!line.startsWith("CSI_DATA")) continue;
    const lb = line.indexOf("[");
    const rb = line.lastIndexOf("]");
    if (lb < 0 || rb < lb) {
      warnings.push(`line ${i + 1}: no CSI array`);
      continue;
    }
    const fields = line.slice(0, lb).split(",");
    const col = (n: string) => fields[header.indexOf(n)];
    const values = line.slice(lb + 1, rb).trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const declared = Number(col("len"));
    if (Number.isFinite(declared) && declared !== values.length) warnings.push(`line ${i + 1}: len=${declared} but ${values.length} values`);
    if (values.length % 2 || values.some((v) => !Number.isFinite(v))) {
      warnings.push(`line ${i + 1}: malformed CSI values, skipped`);
      continue;
    }
    rows.push({ mac: col("mac") ?? "unknown", ts: Number(col("local_timestamp")), rssi: Number(col("rssi")), ch: Number(col("channel")), values });
  }
  if (!rows.length) throw new RecordingFormatError("no CSI_DATA rows found — is this an ESP32-CSI-Tool CSV log?");
  const K = rows[0].values.length / 2;
  const kept = rows.filter((r) => r.values.length / 2 === K);
  if (kept.length < rows.length) warnings.push(`${rows.length - kept.length} rows with a different subcarrier count were skipped`);
  const macs = [...new Set(kept.map((r) => r.mac))];
  const links: LinkDescriptor[] = macs.map((m, index) => ({ index, id: `${m}>esp32`, txId: m, rxId: "esp32", tx: [0, 0, 0], rx: [0, 0, 0], lengthM: 0, antennas: 1 }));
  const t0 = kept.find((r) => Number.isFinite(r.ts))?.ts ?? 0;
  const seqs = new Map<string, number>();
  const packets: CsiPacket[] = kept.map((r) => {
    const link = macs.indexOf(r.mac);
    const seq = seqs.get(r.mac) ?? 0;
    seqs.set(r.mac, seq + 1);
    const re = new Float32Array(K);
    const im = new Float32Array(K);
    for (let k = 0; k < K; k++) {
      im[k] = r.values[2 * k];
      re[k] = r.values[2 * k + 1];
    }
    const ts = Number.isFinite(r.ts) ? (r.ts - t0) / 1e6 : Number.NaN;
    return { link, seq, timestampS: ts, trueTimeS: Number.isFinite(ts) ? ts : seq / 100, antennas: 1, subcarriers: K, re, im };
  });
  const span = packets.length > 1 ? packets[packets.length - 1].trueTimeS - packets[0].trueTimeS : 0;
  const rate = span > 0 ? packets.length / macs.length / span : null;
  const spacing = 312.5e3;
  const ch = kept[0].ch;
  const descriptor: SourceDescriptor = {
    mode: "recorded",
    adapter: "recorded-esp32",
    id: `recorded:${name}`,
    label: `ESP32 CSI log ${name}`,
    sampleFormat: `ESP32-CSI-Tool CSV: int8 (imag, real) pairs, ${K} subcarriers, 1 antenna`,
    links,
    antennas: links.map(() => 1),
    subcarriers: K,
    subcarrierOffsetsHz: Float64Array.from({ length: K }, (_, k) => (k - K / 2) * spacing),
    centerFreqHz: Number.isFinite(ch) ? CHANNEL_MHZ(ch) * 1e6 : null,
    packetRateHz: rate,
    geometryKnown: false,
    hasGroundTruth: false,
    timestampSource: "ESP32 local_timestamp (µs, device clock)",
    notes: [
      "Subcarrier order and guard/null subcarriers follow the raw firmware buffer; no reordering is applied.",
      "Sensor geometry is not part of this format, so spatial reconstruction is unavailable.",
      "Parser validated against the documented format with synthetic rows only.",
    ],
  };
  return { descriptor, packets, warnings: warnings.slice(0, 20), header: { format: "esp32-csi-tool-csv", rows: kept.length, macs, channel: ch, meanRssiDbm: kept.reduce((a, r) => a + r.rssi, 0) / kept.length } };
}

/** Detects the format from content and parses it. */
export function parseRecording(text: string, name: string): ParsedRecording {
  const head = text.slice(0, 200).trimStart();
  if (head.startsWith("{")) return parseNative(text, name);
  if (head.startsWith("type,") || head.startsWith("CSI_DATA")) return parseEsp32Csv(text, name);
  throw new RecordingFormatError("Unsupported source format. Supported: echospace-csi-v1 (JSONL) and ESP32-CSI-Tool CSV.");
}
