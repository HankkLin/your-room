import { setPlaybackSpeed } from "./playback-speed.js";
import { expect, test } from "@playwright/test";

test("Golden Path E1–E10: Sample whole-home floorplan -> real Morning Routine -> avatars, findings & scorecard -> mocked Gemini self-correcting redesign -> Before/After 3D toggle -> shopping list preserves redesigned products", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // The saved catalog row receives its link only after an exact merchant refresh.
  await page.route("**/api/shopify/lookup", route => {
    const products = route.request().postDataJSON().refs.filter(ref => ref.variantId.endsWith("/41588406419527"))
      .map(ref => ({ ...ref, title: "Form Coffee Table, Small, American Walnut", merchant: "Sundays",
        storefrontUrl: "https://www.sundays-company.com", available: true, priceMinor: 67500, currency: "USD",
        productUrl: "https://www.sundays-company.com/products/form-coffee-table-walnut?variant=41588406419527" }));
    return route.fulfill({ json: { products } });
  });

  let redesignCallCount = 0;
  await page.route("**/api/redesign/propose", async (route) => {
    redesignCallCount += 1;
    if (redesignCallCount === 1) {
      // E9: Attempt 1 tries to mutate a locked bathroom fixture -> deterministically rejected by validator!
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          patch: {
            id: "gp-attempt-1-locked",
            reasoning: "Try moving fixed bathroom toilet.",
            targetFindings: ["PRIVACY_SIGHTLINE:bathroom"],
            operations: [
              {
                type: "move",
                objectId: "fixture-toilet",
                position: [7.8, 0, 5.2],
                rotation: [0, 0, 0],
              },
            ],
          },
        }),
      });
      return;
    }

    // E5 & E6: Attempt 2 replaces breakfast table with source-backed walnut-table in south dining zone, moves chair, and shifts bed out of doorway sightline
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        patch: {
          id: "gp-attempt-2-valid",
          reasoning:
            "Replace breakfast table with Form Coffee Table in clear south-central dining corner, relocate chair beside it, and shift primary bed away from bedroom doorway sightline.",
          targetFindings: ["CONGESTION:kitchen", "PRIVACY_SIGHTLINE:bedroom"],
          operations: [
            {
              type: "replace",
              objectId: "kitchen-table-1",
              productId: "walnut-table",
              position: [7.7, 0, 3.45],
              rotation: [0, 0, 0],
            },
            {
              type: "move",
              objectId: "kitchen-chair-1",
              position: [7.7, 0, 2.6],
              rotation: [0, 0, 0],
            },
            {
              type: "move",
              objectId: "bedroom-bed-1",
              position: [5.1, 0, 7.3],
              rotation: [0, 0, 0],
            },
          ],
        },
      }),
    });
  });

  // Step 1 & 2: Try sample whole-home floorplan -> Confirm
  await page.goto("/");
  await page.locator("#try-sample-floorplan").click();
  await expect(page.locator("#fp-status-card")).toContainText("Floorplan analyzed");
  await page.locator("#fp-confirm-import").click();

  // Skip custom persona authoring to exercise valid whole-home persona fallback (Kevin & Alice)
  await expect(page.locator("body")).toHaveAttribute("data-stage", "household");
  await page.locator("#skip-household").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "design");
  await page.locator("#tour-step").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");

  // Step 3 & 4: Whole-home 3D appears + Household personas and saved-routine controls available
  await page.locator("#view-3d").click();
  await expect(page.locator("#scene canvas")).toHaveAttribute("data-engine", /three/i);
  await expect(page.locator("#studio-replay-panel")).toBeVisible();
  await expect(page.locator("#sim-persona-summary")).toContainText("Sample simulation household");
  await expect(page.locator("#sim-persona-summary")).toContainText("Kevin");
  await expect(page.locator("#sim-persona-summary")).toContainText("Alice");
  await expect(page.locator("#sim-persona-summary")).toContainText("Leo");
  await expect(page.locator("#sim-persona-summary")).toContainText("Maya");

  const initialFixtureSnapshot = await page.evaluate(() =>
    window.__livingBlueprint
      .getState()
      .items.filter((i) => i.locked || i.type === "fixed")
      .map((i) => ({ id: i.id, x: i.x, z: i.z })),
  );
  expect(initialFixtureSnapshot).toHaveLength(7);

  // Step 5 & 6 (E1, E2): Run real Morning Routine -> Family of Four moves, no mock badge
  await page.locator("#sim-scenario").selectOption("morning-routine");
  await setPlaybackSpeed(page, 20);
  await page.locator("#sim-play-toggle").click();

  await expect(page.locator(".twin-mock-badge")).toHaveCount(0);
  await expect(page.locator("#sim-status")).toHaveAttribute("data-status", "COMPLETE", { timeout: 20000 });

  const avatarStats = await page.evaluate(() =>
    window.__livingBlueprint.getScene().getPlaybackStats(),
  );
  expect(avatarStats.avatarCount).toBe(4);

  // Step 7 & 8 (E3, E4): Kitchen congestion & Bedroom privacy findings appear + real scorecard values
  await expect(page.locator("#sim-findings-list")).toContainText("Kitchen congestion");
  await expect(page.locator("#sim-findings-list")).toContainText(
    "Bedroom privacy sightline",
  );
  const beforeMovementScore = Number(
    await page
      .locator('#sim-scorecard [data-score-category="movement"] .twin-score-value')
      .textContent(),
  );
  expect(beforeMovementScore).toBeGreaterThan(0);
  expect(beforeMovementScore).toBeLessThan(95);

  // Step 9–12 (E5, E6, E9): Click "Propose Gemini Redesign" -> Attempt 1 (locked toilet) rejected -> Attempt 2 accepted & applied
  const beforeApproval = await page.evaluate(() => JSON.parse(localStorage.getItem("living-blueprint.project.v1")));
  await page.locator("#sim-propose-redesign-btn").click();
  await expect(page.locator("#sim-approve-redesign")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("living-blueprint.project.v1")))).toEqual(beforeApproval);
  await page.locator("#sim-approve-redesign").click();
  await expect(page.locator('[data-layout-view="after"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sim-findings-list")).not.toContainText("Kitchen congestion");
  await expect(page.locator("#sim-status")).toHaveAttribute("data-status", "COMPLETE", { timeout: 20000 });
  expect(redesignCallCount).toBe(2);

  // Self-correction visibility rendered from actual attempts
  await expect(page.locator("#sim-attempt-trail")).toContainText(
    "Attempt 1 rejected — locked fixture protection",
  );
  await expect(page.locator("#sim-attempt-trail")).toContainText(
    "Gemini corrected the redesign",
  );
  await expect(page.locator("#sim-attempt-trail")).toContainText(
    "Attempt 2 accepted",
  );

  // Verify locked fixtures remained completely unchanged (E9) while movable table moved & updated product (E6)
  const afterState = await page.evaluate(() => window.__livingBlueprint.getState());
  const afterFixtureSnapshot = afterState.items
    .filter((i) => i.locked || i.type === "fixed")
    .map((i) => ({ id: i.id, x: i.x, z: i.z }));
  expect(afterFixtureSnapshot).toEqual(initialFixtureSnapshot);

  const updatedTable = afterState.items.find((i) => i.id === "kitchen-table-1");
  expect(updatedTable.productId).toBe("walnut-table");
  expect(updatedTable.x).toBeCloseTo(7.7, 1);
  expect(updatedTable.z).toBeCloseTo(3.45, 1);

  // Step 13–16 (E7, E8): Before/After scores differ, resolved findings disappear from active After findings & appear in Findings comparison
  const afterMovementScore = Number(
    await page
      .locator('#sim-scorecard [data-score-category="movement"] .twin-score-value')
      .textContent(),
  );
  expect(afterMovementScore).toBeGreaterThan(beforeMovementScore);
  await expect(page.locator("#sim-redesign-outcome")).toHaveText("The replay measured an improvement.");

  await expect(page.locator("#sim-findings-diff")).toContainText(
    "Kitchen congestion resolved",
  );
  await expect(page.locator("#sim-findings-diff")).toContainText(
    "Bedroom privacy sightline resolved",
  );
  await expect(page.locator("#sim-findings-list")).not.toContainText(
    "Kitchen congestion",
  );

  // Switch 3D Before / After toggle
  await page.locator('[data-layout-view="before"]').click();
  await expect(
    page.locator('#sim-scorecard [data-score-category="movement"] .twin-score-value'),
  ).toHaveText(String(beforeMovementScore));
  await page.locator('[data-layout-view="after"]').click();
  await expect(
    page.locator('#sim-scorecard [data-score-category="movement"] .twin-score-value'),
  ).toHaveText(String(afterMovementScore));

  // Step 17 (E10): Save room & review products preserves redesigned product metadata & merchant link
  await page.locator("#save-room").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "shop");
  const walnutCard = page
    .locator(".shop-card")
    .filter({ hasText: "Form Coffee Table, Small, American Walnut" });
  await expect(walnutCard).toBeVisible();
  await expect(walnutCard).toContainText("Sundays");
  await expect(
    walnutCard.getByRole("link", { name: /View product at Sundays/i }),
  ).toHaveAttribute("href", /sundays-company\.com.*variant=41588406419527/);

  expect(errors).toEqual([]);
});

test("Blueprint 8-Step Guided Workflow (U1, U5, U6, U7, U8, U9, U10): 8-step header nav, StyleBrief priority chips, Family of Four + Grandparents, Friends count control, region selection shortcut, Before/After redesign stepper, and Owned vs Merchant Shopify handoff", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // U1: 8-step Blueprint header navigation renders all 8 canonical steps
  const nav = page.locator("nav.bp-eight-nav");
  await expect(nav).toBeVisible();
  await expect(nav.locator("[data-bp-step]")).toHaveCount(8);
  await expect(nav.locator('[data-bp-step="1"]')).toHaveAttribute("aria-current", "step");

  // Step 1: Import sample whole-home floorplan -> Confirm
  await page.locator("#try-sample-floorplan").click();
  await expect(page.locator("#fp-status-card")).toContainText("Floorplan analyzed");
  await page.locator("#fp-confirm-import").click();

  // Step 2: Load canonical Family of Four + Grandparents (♿ Wheelchair)
  await expect(page.locator("body")).toHaveAttribute("data-stage", "household");
  await expect(nav.locator('[data-bp-step="2"]')).toHaveAttribute("aria-current", "step");
  await page.locator("#load-family-of-four").click();
  await page.locator("#add-grandparents-wheelchair").click();
  await expect(page.locator("#household-members .household-member")).toHaveCount(6);
  await page.locator("#save-household").click();

  // Step 3: StyleBrief priority chips update #brief cleanly
  await expect(page.locator("body")).toHaveAttribute("data-stage", "design");
  await expect(nav.locator('[data-bp-step="3"]')).toHaveAttribute("aria-current", "step");
  await page.locator('[data-brief-chip="wide step-free walkways"]').click();
  await expect(page.locator("#brief")).toHaveValue(/wide step-free walkways/);

  // Step 4: Jump directly to Your Furniture via Step 4 nav button, add an Owned piece & edit W (m)
  await page.locator("#furniture-step").click();
  await expect(nav.locator('[data-bp-step="4"]')).toHaveAttribute("aria-current", "step");
  await expect(page.locator("#furniture-photo-upload")).toBeAttached();
  await page.locator("#owned-kind").selectOption("chair");
  await page.locator("#add-owned").click();
  await page.locator("[data-name]").last().fill("Family heirloom armchair");
  await page.locator("#setup-next").click();

  // Step 6: Explore room + Select area / Draw region opens floorplan region editor immediately
  await page.locator("#tour-step").click();
  await expect(nav.locator('[data-bp-step="6"]')).toHaveAttribute("aria-current", "step");
  await expect(page.locator("#select-area-shortcut")).toBeVisible();
  await page.locator("#select-area-shortcut").click();
  await expect(page.locator("#studio-region-editor .region-map")).toBeVisible();

  // Step 7: Stress Test nav button -> Friends Are Coming card + friend count preset 12 (4 family + 12 friends -> crowd run)
  await page.locator("#stress-test-step").click();
  await expect(nav.locator('[data-bp-step="7"]')).toHaveAttribute("aria-current", "step");
  await page.locator('[data-scenario-card="friends-arrival"]').click();
  await expect(page.locator("#sim-friends-control")).toBeVisible();
  await page.locator('[data-friend-preset="12"]').click();
  await expect(page.locator("#sim-friends-count")).toHaveText("12");
  await setPlaybackSpeed(page, 20);
  await page.locator("#sim-play-toggle").click();
  await expect(page.locator("#sim-status")).toHaveAttribute("data-status", "COMPLETE", {
    timeout: 20000,
  });
  await expect(
    page.locator('#sim-checkpoints [data-checkpoint-type="FRIENDS_ARRIVE"]'),
  ).toBeVisible();

  // U8: Switch via visual card to Grandparents Staying Over -> accessibility banner + 5-step Gemini stepper
  await page.locator('[data-scenario-card="grandparents-visit"]').click();
  await setPlaybackSpeed(page, 20);
  await page.locator("#sim-play-toggle").click();
  await expect(page.locator("#sim-status")).toHaveAttribute("data-status", "COMPLETE", {
    timeout: 20000,
  });
  await expect(page.locator(".twin-accessibility-banner")).toBeVisible();
  await expect(page.locator("#sim-findings-list")).toContainText("0.76 m width");
  await expect(page.locator("#sim-redesign-stepper li")).toHaveCount(5);

  // U10: Step 8 Furnish & Buy separates Already owned ($0) from New products grouped by merchant
  await page.locator("#tray-review-products").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "shop");
  await expect(nav.locator('[data-bp-step="8"]')).toHaveAttribute("aria-current", "step");
  await expect(page.locator(".shop-owned-section")).toContainText("Already owned");
  await expect(page.locator(".shop-owned-section")).toContainText("Family heirloom armchair");
  await expect(page.locator("#shop-honesty-banner")).toBeVisible();

  expect(errors).toEqual([]);
});
