import { describe, expect, it } from "vitest";
import { EchoEngine } from "../src/runtime/engine";
import { RecordedSource, SyntheticSource } from "../src/runtime/source";
import { scenarioByKey } from "../src/sim/scenarios";
import { parseEsp32Csv, parseRecording } from "../src/io/esp32";
import { parseNative, toNative, RecordingFormatError } from "../src/io/native";

describe("echospace-csi-v1", () => {
  it("round-trips synthetic packets and preserves geometry so imaging still works", () => {
    const cfg = scenarioByKey("B")!.build();
    const src = new SyntheticSource(cfg);
    const packets = src.pull(3);
    const text = toNative(cfg, src.descriptor, packets);
    const rec = parseNative(text, "sample");
    expect(rec.packets.length).toBe(packets.length);
    expect(rec.descriptor.geometryKnown).toBe(true);
    expect(rec.descriptor.mode).toBe("recorded");
    expect(rec.descriptor.hasGroundTruth).toBe(false);
    const eng = new EchoEngine(cfg, {}, new RecordedSource({ ...rec.descriptor, antennaPositions: src.descriptor.antennaPositions }, rec.packets, null));
    const frames: ReturnType<EchoEngine["advance"]> = [];
    eng.runOffline((f) => frames.push(f), 3);
    const last = frames.at(-1)!;
    expect(last.groundTruth).toBeNull();
    expect(last.metrics.positionErrorM).toBeNull();
    expect(last.provenance.sourceMode).toBe("recorded");
  });
  it("rejects unsupported formats explicitly", () => {
    expect(() => parseRecording("hello,world\n1,2", "x")).toThrow(RecordingFormatError);
    expect(() => parseNative('{"format":"other"}\n', "x")).toThrow(/unsupported format/);
  });
});

describe("ESP32-CSI-Tool CSV", () => {
  const header = "type,role,mac,rssi,rate,sig_mode,mcs,bandwidth,smoothing,not_sounding,aggregation,stbc,fec_coding,sgi,noise_floor,ampdu_cnt,channel,secondary_channel,local_timestamp,ant,sig_len,rx_state,real_time_set,real_timestamp,len,CSI_DATA";
  const row = (ts: number, mac = "AA:BB:CC:DD:EE:01") => `CSI_DATA,STA,${mac},-42,11,1,7,0,1,1,1,0,0,0,-93,0,6,0,${ts},0,98,0,0,0.0,8,[3 4 -1 2 0 5 7 -2]`;
  it("parses rows into (re, im) with imaginary first and reports real metadata", () => {
    const r = parseEsp32Csv([header, row(1000000), row(1010000), row(1020000, "AA:BB:CC:DD:EE:02")].join("\n"), "log");
    expect(r.packets.length).toBe(3);
    expect(r.descriptor.subcarriers).toBe(4);
    expect(Array.from(r.packets[0].re)).toEqual([4, 2, 5, -2]);
    expect(Array.from(r.packets[0].im)).toEqual([3, -1, 0, 7]);
    expect(r.descriptor.links.length).toBe(2);
    expect(r.descriptor.geometryKnown).toBe(false);
    expect(r.descriptor.centerFreqHz).toBe(2437e6);
    expect(r.packets[1].timestampS).toBeCloseTo(0.01, 9);
  });
  it("refuses imaging without geometry instead of substituting synthetic data", () => {
    const lines = [header];
    for (let i = 0; i < 400; i++) lines.push(row(1_000_000 + i * 10_000));
    const r = parseEsp32Csv(lines.join("\n"), "log");
    const cfg = scenarioByKey("A")!.build();
    const eng = new EchoEngine(cfg, {}, new RecordedSource(r.descriptor, r.packets, null));
    const frames: ReturnType<EchoEngine["advance"]> = [];
    eng.runOffline((f) => frames.push(f), 3.9);
    const last = frames.at(-1)!;
    expect(last.capability.modelStatus).toBe("unsupported");
    expect(last.provenance.sourceMode).toBe("recorded");
    expect(last.csi?.subcarriers).toBe(4);
    expect(last.groundTruth).toBeNull();
  });
});
