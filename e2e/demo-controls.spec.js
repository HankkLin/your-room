import { test, expect } from "@playwright/test";

test("whole-home demo controls drive real Morning Routine simulation without mock badges, support mock stress fallback Before/After, and preserve 3D Orbit + WASD", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.locator("#whole-home-demo").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");

  // Only ONE simulation control/results UI is visible (retired #studio-replay-panel stays hidden)
  const controlCard = page.locator("#demo-controls-panel .twin-control-card");
  const canvas = page.locator("#scene canvas");
  await expect(controlCard).toBeVisible();
  await expect(page.locator("#studio-replay-panel")).toBeHidden();
  await expect(canvas).toBeVisible();

  const canvasBox = await canvas.boundingBox();
  const cardBox = await controlCard.boundingBox();
  const overlapsCanvas =
    cardBox.x < canvasBox.x + canvasBox.width - 2 &&
    cardBox.x + cardBox.width > canvasBox.x + 2 &&
    cardBox.y < canvasBox.y + canvasBox.height - 2 &&
    cardBox.y + cardBox.height > canvasBox.y + 2;
  expect(overlapsCanvas).toBe(false);

  // Persona quick view renders valid household members
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

  // Select speed 20x and scenario Morning Routine, then click Run Simulation (REAL engine)
  await page.locator('[data-sim-speed="20"]').click();
  await expect(page.locator('[data-sim-speed="20"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#sim-scenario").selectOption("morning-routine");
  await page.locator("#sim-run-btn").click();

  // Transitions to COMPLETE with REAL deterministic findings, NO mock badge, and Ready for redesign status
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "COMPLETE",
  );
  await expect(page.locator(".twin-mock-badge")).toHaveCount(0);
  await expect(page.locator("#sim-run-btn")).toHaveText("Run Again");
  await expect(page.locator("#sim-findings-list")).toContainText(
    "Kitchen congestion",
  );
  await expect(page.locator("#sim-redesign-status")).toHaveText(
    "Ready for redesign",
  );
  await expect(
    page.locator('#sim-scorecard [data-score-category="movement"]'),
  ).toContainText("58");

  // Switch scenario to Dinner Party — 8 Guests (honestly badged as Demo mock until desktop stress hook merges)
  await page.locator("#sim-scenario").selectOption("dinner-party-8-guests");
  await page.locator('[data-sim-speed="20"]').click();
  await page.locator("#sim-run-btn").click();
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "COMPLETE",
  );
  await expect(page.locator(".twin-mock-badge").first()).toBeVisible();
  await expect(page.locator("#sim-findings-list")).toContainText(
    "Severe doorway bottleneck",
  );
  const movementRow = page.locator('[data-compare-category="movement"]');
  await expect(movementRow).toContainText("49");
  await expect(movementRow).toContainText("86");
  await expect(movementRow).toContainText("+37");

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
