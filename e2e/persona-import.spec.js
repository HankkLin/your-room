import { expect, test } from "@playwright/test";

const member = {
  id: "member-lee", name: "Lee", ageGroup: "adult", preferences: ["Daylight"], dislikes: ["Noise"],
  needs: { quiet: 0.8, privacy: 0.4, accessibility: 0.1, daylight: 0.9, social: 0.4 },
  schedule: [
    { activity: "work", roomId: "room-1", startMinute: 540, endMinute: 600 },
    { activity: "relax", roomId: "old-den", windowStartMinute: 720, windowEndMinute: 840, durationMinutes: 35 },
  ],
};
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("stillroom.project.v1")).personas);

async function openImport(page) {
  await page.goto("/");
  await page.locator("#custom-room").click();
  await page.locator("#setup-next").click();
  await page.locator("#setup-next").click();
  await page.getByText("Import from your agent", { exact: true }).click();
}

test("an imported agent export stays a draft through room reassignment, malformed paste, and editing", async ({ page }, testInfo) => {
  await openImport(page);
  await page.locator("#sample-household").click();
  await page.locator("#save-household").click();
  const approved = await saved(page);
  expect(approved.length).toBeGreaterThan(0);
  await page.locator("#household-step").click();
  await page.getByText("Import from your agent", { exact: true }).click();

  const requests = [];
  page.on("request", (request) => { if (request.method() === "POST") requests.push(request.url()); });
  await page.getByLabel("Agent export JSON").fill(JSON.stringify({ personas: [member] }));
  await page.getByRole("button", { name: "Review pasted JSON" }).click();
  await expect(page.getByLabel("Name", { exact: true }).first()).toHaveValue("Lee");
  const rows = page.locator("#household-members .household-schedule-entry");
  await expect(rows.first().getByLabel("Start time")).toHaveValue("09:00");
  await expect(rows.nth(1).getByLabel("Duration (minutes)")).toHaveValue("35");
  await expect(rows.nth(1).getByRole("combobox", { name: "Room", exact: true })).toHaveValue("");
  await page.locator("#save-household").click();
  await expect(page.locator("#household-save-status")).toContainText("available room");
  expect(await saved(page)).toEqual(approved);
  await page.getByLabel("Agent export JSON").fill("{invalid");
  await page.getByRole("button", { name: "Review pasted JSON" }).click();
  await expect(page.locator("#household-import-status")).toContainText("Could not read");
  await expect(rows).toHaveCount(2);
  expect(await saved(page)).toEqual(approved);

  await rows.nth(1).getByRole("combobox", { name: "Room", exact: true }).selectOption("room-1");
  await page.getByLabel("Name", { exact: true }).first().fill("Lee Morgan");
  await page.getByText("Import from your agent", { exact: true }).click();
  await page.locator("#household-review").screenshot({ path: testInfo.outputPath("persona-import-review.png") });
  await page.locator("#save-household").click();
  const expected = structuredClone(member);
  expected.name = "Lee Morgan";
  expected.schedule[1].roomId = "room-1";
  expect(await saved(page)).toEqual([expected]);
  await page.reload();
  expect(await saved(page)).toEqual([expected]);
  expect(requests).toEqual([]);
});

test("a failed import cancels pending generation and clears its progress message", async ({ page }) => {
  await openImport(page);
  await page.locator("#sample-household").click();
  const name = page.getByLabel("Name", { exact: true }).first();
  const draftName = await name.inputValue();
  let release;
  const holdResponse = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/personas/generate", async (route) => {
    await holdResponse;
    await route.fulfill({ json: { personas: [member] } }).catch(() => {});
  });
  try {
    for (const source of ["paste", "file"]) {
      await page.getByLabel("Household description").fill("Lee works in the morning.");
      const pending = page.waitForRequest((request) => request.url().endsWith("/api/personas/generate"));
      await page.locator("#generate-household").click();
      await pending;
      await expect(page.locator("#household-status")).toContainText("Generating");
      if (source === "paste") {
        await page.getByLabel("Agent export JSON").fill("{invalid");
        await page.getByRole("button", { name: "Review pasted JSON" }).click();
      } else {
        await page.getByLabel("Open JSON file").setInputFiles({
          name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{invalid"),
        });
      }
      await expect(page.locator("#household-import-status")).toContainText("Could not read");
      await expect(page.locator("#household-status")).toBeEmpty();
      await expect(page.locator("#generate-household")).toBeEnabled();
      await expect(name).toHaveValue(draftName);
      expect(await saved(page)).toEqual([]);
    }
  } finally {
    release();
  }
});

test("a local JSON file imports without sending it or applying it before approval", async ({ page }) => {
  await openImport(page);
  await page.getByLabel("Open JSON file").setInputFiles({
    name: "agent-export.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([member])),
  });
  await expect(page.getByLabel("Name", { exact: true }).first()).toHaveValue("Lee");
  expect(await saved(page)).toEqual([]);
  await page.locator("#style-step").click();
  await page.locator("#household-step").click();
  await expect(page.locator("#household-members .household-member")).toHaveCount(0);
  expect(await saved(page)).toEqual([]);
});
