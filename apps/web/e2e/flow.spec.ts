import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { frameNumber, trackPageErrors, waitForFrames } from "./helpers";

/**
 * The acceptance flow from the product spec, in one browser session:
 * launch → synthetic session → live reconstruction → signal plots → parameter change →
 * pause + scrub → save → reload + replay (digest verified) → export report and point cloud.
 */
test("signal-to-space acceptance flow", async ({ page }) => {
  test.setTimeout(420_000);
  const errors = trackPageErrors(page);

  // 1–2. Launch the application; a synthetic session starts automatically.
  await page.goto("/");
  await expect(page.getByTestId("source-badge").first()).toContainText(/synthetic simulation/i);
  await page.getByTestId("launch-lab").click();
  await expect(page).toHaveURL(/\/lab/);

  // 3–4. The 3D reconstruction updates.
  await expect(page.getByTestId("viewport")).toBeVisible();
  await waitForFrames(page, 15);
  const f1 = await frameNumber(page);
  await page.waitForTimeout(1500);
  expect(await frameNumber(page)).toBeGreaterThan(f1);
  await expect(page.getByTestId("inspector")).toContainText("rti-bayes");

  // 5. Generated signal plots.
  await page.goto("/studio?tab=signals&signal=magphase");
  await expect(page.getByTestId("plot-magphase")).toBeVisible();
  await expect(page.getByTestId("plot-magphase").locator("canvas").first()).toBeVisible();
  await page.getByTestId("signal-spectrogram").click();
  await expect(page.getByTestId("plot-spectrogram").locator("canvas").first()).toBeVisible();

  // 6–7. Change a simulation parameter and observe the effect on input quality.
  await page.goto("/arena?s=F");
  await waitForFrames(page, 30);
  const readQuality = async () => Number.parseFloat((await page.getByTestId("arena-metrics").getByText("Input quality").locator("xpath=..").locator("xpath=..").locator(".num").first().textContent()) ?? "NaN");
  await expect.poll(readQuality).toBeGreaterThan(0.8);
  const loss = page.getByRole("slider", { name: "Packet loss" });
  await loss.focus();
  await page.keyboard.press("End");
  await expect.poll(readQuality, { timeout: 30_000 }).toBeLessThan(0.6);

  // 8. Pause and scrub the timeline.
  await page.goto("/lab");
  await waitForFrames(page, 20);
  await page.getByTestId("play-toggle").click();
  const scrubber = page.getByTestId("timeline-scrubber");
  const min = Number(await scrubber.getAttribute("min"));
  await scrubber.fill(String(min + 3));
  await expect(page.getByText(/Historical/).first()).toBeVisible();
  // Frames skipped by display backpressure are not in the history; the nearest one is shown.
  await expect.poll(async () => Math.abs((await frameNumber(page)) - (min + 3))).toBeLessThanOrEqual(3);
  const held = await frameNumber(page);
  await page.waitForTimeout(1000);
  expect(await frameNumber(page)).toBe(held);
  await page.getByTestId("play-toggle").click();

  // 9. Save an experiment (needs ≥ 40 frames from seq 0 for the replay digest).
  await page.getByRole("button", { name: "Restart" }).first().click();
  await waitForFrames(page, 45);
  await page.getByTestId("save-experiment").click();
  await page.getByTestId("experiment-name").fill("e2e acceptance run");
  await page.getByTestId("confirm-save").click();
  await expect(page).toHaveURL(/\/experiments\?id=exp_/);
  await expect(page.getByTestId("experiment-detail")).toContainText("e2e acceptance run");

  // 10. Reload and replay; the replay digest must match.
  await page.reload();
  await expect(page.getByTestId("experiment-detail")).toContainText("e2e acceptance run");
  await page.getByTestId("replay-experiment").click();
  await expect(page).toHaveURL(/\/lab/);
  await expect(page.getByText(/reproduced/)).toBeVisible({ timeout: 60_000 });

  // 11. Export a report and a point cloud.
  await page.goto("/experiments");
  await page.getByText("e2e acceptance run").first().click();
  const [report] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-report").click()]);
  const reportText = readFileSync((await report.path())!, "utf8");
  expect(reportText).toContain("SIMULATION");
  expect(reportText).toContain("Position error");
  await page.goto("/lab");
  await waitForFrames(page, 10);
  const [ply] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-ply").click()]);
  const plyText = readFileSync((await ply.path())!, "utf8");
  expect(plyText.startsWith("ply")).toBe(true);
  expect(plyText).toContain("SIMULATED, not a measurement");

  expect(errors).toEqual([]);
});
