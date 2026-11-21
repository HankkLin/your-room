import { test, expect } from "@playwright/test";

const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("living-blueprint.project.v1")));
const proposal = { operations: [{ type: "add", candidateId: "oak-desk", roomId: "room-1", personaId: "sample-alex",
  need: "quiet", reason: "The pale oak desk gives Alex a quiet workspace and fits the warm minimal reference." }] };

async function design(page, household = true) {
  await page.goto("/");
  await page.locator("#custom-room").click();
  await page.locator("#setup-next").click();
  await page.locator("#owned-kind").selectOption("sofa");
  await page.locator("#add-owned").click();
  await page.locator("#setup-next").click();
  if (household) {
    await page.getByRole("button", { name: "Load sample household" }).click();
    await page.getByRole("button", { name: "Save and continue" }).click();
  } else {
    await page.getByRole("button", { name: "Skip", exact: true }).click();
  }
  await page.locator("#setup-next").click();
}

test("review a photo-informed household proposal, apply once, and undo", async ({ page }) => {
  let sent;
  await page.route("**/api/furnishing/propose", (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({ json: proposal });
  });
  await design(page);
  const before = (await state(page)).items;
  await page.locator("#inspiration").setInputFiles("public/assets/sample-capture.jpg");
  await expect(page.getByAltText("Style reference")).toBeVisible();
  await page.getByRole("button", { name: "Warm minimal" }).click();
  await page.locator("#brief").fill("A quiet workspace in pale oak");
  await page.locator("[data-propose]").click();
  await expect(page.locator("[data-preview]")).toContainText("Alex · quiet");
  await expect(page.locator("[data-preview]")).toContainText("warm minimal reference");
  expect(sent.reference).toMatch(/^data:image\/jpeg;base64,/);
  expect(sent.style).toBe("Warm minimal");
  expect(sent.personas[0].needs.quiet).toBe(0.9);
  expect((await state(page)).items).toEqual(before);
  await page.locator("[data-approve]").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
  const after = (await state(page)).items;
  expect(after.slice(0, -1)).toEqual(before);
  expect(after.at(-1).productId).toBe("oak-desk");
  await page.locator("#undo").click();
  expect((await state(page)).items).toEqual(before);
});

test("over-budget preview and failed Gemini call preserve the scene and leave auto-style usable without a photo", async ({ page }) => {
  let failed = false;
  await page.route("**/api/furnishing/propose", (route) => {
    expect(route.request().postDataJSON().reference).toBeNull();
    return failed ? route.fulfill({ status: 503, json: { error: "Gemini is unavailable" } }) : route.fulfill({ json: proposal });
  });
  await design(page);
  const before = (await state(page)).items;
  await page.locator("#budget").fill("20");
  await page.locator("[data-propose]").click();
  await expect(page.locator("#household-furnishing [role=status]")).toContainText("exceeds");
  await expect(page.locator("[data-approve]")).toBeHidden();
  expect((await state(page)).items).toEqual(before);
  failed = true;
  await page.locator("#budget").fill("2000");
  await page.locator("[data-propose]").click();
  await expect(page.locator("#household-furnishing [role=status]")).toContainText("unavailable");
  await page.locator("#generate").click();
  await page.locator("#continue-explore").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
});

test("a skipped household keeps the original design flow", async ({ page }) => {
  await design(page, false);
  await expect(page.locator("[data-propose]")).toBeHidden();
  await page.locator("#generate").click();
  await page.locator("#continue-explore").click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
});
