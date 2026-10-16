// Captures the situation stills: one per situation in the simple view, each with a short note on
// how the model behaves there. The second column is the simulated time of the still in ms.
//
//   node scripts/showcase/capture.mjs [baseUrl]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../../public/showcase/gallery");
const base = process.argv[2] ?? "http://localhost:3100";
const local = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
mkdirSync(out, { recursive: true });

const SHOTS = [
  ["walk", 16000, "One person walking", "The ring follows the walker closely. Movement disturbs many radio links at once. This is the easiest case."],
  ["sit", 22000, "Sitting still", "Once the person stops the signal change is small. The track holds but the estimate wanders more."],
  ["wall", 16000, "Behind a wall", "Radio goes through the partition but weaker. The person is still found with more error near the wall."],
  ["two", 16000, "Two people crossing", "Each person gets a ring when they are apart. Close together they can merge into one ring or swap."],
  ["three", 13000, "Three people", "More bodies means overlapping signal. People can be missed for a while. One person can also show up as two rings."],
  ["noisy", 18000, "Weak signal", "Low signal and lost packets slow detection down. The status line flags the weak input."],
  ["empty", 14000, "Empty room", "Nobody is there and nothing is drawn. Noise alone does not create a person."],
  ["stairs", 14000, "Climbing stairs", "Two floors joined by a staircase. The ring follows the person up and the status line names the floor they were detected on."],
  ["sparse", 12000, "Too few sensors", "With a single radio link the position cannot be worked out. The system says so instead of guessing."],
];

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync(local) ? local : undefined),
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 960 } })).newPage();
// Render mode: step the simulation to an exact time so every still shows the same moment on any machine.
await page.goto(`${base}/?render=1`);
await page.waitForFunction(() => !!window.__echo, null, { timeout: 60_000 });
const shots = [];
for (const [id, atMs, title, caption] of SHOTS) {
  await page.evaluate((x) => window.__echo.pick(x), id);
  for (let i = 0; i < Math.round(atMs / 100); i++) await page.evaluate(() => window.__echo.step());
  await page.evaluate(() => window.__echo.view(1, 0.25));
  const status = (await page.getByTestId("simple-status").textContent())?.trim() ?? "";
  await page.screenshot({ path: join(out, `${id}.png`) });
  shots.push({ file: `gallery/${id}.png`, title, caption, status });
  console.log("captured", id, "·", status);
}
writeFileSync(join(here, "../../public/showcase/gallery.json"), JSON.stringify(shots, null, 2));
await browser.close();
