import type { ScenarioConfig } from "@echospace/schemas";
import { scenarioByKey } from "@echospace/engine";

/** The situations shown in the simple view, in plain language. All are synthetic simulations. */
export interface Situation {
  id: string;
  label: string;
  summary: string;
  build: () => ScenarioConfig;
}

const variant = (key: "I", id: string) => {
  const def = scenarioByKey(key)!;
  return def.variants!.find((v) => v.id === id)!.apply(def.build());
};

export const SITUATIONS: Situation[] = [
  { id: "walk", label: "One person walking", summary: "A person walks along the wall, turns, sits for a while and walks back.", build: () => scenarioByKey("B")!.build() },
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
    summary: "The same walk with a weak, noisy signal and four in ten packets lost.",
    build: () => {
      const c = scenarioByKey("F")!.build();
      c.signal.snrDb = 4;
      c.impairments.packetLoss = 0.4;
      return c;
    },
  },
  { id: "empty", label: "Empty room", summary: "Nobody is in the room. Only noise reaches the sensors.", build: () => scenarioByKey("A")!.build() },
  { id: "sparse", label: "Too few sensors", summary: "Only two sensors, so there is a single radio link across the room.", build: () => variant("I", "insufficient") },
];
