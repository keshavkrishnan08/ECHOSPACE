// Records the two showcase videos frame by frame. The page runs in render mode (`/?render=1`):
// the script steps the engine one frame at a time, eases the person and detections between
// steps and turns the camera by a fixed amount per video frame. Every video frame is a screenshot,
// encoded at a constant 30 fps, so motion is smooth however slowly the machine renders.
// Subtitle times are counted in video frames, so they line up exactly.
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
const FPS = 30;
const SIM_HZ = 10; // engine frames per simulated second
const SUB = FPS / SIM_HZ; // video frames per engine frame
const TURN = ((2 * Math.PI) / 60) * 0.35 / FPS; // same slow orbit as the live view
const local = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

mkdirSync(out, { recursive: true });

const fmt = (ms) => {
  const t = Math.max(0, ms) / 1000;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(3).padStart(6, "0");
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s}`;
};

async function record(name, script) {
  if (only && only !== name) return;
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync(local) ? local : undefined),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
  const dir = join(out, ".raw", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let n = 0;
  let angle = 0;
  const cues = [];
  const now = () => (n / FPS) * 1000;
  const shoot = async () => {
    await page.screenshot({ path: join(dir, `${String(n).padStart(6, "0")}.jpg`), type: "jpeg", quality: 92 });
    n++;
  };
  /** Advance the simulation by `seconds`, writing SUB video frames per engine frame. */
  const play = async (seconds) => {
    for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
      await page.evaluate(() => window.__echo.step());
      for (let k = 1; k <= SUB; k++) {
        angle += TURN;
        await page.evaluate(([a, b]) => window.__echo.view(a, b), [k / SUB, angle]);
        await shoot();
      }
    }
  };
  /** Switch situation and run the calibration off camera, so the cut lands on a working scene. */
  const pick = async (id) => {
    await page.evaluate((x) => window.__echo.pick(x), id);
    for (let i = 0; i < 400; i++) {
      const state = await page.evaluate(() => window.__echo.step());
      if (state !== "calibrating" && i > 5) break;
    }
    // let tracks settle for a few simulated seconds before the cut
    for (let i = 0; i < 30; i++) await page.evaluate(() => window.__echo.step());
  };
  const say = (text, holdMs = 6000) => {
    const start = now();
    if (cues.length) cues[cues.length - 1].end = Math.min(cues[cues.length - 1].end, start);
    cues.push({ start, end: start + holdMs, text });
    console.log(`[${name}] ${fmt(start)} ${text}`);
  };
  const t0 = Date.now();
  try {
    await page.goto(base + "/?render=1");
    await page.waitForFunction(() => !!window.__echo, null, { timeout: 60_000 });
    await script({ play, pick, say });
  } finally {
    await browser.close();
  }
  if (cues.length) cues[cues.length - 1].end = Math.min(cues[cues.length - 1].end, now());
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "%06d.jpg"), "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-movflags", "+faststart", join(out, `${name}.mp4`)]);
  writeFileSync(join(out, `${name}.vtt`), ["WEBVTT", "", ...cues.flatMap((c, i) => [String(i + 1), `${fmt(c.start)} --> ${fmt(c.end)}`, c.text, ""])].join("\n"));
  rmSync(dir, { recursive: true, force: true });
  console.log(`[${name}] ${(n / FPS).toFixed(1)} s of video, ${n} frames, ${cues.length} cues, rendered in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

// Video 1: one person.
await record("demo-1", async ({ play, pick, say }) => {
  await pick("walk");
  say("This is a simulated room with eight Wi-Fi sensors on the walls.", 6000);
  await play(6);
  say("The white figure is a simulated person. ECHOSPACE never sees it, only the radio signals it disturbs.", 7000);
  await play(7);
  say("The violet ring is where the system thinks the person is, worked out from those signals alone.", 8000);
  await play(8);
  say("The green points are the parts of the room it believes are occupied.", 7000);
  await play(7);
  say("As the person walks, the detection follows. The status line shows how far off it is.", 10000);
  await play(12);
  await pick("sit");
  say("Sitting still is harder. A still body disturbs the signal much less than a moving one.", 9000);
  await play(9);
  say("The system keeps the person once found, but the estimate drifts more.", 9000);
  await play(11);
  await pick("wall");
  say("Here the person walks behind a partition wall. Radio passes through it, weakened.", 9000);
  await play(9);
  say("The detection still follows, with more error near the wall.", 9000);
  await play(11);
  say("Everything here is simulated. Real hardware would need its own testing.", 7000);
  await play(7);
});

// Video 2: harder situations, including the ones where it fails.
await record("demo-2", async ({ play, pick, say }) => {
  await pick("two");
  say("Two people crossing the room. Each one gets its own ring.", 8000);
  await play(8);
  say("When they pass close together the system can mix them up. That is a real limit.", 10000);
  await play(12);
  await pick("three");
  say("Three people. More bodies means more overlapping signal, and the estimates get rougher.", 10000);
  await play(12);
  await pick("noisy");
  say("A weak, noisy signal with lost packets. Detection gets slower and less precise.", 10000);
  await play(12);
  await pick("empty");
  say("An empty room. The right answer is nothing, and noise alone should not create a person.", 10000);
  await play(10);
  await pick("sparse");
  say("Only two sensors, so a single radio link. That cannot tell where anyone is.", 9000);
  await play(9);
  say("So the system says it cannot locate anyone instead of guessing.", 8000);
  await play(8);
  await pick("walk");
  say("Back to one person with the full set of sensors. All of this is simulated.", 8000);
  await play(9);
});
