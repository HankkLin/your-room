import { test, expect } from "@playwright/test";

test("3D simulation playback renders real avatars, pause/resume/speed/scrubber, clickable finding hotspots & sightlines, 10-guest party, fire evacuation, Before/After layout toggle, and clean reset", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.route("**/api/redesign/propose", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        patch: {
          id: "e2e-playback-patch",
          reasoning:
            "Move breakfast table into clear northwest kitchen corner and remove extra chair.",
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
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");

  // 1. Select Morning Routine at 1x speed and click Run Simulation
  await page.locator("#sim-scenario").selectOption("morning-routine");
  await page.locator('[data-sim-speed="1"]').click();
  await page.locator("#sim-run-btn").click();

  // 2. Verify Kevin & Alice real avatars spawn in 3D scene and clock advances (no mock badge)
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

  // 3. Click Pause -> verify PAUSED and Resume button label -> click Resume at 20x
  await page.locator("#sim-pause-btn").click();
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "PAUSED",
  );
  await expect(page.locator("#sim-run-btn")).toHaveText("Resume");

  await page.locator('[data-sim-speed="20"]').click();
  await page.locator("#sim-run-btn").click();

  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "COMPLETE",
  );

  // 4. Verify timeline scrubber & route toggle exist and work
  const scrubber = page.locator("#sim-scrubber");
  await expect(scrubber).toBeVisible();
  await page.locator("#sim-toggle-routes").check();

  // 5. Verify real Findings & measured evidence chips render
  const congestionCard = page
    .locator('#sim-findings-list [data-finding-type="CONGESTION"]')
    .first();
  await expect(congestionCard).toBeVisible();
  await expect(congestionCard).toContainText("Kitchen congestion");
  await expect(congestionCard).toContainText("2 people");

  const privacyCard = page
    .locator('#sim-findings-list [data-finding-type="PRIVACY_SIGHTLINE"]')
    .first();
  await expect(privacyCard).toBeVisible();
  await expect(privacyCard).toContainText("sightline");

  const completeStats = await page.evaluate(() =>
    window.__stillroom.getScene().getPlaybackStats(),
  );
  expect(completeStats.overlayCount).toBeGreaterThanOrEqual(3);

  // 6. Click Kitchen congestion card -> focuses hotspot & related avatars
  await congestionCard.click();
  await expect(congestionCard).toHaveAttribute("aria-pressed", "true");

  // 7. Run Gemini redesign and toggle Before / After layout preview in 3D scene
  const beforeMovScoreText = await page
    .locator('#sim-scorecard [data-score-category="movement"] .twin-score-value')
    .textContent();
  const beforeApproval = await page.evaluate(() => JSON.parse(localStorage.getItem("stillroom.project.v1")));
  await page.locator("#sim-propose-redesign-btn").click();
  await expect(page.locator("#sim-approve-redesign")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("stillroom.project.v1")))).toEqual(beforeApproval);
  await page.locator("#sim-approve-redesign").click();
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "COMPLETE",
  );

  const afterBtn = page.locator('[data-layout-view="after"]');
  await expect(afterBtn).toBeVisible();
  await expect(afterBtn).toHaveAttribute("aria-pressed", "true");
  const afterMovScoreText = await page
    .locator('#sim-scorecard [data-score-category="movement"] .twin-score-value')
    .textContent();
  expect(Number(afterMovScoreText)).toBeGreaterThan(Number(beforeMovScoreText));

  await page.locator('[data-layout-view="before"]').click();
  await expect(
    page.locator('#sim-scorecard [data-score-category="movement"] .twin-score-value'),
  ).toHaveText(String(beforeMovScoreText));

  await afterBtn.click();
  await expect(
    page.locator('#sim-scorecard [data-score-category="movement"] .twin-score-value'),
  ).toHaveText(String(afterMovScoreText));

  // 8. Dinner Party — 8 Guests renders 10 concurrent avatars smoothly
  await page.locator("#sim-scenario").selectOption("dinner-party-8-guests");
  await page.locator('[data-sim-speed="20"]').click();
  await page.locator("#sim-run-btn").click();
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "COMPLETE",
  );
  const partyStats = await page.evaluate(() =>
    window.__stillroom.getScene().getPlaybackStats(),
  );
  expect(partyStats.avatarCount).toBe(10);

  // 9. Fire Emergency renders evacuation paths and exit bottleneck evidence
  await page.locator("#sim-scenario").selectOption("fire-emergency");
  await page.locator("#sim-run-btn").click();
  await expect(page.locator("#sim-status")).toHaveAttribute(
    "data-status",
    "COMPLETE",
  );
  await expect(page.locator("#sim-findings-list")).toContainText(
    "2 converging",
  );
  await expect(page.locator("#sim-findings-list")).toContainText(
    "0.96 m exit width",
  );

  // 10. Reset removes all avatars, routes, and finding overlays cleanly
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

  // 11. Verify 360° Orbit & First-Person WASD remain unbroken
  const canvasBox = await page.locator("#scene canvas").boundingBox();
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.5,
    canvasBox.y + canvasBox.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.62,
    canvasBox.y + canvasBox.height * 0.46,
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
