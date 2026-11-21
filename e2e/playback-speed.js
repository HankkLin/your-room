import { expect } from "@playwright/test";

export async function setPlaybackSpeed(page, target) {
  const speeds = [1, 5, 20];
  const readout = page.locator("#sim-speed-value");
  const current = speeds.indexOf(Number(await readout.getAttribute("data-current-speed")));
  const desired = speeds.indexOf(target);
  expect(current).toBeGreaterThanOrEqual(0);
  expect(desired).toBeGreaterThanOrEqual(0);
  const step = desired > current ? 1 : -1;
  for (let index = current; index !== desired; index += step) {
    await page.getByRole("button", { name: step > 0 ? "Increase speed" : "Decrease speed" }).click();
    await expect(readout).toHaveText(speeds[index + step] + "×");
  }
}
