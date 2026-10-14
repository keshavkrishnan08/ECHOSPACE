/**
 * Writes every scenario preset (default seed) to services/simulator/echospace_sim/presets/<KEY>.json
 * for the Python reference simulator.
 *
 *   npx tsx scripts/export-presets.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "../src/sim/scenarios";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../services/simulator/echospace_sim/presets");
mkdirSync(outDir, { recursive: true });

for (const s of SCENARIOS) {
  const doc = { key: s.key, title: s.title, objective: s.objective, lesson: s.lesson, difficulty: s.difficulty, config: s.build() };
  writeFileSync(resolve(outDir, `${s.key}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`wrote ${s.key}.json`);
}
