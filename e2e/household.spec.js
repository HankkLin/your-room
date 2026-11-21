import { expect, test } from "@playwright/test";

const endpoint = "**/api/personas/generate";
const description = "Alex works from 9 to 5 and Sam watches television at 4.";
const personas = [
  {
    id: "alex",
    name: "Alex",
    ageGroup: "adult",
    preferences: ["quiet workspace"],
    dislikes: [],
    needs: { privacy: 0.7, quiet: 0.9, accessibility: 0.1, daylight: 0.7, social: 0.3 },
    schedule: [{ activity: "work", roomId: "room-1", startMinute: 540, endMinute: 1020 }],
  },
  {
    id: "sam",
    name: "Sam",
    ageGroup: "adult",
    preferences: [],
    dislikes: [],
    needs: { privacy: 0.3, quiet: 0.4, accessibility: 0.1, daylight: 0.4, social: 0.6 },
    schedule: [{ activity: "watchTv", roomId: "room-1", startMinute: 960, endMinute: 1020 }],
  },
];

const savedPersonas = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("living-blueprint.project.v1")).personas);
const household = (page) => page.locator("#household-page");
const generateButton = (page) =>
  household(page).getByRole("button", { name: "Generate", exact: true });
const personName = (page) => household(page).getByLabel("Name", { exact: true }).first();

async function confirmRoom(page, name) {
  await page.locator("#custom-room").click();
  await page.locator("#setup-name").fill(name);
  await page.locator("#setup-next").click();
  await page.locator("#setup-next").click();
  await expect(household(page).getByRole("heading", { name: "Your household" })).toBeVisible();
}

async function createRoom(page) {
  await page.goto("/");
  await confirmRoom(page, "Reading room");
}

async function saveHousehold(page) {
  await household(page).getByRole("button", { name: "Save and continue" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "design");
}

test("a generated household can be edited, saved, and reopened after furnishing", async ({ page }) => {
  await page.route(endpoint, (route) => route.fulfill({ json: { personas } }));
  await createRoom(page);
  await expect(household(page)).toContainText("Reading room");
  await household(page).getByLabel("Household description").fill(description);
  const request = page.waitForRequest((candidate) => candidate.url().endsWith("/api/personas/generate"));
  await generateButton(page).click();
  const sent = await request;
  expect(sent.method()).toBe("POST");
  expect(sent.postDataJSON()).toEqual({
    description,
    rooms: [{ id: "room-1", name: "Reading room" }],
  });
  await expect(personName(page)).toHaveValue("Alex");
  expect(await savedPersonas(page)).toEqual([]);
  await personName(page).fill("Alex Rivera");
  const endTime = household(page).getByLabel("End time", { exact: true }).first();
  await endTime.fill("08:59");
  await household(page).getByRole("button", { name: "Save and continue" }).click();
  await expect(page.locator("#household-save-status")).toContainText("activity times");
  expect(await savedPersonas(page)).toEqual([]);
  await endTime.fill("17:30");
  await saveHousehold(page);
  const approved = structuredClone(personas);
  approved[0].name = "Alex Rivera";
  approved[0].schedule[0].endMinute = 1050;
  expect(await savedPersonas(page)).toEqual(approved);

  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "design");
  await page.locator("#room-settings").click();
  await expect(page.locator("#floorplan-upload")).toBeAttached();
  await page.locator("#edit-current-home").click();
  await page.locator("#setup-name").fill("Family room");
  await page.locator("#setup-next").click();
  await page.locator("#setup-next").click();
  await expect(page.locator("#room-name")).toHaveText("Family room");
  expect(await savedPersonas(page)).toEqual(approved);
  await page.locator("#generate").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
  expect(await savedPersonas(page)).toEqual(approved);
  await page.locator("#household-step").click();
  await expect(personName(page)).toHaveValue("Alex Rivera");
  await expect(endTime).toHaveValue("17:30");
  await page.reload();
  await expect(personName(page)).toHaveValue("Alex Rivera");

  await page.locator("#style-step").click();
  await page.locator("#new-project").click();
  expect(await savedPersonas(page)).toEqual(approved);
  await confirmRoom(page, "New room");
  expect(await savedPersonas(page)).toEqual([]);
  await expect(personName(page)).toHaveCount(0);
});

test("flexible activities and guests without a routine survive the design flow", async ({ page }) => {
  const flexibleWork = {
    activity: "work",
    roomId: "room-1",
    windowStartMinute: 780,
    windowEndMinute: 960,
    durationMinutes: 30,
  };
  const scheduled = { ...personas[0], schedule: [flexibleWork] };
  const unscheduled = { ...personas[1], schedule: [] };
  await page.route(endpoint, (route) => route.fulfill({
    json: { personas: [scheduled, unscheduled] },
  }));
  await createRoom(page);
  await household(page).getByLabel("Household description").fill(
    "Alex works for 30 minutes between 13:00 and 16:00. Sam is a guest without a routine.",
  );
  await generateButton(page).click();

  const members = household(page).locator(".household-member");
  const work = members.nth(0).locator(".household-schedule-entry");
  const earliest = work.getByLabel("Earliest start", { exact: true });
  const latest = work.getByLabel("Latest finish", { exact: true });
  const duration = work.getByRole("spinbutton", { name: "Duration (minutes)", exact: true });
  await expect(work.getByRole("combobox", { name: "Timing", exact: true })).toHaveValue("flexible");
  await expect(earliest).toHaveValue("13:00");
  await expect(latest).toHaveValue("16:00");
  await expect(duration).toHaveValue("30");
  await expect(members.nth(1).getByText("No routine", { exact: false })).toBeVisible();

  await household(page).getByRole("button", { name: "Add guest", exact: true }).click();
  const addedGuest = members.nth(2);
  await addedGuest.getByLabel("Name", { exact: true }).fill("Jordan");
  await expect(addedGuest.getByText("No routine", { exact: false })).toBeVisible();

  await earliest.fill("13:30");
  await duration.fill("180");
  await household(page).getByRole("button", { name: "Save and continue" }).click();
  await expect(page.locator("#household-save-status")).toContainText("fit inside the window");
  expect(await savedPersonas(page)).toEqual([]);

  await duration.fill("40");
  await saveHousehold(page);
  const approved = await savedPersonas(page);
  expect(approved).toHaveLength(3);
  expect(approved[0]).toEqual({
    ...scheduled,
    schedule: [{ ...flexibleWork, windowStartMinute: 810, durationMinutes: 40 }],
  });
  expect(approved[1]).toEqual(unscheduled);
  expect(approved[2]).toMatchObject({ name: "Jordan", schedule: [] });

  await page.locator("#generate").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
  await page.locator("#household-step").click();
  await expect(earliest).toHaveValue("13:30");
  await expect(duration).toHaveValue("40");
  await expect(addedGuest.getByLabel("Name", { exact: true })).toHaveValue("Jordan");
  expect(await savedPersonas(page)).toEqual(approved);
});

test("the sample works without Gemini and a failed generation preserves the saved household", async ({ page }) => {
  let generationCalls = 0;
  await page.route(endpoint, (route) => {
    generationCalls += 1;
    return route.fulfill({ status: 503, json: { error: "Gemini is unavailable. Try again later." } });
  });
  await createRoom(page);
  await household(page).getByRole("button", { name: "Load sample household" }).click();
  await expect(personName(page)).not.toBeEmpty();
  await saveHousehold(page);
  const sample = await savedPersonas(page);
  expect(sample.length).toBeGreaterThan(0);
  expect(generationCalls).toBe(0);
  await page.locator("#household-step").click();
  await household(page).getByLabel("Household description").fill(description);
  await generateButton(page).click();
  await expect(page.locator("#household-status")).toContainText("Gemini is unavailable");
  await expect(personName(page)).toHaveValue(sample[0].name);
  expect(await savedPersonas(page)).toEqual(sample);
});

test("leaving Household cancels an in-flight generation and drops its draft", async ({ page }) => {
  let releaseResponse;
  const responseReady = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  await page.route(endpoint, async (route) => {
    await responseReady;
    await route.fulfill({ json: { personas } }).catch(() => {});
  });
  await createRoom(page);
  await household(page).getByLabel("Household description").fill(description);
  const requested = page.waitForRequest((request) => request.url().endsWith("/api/personas/generate"));
  await generateButton(page).click();
  try {
    await requested;
    const canceled = page.waitForEvent("requestfailed", {
      predicate: (request) => request.url().endsWith("/api/personas/generate"),
    });
    await page.locator("#style-step").click();
    await canceled;
    await expect(page.locator("body")).toHaveAttribute("data-stage", "design");
    await page.locator("#household-step").click();
    await expect(generateButton(page)).toBeEnabled();
  } finally {
    releaseResponse();
  }
  await expect(personName(page)).toHaveCount(0);
  expect(await savedPersonas(page)).toEqual([]);
});
