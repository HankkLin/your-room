import { test, expect } from "@playwright/test";

test("whole-home demo controls drive scenario selection, speed, Running -> Complete mock flow, findings, Before/After scores, and preserve 3D Orbit + WASD", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.locator("#whole-home-demo").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");

  // Control panel is visible in sidebar and does NOT overlap the 3D scene canvas
  const controlCard = page.locator("#demo-controls-panel .twin-control-card");
  const canvas = page.locator("#scene canvas");
  await expect(controlCard).toBeVisible();
  await expect(canvas).toBeVisible();

  const canvasBox = await canvas.boundingBox();
  const cardBox = await controlCard.boundingBox();
  const overlapsCanvas =
    cardBox.x < canvasBox.x + canvasBox.width - 2 &&
    cardBox.x + cardBox.width > canvasBox.x + 2 &&
    cardBox.y < canvasBox.y + canvasBox.height - 2 &&
    cardBox.y + cardBox.height > canvasBox.y + 2;
  expect(overlapsCanvas).toBe(false);

  // Persona quick view renders pre-loaded household members
  await expect(page.locator("#sim-persona-summary")).toContainText("Kevin");
  await expect(page.locator("#sim-persona-summary")).toContainText(
    "WFH • Quiet preferred",
  );
  await expect(page.locator("#sim-persona-summary")).toContainText("Alice");

  // Initial empty state
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "READY",
  );
  await expect(page.locator("#sim-findings-empty")).toBeVisible();
  await expect(page.locator("#sim-before-after-empty")).toBeVisible();

  // Select speed 5x and scenario Morning Routine, then click Run Simulation
  await page.locator('[data-sim-speed="5"]').click();
  await expect(page.locator('[data-sim-speed="5"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#sim-scenario").selectOption("morning-routine");
  await page.locator("#sim-run-btn").click();

  // Transitions to COMPLETE with findings, scorecard, Before/After, and Gemini redesign actions
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "COMPLETE",
  );
  await expect(page.locator("#sim-run-btn")).toHaveText("Run Again");
  await expect(page.locator("#sim-findings-list")).toContainText(
    "Kitchen congestion",
  );
  await expect(page.locator("#sim-findings-list")).toContainText(
    "WFH noise conflict",
  );
  await expect(page.locator("#sim-findings-list")).toContainText(
    "Bedroom route clear",
  );

  // Verify Before -> After improvements render clearly
  const movementRow = page.locator('[data-compare-category="movement"]');
  await expect(movementRow).toContainText("64");
  await expect(movementRow).toContainText("91");
  await expect(movementRow).toContainText("+27");

  const noiseRow = page.locator('[data-compare-category="noise"]');
  await expect(noiseRow).toContainText("55");
  await expect(noiseRow).toContainText("84");
  await expect(noiseRow).toContainText("+29");

  await expect(page.locator("#sim-redesign-list")).toContainText(
    "Moved desk away from TV noise",
  );

  // Switch scenario to Dinner Party — 8 Guests and run at 20x
  await page.locator("#sim-scenario").selectOption("dinner-party-8-guests");
  await page.locator('[data-sim-speed="20"]').click();
  await page.locator("#sim-run-btn").click();
  await expect(page.locator("#sim-findings-list")).toContainText(
    "Severe doorway bottleneck",
  );

  // Reset restores READY empty state cleanly
  await page.locator("#sim-reset-btn").click();
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "READY",
  );
  await expect(page.locator("#sim-findings-empty")).toBeVisible();

  // Confirm 3D Orbit and First-Person WASD still work cleanly alongside the panel
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.5,
    canvasBox.y + canvasBox.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.6,
    canvasBox.y + canvasBox.height * 0.48,
    { steps: 4 },
  );
  await page.mouse.up();

  await page.locator("#view-interior").click();
  await page.evaluate(() => {
    window.__stillroom.getScene().setEyePose(0.5, 1.8, Math.PI / 2);
  });
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("w");
  }
  await expect(page.locator("#scene")).toHaveAttribute("data-room", "kitchen");

  expect(errors).toEqual([]);
});
