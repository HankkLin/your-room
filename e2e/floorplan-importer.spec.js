import { expect, test } from "@playwright/test";

const household = (page) => page.locator("#household-page");
const project = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("living-blueprint.project.v1")));

async function skipHousehold(page) {
  await expect(household(page)).toBeVisible();
  await household(page).getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "design");
}

test("whole-home sample floorplan imports, supports manual review/calibration, and exposes validated House JSON", async ({
  page,
}) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/");
  await expect(page.locator("#setup-page")).toBeVisible();

  await page.locator("#try-sample-floorplan").click();
  await expect(page.locator("#fp-status-card")).toContainText(
    "Floorplan analyzed",
  );
  await expect(page.locator("#fp-stats")).toContainText("5");
  await expect(page.locator("#fp-stats")).toContainText("rooms detected");
  await expect(page.locator("#fp-stats")).toContainText("6");
  await expect(page.locator("#fp-stats")).toContainText("4");
  await expect(page.locator("#fp-stats")).toContainText("7");
  await expect(page.locator("#fp-scale-status")).toContainText(
    "printed_dimension",
  );

  // Inspect Debug JSON view during review
  await page.locator("#fp-view-json").click();
  await expect(page.locator("#parsed-house-json")).toContainText(
    '"id": "mercer-apartment-sample"',
  );
  await page.locator("#close-modal").click();

  // Exercise manual correction layer (rename room)
  await page.locator("#fp-open-review").click();
  await page.locator('[data-room-rename="bedroom"]').fill("Primary Bedroom");

  // Confirm import and verify downstream House JSON contract
  await page.locator("#fp-confirm-import").click();
  await skipHousehold(page);
  await expect(page.locator("#view-house-json")).toBeVisible();

  const confirmedHouse = await page.evaluate(() =>
    window.getConfirmedImportedHouse(),
  );
  expect(confirmedHouse).toBeTruthy();
  expect(confirmedHouse.units).toBe("meters");
  expect(confirmedHouse.rooms).toHaveLength(5);
  expect(
    confirmedHouse.rooms.find((r) => r.id === "bedroom").name,
  ).toBe("Primary Bedroom");
  expect(confirmedHouse.doors).toHaveLength(6);
  expect(confirmedHouse.windows).toHaveLength(4);
  expect(confirmedHouse.fixtures).toHaveLength(7);
  expect(confirmedHouse.fixtures.every((f) => f.locked === true)).toBe(true);
  expect(confirmedHouse.adjacency.length).toBeGreaterThanOrEqual(5);

  // Verify View Parsed Geometry remains accessible in studio
  await page.locator("#view-house-json").click();
  await expect(page.locator("#parsed-house-json")).toContainText(
    "Primary Bedroom",
  );
  await page.locator("#close-modal").click();

  // Reopen a home saved under the project's previous name.
  await page.evaluate(() => {
    for (const suffix of ["project.v1", "importedHouse.v1"]) {
      const key = `living-blueprint.${suffix}`;
      const saved = localStorage.getItem(key);
      if (saved === null) throw new Error(`Missing fixture: ${key}`);
      localStorage.setItem(`stillroom.${suffix}`, saved);
      localStorage.removeItem(key);
    }
  });
  await page.reload();
  await expect(page.locator("#view-house-json")).toBeVisible();
  const restored = await project(page);
  expect(restored.importedHouse).toEqual(confirmedHouse);
  const restoredHouse = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("living-blueprint.importedHouse.v1")),
  );
  expect(restoredHouse).toEqual(confirmedHouse);

  expect(pageErrors).toEqual([]);
});

test("uploaded floorplan without printed scale requires two-point calibration before confirming", async ({
  page,
}) => {
  await page.route("**/api/floorplan/analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "uploaded-uncalibrated-home",
        name: "Uploaded Two-Room Plan",
        confidence: 0.82,
        warnings: ["Bathroom west wall partially obscured."],
        printedDimensions: [],
        rooms: [
          {
            id: "living-room",
            name: "Living Room",
            kind: "living",
            polygonPx: [
              [60, 60],
              [360, 60],
              [360, 300],
              [60, 300],
            ],
            confidence: 0.88,
          },
          {
            id: "kitchen",
            name: "Kitchen",
            kind: "kitchen",
            polygonPx: [
              [360, 60],
              [560, 60],
              [560, 300],
              [360, 300],
            ],
            confidence: 0.84,
          },
        ],
        doors: [
          {
            id: "door-1",
            kind: "interior",
            roomA: "living-room",
            roomB: "kitchen",
            positionPx: [360, 180],
            widthPx: 60,
            confidence: 0.85,
          },
        ],
        windows: [
          {
            id: "win-1",
            roomId: "living-room",
            positionPx: [210, 60],
            widthPx: 110,
            confidence: 0.78,
          },
        ],
        fixtures: [
          {
            id: "fix-sink",
            kind: "sink",
            name: "Kitchen Sink",
            roomId: "kitchen",
            positionPx: [460, 100],
            widthPx: 50,
            depthPx: 45,
            confidence: 0.86,
          },
        ],
      }),
    });
  });

  await page.goto("/");
  await page
    .locator("#floorplan-upload")
    .setInputFiles("public/assets/sample-capture.jpg");

  await expect(page.locator("#fp-scale-status")).toContainText(
    "Calibration required",
  );
  await expect(page.locator("#fp-confirm-import")).toBeDisabled();

  // Select two points on the SVG overlay and calibrate using feet & inches
  const svg = page.locator("#fp-overlay-svg");
  const box = await svg.boundingBox();
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.2);

  await page.locator("#fp-cal-unit").selectOption("feet_inches");
  await page.locator("#fp-cal-feet").fill("16");
  await page.locator("#fp-cal-inches").fill("6");
  await page.locator("#fp-apply-calibration").click();

  await expect(page.locator("#fp-scale-status")).toContainText(
    "manual_calibration",
  );
  await expect(page.locator("#fp-confirm-import")).toBeEnabled();

  await page.locator("#fp-confirm-import").click();
  await skipHousehold(page);

  const house = await page.evaluate(() => window.getConfirmedImportedHouse());
  expect(house.calibration.source).toBe("manual_calibration");
  expect(house.rooms).toHaveLength(2);
  expect(house.fixtures[0].locked).toBe(true);
});

test("gracefully handles Gemini API failure with sample and manual calibration recovery", async ({
  page,
}) => {
  const analysisRequest = new Promise((resolve) => page.route("**/api/floorplan/analyze", resolve));
  await page.goto("/");
  await page.locator("#floorplan-upload").setInputFiles("public/assets/sample-capture.jpg");
  const route = await analysisRequest;
  const spinner = page.locator("#setup-page .image-processing");
  await expect(spinner).toHaveText("Analyzing floorplan…");
  await route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "Analysis unavailable." }),
  });
  await expect(spinner).toHaveCount(0);
  await expect(page.locator("#fp-analysis-failed")).toContainText(
    "Analysis failed.",
  );
  await expect(page.locator("#fp-fallback-sample")).toBeVisible();
  await expect(page.locator("#fp-fallback-retry")).toBeVisible();
  await expect(page.locator("#fp-fallback-manual")).toBeVisible();

  await page.locator("#fp-fallback-manual").click();
  await expect(page.locator("#fp-calibrate-panel")).toBeVisible();
  await page.locator("#fp-cal-distance").fill("6.4");
  await page.locator("#fp-apply-calibration").click();
  await expect(page.locator("#fp-confirm-import")).toBeEnabled();
});

test("a household uses imported room IDs and keeps destinations after room settings and reload", async ({ page }) => {
  const description = "Alex cooks in the Kitchen between 18:00 and 19:00.";
  const rooms = [
    { id: "living-room", name: "Living Room" },
    { id: "kitchen", name: "Kitchen" },
    { id: "hallway", name: "Hallway" },
    { id: "bedroom", name: "Bedroom" },
    { id: "bathroom", name: "Bathroom" },
  ];
  const draft = {
    id: "alex",
    name: "Alex",
    ageGroup: "adult",
    preferences: [],
    dislikes: [],
    needs: { privacy: 0.7, quiet: 0.9, accessibility: 0.1, daylight: 0.7, social: 0.3 },
    schedule: [
      { activity: "cook", roomId: "living-room", startMinute: 1080, endMinute: 1140 },
    ],
  };
  await page.route("**/api/personas/generate", (route) =>
    route.fulfill({ json: { personas: [draft] } }),
  );

  await page.goto("/");
  await page.locator("#try-sample-floorplan").click();
  await page.locator("#fp-confirm-import").click();
  await expect(household(page)).toBeVisible();
  const availableRooms = household(page).getByRole("listitem");
  await expect(availableRooms).toHaveText(rooms.map(({ name }) => name));
  await household(page).getByLabel("Household description").fill(description);
  const request = page.waitForRequest((item) => item.url().endsWith("/api/personas/generate"));
  await household(page).getByRole("button", { name: "Generate", exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ description, rooms });

  const destination = household(page).getByRole("combobox", { name: "Room", exact: true });
  await expect(destination).toHaveValue("living-room");
  await destination.selectOption("kitchen");
  await household(page).getByRole("button", { name: "Save and continue" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "design");
  const approved = await project(page);
  expect(approved.personas).toEqual([
    { ...draft, schedule: [{ ...draft.schedule[0], roomId: "kitchen" }] },
  ]);
  expect(approved.importedHouse.rooms.map(({ id, name }) => ({ id, name }))).toEqual(rooms);

  await page.reload();
  await expect(page.locator("#view-house-json")).toBeVisible();
  await page.locator("#room-settings").click();
  await expect(page.locator("#floorplan-upload")).toBeAttached();
  await page.locator("#edit-current-home").click();
  await page.locator("#setup-name").fill("Updated Mercer Apartment");
  await page.locator("#room-width").fill("6.6");
  await page.locator("#setup-next").click();
  await page.locator("#setup-next").click();
  await expect(page.locator("#room-name")).toHaveText("Updated Mercer Apartment");
  const edited = await project(page);
  expect(edited.room.width).toBe(6.6);
  expect(edited.importedHouse.rooms).toEqual(approved.importedHouse.rooms);
  expect(edited.personas).toEqual(approved.personas);

  await page.reload();
  await page.locator("#household-step").click();
  await expect(availableRooms).toHaveText(rooms.map(({ name }) => name));
  await expect(destination).toHaveValue("kitchen");
});
