import type { Material, Obstacle, ScenarioConfig, ScenarioConfigInput, ScenarioKey, SensorNode, SubjectSpec } from "@echospace/schemas";
import { ScenarioConfig as ScenarioConfigSchema } from "@echospace/schemas";

/**
 * Scenario library. Each scenario is a deterministic configuration plus a short scientific
 * objective and the parameters the Simulation Arena exposes. All presets are synthetic.
 */

export interface ScenarioControl {
  id: string;
  label: string;
  unit?: string;
  kind: "slider" | "toggle" | "select";
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  help?: string;
  get: (c: ScenarioConfig) => number | boolean | string;
  set: (c: ScenarioConfig, v: number | boolean | string) => ScenarioConfig;
}

export interface ScenarioDefinition {
  key: ScenarioKey;
  title: string;
  objective: string;
  lesson: string;
  difficulty: "baseline" | "moderate" | "hard" | "failure";
  build: (seed?: number) => ScenarioConfig;
  controls: ScenarioControl[];
  variants?: Array<{ id: string; label: string; description: string; apply: (c: ScenarioConfig) => ScenarioConfig }>;
}

const clone = <T,>(x: T): T => structuredClone(x);
const upd = (c: ScenarioConfig, f: (d: ScenarioConfig) => void) => {
  const d = clone(c);
  f(d);
  return d;
};

export function perimeterSensors(count: number, width: number, depth: number, heights: number[] = [1.0, 1.6]): SensorNode[] {
  // Evenly spaced along the perimeter, inset 0.15 m from the walls, facing the room centre.
  const inset = 0.15;
  const perim = 2 * (width + depth);
  const out: SensorNode[] = [];
  for (let i = 0; i < count; i++) {
    let d = ((i + 0.5) / count) * perim;
    let x: number;
    let y: number;
    if (d < width) {
      x = d;
      y = inset;
    } else if ((d -= width) < depth) {
      x = width - inset;
      y = d;
    } else if ((d -= depth) < width) {
      x = width - d;
      y = depth - inset;
    } else {
      d -= width;
      x = inset;
      y = depth - d;
    }
    x = Math.min(width - inset, Math.max(inset, x));
    y = Math.min(depth - inset, Math.max(inset, y));
    const yaw = (Math.atan2(depth / 2 - y, width / 2 - x) * 180) / Math.PI;
    out.push({
      id: `N${i + 1}`,
      label: `Node ${i + 1}`,
      role: "trx",
      position: [round(x), round(y), heights[i % heights.length]],
      yawDeg: Math.round(yaw),
      antennas: 3,
      enabled: true,
    });
  }
  return out;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

export const DEFAULT_FURNITURE: Obstacle[] = [
  { id: "table", kind: "table", min: [2.4, 2.0, 0.7], max: [3.6, 2.8, 0.76], material: "wood", attenuationDb: null },
  { id: "sofa", kind: "sofa", min: [0.6, 3.9, 0.0], max: [2.6, 4.7, 0.85], material: "fabric", attenuationDb: null },
  { id: "cabinet", kind: "cabinet", min: [5.3, 3.6, 0.0], max: [5.8, 4.6, 1.9], material: "metal", attenuationDb: null },
];

export function baseConfig(overrides: Partial<ScenarioConfigInput> & { scenario: ScenarioKey; name: string }): ScenarioConfig {
  const width = 6;
  const depth = 5;
  const input: ScenarioConfigInput = {
    seed: 7,
    durationS: 60,
    room: { width, depth, height: 2.8, wallMaterial: "drywall", wallThickness: 0.12, wallReflectivity: null },
    obstacles: DEFAULT_FURNITURE,
    openings: [
      { id: "door", kind: "door", wall: "south", offset: 1.0, width: 0.9, height: 2.05, sill: 0 },
      { id: "window", kind: "window", wall: "north", offset: 3.8, width: 1.6, height: 1.2, sill: 0.9 },
    ],
    sensors: perimeterSensors(8, width, depth),
    subjects: [],
    signal: {},
    impairments: {},
    dsp: {},
    recon: {},
    tracking: {},
    privacy: {},
    pipeline: {},
    ...overrides,
  };
  return ScenarioConfigSchema.parse(input);
}

const walker = (id: string, label: string, actions: SubjectSpec["actions"], start: [number, number], extra: Partial<SubjectSpec> = {}): SubjectSpec => ({
  id,
  label,
  heightM: 1.75,
  radiusM: 0.22,
  rcsM2: 1,
  start,
  startHeadingDeg: 0,
  startDelayS: 0,
  actions,
  loop: true,
  ...extra,
});

// ---------- shared controls ----------
const snrControl: ScenarioControl = {
  id: "snr", label: "Signal-to-noise ratio", unit: "dB", kind: "slider", min: -5, max: 45, step: 1,
  help: "Ratio of mean static channel power to complex noise power per CSI sample.",
  get: (c) => c.signal.snrDb, set: (c, v) => upd(c, (d) => void (d.signal.snrDb = Number(v))),
};
const voxelControl: ScenarioControl = {
  id: "voxel", label: "Voxel resolution", unit: "m", kind: "slider", min: 0.15, max: 0.5, step: 0.05,
  get: (c) => c.recon.voxelSizeM, set: (c, v) => upd(c, (d) => void (d.recon.voxelSizeM = Number(v))),
};
const sensorCountControl: ScenarioControl = {
  id: "sensors", label: "Sensing endpoints", unit: "nodes", kind: "slider", min: 2, max: 12, step: 1,
  help: "Transceivers evenly spaced around the perimeter. Links = n(n−1)/2.",
  get: (c) => c.sensors.length,
  set: (c, v) => upd(c, (d) => void (d.sensors = perimeterSensors(Number(v), d.room.width, d.room.depth))),
};
const roomWidthControl: ScenarioControl = {
  id: "roomWidth", label: "Room width", unit: "m", kind: "slider", min: 3, max: 12, step: 0.5,
  get: (c) => c.room.width,
  set: (c, v) => upd(c, (d) => {
    d.room.width = Number(v);
    d.sensors = perimeterSensors(d.sensors.length, d.room.width, d.room.depth);
    d.obstacles = d.obstacles.filter((o) => o.max[0] <= d.room.width);
    d.subjects = d.subjects.map((s) => clampSubject(s, d.room.width, d.room.depth));
  }),
};
const roomDepthControl: ScenarioControl = {
  id: "roomDepth", label: "Room depth", unit: "m", kind: "slider", min: 3, max: 12, step: 0.5,
  get: (c) => c.room.depth,
  set: (c, v) => upd(c, (d) => {
    d.room.depth = Number(v);
    d.sensors = perimeterSensors(d.sensors.length, d.room.width, d.room.depth);
    d.obstacles = d.obstacles.filter((o) => o.max[1] <= d.room.depth);
    d.subjects = d.subjects.map((s) => clampSubject(s, d.room.width, d.room.depth));
  }),
};
const durationControl: ScenarioControl = {
  id: "duration", label: "Observation duration", unit: "s", kind: "slider", min: 10, max: 300, step: 5,
  get: (c) => c.durationS, set: (c, v) => upd(c, (d) => void (d.durationS = Number(v))),
};
const smoothingControl: ScenarioControl = {
  id: "smoothing", label: "Temporal smoothing (occupancy EMA)", kind: "slider", min: 0, max: 0.95, step: 0.05,
  get: (c) => c.recon.temporalSmoothing, set: (c, v) => upd(c, (d) => void (d.recon.temporalSmoothing = Number(v))),
};

function clampSubject(s: SubjectSpec, w: number, h: number): SubjectSpec {
  const cx = (x: number) => Math.min(w - 0.4, Math.max(0.4, x));
  const cy = (y: number) => Math.min(h - 0.4, Math.max(0.4, y));
  return {
    ...s,
    start: [cx(s.start[0]), cy(s.start[1])],
    actions: s.actions.map((a) => (a.type === "walk" ? { ...a, to: [cx(a.to[0]), cy(a.to[1])] as [number, number] } : a)),
  };
}

const materialOptions: Array<{ value: Material; label: string }> = [
  { value: "fabric", label: "Fabric (1 dB)" },
  { value: "glass", label: "Glass (2 dB)" },
  { value: "wood", label: "Wood (3 dB)" },
  { value: "drywall", label: "Drywall (4 dB)" },
  { value: "brick", label: "Brick (8 dB)" },
  { value: "concrete", label: "Concrete (15 dB)" },
  { value: "metal", label: "Metal (30 dB)" },
];

const PARTITION: Obstacle = { id: "partition", kind: "partition", min: [2.9, 0.6, 0], max: [3.1, 4.4, 2.4], material: "brick", attenuationDb: null };

const B_ACTIONS: SubjectSpec["actions"] = [
  { type: "walk", to: [4.8, 1.2], speed: 1.0 },
  { type: "stop", durationS: 2 },
  { type: "turn", headingDeg: 90, durationS: 1 },
  { type: "walk", to: [4.6, 3.2], speed: 0.9 },
  { type: "sit", durationS: 6 },
  { type: "walk", to: [4.8, 1.2], speed: 0.9 },
  { type: "turn", headingDeg: 180, durationS: 1 },
];

export const SCENARIOS: ScenarioDefinition[] = [
  {
    key: "A",
    title: "Empty room baseline",
    objective: "Characterise the pipeline's output when nothing moves: noise floor, residual image energy and coverage.",
    lesson: "A static scene still produces fluctuating measurements. The reconstruction should report low occupancy with explicit uncertainty, and unobserved regions must stay marked as unobserved rather than empty.",
    difficulty: "baseline",
    build: (seed = 11) => baseConfig({ scenario: "A", name: "Empty room baseline", seed, sensors: perimeterSensors(4, 6, 5) }),
    controls: [roomWidthControl, roomDepthControl, sensorCountControl, snrControl, durationControl, voxelControl],
  },
  {
    key: "B",
    title: "Human motion across a room",
    objective: "Observe how one synthetic subject walking, stopping, turning and sitting changes the CSI and the reconstruction.",
    lesson: "Motion produces large, structured changes in the measurements; a seated, motionless subject is much harder to see with shadowing-based imaging once the body is low and away from link lines.",
    difficulty: "moderate",
    build: (seed = 7) => baseConfig({ scenario: "B", name: "Human motion across a room", seed, subjects: [walker("s1", "S1", B_ACTIONS, [1.2, 1.2])] }),
    controls: [
      snrControl,
      sensorCountControl,
      { id: "speed", label: "Walking speed", unit: "m/s", kind: "slider", min: 0.3, max: 2, step: 0.1,
        get: (c) => (c.subjects[0]?.actions.find((a) => a.type === "walk") as { speed: number } | undefined)?.speed ?? 1,
        set: (c, v) => upd(c, (d) => d.subjects.forEach((s) => s.actions.forEach((a) => { if (a.type === "walk") a.speed = Number(v); }))) },
      smoothingControl,
      voxelControl,
    ],
  },
  {
    key: "C",
    title: "Occlusion and wall attenuation",
    objective: "Measure how an interior partition and its material change observability of a subject behind it.",
    lesson: "Attenuating obstacles remove information. Links crossing a dense partition carry little body-shadowing contrast, so the reconstruction behind it becomes uncertain, and may fail.",
    difficulty: "hard",
    build: (seed = 21) => baseConfig({
      scenario: "C", name: "Occlusion and wall attenuation", seed,
      obstacles: [...DEFAULT_FURNITURE.filter((o) => o.id !== "table"), PARTITION],
      sensors: perimeterSensors(8, 6, 5).map((s) => s),
      subjects: [walker("s1", "S1", [{ type: "walk", to: [4.6, 3.6], speed: 0.8 }, { type: "stop", durationS: 2 }, { type: "walk", to: [4.6, 1.2], speed: 0.8 }], [4.0, 1.2])],
    }),
    controls: [
      { id: "partition", label: "Interior partition", kind: "toggle", get: (c) => c.obstacles.some((o) => o.id === "partition"),
        set: (c, v) => upd(c, (d) => { d.obstacles = d.obstacles.filter((o) => o.id !== "partition"); if (v) d.obstacles.push(clone(PARTITION)); }) },
      { id: "material", label: "Partition material", kind: "select", options: materialOptions,
        get: (c) => c.obstacles.find((o) => o.id === "partition")?.material ?? "brick",
        set: (c, v) => upd(c, (d) => d.obstacles.forEach((o) => { if (o.id === "partition") { o.material = v as Material; o.attenuationDb = null; } })) },
      { id: "atten", label: "Attenuation override (simplified)", unit: "dB", kind: "slider", min: 0, max: 40, step: 1,
        help: "Single-number penetration loss applied to every path crossing the partition. 0 restores the material default.",
        get: (c) => c.obstacles.find((o) => o.id === "partition")?.attenuationDb ?? 0,
        set: (c, v) => upd(c, (d) => d.obstacles.forEach((o) => { if (o.id === "partition") o.attenuationDb = Number(v) > 0 ? Number(v) : null; })) },
      { id: "n1x", label: "Node 1 position x", unit: "m", kind: "slider", min: 0.15, max: 5.85, step: 0.05,
        get: (c) => c.sensors[0].position[0], set: (c, v) => upd(c, (d) => void (d.sensors[0].position[0] = Number(v))) },
      snrControl,
    ],
  },
  {
    key: "D",
    title: "Multipath and reflections",
    objective: "Separate direct paths from reflections and observe how strong reflectors create ghost structure in a coherent back-projection image.",
    lesson: "Reflections add delayed copies of the subject's signature. A delay-and-sum back-projection that assumes single-bounce geometry places that energy at wrong locations (ghosts).",
    difficulty: "hard",
    build: (seed = 31) => baseConfig({
      scenario: "D", name: "Multipath and reflections", seed,
      room: { width: 6, depth: 5, height: 2.8, wallMaterial: "concrete", wallThickness: 0.2, wallReflectivity: 0.6 },
      recon: { modelId: "bp-dsb" },
      signal: { bandwidthHz: 80e6, subcarriers: 56 },
      subjects: [walker("s1", "S1", [{ type: "walk", to: [4.5, 3.5], speed: 0.8 }, { type: "walk", to: [1.5, 3.5], speed: 0.8 }], [1.5, 1.5])],
    }),
    controls: [
      { id: "refl", label: "Wall reflectivity |Γ|", kind: "slider", min: 0, max: 0.95, step: 0.05,
        get: (c) => c.room.wallReflectivity ?? 0.3, set: (c, v) => upd(c, (d) => void (d.room.wallReflectivity = Number(v))) },
      { id: "surfaces", label: "Modelled reflecting surfaces", kind: "slider", min: 0, max: 6, step: 1,
        get: (c) => c.signal.reflectingSurfaces, set: (c, v) => upd(c, (d) => void (d.signal.reflectingSurfaces = Number(v))) },
      snrControl,
      { id: "antennas", label: "Receive antennas per node", kind: "slider", min: 1, max: 4, step: 1,
        get: (c) => c.sensors[0].antennas, set: (c, v) => upd(c, (d) => d.sensors.forEach((s) => void (s.antennas = Number(v)))) },
      { id: "model", label: "Reconstruction model", kind: "select",
        options: [{ value: "bp-dsb", label: "Back-projection (coherent)" }, { value: "rti-bayes", label: "RTI (attenuation)" }],
        get: (c) => c.recon.modelId, set: (c, v) => upd(c, (d) => void (d.recon.modelId = v as ScenarioConfig["recon"]["modelId"])) },
      { id: "spatial", label: "Spatial filtering", kind: "toggle", get: (c) => c.recon.spatialFilter, set: (c, v) => upd(c, (d) => void (d.recon.spatialFilter = Boolean(v))) },
    ],
  },
  {
    key: "E",
    title: "Multiple moving subjects",
    objective: "Stress data association with crossing trajectories and count fragmentations and identity switches honestly.",
    lesson: "When two subjects come within the image resolution, their blobs merge. The tracker is not forced to keep identities, so switches and fragmentation appear and are counted.",
    difficulty: "hard",
    build: (seed = 41) => baseConfig({
      scenario: "E", name: "Multiple moving subjects", seed,
      subjects: [
        walker("s1", "S1", [{ type: "walk", to: [5.0, 4.0], speed: 0.9 }, { type: "stop", durationS: 1 }], [1.0, 1.0]),
        walker("s2", "S2", [{ type: "walk", to: [1.0, 4.0], speed: 0.8 }, { type: "stop", durationS: 1.5 }], [5.0, 1.0], { heightM: 1.62, startDelayS: 1 }),
        walker("s3", "S3", [{ type: "walk", to: [3.0, 4.2], speed: 0.6 }], [3.0, 0.8], { heightM: 1.85, startDelayS: 4 }),
      ],
    }),
    controls: [
      { id: "subjects", label: "Subjects", kind: "slider", min: 1, max: 3, step: 1,
        get: (c) => c.subjects.length,
        set: (c, v) => upd(c, (d) => void (d.subjects = SCENARIOS.find((s) => s.key === "E")!.build(d.seed).subjects.slice(0, Number(v)))) },
      { id: "gate", label: "Association gate", unit: "m", kind: "slider", min: 0.3, max: 3, step: 0.1,
        get: (c) => c.tracking.gateM, set: (c, v) => upd(c, (d) => void (d.tracking.gateM = Number(v))) },
      { id: "birth", label: "Hits to confirm", kind: "slider", min: 1, max: 10, step: 1,
        get: (c) => c.tracking.birthHits, set: (c, v) => upd(c, (d) => void (d.tracking.birthHits = Number(v))) },
      sensorCountControl,
      snrControl,
    ],
  },
  {
    key: "F",
    title: "Low signal quality",
    objective: "Degrade the observations progressively and watch input quality, reconstruction error and confidence respond.",
    lesson: "Robustness has limits. Packet loss and noise raise error and lower confidence; the system should say so instead of holding a stale or smoothed-over answer.",
    difficulty: "moderate",
    build: (seed = 51) => baseConfig({ scenario: "F", name: "Low signal quality", seed, subjects: [walker("s1", "S1", B_ACTIONS, [1.2, 1.2])] }),
    controls: [
      snrControl,
      { id: "loss", label: "Packet loss", unit: "ratio", kind: "slider", min: 0, max: 0.9, step: 0.01,
        get: (c) => c.impairments.packetLoss, set: (c, v) => upd(c, (d) => void (d.impairments.packetLoss = Number(v))) },
      { id: "burst", label: "Burst dropouts", unit: "per s", kind: "slider", min: 0, max: 2, step: 0.05,
        get: (c) => c.impairments.burstRateHz, set: (c, v) => upd(c, (d) => void (d.impairments.burstRateHz = Number(v))) },
      { id: "missts", label: "Missing timestamps", unit: "ratio", kind: "slider", min: 0, max: 1, step: 0.05,
        get: (c) => c.impairments.missingTimestampProb, set: (c, v) => upd(c, (d) => void (d.impairments.missingTimestampProb = Number(v))) },
      { id: "jitter", label: "Timestamp jitter", unit: "ms", kind: "slider", min: 0, max: 20, step: 0.5,
        get: (c) => c.impairments.timestampJitterMs, set: (c, v) => upd(c, (d) => void (d.impairments.timestampJitterMs = Number(v))) },
      { id: "phase", label: "Phase instability", unit: "rad", kind: "slider", min: 0, max: 3, step: 0.05,
        get: (c) => c.impairments.phaseInstabilityRad, set: (c, v) => upd(c, (d) => void (d.impairments.phaseInstabilityRad = Number(v))) },
      { id: "rate", label: "Observation rate", unit: "Hz", kind: "slider", min: 10, max: 200, step: 10,
        get: (c) => c.signal.packetRateHz, set: (c, v) => upd(c, (d) => void (d.signal.packetRateHz = Number(v))) },
    ],
  },
  {
    key: "G",
    title: "Sensor geometry comparison",
    objective: "Compare how the number and placement of endpoints change coverage, link conditioning and reconstruction error.",
    lesson: "Spatial information comes from link geometry. Few or collinear endpoints leave large unobserved regions; no node count guarantees 3D reconstruction.",
    difficulty: "moderate",
    build: (seed = 61) => baseConfig({ scenario: "G", name: "Sensor geometry comparison", seed, sensors: perimeterSensors(4, 6, 5), subjects: [walker("s1", "S1", B_ACTIONS, [1.2, 1.2])] }),
    controls: [
      sensorCountControl,
      { id: "heights", label: "Node height pattern", kind: "select",
        options: [{ value: "flat", label: "All at 1.2 m" }, { value: "alt", label: "Alternating 1.0 / 1.6 m" }, { value: "tri", label: "0.6 / 1.3 / 2.0 m" }],
        get: (c) => { const hs = new Set(c.sensors.map((s) => s.position[2])); return hs.size === 1 ? "flat" : hs.size === 2 ? "alt" : "tri"; },
        set: (c, v) => upd(c, (d) => void (d.sensors = perimeterSensors(d.sensors.length, d.room.width, d.room.depth, v === "flat" ? [1.2] : v === "alt" ? [1.0, 1.6] : [0.6, 1.3, 2.0]))) },
      { id: "collinear", label: "Collinear layout (one wall)", kind: "toggle",
        get: (c) => c.sensors.every((s) => Math.abs(s.position[1] - c.sensors[0].position[1]) < 1e-6),
        set: (c, v) => upd(c, (d) => {
          const n = d.sensors.length;
          d.sensors = v
            ? d.sensors.map((s, i) => ({ ...s, position: [round(0.3 + ((d.room.width - 0.6) * i) / Math.max(1, n - 1)), 0.15, s.position[2]], yawDeg: 90 }))
            : perimeterSensors(n, d.room.width, d.room.depth);
        }) },
      voxelControl,
    ],
  },
  {
    key: "H",
    title: "Temporal filtering comparison",
    objective: "Trade smoothness against responsiveness: compare no filter, exponential smoothing and a constant-velocity Kalman filter.",
    lesson: "Smoothing lowers jitter but adds lag at turns and stops. The best setting depends on the motion; there is no free lunch.",
    difficulty: "moderate",
    build: (seed = 71) => baseConfig({ scenario: "H", name: "Temporal filtering comparison", seed, subjects: [walker("s1", "S1", B_ACTIONS, [1.2, 1.2], { actions: [...B_ACTIONS].map((a) => (a.type === "walk" ? { ...a, speed: 1.3 } : a)) })] }),
    controls: [
      { id: "filter", label: "Temporal filter", kind: "select",
        options: [{ value: "none", label: "None" }, { value: "ema", label: "Exponential smoothing" }, { value: "kalman", label: "Kalman (constant velocity)" }, { value: "learned", label: "Learned temporal model (not implemented)" }],
        get: (c) => c.tracking.filter, set: (c, v) => upd(c, (d) => void (d.tracking.filter = v as ScenarioConfig["tracking"]["filter"])) },
      { id: "alpha", label: "EMA α", kind: "slider", min: 0.05, max: 1, step: 0.05,
        get: (c) => c.tracking.emaAlpha, set: (c, v) => upd(c, (d) => void (d.tracking.emaAlpha = Number(v))) },
      { id: "q", label: "Kalman process noise q", unit: "m²/s³", kind: "slider", min: 0.05, max: 20, step: 0.05,
        get: (c) => c.tracking.processNoise, set: (c, v) => upd(c, (d) => void (d.tracking.processNoise = Number(v))) },
      { id: "r", label: "Measurement std", unit: "m", kind: "slider", min: 0.05, max: 1.5, step: 0.05,
        get: (c) => c.tracking.measurementStdM, set: (c, v) => upd(c, (d) => void (d.tracking.measurementStdM = Number(v))) },
      smoothingControl,
    ],
  },
  {
    key: "I",
    title: "Model failure laboratory",
    objective: "Push the system into states it cannot support and verify that it reports the failure instead of inventing output.",
    lesson: "Every model has a domain. Outside it, the right output is an explicit, explained failure state.",
    difficulty: "failure",
    build: (seed = 81) => baseConfig({ scenario: "I", name: "Model failure laboratory", seed, subjects: [walker("s1", "S1", B_ACTIONS, [1.2, 1.2])] }),
    controls: [snrControl, sensorCountControl],
    variants: [
      { id: "insufficient", label: "Insufficient observations", description: "Only two endpoints: one link cannot localise anything in 3D.",
        apply: (c) => upd(c, (d) => void (d.sensors = perimeterSensors(2, d.room.width, d.room.depth))) },
      { id: "geometry", label: "Unexpected scene geometry", description: "The learned ridge model was trained on a 6×5 m room with 8 nodes; this room is 9×4 m.",
        apply: (c) => upd(c, (d) => { d.room.width = 9; d.room.depth = 4; d.sensors = perimeterSensors(8, 9, 4); d.obstacles = []; d.recon.modelId = "ridge-floor"; d.subjects = d.subjects.map((s) => clampSubject(s, 9, 4)); }) },
      { id: "channels", label: "Missing sensor channels", description: "Two receivers lose antennas (NaN samples).",
        apply: (c) => upd(c, (d) => void (d.impairments.missingAntennas = [{ sensorId: "N2", antenna: 0 }, { sensorId: "N2", antenna: 1 }, { sensorId: "N2", antenna: 2 }, { sensorId: "N5", antenna: 1 }])) },
      { id: "shift", label: "Distribution shift", description: "Learned model with metal walls and 5 dB SNR, far from its training distribution.",
        apply: (c) => upd(c, (d) => { d.recon.modelId = "ridge-floor"; d.room.wallMaterial = "metal"; d.room.wallReflectivity = 0.9; d.signal.snrDb = 5; }) },
      { id: "lowconf", label: "Low confidence", description: "Heavy noise and loss: confidence collapses and outputs are suppressed.",
        apply: (c) => upd(c, (d) => { d.signal.snrDb = -3; d.impairments.packetLoss = 0.6; }) },
      { id: "transformer", label: "Unimplemented model", description: "Select the transformer encoder slot, which has no trained weights.",
        apply: (c) => upd(c, (d) => void (d.recon.modelId = "transformer-encoder")) },
    ],
  },
  {
    key: "J",
    title: "Privacy-preserving occupancy",
    objective: "Answer 'where is the room occupied?' with coarse occupancy and aggregate motion, without skeletons or track history.",
    lesson: "Many applications only need coarse occupancy. Coarse mode discards detail at the source of the presentation layer and shortens retention.",
    difficulty: "baseline",
    build: (seed = 91) => baseConfig({
      scenario: "J", name: "Privacy-preserving occupancy", seed,
      privacy: { mode: "coarse", showSkeleton: false, trackHistorySeconds: 0 },
      recon: { voxelSizeM: 0.5 },
      subjects: SCENARIOS_E_SUBJECTS(),
    }),
    controls: [
      { id: "coarse", label: "Coarse privacy mode", kind: "toggle",
        get: (c) => c.privacy.mode === "coarse",
        set: (c, v) => upd(c, (d) => { d.privacy.mode = v ? "coarse" : "standard"; d.privacy.showSkeleton = !v; d.privacy.trackHistorySeconds = v ? 0 : 10; d.recon.voxelSizeM = v ? 0.5 : 0.25; }) },
      { id: "history", label: "Track history retention", unit: "s", kind: "slider", min: 0, max: 30, step: 1,
        get: (c) => c.privacy.trackHistorySeconds, set: (c, v) => upd(c, (d) => void (d.privacy.trackHistorySeconds = Number(v))) },
      voxelControl,
    ],
  },
];

function SCENARIOS_E_SUBJECTS(): SubjectSpec[] {
  return [
    walker("s1", "S1", [{ type: "walk", to: [5.0, 4.0], speed: 0.9 }, { type: "stop", durationS: 1 }], [1.0, 1.0]),
    walker("s2", "S2", [{ type: "walk", to: [1.0, 4.0], speed: 0.8 }, { type: "sit", durationS: 5 }], [5.0, 1.0], { heightM: 1.62, startDelayS: 1 }),
  ];
}

export function scenarioByKey(key: ScenarioKey): ScenarioDefinition | undefined {
  return SCENARIOS.find((s) => s.key === key);
}

/** The guided "From signal to space" demo uses scenario B. */
export function demoScenario(): ScenarioConfig {
  return scenarioByKey("B")!.build();
}
