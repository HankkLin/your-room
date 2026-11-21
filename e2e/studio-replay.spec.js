import { expect, test } from "@playwright/test";
import { createBlockedRouteDemo } from "../src/simulation/studio-replay-demo.js";

const { items: [sofa], householdDraft } = createBlockedRouteDemo();
const api = "**/api/replay/suggest-fix";
const suggestion = {
  explanation: "The doorway sofa may restrict passage. Move it farther into the Bedroom.",
  scenePatch: { operations: [{ type: "move", objectId: sofa.id, position: [3.4, 0, 7] }] },
};
const project = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("stillroom.project.v1")));

async function openDemo(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try blocked-route replay demo", exact: true }).click();
  const household = page.locator("#household-page");
  await expect(household.getByLabel("Name", { exact: true })).toHaveValue("Alex");
  const destinations = household.getByRole("combobox", { name: "Room", exact: true });
  await expect(destinations.nth(0)).toHaveValue("bedroom");
  await expect(destinations.nth(1)).toHaveValue("kitchen");
  expect((await project(page)).personas).toEqual([]);
  await household.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("button", { name: "Explore room", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
  const replay = page.locator("#studio-replay-panel");
  return {
    household,
    capture: replay.getByRole("button", { name: "Capture baseline", exact: true }),
    compare: replay.getByRole("button", { name: "Compare current layout", exact: true }),
    suggest: replay.getByRole("button", { name: "Suggest a fix", exact: true }),
    approve: replay.getByRole("button", { name: "Approve move", exact: true }),
    failures: replay.getByRole("rowheader", { name: "Path failures", exact: true }).locator("..").locator("td"),
    findings: page.locator("#studio-replay-findings"),
    obstacle: page.locator('#inventory [data-item="' + sofa.id + '"]'),
  };
}

test("Studio replay measures that removing a sofa restores the scheduled route to the kitchen", async ({ page }) => {
  const { household, capture, compare, failures, findings, obstacle } = await openDemo(page);
  const approved = await project(page);
  expect(approved.personas).toEqual(householdDraft);
  expect(approved.importedHouse.fixtures).toHaveLength(7);
  expect(approved.importedHouse.fixtures.every(({ locked }) => locked)).toBe(true);
  await expect(compare).toBeDisabled();
  await capture.click();
  await expect(failures).toHaveText(["1"]);

  await obstacle.click();
  await page.locator("#objectbar [data-action=remove]").click();
  await expect(obstacle).toHaveCount(0);
  await compare.click();
  await expect(failures).toHaveText(["1", "0"]);
  await expect(findings).toContainText("Baseline route blocked from Bedroom to Kitchen.");
  await expect(findings).toContainText("No blocked routes were recorded in the current layout.");
  expect((await project(page)).personas).toEqual(approved.personas);

  await page.locator("#household-step").click();
  await household.getByLabel("Latest finish", { exact: true }).fill("08:35");
  await household.getByRole("button", { name: "Save and continue" }).click();
  await page.locator("#tour-step").click();
  await expect(compare).toBeDisabled();
  await capture.click();
  await expect(compare).toBeEnabled();

  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-stage", "tour");
  const saved = await project(page);
  expect(saved.items.some(({ id }) => id === sofa.id)).toBe(false);
  const [alex] = householdDraft;
  expect(saved.personas).toEqual([
    { ...alex, schedule: [alex.schedule[0], { ...alex.schedule[1], windowEndMinute: 515 }] },
  ]);
  expect(saved.importedHouse).toEqual(approved.importedHouse);
});

test("a Gemini move requires approval and replays the saved whole-home trip with the same routine", async ({ page }) => {
  await page.route(api, (route) => route.fulfill({ json: suggestion }));
  const { capture, suggest, approve, failures, findings } = await openDemo(page);
  const before = await project(page);
  await capture.click();
  await expect(failures).toHaveText(["1"]);
  await expect(findings).toContainText("Baseline route blocked from Bedroom to Kitchen. Trip time 08:05.");

  const requested = page.waitForRequest((request) => request.url().endsWith("/api/replay/suggest-fix"));
  await suggest.click();
  const context = (await requested).postDataJSON();
  expect(context.finding).toMatchObject({
    type: "NO_PATH", fromRoomId: "bedroom", toRoomId: "kitchen", evidence: { timestampSeconds: 29100 },
  });
  expect(context.objects).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: sofa.id, locked: false, relocationHint: [3.4, 0, 7] }),
    expect.objectContaining({ id: "fixture-bedroom-closet", locked: true }),
  ]));
  await expect(page.locator("#studio-replay-proposal")).toContainText(suggestion.explanation);
  await expect(page.locator("#studio-replay-move")).toHaveText("Doorway sofa · Bedroom (3.2, 0, 6 m) → Bedroom (3.4, 0, 7 m)");
  expect((await project(page)).items).toEqual(before.items);

  await approve.click();
  await expect(failures).toHaveText(["1", "0"]);
  await expect(findings).toContainText("The replay recorded the selected trip arriving at its destination.");
  const after = await project(page);
  expect(after.items).toEqual(before.items.map((item) => item.id === sofa.id ? { ...item, x: 3.4, z: 7 } : item));
  expect(after.items.filter(({ type, locked }) => type === "fixed" && locked)).toHaveLength(7);
  expect(after.importedHouse).toEqual(before.importedHouse);
  expect(after.personas).toEqual(before.personas);

  await page.getByRole("button", { name: "Undo last change", exact: true }).click();
  const undone = await project(page);
  expect(undone.items).toEqual(before.items);
  expect(undone.personas).toEqual(before.personas);
  await expect(failures).toHaveText(["1"]);
});

test("layout, schedule and floorplan changes discard a proposed or in-flight move", async ({ page }) => {
  let releaseReply;
  let finishReply;
  let delayReply = false;
  const delayedReply = new Promise((resolve) => { releaseReply = resolve; });
  const replyFinished = new Promise((resolve) => { finishReply = resolve; });
  await page.route(api, async (route) => {
    if (!delayReply) return route.fulfill({ json: suggestion });
    await delayedReply;
    try {
      await route.fulfill({ json: suggestion });
    } finally {
      finishReply();
    }
  });
  const { household, capture, suggest, approve, obstacle } = await openDemo(page);
  await capture.click();
  await suggest.click();
  await expect(approve).toBeVisible();
  await obstacle.click();
  await page.locator("#objectbar [data-action=lock]").click();
  await expect(approve).toBeHidden();
  await expect(suggest).toBeHidden();
  expect((await project(page)).items.find(({ id }) => id === sofa.id)).toMatchObject({ locked: true, x: 3.2, z: 6 });

  await page.getByRole("button", { name: "Undo last change", exact: true }).click();
  delayReply = true;
  const requested = page.waitForRequest((request) => request.url().endsWith("/api/replay/suggest-fix"));
  await suggest.click();
  await requested;
  await page.locator("#household-step").click();
  await household.getByLabel("Latest finish", { exact: true }).fill("08:35");
  await household.getByRole("button", { name: "Save and continue" }).click();
  releaseReply();
  await replyFinished;
  delayReply = false;
  await expect(approve).toBeHidden();
  await expect(suggest).toBeHidden();

  await capture.click();
  await suggest.click();
  await expect(approve).toBeVisible();
  await page.locator("#new-project").click();
  await page.locator("#try-sample-floorplan").click();
  await page.locator("#fp-confirm-import").click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(approve).toBeHidden();
  await expect(suggest).toBeHidden();
  expect((await project(page)).items.some(({ id }) => id === sofa.id)).toBe(false);
});
