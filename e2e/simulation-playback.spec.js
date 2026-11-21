import { test, expect } from "@playwright/test";

test("Whole-Home Demo runs real Morning Routine simulation with 3D Kevin & Alice avatars, pause/resume, clock, deterministic congestion hotspots, no mock badge, furniture capture on move, and clean reset", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.locator("#whole-home-demo").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
  await expect(page.locator("#studio-replay-panel")).toBeHidden();

  // Verify valid fallback personas exist with real room IDs
  const validRoomIds = await page.evaluate(() => {
    const s = window.__stillroom.getState();
    return s.personas.flatMap((p) => p.schedule.map((e) => e.roomId));
  });
  expect(validRoomIds).toContain("bedroom");
  expect(validRoomIds).toContain("kitchen");
  expect(validRoomIds).not.toContain("room-1");

  // 1. Select Morning Routine at 1x speed and click Run Simulation (REAL simulateHouse)
  await page.locator("#sim-scenario").selectOption("morning-routine");
  await page.locator('[data-sim-speed="1"]').click();
  await page.locator("#sim-run-btn").click();

  // 2. Verify real simulation starts, Kevin & Alice 3D avatars spawn, clock advances, and NO mock badge appears
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "RUNNING",
  );
  await expect(page.locator(".twin-mock-badge")).toHaveCount(0);
  const initialStats = await page.evaluate(() =>
    window.__stillroom.getScene().getPlaybackStats(),
  );
  expect(initialStats.avatarCount).toBe(2);
  await expect(page.locator("#sim-clock")).not.toHaveText("");

  // 3. Click Pause -> verify PAUSED and Resume button label -> speed up to 20x -> click Resume
  await page.locator("#sim-pause-btn").click();
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "PAUSED",
  );
  await expect(page.locator("#sim-run-btn")).toHaveText("Resume");

  await page.locator('[data-sim-speed="20"]').click();
  await page.locator("#sim-run-btn").click();

  // 4. Simulation completes -> no "Demo mock" badge -> deterministic Kitchen congestion finding & chips appear
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "COMPLETE",
  );
  await expect(page.locator(".twin-mock-badge")).toHaveCount(0);
  await expect(page.locator("#sim-scrubber")).toBeVisible();
  await page.locator("#sim-toggle-routes").check();

  const kitchenCard = page
    .locator("#sim-findings-list [data-finding-id]")
    .filter({ hasText: "Kitchen congestion" });
  await expect(kitchenCard).toBeVisible();
  await expect(kitchenCard).toContainText("2 people");
  await expect(kitchenCard).toContainText("29.9 min");
  await expect(kitchenCard).toContainText("0.25 m min clearance");

  const completeStats = await page.evaluate(() =>
    window.__stillroom.getScene().getPlaybackStats(),
  );
  expect(completeStats.overlayCount).toBeGreaterThanOrEqual(2);

  // Click Kitchen congestion card -> focuses hotspot & related avatars
  await kitchenCard.click();
  await expect(kitchenCard).toHaveAttribute("aria-pressed", "true");

  // 5. Move furniture in Studio -> verify captureCurrentHouse() reflects new coordinates
  await page.locator('#inventory [data-item="home-chair"]').click();
  await page.locator("#scene").press("ArrowLeft");
  const movedChairX = await page.evaluate(() => {
    const captured = window.__stillroom.captureCurrentHouse();
    return captured.objects.find((o) => o.id === "home-chair")?.x;
  });
  expect(movedChairX).toBeCloseTo(-0.25, 2);

  // 6. Stress scenarios (Dinner Party — 8 Guests & Fire Emergency) exercise 10-avatar, sightline, Before/After & evacuation overlays
  await page.locator("#sim-scenario").selectOption("dinner-party-8-guests");
  await page.locator('[data-sim-speed="20"]').click();
  await page.locator("#sim-run-btn").click();
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "COMPLETE",
  );
  await expect(page.locator(".twin-mock-badge").first()).toBeVisible();
  const partyStats = await page.evaluate(() =>
    window.__stillroom.getScene().getPlaybackStats(),
  );
  expect(partyStats.avatarCount).toBe(10);

  const afterBtn = page.locator('[data-layout-view="after"]');
  await expect(afterBtn).toBeVisible();
  await afterBtn.click();
  await expect(afterBtn).toHaveAttribute("aria-pressed", "true");

  await page.locator("#sim-scenario").selectOption("fire-emergency");
  await page.locator("#sim-run-btn").click();
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "COMPLETE",
  );
  await expect(page.locator("#sim-findings-list")).toContainText("2 converging");

  // 7. Reset removes all avatars, routes, and finding overlays cleanly
  await page.locator("#sim-reset-btn").click();
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "READY",
  );
  const resetStats = await page.evaluate(() =>
    window.__stillroom.getScene().getPlaybackStats(),
  );
  expect(resetStats.avatarCount).toBe(0);
  expect(resetStats.overlayCount).toBe(0);

  expect(errors).toEqual([]);
});
