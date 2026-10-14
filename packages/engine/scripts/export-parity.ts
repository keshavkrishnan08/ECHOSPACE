/**
 * Exports cross-language parity fixtures for the Python reference implementation
 * (services/inference/tests/test_parity.py) to tests/fixtures/parity/<name>.json.
 *
 *   npx tsx scripts/export-parity.ts
 *
 * Each fixture holds the full scenario config, the delivered-packet pattern of the first
 * DROP_WINDOW_S seconds, the first PACKETS_PER_LINK packets of every link, the calibration-derived
 * baseline RSS / SNR estimate per link, and per-frame features and RTI outputs for frames 1..FRAMES.
 * Float32 arrays are stored exactly as base64 of their little-endian bytes; NaN survives.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ScenarioConfig as ScenarioConfigSchema, type ScenarioConfig } from "@echospace/schemas";
import { EchoEngine } from "../src/runtime/engine";
import { SyntheticSource } from "../src/runtime/source";
import { scenarioByKey } from "../src/sim/scenarios";

const FRAMES = 15;
const PACKETS_PER_LINK = 20;
const DROP_WINDOW_S = 1.5;

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/parity");

const f32 = (a: ArrayLike<number>) => {
  const arr = a instanceof Float32Array ? a : Float32Array.from(a);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString("base64");
};
const finiteOrNull = (x: number) => (Number.isFinite(x) ? x : null);

function fixtureConfigs(): Array<{ name: string; description: string; config: ScenarioConfig }> {
  const b = scenarioByKey("B")!.build();
  b.recon.voxelSizeM = 0.5;

  const f = scenarioByKey("F")!.build();
  f.recon.voxelSizeM = 0.5;
  f.signal.snrDb = 15;
  f.impairments.packetLoss = 0.2;
  f.impairments.burstRateHz = 0.5;
  f.impairments.burstLengthPackets = 8;
  f.impairments.missingTimestampProb = 0.15;
  f.impairments.timestampJitterMs = 2;
  f.impairments.missingAntennas = [{ sensorId: "N2", antenna: 1 }];

  return [
    { name: "scenario-b", description: "Scenario B (default seed), voxelSizeM 0.5", config: ScenarioConfigSchema.parse(b) },
    {
      name: "scenario-f-impaired",
      description: "Scenario F (default seed), voxelSizeM 0.5, SNR 15 dB, 20 % loss, bursts, missing timestamps, N2 antenna 1 missing",
      config: ScenarioConfigSchema.parse(f),
    },
  ];
}

function exportFixture(name: string, description: string, config: ScenarioConfig) {
  // Packet stream, from an independent source with the same configuration.
  const src = new SyntheticSource(config);
  const L = src.descriptor.links.length;
  const lastSeq = Math.round(DROP_WINDOW_S * config.signal.packetRateHz);
  const delivered: number[][] = Array.from({ length: L }, () => []);
  const missingTimestamp: number[][] = Array.from({ length: L }, () => []);
  const first: Array<Array<{ seq: number; timestampS: number | null; re: string; im: string }>> = Array.from({ length: L }, () => []);
  for (const p of src.pull(lastSeq / config.signal.packetRateHz)) {
    if (p.seq > lastSeq) continue;
    delivered[p.link].push(p.seq);
    if (!Number.isFinite(p.timestampS)) missingTimestamp[p.link].push(p.seq);
    if (first[p.link].length < PACKETS_PER_LINK) first[p.link].push({ seq: p.seq, timestampS: finiteOrNull(p.timestampS), re: f32(p.re), im: f32(p.im) });
  }

  const eng = new EchoEngine(config);
  // Calibration results are not part of a frame; TypeScript permits element access to private members.
  const baselineRss = eng.pipeline["baselineRss"] as Float64Array;
  const snrEst = eng.pipeline["snrEst"] as Float64Array;
  const calibMotion = eng.pipeline["calibMotion"] as Float64Array;
  const frames = [];
  while (frames.length < FRAMES) {
    for (const fr of eng.advance(1 / config.dsp.frameRateHz, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)) {
      if (frames.length >= FRAMES) break;
      frames.push({
        seq: fr.seq,
        timestampS: fr.timestampS,
        state: fr.state,
        modelStatus: fr.capability.modelStatus,
        rssDb: f32(fr.features.rssDb),
        deltaRssDb: f32(fr.features.deltaRssDb),
        motionEnergy: f32(fr.features.motionEnergy),
        deliveryRatio: f32(fr.features.deliveryRatio),
        image: f32(fr.image),
        varianceRatio: f32(fr.varianceRatio),
        occupancy: f32(fr.occupancy),
      });
    }
  }

  const g = eng.pipeline.grid;
  const doc = {
    name,
    description,
    generator: "packages/engine/scripts/export-parity.ts",
    encoding: "float32 arrays are base64 of little-endian IEEE-754 bytes",
    config,
    links: src.descriptor.links.map((l) => l.id),
    grid: { nx: g.nx, ny: g.ny, nz: g.nz },
    dropWindow: { lastSeq, delivered, missingTimestamp },
    packets: first,
    calibration: {
      baselineRss: Array.from(baselineRss, finiteOrNull),
      snrEst: Array.from(snrEst, finiteOrNull),
      calibMotion: Array.from(calibMotion, finiteOrNull),
    },
    frames,
  };
  mkdirSync(outDir, { recursive: true });
  const json = JSON.stringify(doc);
  writeFileSync(resolve(outDir, `${name}.json`), `${json}\n`);
  console.log(`wrote ${name}.json (${(json.length / 1024).toFixed(0)} KiB, ${L} links, ${frames.length} frames)`);
}

for (const { name, description, config } of fixtureConfigs()) exportFixture(name, description, config);
