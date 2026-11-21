import { expect, test } from "@playwright/test";
import { createEnvironmentSnapshot } from "../src/environment/environment-context.js";

const location = { label: "350 5TH AVE, NEW YORK, NY, 10118", latitude: 40.74785085, longitude: -73.98507558 };
const weather = { hour: "2026-11-01T13:00:00.000Z", source: "Open-Meteo historical reanalysis",
  temperatureC: 11, humidityPercent: 70, windSpeedMps: 3, windDirectionDegrees: 270 };

async function openEnvironment(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try blocked-route replay demo" }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("button", { name: "Explore room", exact: true }).click();
  await page.locator("#studio-environment summary").click();
  return page.locator("#studio-environment");
}

test("selected address and orientation feed the captured replay even after conditions change", async ({ page }) => {
  await page.route("**/api/environment/addresses?**", (route) => route.fulfill({ json: { matches: [
    { label: "350 5TH AVENUE, OTHER CITY", latitude: 41, longitude: -74 }, location,
  ] } }));
  const requests = [];
  await page.route("**/api/environment/snapshot?**", (route) => {
    const p = new URL(route.request().url()).searchParams;
    expect(Number(p.get("latitude"))).toBe(location.latitude);
    requests.push(p.get("instant"));
    const morning = requests.length === 1;
    return route.fulfill({ json: { snapshot: createEnvironmentSnapshot({
      location, instant: p.get("instant"), timeZone: "America/New_York", orientationDegrees: Number(p.get("orientation")),
      weather: morning ? weather : null,
    }) } });
  });
  const panel = await openEnvironment(page);
  await panel.getByLabel("U.S. street address").fill("350 5th Ave");
  await panel.getByRole("button", { name: "Find address" }).click();
  await expect(panel.getByRole("status")).toContainText("Several addresses");
  await expect(panel.getByRole("button", { name: "Use these conditions" })).toBeDisabled();
  await panel.getByLabel("Matching addresses").selectOption({ label: location.label });
  await panel.getByLabel("Simulation time (UTC)").fill("2026-11-01T13:00");
  await panel.getByLabel("Compass bearing").fill("90");
  await panel.getByRole("button", { name: "Use these conditions" }).click();
  await expect(panel.locator("dl")).toContainText("8:00 AM EST");
  await expect(panel.locator("dl")).toContainText("35.0° clockwise");
  await expect(panel.locator("dl")).toContainText("70%");
  await page.getByRole("button", { name: "Capture baseline" }).click();
  const findings = page.locator("#studio-replay-findings");
  await expect(findings).toContainText("Baseline conditions used");
  await panel.getByLabel("Simulation time (UTC)").fill("2026-11-01T19:00");
  await panel.getByRole("button", { name: "Use these conditions" }).click();
  await expect(panel.locator("dl")).toContainText("2:00 PM EST");
  await expect(panel.locator("dl")).toContainText("Weather unavailable for this hour");
  await page.getByRole("button", { name: "Compare current layout" }).click();
  await expect(findings).toContainText("Both layouts used");
  await expect(findings).toContainText("8:00 AM EST");
  expect(requests).toEqual(["2026-11-01T13:00:00.000Z", "2026-11-01T19:00:00.000Z"]);
  await page.reload();
  await expect(page.locator("#studio-environment dl")).toContainText("2:00 PM EST");
});

test("unknown home bearing, missing weather and unmatched addresses have clear states", async ({ page }) => {
  let matched = true;
  await page.route("**/api/environment/addresses?**", (route) => route.fulfill({ json: { matches: matched ? [location] : [] } }));
  await page.route("**/api/environment/snapshot?**", (route) => {
    expect(new URL(route.request().url()).searchParams.get("orientation")).toBe("");
    return route.fulfill({ json: { snapshot: createEnvironmentSnapshot({ location, instant: "2026-11-01T13:00:00.000Z",
      timeZone: "America/New_York", orientationDegrees: null, weather: null }) } });
  });
  const panel = await openEnvironment(page);
  await panel.getByLabel("U.S. street address").fill(location.label);
  await panel.getByRole("button", { name: "Find address" }).click();
  await panel.getByRole("button", { name: "Use these conditions" }).click();
  await expect(panel.locator("dl")).toContainText("Home orientation missing");
  await expect(panel.locator("dl")).toContainText("Weather unavailable");
  matched = false;
  await panel.getByLabel("U.S. street address").fill("Unknown road");
  await panel.getByRole("button", { name: "Find address" }).click();
  await expect(panel.getByRole("status")).toContainText("No matching address");
  await expect(panel.locator("dl")).toContainText(location.label);
});
