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

// Both videos only use the simple view: a simulated person moves through a room and the
// system marks where it thinks they are. Nothing in them is measured; it is all simulation.
const pick = async (page, id) => {
  await page.getByTestId(`situation-${id}`).click();
  // wait out calibration so the scene shows the model working, not the empty-room warm up
  await page.getByTestId("simple-status").filter({ hasNotText: /Calibrating|Starting/ }).waitFor({ timeout: 60_000 });
};

// Video 1: one person.
await record("demo-1", async ({ page, say, wait }) => {
  await page.goto(base + "/?s=walk");
  await say("This is a simulated room with eight Wi-Fi sensors on the walls.", 6000);
  await wait(6000);
  await say("The white figure is a simulated person. ECHOSPACE never sees it, only the radio signals it disturbs.", 7000);
  await page.getByTestId("simple-status").filter({ hasNotText: /Calibrating|Starting/ }).waitFor({ timeout: 60_000 });
  await wait(7000);
  await say("The violet ring is where the system thinks the person is, worked out from those signals alone.", 8000);
  await wait(8000);
  await say("The green points are the parts of the room it believes are occupied.", 8000);
  await wait(8000);
  await say("As the person walks, the detection follows. The status line shows how far off it is.", 10000);
  await wait(14000);
  await pick(page, "sit");
  await say("Sitting still is harder. A still body disturbs the signal much less than a moving one.", 9000);
  await wait(9000);
  await say("The system keeps the person once found, but the estimate drifts more.", 9000);
  await wait(12000);
  await pick(page, "wall");
  await say("Here the person walks behind a partition wall. Radio passes through it, weakened.", 9000);
  await wait(9000);
  await say("The detection still follows, with more error near the wall.", 9000);
  await wait(12000);
  await say("Everything here is simulated. Real hardware would need its own testing.", 7000);
  await wait(7000);
});

// Video 2: harder situations, including the ones where it fails.
await record("demo-2", async ({ page, say, wait }) => {
  await page.goto(base + "/?s=two");
  await page.getByTestId("simple-status").filter({ hasNotText: /Calibrating|Starting/ }).waitFor({ timeout: 60_000 });
  await say("Two people crossing the room. Each one gets its own ring.", 8000);
  await wait(8000);
  await say("When they pass close together the system can mix them up. That is a real limit.", 10000);
  await wait(14000);
  await pick(page, "three");
  await say("Three people. More bodies means more overlapping signal, and the estimates get rougher.", 10000);
  await wait(14000);
  await pick(page, "noisy");
  await say("A weak, noisy signal with lost packets. Detection gets slower and less precise.", 10000);
  await wait(14000);
  await pick(page, "empty");
  await say("An empty room. The right answer is nothing, and noise alone should not create a person.", 10000);
  await wait(12000);
  await pick(page, "sparse");
  await say("Only two sensors, so a single radio link. That cannot tell where anyone is.", 9000);
  await wait(9000);
  await say("So the system says it cannot locate anyone instead of guessing.", 8000);
  await wait(10000);
  await pick(page, "walk");
  await say("Back to one person with the full set of sensors. All of this is simulated.", 8000);
  await wait(9000);
});
