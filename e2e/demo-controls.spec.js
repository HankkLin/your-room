import { setPlaybackSpeed } from "./playback-speed.js";
import { test, expect } from "@playwright/test";

test("whole-home demo controls drive real scenario selection, speed, Running -> Complete simulation, real findings, Gemini redesign Before/After scores, and preserve 3D Orbit + WASD", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Deterministically mock Gemini redesign endpoint in automated E2E
  await page.route("**/api/redesign/propose", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        patch: {
          id: "e2e-demo-patch",
          reasoning:
            "Relocate breakfast table into clear northwest kitchen corner and remove extra chair crowding the sink.",
          targetFindings: ["CONGESTION:kitchen"],
          operations: [
            {
              type: "move",
              objectId: "kitchen-table-1",
              position: [2.35, 0, 0.35],
              rotation: [0, 0, 0],
            },
            {
              type: "remove",
              objectId: "kitchen-chair-1",
            },
          ],
        },
      }),
    });
  });

  await page.goto("/");
  await page.locator("#whole-home-demo").click();
  await page.locator("#save-household").click();
  await page.locator("#tour-step").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");

  // The saved-household comparison and scenario controls share the live tour.
  await expect(page.locator("#studio-replay-panel")).toBeVisible();

  // Control panel is visible in sidebar and does NOT overlap the 3D scene canvas
  const controlCard = page.locator("#demo-controls-panel .twin-control-card");
  const canvas = page.locator("#scene canvas");
  await expect(controlCard).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(page.locator(".twin-mock-badge")).toHaveCount(0);

  const canvasBox = await canvas.boundingBox();
  const cardBox = await controlCard.boundingBox();
  const overlapsCanvas =
    cardBox.x < canvasBox.x + canvasBox.width - 2 &&
    cardBox.x + cardBox.width > canvasBox.x + 2 &&
    cardBox.y < canvasBox.y + canvasBox.height - 2 &&
    cardBox.y + cardBox.height > canvasBox.y + 2;
  expect(overlapsCanvas).toBe(false);

  // Persona quick view renders valid pre-loaded household members
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

  // Select speed 20x and scenario Morning Routine, then click Run Simulation
  await setPlaybackSpeed(page, 20);
  await expect(page.locator("#sim-speed-value")).toHaveText("20×");
  await page.locator("#sim-scenario").selectOption("morning-routine");
  await page.locator("#sim-play-toggle").click();

  // Transitions to COMPLETE with real findings and real scorecard (no mock badge)
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "COMPLETE",
    { timeout: 20000 },
  );
  await expect(page.locator(".twin-mock-badge")).toHaveCount(0);
  await expect(page.locator("#sim-play-toggle")).toHaveAccessibleName("Run Again");
  await expect(page.locator("#sim-findings-list")).toContainText(
    "Kitchen congestion",
  );
  await expect(page.locator("#sim-findings-list")).toContainText(
    "Bathroom privacy sightline",
  );

  // Click Propose Gemini Redesign -> applies ScenePatch, replays, and shows Before -> After improvement
  const beforeApproval = await page.evaluate(() => JSON.parse(localStorage.getItem("living-blueprint.project.v1")));
  await page.locator("#sim-propose-redesign-btn").click();
  await expect(page.locator("#sim-approve-redesign")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("living-blueprint.project.v1")))).toEqual(beforeApproval);
  // Leaving the captured scenario invalidates its pending operations.
  await page.locator("#sim-scenario").selectOption("dinner-party-8-guests");
  await expect(page.locator("#sim-approve-redesign")).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("living-blueprint.project.v1")))).toEqual(beforeApproval);
  await page.locator("#sim-scenario").selectOption("morning-routine");
  await page.locator("#sim-play-toggle").click();
  await expect(page.locator("#sim-status")).toHaveAttribute("data-status", "COMPLETE", { timeout: 20000 });
  await page.locator("#sim-propose-redesign-btn").click();
  await page.locator("#sim-approve-redesign").click();
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "COMPLETE",
    { timeout: 20000 },
  );
  const movementRow = page.locator('[data-compare-category="movement"]');
  await expect(movementRow).toContainText("+");
  await expect(page.locator("#sim-redesign-list")).toContainText("Breakfast Bistro Table");

  // Switch scenario to Dinner Party — 8 Guests and run at 20x
  await page.locator("#sim-scenario").selectOption("dinner-party-8-guests");
  await setPlaybackSpeed(page, 20);
  await page.locator("#sim-play-toggle").click();
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "COMPLETE",
    { timeout: 20000 },
  );
  await expect(page.locator("#sim-findings-list")).toContainText(/congestion/i);
  await expect(page.locator("#sim-propose-redesign-btn")).toHaveCount(0);

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
    window.__livingBlueprint.getScene().setEyePose(0.5, 1.8, Math.PI / 2);
  });
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("w");
  }
  await expect(page.locator("#scene")).toHaveAttribute("data-room", "kitchen");

  expect(errors).toEqual([]);
});
