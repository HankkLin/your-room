import { expect, test } from "@playwright/test";

const alex = {
  id: "alex",
  name: "Alex",
  ageGroup: "adult",
  preferences: [],
  dislikes: [],
  needs: { privacy: 0.6, quiet: 0.6, accessibility: 0.2, daylight: 0.6, social: 0.6 },
  schedule: [
    { activity: "sleep", roomId: "bedroom", startMinute: 470, endMinute: 485 },
    { activity: "cook", roomId: "kitchen", startMinute: 485, endMinute: 500 },
  ],
};

const sofa = {
  id: "replay-test-sofa",
  name: "Doorway sofa",
  type: "existing",
  kind: "sofa",
  roomId: "bedroom",
  x: 3.2,
  z: 6,
  rotation: 0,
  width: 2.1,
  height: 0.85,
  depth: 0.9,
  owned: true,
  locked: false,
  price: 0,
  color: "#8e7969",
};

const project = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("stillroom.project.v1")));

test("Studio replay measures that removing a sofa restores the scheduled route to the kitchen", async ({ page }) => {
  await page.route("**/api/personas/generate", (route) =>
    route.fulfill({ json: { personas: [alex] } }),
  );
  await page.goto("/");
  await page.locator("#try-sample-floorplan").click();
  await page.locator("#fp-confirm-import").click();

  const household = page.locator("#household-page");
  await household.getByLabel("Household description").fill(
    "Alex sleeps in the Bedroom from 07:50 to 08:05, then cooks in the Kitchen until 08:20.",
  );
  await household.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(household.getByLabel("Name", { exact: true })).toHaveValue("Alex");
  const destinations = household.getByRole("combobox", { name: "Room", exact: true });
  await expect(destinations.nth(0)).toHaveValue("bedroom");
  await expect(destinations.nth(1)).toHaveValue("kitchen");
  await household.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "design");
  const approved = await project(page);
  expect(approved.personas).toEqual([alex]);
  expect(approved.importedHouse.fixtures).toHaveLength(7);
  expect(approved.importedHouse.fixtures.every(({ locked }) => locked)).toBe(true);

  // Seed only the obstruction. The normal placement editor protects doorway clearance.
  await page.evaluate((item) => {
    const key = "stillroom.project.v1";
    const state = JSON.parse(localStorage.getItem(key));
    state.items.push(item);
    localStorage.setItem(key, JSON.stringify(state));
  }, sofa);
  await page.reload();
  await page.locator("#tour-step").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");

  const replay = page.locator("#twin-results-section");
  const capture = replay.locator("#sim-capture-baseline-btn");
  const compare = replay.locator("#sim-compare-current-btn");
  await expect(page.locator("#studio-replay-panel")).toBeHidden();
  await expect(compare).toBeDisabled();
  await capture.click();
  await expect(page.locator("#sim-layout-compare-status")).toContainText("Baseline captured");

  const obstacle = page.locator(`#inventory [data-item="${sofa.id}"]`);
  await obstacle.click();
  await page.locator("#objectbar [data-action=remove]").click();
  await expect(obstacle).toHaveCount(0);

  await compare.click();
  const failures = replay.getByRole("row").filter({ hasText: "Path failures" });
  await expect(failures.locator("td")).toHaveText(["1", "0"]);
  const findings = page.locator("#sim-layout-compare-findings");
  await expect(findings).toContainText("Baseline route blocked from Bedroom to Kitchen.");
  await expect(findings).toContainText("No blocked routes were recorded in the current layout.");
  expect((await project(page)).personas).toEqual(approved.personas);

  await page.locator("#household-step").click();
  await household.getByLabel("End time", { exact: true }).nth(1).fill("08:30");
  await household.getByRole("button", { name: "Save and continue" }).click();
  await page.locator("#tour-step").click();
  await expect(compare).toBeDisabled();
  await capture.click();
  await expect(compare).toBeEnabled();

  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
  const saved = await project(page);
  expect(saved.items.some(({ id }) => id === sofa.id)).toBe(false);
  expect(saved.personas).toEqual([
    { ...alex, schedule: [alex.schedule[0], { ...alex.schedule[1], endMinute: 510 }] },
  ]);
  expect(saved.importedHouse.rooms).toEqual(approved.importedHouse.rooms);
  expect(saved.importedHouse.fixtures).toEqual(approved.importedHouse.fixtures);
});
