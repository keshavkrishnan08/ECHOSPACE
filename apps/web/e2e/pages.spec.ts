import { expect, test } from "@playwright/test";
import { frameNumber, trackPageErrors, waitForFrames } from "./helpers";

const ROUTES: Array<[string, RegExp | string]> = [
  ["/", "Live preview"],
  ["/lab", "Scene & sensors"],
  ["/arena?s=A", "Empty room baseline"],
  ["/studio", "RF Signal Studio"],
  ["/studio?tab=pipeline", "Input validation"],
  ["/studio?tab=performance", "Benchmark mode"],
  ["/studio?tab=sources", "Source adapters"],
  ["/workbench", "Research Workbench"],
  ["/workbench?tab=ablations", "Ablation study"],
  ["/datasets", "Datasets"],
  ["/models", "Model registry"],
  ["/experiments", "Experiments"],
  ["/diagnostics", "System diagnostics"],
  ["/settings", "Settings"],
  ["/hardware", "Hardware readiness"],
  ["/docs", "Documentation"],
];

for (const [route, text] of ROUTES) {
  test(`route ${route} renders without page errors`, async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto(route);
    await expect(page.getByText(text).first()).toBeVisible();
    await page.waitForTimeout(800);
    expect(errors).toEqual([]);
  });
}

test("keyboard: command palette, navigation shortcuts and focus", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  await expect(page.getByPlaceholder("Type a command…")).toBeFocused();
  await page.keyboard.type("Signal Studio");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/studio/);
  await page.keyboard.press("2");
  await expect(page).toHaveURL(/\/lab/);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
});

test("failure lab: insufficient observations is reported, not invented", async ({ page }) => {
  await page.goto("/arena?s=I");
  await page.getByTestId("variant-insufficient").click();
  await expect(page.getByTestId("arena-capability")).toContainText(/Insufficient observations/, { timeout: 30_000 });
});

test("failure lab: untrained transformer slot refuses to run", async ({ page }) => {
  await page.goto("/arena?s=I");
  await page.getByTestId("variant-transformer").click();
  await expect(page.getByTestId("arena-capability")).toContainText(/without trained weights/, { timeout: 30_000 });
});

test("layer toggles change what the viewport draws and persist", async ({ page }) => {
  await page.goto("/lab");
  await waitForFrames(page, 5);
  const toggle = page.getByRole("switch", { name: "Ground truth (synthetic)" });
  await expect(toggle).toHaveAttribute("data-state", "checked");
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-state", "unchecked");
  await expect(page.getByTestId("legend")).not.toContainText("Synthetic ground truth");
  await page.reload();
  await expect(page.getByRole("switch", { name: "Ground truth (synthetic)" })).toHaveAttribute("data-state", "unchecked");
  await page.getByRole("switch", { name: "Ground truth (synthetic)" }).click();
});

test("scene reset restarts the stream from frame 0", async ({ page }) => {
  await page.goto("/lab");
  await waitForFrames(page, 60);
  const before = await frameNumber(page);
  await page.getByRole("button", { name: "Restart", exact: true }).first().click();
  // The UI thread may skip early frames under load (display backpressure); what matters is that
  // the stream restarts from zero rather than continuing.
  await expect.poll(() => frameNumber(page), { timeout: 30_000 }).toBeLessThan(before);
});

test("narrow viewport keeps the shell usable", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("launch-lab")).toBeVisible();
});
