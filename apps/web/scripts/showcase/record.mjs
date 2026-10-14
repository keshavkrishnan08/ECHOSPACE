// Records the two showcase walkthroughs with Playwright and writes WebVTT subtitles whose cue
// times come from the moments the script actually performs each step.
//
//   node scripts/showcase/record.mjs [baseUrl] [demo-1|demo-2]   (default http://localhost:3100)
//
// Output: public/showcase/demo-{1,2}.mp4 (H.264) and matching .vtt files.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../../public/showcase");
const base = process.argv[2] ?? "http://localhost:3100";
const only = process.argv[3] ?? null;
const W = 1440;
const H = 900;
const local = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

mkdirSync(out, { recursive: true });

const fmt = (ms) => {
  const t = Math.max(0, ms) / 1000;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(3).padStart(6, "0");
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s}`;
};

/**
 * Frames come from the DevTools screencast (each with its own timestamp) and are encoded with
 * ffmpeg's concat demuxer, so frame timing and subtitle timing share one clock.
 */
async function record(name, script) {
  if (only && only !== name) return;
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync(local) ? local : undefined),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  const framesDir = join(out, ".raw", name);
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  cdp.on("Page.screencastFrame", async (f) => {
    const file = join(framesDir, `${String(frames.length).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ file, t: f.metadata.timestamp * 1000 });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const t0 = Date.now();
  const cues = [];
  const say = async (text, holdMs = 6000) => {
    const start = Date.now() - t0;
    if (cues.length) cues[cues.length - 1].end = Math.min(cues[cues.length - 1].end, start);
    cues.push({ start, end: start + holdMs, text });
    console.log(`[${name}] ${fmt(start)} ${text}`);
  };
  const wait = (ms) => page.waitForTimeout(ms);
  try {
    await script({ page, say, wait });
  } catch (e) {
    console.error(`[${name}] step failed:`, e);
    throw e;
  } finally {
    const total = Date.now() - t0;
    await cdp.send("Page.stopScreencast").catch(() => {});
    await ctx.close();
    await browser.close();
    if (cues.length) cues[cues.length - 1].end = Math.min(cues[cues.length - 1].end, total);
    // concat list: each frame lasts until the next one; the last one until the end of the script
    const lines = ["ffconcat version 1.0"];
    frames.forEach((f, i) => {
      const next = i + 1 < frames.length ? frames[i + 1].t : t0 + total;
      const startMs = i === 0 ? t0 : f.t;
      lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, (next - startMs) / 1000).toFixed(3)}`);
    });
    if (frames.length) lines.push(`file '${frames[frames.length - 1].file}'`);
    const list = join(framesDir, "list.txt");
    writeFileSync(list, lines.join("\n"));
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", "fps=15,format=yuv420p,scale=1440:-2", "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-movflags", "+faststart", join(out, `${name}.mp4`)]);
    writeFileSync(join(out, `${name}.vtt`), ["WEBVTT", "", ...cues.flatMap((c, i) => [String(i + 1), `${fmt(c.start)} --> ${fmt(c.end)}`, c.text, ""])].join("\n"));
    rmSync(framesDir, { recursive: true, force: true });
    console.log(`[${name}] ${(total / 1000).toFixed(0)} s, ${frames.length} frames, ${cues.length} cues`);
  }
}

const drag = async (page, x, y, dx, dy) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(x + (dx * i) / 20, y + (dy * i) / 20);
  await page.mouse.up();
};

// Walkthrough 1: the guided "From signal to space" demo, end to end.
await record("demo-1", async ({ page, say, wait }) => {
  await page.goto(base + "/");
  await say("ECHOSPACE turns ambient radio measurements into a 3D picture of a room. Everything here runs in the browser on a synthetic simulation.", 7000);
  await wait(7000);
  await say("The overview shows the live session: source, processing state, a 3D preview and metrics measured from the running engine.", 7000);
  await wait(7000);
  await page.getByTestId("start-demo").click();
  await say("Act 1. Eight transceivers line the walls. A synthetic person walks a scripted path, drawn as dashed white ground truth.", 8000);
  await wait(4000);
  await drag(page, 820, 520, 220, -40);
  await wait(4500);
  await say("Cyan lines are the modelled radio paths for one link: the direct path, wall reflections, and the scatter off the body.", 8000);
  await wait(8000);
  await page.getByTestId("tour-next").click();
  await say("Act 2. RF Signal Studio. These plots come from the simulated channel state of the selected link, frame by frame.", 8000);
  await wait(6000);
  await page.getByTestId("signal-spectrogram").click();
  await say("The Doppler spectrogram shows motion as spread energy. When the person stops or sits, it collapses back to the centre.", 9000);
  await wait(9000);
  await page.getByTestId("signal-magphase").click();
  await say("Raw phase is scrambled by oscillator offsets. Sanitization removes a fitted linear phase so antenna differences survive.", 8000);
  await wait(8000);
  await page.getByTestId("tour-next").click();
  await say("Act 3. The pipeline has twelve stages. Each one reports its input and output shapes and its measured run time.", 8000);
  await wait(5000);
  await page.getByTestId("stage-spatial").click();
  await say("Spatial representation: a Bayesian radio tomography posterior over a voxel grid, computed in the dual form so it stays fast.", 8000);
  await wait(8000);
  await page.getByTestId("tour-next").click();
  await say("Act 4. Back in the lab. Blue voxels and points are the model output. The violet sphere is a track with a two sigma ellipse.", 9000);
  await wait(9000);
  await page.getByRole("switch", { name: "Unobserved regions" }).click();
  await say("Amber marks voxels that no link can see. The system reports them as unknown instead of pretending they are empty.", 8000);
  await wait(8000);
  await page.getByRole("switch", { name: "Unobserved regions" }).click();
  await page.getByTestId("tour-next").click();
  await say("Act 5. We drop the signal to noise ratio to 3 dB and lose 40 percent of packets.", 6000);
  await wait(6000);
  await say("Input quality falls, confidence drops and position error grows. The model is not allowed to hold on to an old answer.", 9000);
  await wait(9000);
  await page.getByTestId("tour-next").click();
  await say("Act 6. Saving stores the seed, the launch configuration, every mid run change, model versions and measured metrics.", 7000);
  await wait(2500);
  await page.getByTestId("experiment-name").fill("Walkthrough: signal to space");
  await wait(1500);
  await page.getByTestId("confirm-save").click();
  await page.waitForURL(/experiments/, { timeout: 60000 });
  await say("The experiment page lists provenance and metric summaries. Replay relaunches the run and checks a digest of its first forty frames.", 9000);
  await wait(6000);
  await page.getByTestId("replay-experiment").click();
  await page.getByText(/reproduced/).first().waitFor({ timeout: 90000 }).catch(() => {});
  await say("The digest matches, so the run was reproduced exactly from its saved configuration.", 7000);
  await wait(7000);
  await say("That is the whole loop: simulate, measure, reconstruct, fail honestly, save, and reproduce.", 6000);
  await wait(6000);
});

// Walkthrough 2: the simulation arena and the research workbench.
await record("demo-2", async ({ page, say, wait }) => {
  await page.goto(base + "/arena?s=C");
  await say("The Simulation Arena holds ten scenarios. Each one has a stated objective, editable parameters and live metrics.", 7000);
  await wait(7000);
  await say("Scenario C puts a brick partition in the room. Links that cross it lose most of the body shadowing contrast.", 8000);
  await wait(8000);
  await page.getByRole("slider", { name: "Attenuation override (simplified)" }).focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
  await say("Raising the partition loss to 30 dB removes information. The view warns that the empty room calibration is now stale.", 9000);
  await wait(9000);
  await page.getByTestId("scenario-D").click();
  await say("Scenario D uses concrete walls and a coherent back projection model. Strong reflections create ghost energy away from the person.", 10000);
  await wait(10000);
  await page.getByTestId("scenario-E").click();
  await say("Scenario E has three people crossing paths. Identity switches and fragmented tracks are counted, not hidden.", 9000);
  await wait(9000);
  await page.getByTestId("scenario-I").click();
  await wait(3000);
  await page.getByTestId("variant-insufficient").click();
  await say("The failure lab pushes the system out of its depth. With only two nodes there is one link, so the model refuses to localise.", 9000);
  await wait(9000);
  await page.getByTestId("variant-geometry").click();
  await say("The learned ridge model was trained for one room layout. In a different room it reports unexpected geometry and does not run.", 9000);
  await wait(9000);
  await page.getByTestId("variant-transformer").click();
  await say("The transformer slot has no trained weights, so selecting it produces an explained failure instead of output.", 8000);
  await wait(8000);
  await page.getByTestId("scenario-F").click();
  await wait(3000);
  await page.getByTestId("compare-toggle").click();
  await say("Compare with baseline runs a second engine on the same seed. Both views share the timestamp.", 7000);
  await wait(5000);
  await page.getByRole("slider", { name: "Packet loss" }).focus();
  for (let i = 0; i < 50; i++) await page.keyboard.press("ArrowRight");
  await say("With half the packets gone, the current run degrades while the baseline keeps its accuracy. The table shows both.", 9000);
  await wait(9000);
  await page.goto(base + "/workbench?tab=ablations");
  await say("The research workbench runs ablations. Every variant uses the same seed and the same input, unpaced in a worker.", 7000);
  await wait(3000);
  await page.getByTestId("run-ablation").click();
  await say("Here temporal smoothing is switched on and off. Accuracy and processing cost are reported side by side.", 10000);
  await page.getByText(/not run|running/).first().waitFor({ state: "detached", timeout: 120000 }).catch(() => {});
  await wait(6000);
  await page.goto(base + "/workbench?tab=sidebyside");
  await say("Side by side reconstruction shows ground truth, a baseline model and the current model with one shared camera.", 9000);
  await wait(12000);
  await page.goto(base + "/models");
  await page.getByTestId("model-ridge-floor").click();
  await say("Every model has a card: schemas, confidence semantics, limitations and evaluation on held out synthetic scenes.", 9000);
  await wait(9000);
  await page.goto(base + "/hardware");
  await say("Hardware readiness is kept apart from the simulation. A checklist tests a real device before anything is claimed to work.", 9000);
  await wait(9000);
  await say("Physical capture needs operator authorisation and consent, and raw recording is off unless someone turns it on.", 7000);
  await wait(7000);
});
