"use client";
import { ESP32_DEFAULT_HEADER, esp32Descriptor, parseEsp32Row, type CsiPacket } from "@echospace/engine";
import { useSession } from "../store/session";

/**
 * Live ESP32 CSI over the Web Serial API. Reads newline-delimited ESP32-CSI-Tool output,
 * converts CSI_DATA rows to packets and pushes them into the engine's bounded PushSource.
 * Experimental: implemented against the published output format, not tested on a device here.
 */
export interface SerialStats {
  connected: boolean;
  lines: number;
  csiRows: number;
  malformed: number;
  ignoredMacs: number;
  subcarriers: number | null;
  mac: string | null;
  channel: number | null;
  lastRowAtMs: number | null;
  ratesHz: number | null;
  nonMonotonic: number;
  bytes: number;
  error: string | null;
}

type SerialPortLike = {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  getInfo?: () => { usbVendorId?: number; usbProductId?: number };
};

export const serialSupported = () => typeof navigator !== "undefined" && "serial" in navigator;

export class Esp32SerialAdapter {
  stats: SerialStats = { connected: false, lines: 0, csiRows: 0, malformed: 0, ignoredMacs: 0, subcarriers: null, mac: null, channel: null, lastRowAtMs: null, ratesHz: null, nonMonotonic: 0, bytes: 0, error: null };
  deviceInfo: Record<string, unknown> = {};
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private header = ESP32_DEFAULT_HEADER;
  private seq = 0;
  private t0: number | null = null;
  private lastTs = -Infinity;
  private batch: CsiPacket[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private arrivals: number[] = [];
  recording: string[] | null = null;
  recordingBytes = 0;
  readonly maxRecordingBytes = 50 * 1024 * 1024;

  constructor(private onUpdate: () => void) {}

  async connect(baudRate: number) {
    const serial = (navigator as unknown as { serial: { requestPort(): Promise<SerialPortLike> } }).serial;
    this.port = await serial.requestPort();
    await this.port.open({ baudRate });
    this.deviceInfo = { ...(this.port.getInfo?.() ?? {}), baudRate };
    this.stats.connected = true;
    this.onUpdate();
    this.flushTimer = setInterval(() => this.flush(), 100);
    void this.readLoop();
  }

  private async readLoop() {
    if (!this.port?.readable) return;
    const decoded = this.port.readable.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>);
    this.reader = decoded.getReader();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          this.line(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
        if (buf.length > 65536) buf = "";
      }
    } catch (e) {
      this.stats.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.stats.connected = false;
      this.onUpdate();
    }
  }

  private line(raw: string) {
    this.stats.lines++;
    this.stats.bytes += raw.length + 1;
    const t = raw.trim();
    if (t.startsWith("type,")) {
      this.header = t.split(",").map((x) => x.trim());
      return;
    }
    if (!t.startsWith("CSI_DATA")) return;
    const row = parseEsp32Row(t, this.header);
    if (!row) {
      this.stats.malformed++;
      return;
    }
    if (this.recording && this.recordingBytes < this.maxRecordingBytes) {
      this.recording.push(t);
      this.recordingBytes += t.length + 1;
    }
    if (this.stats.mac === null) {
      this.stats.mac = row.mac;
      this.stats.subcarriers = row.re.length;
      this.stats.channel = row.ch;
    }
    if (row.mac !== this.stats.mac) {
      this.stats.ignoredMacs++;
      return;
    }
    if (row.re.length !== this.stats.subcarriers) {
      this.stats.malformed++;
      return;
    }
    if (!this.started) {
      useSession.getState().startPush(useSession.getState().config, esp32Descriptor(row.re.length, row.mac, row.ch, `ESP32 serial · ${row.mac}`));
      this.started = true;
    }
    if (Number.isFinite(row.ts) && row.ts <= this.lastTs) this.stats.nonMonotonic++;
    if (Number.isFinite(row.ts)) this.lastTs = row.ts;
    if (this.t0 === null && Number.isFinite(row.ts)) this.t0 = row.ts;
    const ts = Number.isFinite(row.ts) ? (row.ts - (this.t0 ?? 0)) / 1e6 : Number.NaN;
    const now = performance.now();
    this.arrivals.push(now);
    while (this.arrivals.length && now - this.arrivals[0] > 2000) this.arrivals.shift();
    this.stats.ratesHz = this.arrivals.length / 2;
    this.stats.csiRows++;
    this.stats.lastRowAtMs = Date.now();
    this.batch.push({ link: 0, seq: this.seq++, timestampS: ts, trueTimeS: Number.isFinite(ts) ? ts : this.seq / 100, antennas: 1, subcarriers: row.re.length, re: row.re, im: row.im });
  }

  private flush() {
    if (this.batch.length) {
      useSession.getState().pushPackets(this.batch);
      this.batch = [];
    }
    this.onUpdate();
  }

  async disconnect() {
    try {
      await this.reader?.cancel();
    } catch {
      /* already closed */
    }
    try {
      await this.port?.close();
    } catch {
      /* already closed */
    }
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.stats.connected = false;
    this.onUpdate();
  }
}
