import type { ReconstructionFrame, ScenarioConfig } from "@echospace/schemas";
import type { CsiPacket, RidgeWeights, SourceDescriptor } from "@echospace/engine";

export interface EngineInfo {
  links: Array<{ index: number; id: string; txId: string; rxId: string; lengthM: number; antennas: number }>;
  grid: { nx: number; ny: number; nz: number; voxelSizeM: number };
  coverage: Float32Array | null;
  descriptor: Omit<SourceDescriptor, "subcarrierOffsetsHz" | "links" | "antennaPositions"> & { subcarrierOffsetsHz: number[] };
  calibrated: boolean;
  initMs: number;
  configHash: string;
}

export type ToWorker =
  | { type: "init"; config: ScenarioConfig; ridge: RidgeWeights | null; selectedLink: number; maxInFlight: number; schedule?: Array<{ frameSeq: number; config: ScenarioConfig }> }
  | { type: "init-recorded"; config: ScenarioConfig; descriptor: SourceDescriptor; packets: CsiPacket[]; calibration: CsiPacket[] | null; maxInFlight: number }
  | { type: "init-push"; config: ScenarioConfig; descriptor: SourceDescriptor; maxInFlight: number }
  | { type: "push-packets"; packets: CsiPacket[] }
  | { type: "play" }
  | { type: "pause" }
  | { type: "speed"; speed: number }
  | { type: "step"; frames: number }
  | { type: "restart" }
  | { type: "reconfigure"; config: ScenarioConfig }
  | { type: "select-link"; index: number }
  | { type: "recalibrate" }
  | { type: "ack" }
  | { type: "dispose" };

export type FromWorker =
  | { type: "ready"; info: EngineInfo }
  | { type: "reconfigured"; frameSeq: number; t: number }
  | { type: "frames"; frames: ReconstructionFrame[]; simTime: number; displayDrops: number }
  | { type: "status"; playing: boolean; simTime: number; finished: boolean; message?: string }
  | { type: "error"; message: string; fatal: boolean };
