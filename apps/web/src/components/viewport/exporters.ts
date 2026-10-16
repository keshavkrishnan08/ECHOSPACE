import type { ReconstructionFrame, ScenarioConfig } from "@echospace/schemas";
import { SOFTWARE_VERSION } from "@echospace/schemas";

/** ASCII PLY of the filtered point cloud. Provenance is written as header comments. */
export function exportPly(frame: ReconstructionFrame, config: ScenarioConfig): string {
  const p = frame.pointsFiltered;
  const n = p.length / 5;
  const pv = frame.provenance;
  const lines = [
    "ply",
    "format ascii 1.0",
    `comment generator ECHO ${SOFTWARE_VERSION}`,
    `comment source_mode ${pv.sourceMode}${pv.sourceMode === "synthetic" ? " (SIMULATED, not a measurement)" : ""}`,
    `comment source_id ${pv.sourceId}`,
    `comment scenario ${pv.scenario ?? "none"} seed ${pv.seed ?? "none"}`,
    `comment model ${pv.modelId}@${pv.modelVersion} preprocessing ${pv.preprocessingVersion} engine ${pv.engine}`,
    `comment config_hash ${pv.configHash}`,
    `comment frame_seq ${frame.seq} timestamp_s ${frame.timestampS.toFixed(4)}`,
    `comment units metres; confidence = 1 - posterior variance ratio; occupancy = model detection confidence`,
    `comment room ${config.room.width}x${config.room.depth}x${config.room.height}`,
    `element vertex ${n}`,
    "property float x",
    "property float y",
    "property float z",
    "property float confidence",
    "property float occupancy",
    "end_header",
  ];
  for (let i = 0; i < n; i++) lines.push(`${p[i * 5].toFixed(4)} ${p[i * 5 + 1].toFixed(4)} ${p[i * 5 + 2].toFixed(4)} ${p[i * 5 + 3].toFixed(4)} ${p[i * 5 + 4].toFixed(4)}`);
  return lines.join("\n") + "\n";
}

export function exportSceneJson(config: ScenarioConfig, frame: ReconstructionFrame | null): string {
  return JSON.stringify(
    {
      kind: "echospace.scene",
      version: 1,
      exportedAt: new Date().toISOString(),
      software: SOFTWARE_VERSION,
      config,
      frame: frame
        ? {
            seq: frame.seq,
            timestampS: frame.timestampS,
            provenance: frame.provenance,
            tracks: frame.tracks,
            detections: frame.detections,
            groundTruth: frame.groundTruth?.map((g) => ({ id: g.id, label: g.label, position: g.position, posture: g.posture, note: "synthetic ground truth" })) ?? null,
            metrics: frame.metrics,
            capability: frame.capability,
          }
        : null,
    },
    null,
    2,
  );
}
