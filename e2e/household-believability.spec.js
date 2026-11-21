import { expect, test } from "@playwright/test";

test("Household believability: Family of 4 heights, slow continuous 1x walking (no teleport), Grandparents wheelchair accessibility findings, staged Friends waves, and demoHooks checkpoints", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Start from imported Mercer Street sample floorplan (which has a 0.76 m bathroom door -> triggers real wheelchair findings!)
  await page.goto("/");
  await page.locator("#try-sample-floorplan").click();
  await expect(page.locator("#fp-status-card")).toContainText("Floorplan analyzed");
  await page.locator("#fp-confirm-import").click();
  await page.locator("#skip-household").click();
  await page.locator("#tour-step").click();
  await page.locator("#view-3d").click();

  // 1. Canonical Family of Four rendered in Household summary
  const personaSummary = page.locator("#sim-persona-summary");
  await expect(personaSummary).toContainText("Kevin (Dad)");
  await expect(personaSummary).toContainText("Alice (Mom)");
  await expect(personaSummary).toContainText("Leo (Brother)");
  await expect(personaSummary).toContainText("Maya (Sister)");

  // 2. Run Morning Routine at 1x -> verify slow, readable continuous time flow & checkpoint hooks
  await page.locator("#sim-scenario").selectOption("morning-routine");
  await page.locator('[data-sim-speed="1"]').click();
  await page.locator("#sim-run-btn").click();
  await expect(page.locator("#sim-status")).toHaveAttribute("data-status", "RUNNING");

  // Jump via `window.__stillroom.demoHooks` right before Dad walks to bathroom (07:12 = 432 min = 25920s)
  const walkMotion = await page.evaluate(async () => {
    const pb = window.__stillroom.playbackController;
    pb.seek(432 * 60 + 0.5);
    pb.play();
    const posA = window.__stillroom
      .getScene()
      .getAvatarPosition?.("kevin") ?? null;
    const secA = pb.getState().currentSecond;
    await new Promise((r) => setTimeout(r, 350));
    const secB = pb.getState().currentSecond;
    const checkpoints = window.__stillroom.demoHooks.getCheckpoints();
    return {
      posA,
      deltaSimSec: secB - secA,
      statusAfter350ms: pb.getState().status,
      checkpointTypes: checkpoints.map((c) => c.type),
    };
  });

  // At 1x during active walking (~3.2 sim s / real s), 350ms advances ~0.8–3.0 sim seconds (NOT 100+ seconds!) and stays RUNNING
  expect(walkMotion.statusAfter350ms).toBe("RUNNING");
  expect(walkMotion.deltaSimSec).toBeGreaterThan(0.2);
  expect(walkMotion.deltaSimSec).toBeLessThan(8.0);
  expect(walkMotion.checkpointTypes).toContain("MORNING_START");
  expect(walkMotion.checkpointTypes).toContain("BATHROOM_CONFLICT");

  // Click checkpoint pill to jump & pause cleanly
  await page
    .locator('#sim-checkpoints [data-checkpoint-type="BATHROOM_CONFLICT"]')
    .click();
  await expect(page.locator("#sim-status")).toHaveAttribute("data-status", "PAUSED");

  // 3. Switch to Grandparents Visit — Accessibility and run at 20x
  await page.locator("#sim-scenario").selectOption("grandparents-visit");
  await page.locator('[data-sim-speed="20"]').click();
  await page.locator("#sim-run-btn").click();
  await expect(page.locator("#sim-status")).toHaveAttribute("data-status", "COMPLETE");

  // Verify 6 avatars (4 family + Grandpa in wheelchair + Grandma) and structured accessibility findings
  await expect(
    page.locator('#sim-findings-list [data-finding-type="ACCESSIBILITY_CLEARANCE_FAIL"]').first(),
  ).toBeVisible();
  await expect(
    page.locator('#sim-findings-list [data-finding-type="ACCESSIBILITY_ROUTE_BLOCKED"]').first(),
  ).toBeVisible();
  await expect(page.locator("#sim-findings-list")).toContainText("0.76 m width");
  await expect(page.locator("#sim-findings-list")).toContainText("Wheelchair blocked");

  // Jump to WHEELCHAIR_ACCESS_CHECK checkpoint via controllable demo hook
  const gpJump = await page.evaluate(() =>
    window.__stillroom.demoHooks.jumpToCheckpoint("WHEELCHAIR_ACCESS_CHECK"),
  );
  expect(gpJump?.type).toBe("WHEELCHAIR_ACCESS_CHECK");

  // 4. Switch to Friends Arrive — Staged Crowd and verify 12 avatars & staged arrival checkpoint
  await page.locator("#sim-scenario").selectOption("friends-arrival");
  await page.locator('[data-sim-speed="20"]').click();
  await page.locator("#sim-run-btn").click();
  await expect(page.locator("#sim-status")).toHaveAttribute("data-status", "COMPLETE");

  const crowdStats = await page.evaluate(() =>
    window.__stillroom.getScene().getPlaybackStats(),
  );
  expect(crowdStats.avatarCount).toBe(12);
  await expect(
    page.locator('#sim-checkpoints [data-checkpoint-type="FRIENDS_ARRIVE"]'),
  ).toBeVisible();

  expect(errors).toEqual([]);
});
