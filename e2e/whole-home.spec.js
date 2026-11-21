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
  await expect(page.locator(".subtitle")).toContainText("Living Room");
  await expect(page.locator(".subtitle")).toContainText("Kitchen");
  await expect(page.locator(".subtitle")).toContainText("Bedroom");
  await expect(page.locator(".subtitle")).toContainText("Bathroom");

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("stillroom.project.v1")),
  );
  expect(stored.house.rooms.map((r) => r.id)).toEqual([
    "living-room",
    "kitchen",
    "bedroom",
    "bathroom",
  ]);
  expect(stored.items.some((i) => i.kind === "toilet" && i.locked)).toBe(true);
  expect(stored.items.some((i) => i.kind === "counter" && i.locked)).toBe(true);

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

  // Position in Living Room facing East (+X, yaw = Math.PI / 2 -> eye.rotation.y = -Math.PI / 2) aligned with Kitchen doorway (z = 1.8)
  await page.evaluate(() => {
    window.__stillroom.getScene().setEyePose(0.5, 1.8, Math.PI / 2);
  });
  await expect(page.locator("#scene")).toHaveAttribute(
    "data-room",
    "living-room",
  );
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("w");
  }
  await expect(page.locator("#scene")).toHaveAttribute("data-room", "kitchen");
  await expect(page.locator("#spot-label")).toHaveText("Kitchen");

  // Walk from Living Room North (-Z, yaw = 0) through Bedroom doorway (x = -1.3, z = -0.4) into Bedroom
  await page.evaluate(() => {
    window.__stillroom.getScene().setEyePose(-1.3, 0.3, 0);
  });
  await expect(page.locator("#scene")).toHaveAttribute(
    "data-room",
    "living-room",
  );
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("w");
  }
  await expect(page.locator("#scene")).toHaveAttribute("data-room", "bedroom");
  await expect(page.locator("#spot-label")).toHaveText("Bedroom");

  // Walk East (+X, yaw = Math.PI / 2) from Bedroom through Bathroom doorway (x = 0.2, z = -1.25) into Bathroom
  await page.evaluate(() => {
    window.__stillroom.getScene().setEyePose(-0.5, -1.25, Math.PI / 2);
  });
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("w");
  }
  await expect(page.locator("#scene")).toHaveAttribute("data-room", "bathroom");
  await expect(page.locator("#spot-label")).toHaveText("Bathroom");

  // Verify solid wall beside doorway blocks walking through walls
  await page.evaluate(() => {
    window.__stillroom.getScene().setEyePose(-3.0, 0.2, 0);
  });
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("w");
  }
  // Should remain in Living Room (z > -0.4) instead of passing through solid Bedroom wall
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
      window.__stillroom
        .getState()
        .items.find((i) => i.id === "home-chair").rotation,
  );
  await page.locator("[data-action=rotate]").click();
  const afterChair = await page.evaluate(
    () =>
      window.__stillroom
        .getState()
        .items.find((i) => i.id === "home-chair").rotation,
  );
  expect(afterChair).toBe((beforeChair + 90) % 360);

  expect(errors).toEqual([]);
});
