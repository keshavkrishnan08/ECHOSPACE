// Captures the gallery screenshots for the showcase. Each shot sets up a real situation in the
// running app first, then saves a PNG and a caption entry in public/showcase/gallery.json.
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

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync(local) ? local : undefined),
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const shots = [];
const shot = async (file, title, caption, group) => {
  await page.screenshot({ path: join(out, `${file}.png`) });
  shots.push({ file: `gallery/${file}.png`, title, caption, group });
  console.log("captured", file);
};
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(base + "/");
await wait(9000);
await shot("overview", "Mission control", "The overview with a live 3D preview, the session inspector and metrics measured from the running engine. Every metric has a definition and a source.", "Product");

await page.goto(base + "/lab");
await wait(14000);
await shot("lab-live", "Live Spatial Lab", "Scene configuration on the left, the reconstruction in the centre and the inspector on the right. Tracks carry two sigma ellipses; ground truth stays dashed.", "Product");

await page.getByRole("switch", { name: "Unobserved regions" }).click();
await page.getByRole("switch", { name: "Filtered point cloud" }).click();
await wait(3000);
await shot("lab-unobserved", "Unknown is not empty", "Amber points mark voxels that no link constrains. The posterior variance separates them from regions that are confidently empty.", "Situations");
await page.getByRole("switch", { name: "Unobserved regions" }).click();
await page.getByRole("switch", { name: "Filtered point cloud" }).click();

await page.goto(base + "/studio?tab=signals&signal=spectrogram");
await wait(12000);
await shot("studio-doppler", "Doppler spectrogram", "Micro Doppler from a walking subject on one link, computed from sanitized channel state. Each column is one frame.", "Signals");

await page.goto(base + "/studio?tab=signals&signal=magphase");
await wait(5000);
await shot("studio-phase", "Magnitude and phase", "Per subcarrier magnitude and sanitized phase for three receive antennas. Frequency selective fading shows as ripples.", "Signals");

await page.goto(base + "/studio?tab=pipeline");
await wait(6000);
await page.getByTestId("stage-spatial").click();
await wait(3000);
await shot("studio-pipeline", "Twelve stage pipeline", "Each stage reports shapes, dtype, measured time and queue state. Channel estimation is marked not applicable because the source already provides CSI.", "Technical design");

await page.goto(base + "/studio?tab=performance");
await wait(6000);
await shot("studio-performance", "Latency profiling", "Processing time and wall clock latency are kept apart. Percentiles only appear once enough samples exist.", "Technical design");

await page.goto(base + "/arena?s=E");
await wait(16000);
await shot("arena-crossing", "Three people crossing", "Scenario E with link attenuation over time, simulation metrics and an event log that records identity switches.", "Situations");

await page.goto(base + "/arena?s=I");
await wait(5000);
await page.getByTestId("variant-insufficient").click();
await wait(8000);
await shot("arena-failure", "An explained failure", "With two nodes there is one link. The model reports insufficient observations and draws nothing rather than inventing a reconstruction.", "Situations");

await page.goto(base + "/arena?s=D");
await wait(16000);
await shot("arena-multipath", "Multipath ghosts", "Concrete walls and a coherent back projection model. Reflections put energy where nobody stands.", "Situations");

await page.goto(base + "/workbench?tab=sidebyside");
await wait(20000);
await shot("workbench-sidebyside", "Side by side reconstruction", "Ground truth, a baseline model and the current model at the same timestamp with a shared camera.", "Research");

await page.goto(base + "/models");
await wait(3000);
await page.getByTestId("model-ridge-floor").click();
await wait(3000);
await shot("models", "Model registry", "Model cards with schemas, confidence semantics, limitations and held out evaluation. Untrained slots are listed but cannot run.", "Research");

await page.goto(base + "/hardware");
await wait(4000);
await shot("hardware", "Hardware readiness", "A live checklist for a physical CSI source, gated on operator authorisation and consent. The adapter is labelled experimental.", "Research");

await page.goto(base + "/lab");
await wait(9000);
await page.getByTestId("save-experiment").click();
await page.getByTestId("experiment-name").fill("Scenario B baseline run");
await page.getByTestId("confirm-save").click();
await page.waitForURL(/experiments\?id=/, { timeout: 60000 });
await wait(4000);
await shot("experiments", "Reproducible experiments", "A saved run with provenance, metric summaries, exports and a replay digest that verifies reproduction.", "Research");

writeFileSync(join(here, "../../public/showcase/gallery.json"), JSON.stringify(shots, null, 2));
await browser.close();
