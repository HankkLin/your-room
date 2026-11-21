import { test, expect } from "@playwright/test";

test("whole-home demo renders multiple connected rooms, enforces locked fixtures, and supports WASD room-to-room walking", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await expect(page.locator("#whole-home-demo")).toBeVisible();
  await page.locator("#whole-home-demo").click();

  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
  await expect(page.locator("#scene canvas")).toHaveAttribute(
    "data-engine",
    /three/i,
  );
  await expect(page.locator("#view-label")).toHaveText("Perspective");
  await expect(page.locator("#studio .subtitle")).toContainText("Living Room");
  await expect(page.locator("#studio .subtitle")).toContainText("Kitchen");
  await expect(page.locator("#studio .subtitle")).toContainText("Bedroom");
  await expect(page.locator("#studio .subtitle")).toContainText("Bathroom");

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("living-blueprint.project.v1")),
  );
  expect(stored.house.rooms.map((r) => r.id)).toEqual([
    "living-room",
    "kitchen",
    "bedroom",
    "bathroom",
  ]);
  expect(stored.items.some((i) => i.kind === "toilet" && i.locked)).toBe(true);
  expect(
    stored.items.some((i) => i.kind === "kitchen_counter" && i.locked),
  ).toBe(true);

  // Orbit interaction on the 3D overview canvas
  const canvas = page.locator("#scene canvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.46, {
    steps: 4,
  });
  await page.mouse.up();

  // Enter First-Person Interior mode and walk across connected rooms using W/A/S/D
  await page.locator("#view-interior").click();
  await expect(page.locator("#view-label")).toHaveText("Interior view");
  await expect(page.locator("#scene")).toHaveAttribute(
    "data-room",
    "living-room",
  );
  await expect(page.locator("#spot-label")).toHaveText("Living Room");

  // Walk from Living Room East (+X) through Kitchen doorway into Kitchen
  await page.evaluate(() => {
    window.__livingBlueprint.getScene().setEyePose(0.5, 1.8, Math.PI / 2);
  });
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("w");
  }
  await expect(page.locator("#scene")).toHaveAttribute("data-room", "kitchen");
  await expect(page.locator("#spot-label")).toHaveText("Kitchen");

  // Walk from Living Room North (-Z) through Bedroom doorway into Bedroom
  await page.evaluate(() => {
    window.__livingBlueprint.getScene().setEyePose(-1.3, 0.3, 0);
  });
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("w");
  }
  await expect(page.locator("#scene")).toHaveAttribute("data-room", "bedroom");
  await expect(page.locator("#spot-label")).toHaveText("Bedroom");

  // Walk East (+X) from Bedroom through Bathroom doorway into Bathroom
  await page.evaluate(() => {
    window.__livingBlueprint.getScene().setEyePose(-0.5, -1.25, Math.PI / 2);
  });
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("w");
  }
  await expect(page.locator("#scene")).toHaveAttribute("data-room", "bathroom");
  await expect(page.locator("#spot-label")).toHaveText("Bathroom");

  // Solid wall beside doorway blocks walking through walls
  await page.evaluate(() => {
    window.__livingBlueprint.getScene().setEyePose(-3.0, 0.2, 0);
  });
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("w");
  }
  await expect(page.locator("#scene")).toHaveAttribute(
    "data-room",
    "living-room",
  );

  // Verify locked fixtures cannot be edited while movable furniture still rotates
  await page.locator('[data-item="fixture-bathroom-toilet"]').click();
  await expect(page.locator("#objectbar")).toContainText("Locked");
  await expect(page.locator("[data-action=remove]")).toHaveCount(0);

  await page.locator("#edit-text").fill("remove the toilet");
  await page.locator("#edit-request button").click();
  await expect(page.locator("#edit-result")).toContainText("locked");

  await page.locator('[data-item="home-chair"]').click();
  const beforeChair = await page.evaluate(
    () =>
      window.__livingBlueprint
        .getState()
        .items.find((i) => i.id === "home-chair").rotation,
  );
  await page.locator("[data-action=rotate]").click();
  const afterChair = await page.evaluate(
    () =>
      window.__livingBlueprint
        .getState()
        .items.find((i) => i.id === "home-chair").rotation,
  );
  expect(afterChair).toBe((beforeChair + 90) % 360);

  expect(errors).toEqual([]);
});

test("sample floorplan imports into House JSON and renders as a connected 3D whole-home with locked fixtures, Orbit, and WASD room navigation", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.locator("#try-sample-floorplan").click();
  await expect(page.locator("#fp-status-card")).toContainText(
    "Floorplan analyzed",
  );
  await page.locator("#fp-confirm-import").click();

  await expect(page.locator("body")).toHaveAttribute("data-stage", "household");
  await page.locator("#skip-household").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "design");
  await expect(page.locator("#scene canvas")).toHaveAttribute(
    "data-engine",
    /three/i,
  );
  await expect(page.locator("#studio .subtitle")).toContainText("5 rooms imported");
  await expect(page.locator("#studio .subtitle")).toContainText("Living Room");
  await expect(page.locator("#studio .subtitle")).toContainText("Kitchen");
  await expect(page.locator("#studio .subtitle")).toContainText("Bedroom");
  await expect(page.locator("#studio .subtitle")).toContainText("Bathroom");

  const confirmedHouse = await page.evaluate(() =>
    window.getConfirmedImportedHouse(),
  );
  expect(confirmedHouse.units).toBe("meters");
  expect(confirmedHouse.rooms).toHaveLength(5);
  expect(confirmedHouse.fixtures).toHaveLength(7);

  // Auto-style places movable furniture while keeping all 7 imported locked fixtures
  await page.locator("#generate").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");

  const stateAfterStyle = await page.evaluate(() =>
    window.__livingBlueprint.getState(),
  );
  const lockedFixtures = stateAfterStyle.items.filter(
    (i) => i.type === "fixed" && i.locked,
  );
  expect(lockedFixtures).toHaveLength(7);
  expect(stateAfterStyle.items.length).toBeGreaterThan(7);

  // Test Orbit mode on imported 3D house
  await page.locator("#view-3d").click();
  await expect(page.locator("#view-label")).toHaveText("Perspective");
  const canvas = page.locator("#scene canvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.52, {
    steps: 4,
  });
  await page.mouse.up();

  // Switch to First-Person Interior and walk across Mercer Street Apartment rooms via W/A/S/D
  await page.locator("#view-interior").click();
  await expect(page.locator("#view-label")).toHaveText("Interior view");

  // Hallway -> Living Room through door-living-hall at (2.4, 4.2)
  await page.evaluate(() => {
    window.__livingBlueprint.getScene().setEyePose(2.4, 4.75, 0);
  });
  await expect(page.locator("#scene")).toHaveAttribute("data-room", "hallway");
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("w");
  }
  await expect(page.locator("#scene")).toHaveAttribute(
    "data-room",
    "living-room",
  );

  // Living Room -> Kitchen through door-living-kitchen at (5.8, 2.3)
  await page.evaluate(() => {
    window.__livingBlueprint.getScene().setEyePose(5.1, 2.3, Math.PI / 2);
  });
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("w");
  }
  await expect(page.locator("#scene")).toHaveAttribute("data-room", "kitchen");

  // Hallway -> Bedroom through door-bedroom at (3.2, 5.4) walking South (+Z, yaw = Math.PI)
  await page.evaluate(() => {
    window.__livingBlueprint.getScene().setEyePose(3.2, 4.8, Math.PI);
  });
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("w");
  }
  await expect(page.locator("#scene")).toHaveAttribute("data-room", "bedroom");

  // Hallway -> Bathroom through door-bathroom at (6.8, 4.8) walking East (+X, yaw = Math.PI / 2)
  await page.evaluate(() => {
    window.__livingBlueprint.getScene().setEyePose(6.1, 4.8, Math.PI / 2);
  });
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("w");
  }
  await expect(page.locator("#scene")).toHaveAttribute("data-room", "bathroom");

  expect(errors).toEqual([]);
});
