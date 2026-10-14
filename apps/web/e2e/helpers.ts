import { expect, type Page } from "@playwright/test";

export async function frameNumber(page: Page): Promise<number> {
  const text = (await page.getByTestId("timeline-readout").first().textContent()) ?? "";
  const m = text.match(/frame (\d+)/);
  return m ? Number(m[1]) : -1;
}

export async function waitForFrames(page: Page, min: number) {
  await expect.poll(() => frameNumber(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(min);
}

export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

export async function metricValue(page: Page, label: string): Promise<number> {
  const tile = page.getByTestId("arena-metrics").locator("div", { hasText: label }).first();
  const text = (await tile.locator(".num").first().textContent()) ?? "";
  return Number.parseFloat(text);
}
