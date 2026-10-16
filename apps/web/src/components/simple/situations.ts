import type { Obstacle, ScenarioConfig } from "@echospace/schemas";
import { baseConfig, perimeterSensors, scenarioByKey } from "@echospace/engine";

/** The situations shown in the simple view, in plain language. All are synthetic simulations. */
export interface Situation {
  id: string;
  label: string;
  summary: string;
  build: () => ScenarioConfig;
  /** Floor heights (m) for multi-storey scenes, lowest first. */
  floors?: number[];
}

const variant = (key: "I", id: string) => {
  const def = scenarioByKey(key)!;
  return def.variants!.find((v) => v.id === id)!.apply(def.build());
};

// Two storeys of 2.8 m. A straight flight of stairs along the south wall rises from x 0.7 to 3.3
// through an opening in the concrete slab; the upper floor has its own ring of sensors.
const SLAB_Z = 2.85;
function twoStoreys(): ScenarioConfig {
  const W = 6;
  const D = 5;
  const slab = (id: string, min: [number, number], max: [number, number]): Obstacle => ({ id, kind: "partition", min: [min[0], min[1], SLAB_Z - 0.12], max: [max[0], max[1], SLAB_Z], material: "concrete", attenuationDb: null });
  const STEPS = 6;
  const steps: Obstacle[] = Array.from({ length: STEPS }, (_, i) => ({
    id: `step-${i + 1}`,
    kind: "box",
    min: [0.7 + (i * 2.6) / STEPS, 0.55, 0],
    max: [0.7 + ((i + 1) * 2.6) / STEPS, 1.45, ((i + 1) * SLAB_Z) / STEPS],
    material: "wood",
    attenuationDb: null,
  }));
  const upper = perimeterSensors(8, W, D, [3.85, 4.45]).map((n, i) => ({ ...n, id: `U${i + 1}`, label: `Upper node ${i + 1}` }));
  return baseConfig({
    scenario: "B",
    name: "Two storeys with stairs",
    room: { width: W, depth: D, height: 5.6, wallMaterial: "drywall", wallThickness: 0.12, wallReflectivity: null },
    obstacles: [slab("slab-north", [0, 1.6], [W, D]), slab("slab-east", [3.6, 0], [W, 1.6]), ...steps],
    openings: [{ id: "door", kind: "door", wall: "south", offset: 4.6, width: 0.9, height: 2.05, sill: 0 }],
    sensors: [...perimeterSensors(8, W, D), ...upper],
    // a coarser grid keeps the 16 node, 5.6 m tall scene close to real time in the browser
    recon: { voxelSizeM: 0.3 },
    subjects: [
      {
        id: "s1", label: "S1", heightM: 1.75, radiusM: 0.22, rcsM2: 1, start: [4.6, 3.6], startHeadingDeg: 180, startDelayS: 0, loop: true,
        actions: [
          { type: "walk", to: [0.4, 1.0], speed: 0.9 },
          { type: "walk", to: [3.4, 1.0], speed: 0.55, toZ: SLAB_Z },
          { type: "walk", to: [4.8, 3.8], speed: 0.9 },
          { type: "stop", durationS: 4 },
          { type: "walk", to: [3.4, 1.0], speed: 0.9 },
          { type: "walk", to: [0.4, 1.0], speed: 0.55, toZ: 0 },
        ],
      },
    ],
  });
}

/**
 * Which floor a detection is on, from the height the tracker estimates. Downstairs tracks sit
 * around 1.8 to 2.1 m and upstairs ones around 3.4 to 3.8 m in this scene, so the midpoint splits them.
 */
export const detectedFloor = (floors: number[], z: number) => (z > floors[1] - 0.15 ? 1 : 0);
/** Floor height under a detection for drawing its ring: follows the estimated height, clamped to the floors. */
export const ringHeight = (floors: number[], z: number) => Math.min(floors[1], Math.max(0, ((z - 1.85) * floors[1]) / 1.75));
export const SLAB = SLAB_Z;

export const SITUATIONS: Situation[] = [
  { id: "walk", label: "One person walking", summary: "A person walks along the wall and turns. They sit for a while and then walk back.", build: () => scenarioByKey("B")!.build() },
  {
    id: "sit",
    label: "Sitting still",
    summary: "A person walks to the middle of the room and sits down without moving.",
    build: () => {
      const c = scenarioByKey("B")!.build();
      c.name = "Sitting still";
      c.subjects = [{ ...c.subjects[0], start: [1.2, 1.2], actions: [{ type: "walk", to: [3.2, 2.4], speed: 0.9 }, { type: "sit", durationS: 40 }], loop: true }];
      return c;
    },
  },
  { id: "wall", label: "Behind a wall", summary: "A brick partition splits the room and the person walks on the far side of it.", build: () => scenarioByKey("C")!.build() },
  {
    id: "two",
    label: "Two people crossing",
    summary: "Two people walk diagonally and pass close to each other in the middle.",
    build: () => {
      const c = scenarioByKey("E")!.build();
      c.subjects = c.subjects.slice(0, 2);
      return c;
    },
  },
  { id: "three", label: "Three people", summary: "Three people of different heights cross paths at different times.", build: () => scenarioByKey("E")!.build() },
  {
    id: "noisy",
    label: "Weak signal",
    summary: "The same walk with a weak and noisy signal. Four in ten packets are lost.",
    build: () => {
      const c = scenarioByKey("F")!.build();
      c.signal.snrDb = 4;
      c.impairments.packetLoss = 0.4;
      return c;
    },
  },
  { id: "empty", label: "Empty room", summary: "Nobody is in the room. Only noise reaches the sensors.", build: () => scenarioByKey("A")!.build() },
  { id: "stairs", label: "Climbing stairs", summary: "Two floors joined by a staircase. A person walks up to the top floor and comes back down.", build: twoStoreys, floors: [0, SLAB_Z] },
  { id: "sparse", label: "Too few sensors", summary: "There are only two sensors. That gives a single radio link across the room.", build: () => variant("I", "insufficient") },
];
