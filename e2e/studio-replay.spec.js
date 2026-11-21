import { expect, test } from "@playwright/test";
import { createBlockedRouteDemo } from "../src/simulation/studio-replay-demo.js";

const { items: [sofa], householdDraft } = createBlockedRouteDemo();
const api = "**/api/replay/suggest-fix";
const suggestion = {
  explanation: "The doorway sofa may restrict passage. Move it farther into the Bedroom.",
  scenePatch: { operations: [{ type: "move", objectId: sofa.id, position: [3.4, 0, 7] }] },
};
const project = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("living-blueprint.project.v1")));

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
  await expect(page.locator("body")).toHaveAttribute("data-stage", "design");
  await page.locator("#tour-step").click();
  await expect(page.locator("#studio-replay-panel")).toBeVisible();
  expect((await project(page)).personas[0].schedule[1].windowEndMinute).toBe(515);
  await expect(page.locator("#studio-replay-compare")).toBeDisabled();
  await expect(approve).toBeHidden();
  await expect(suggest).toBeHidden();

  await capture.click();
  await suggest.click();
  await expect(approve).toBeVisible();
  await page.locator("#new-project").click();
  await page.locator("#try-sample-floorplan").click();
  await page.locator("#fp-confirm-import").click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.locator("#tour-step").click();
  await expect(page.locator("#studio-replay-panel")).toBeVisible();
  await expect(capture).toBeDisabled();
  await expect(page.locator("#studio-replay-compare")).toBeDisabled();
  await expect(approve).toBeHidden();
  await expect(suggest).toBeHidden();
  expect((await project(page)).items.some(({ id }) => id === sofa.id)).toBe(false);
});

const regionalPatch = {
  id: "clear-bedroom", reasoning: "Move the sofa away from the bedroom doorway.",
  targetFindings: ["NO_PATH:kitchen"], operations: suggestion.scenePatch.operations,
};

async function dragArea(page, start, end) {
  const map = page.getByRole("img", { name: "Select a redesign area on the floor plan" });
  await map.scrollIntoViewIfNeeded();
  const [a, b] = await map.evaluate((element, corners) => corners.map(([x, z]) => {
    const p = new DOMPoint(x, z).matrixTransform(element.getScreenCTM());
    return { x: p.x, y: p.y };
  }), [start, end]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

test("drag an area, review the scoped proposal, approve once and replay the same saved routine", async ({ page }) => {
  let payload;
  await page.route(api, async route => {
    payload = route.request().postDataJSON();
    await route.fulfill({ json: regionalPatch });
  });
  const { capture, failures } = await openDemo(page);
  const before = await project(page);
  await capture.click();
  await page.getByText("Edit a selected area", { exact: true }).click();
  await dragArea(page, [1.9, 5.4], [4.8, 7.65]);
  const instruction = page.getByRole("textbox", { name: "Redesign instruction" });
  await instruction.fill("Move the sofa away from the bedroom doorway.");
  await page.getByRole("button", { name: "Preview regional redesign" }).click();
  const approve = page.getByRole("button", { name: "Approve redesign" });
  await expect(approve).toBeVisible();
  expect(payload.instruction).toEqual(await instruction.inputValue());
  expect(payload.region[0]).toBeCloseTo(1.9, 1);
  expect(payload.region[3]).toBeCloseTo(7.65, 1);
  expect(payload.findings).toEqual(expect.arrayContaining([expect.objectContaining({
    type: "NO_PATH", evidence: expect.objectContaining({ timestampSeconds: 29100 }),
  })]));
  expect(await project(page)).toEqual(before);
  await approve.click();
  await expect(failures).toHaveText(["1", "0"]);
  await expect(page.locator("#sim-scenario")).toHaveValue("saved-routine");
  await expect(page.locator("#sim-scorecard")).toBeVisible();
  await expect(page.locator("#studio-replay-status")).toContainText("improved");
  const after = await project(page);
  expect(after.personas).toEqual(before.personas);
  expect(after.items).toEqual(before.items.map(item => item.id === sofa.id ? { ...item, x: 3.4, z: 7 } : item));
  await page.getByRole("button", { name: "Undo last change" }).click();
  expect((await project(page)).items).toEqual(before.items);
});

test("room selection rejects out-of-area moves and invalidates a preview after instruction or area changes", async ({ page }) => {
  let response = { ...regionalPatch, operations: [{ ...regionalPatch.operations[0], position: [7, 0, 7] }] };
  await page.route(api, route => route.fulfill({ json: response }));
  const { capture } = await openDemo(page);
  const before = await project(page);
  await capture.click();
  await page.getByText("Edit a selected area", { exact: true }).click();
  const room = page.getByRole("combobox", { name: "Room selection" });
  await room.selectOption("bedroom");
  const instruction = page.getByRole("textbox", { name: "Redesign instruction" });
  await instruction.fill("Leave the doorway clear");
  const preview = page.getByRole("button", { name: "Preview regional redesign" });
  const approve = page.getByRole("button", { name: "Approve redesign" });
  await preview.click();
  await expect(page.locator("#studio-replay-status")).toContainText("outside the selected area");
  await expect(approve).toHaveCount(0);
  response = regionalPatch;
  await preview.click();
  await expect(approve).toBeVisible();
  await instruction.fill("Make space for two people");
  await expect(approve).toBeHidden();
  await preview.click();
  await expect(approve).toBeVisible();
  await room.selectOption("kitchen");
  await expect(approve).toBeHidden();
  expect((await project(page)).items).toEqual(before.items);
});

test("regional replay displays measured regression and no change for an approved two-person routine", async ({ page }) => {
  const { capture } = await openDemo(page);
  const seeded = await project(page);
  seeded.items = seeded.items.map(item => item.id === sofa.id ? { ...item, x: 3.4, z: 7 } : item);
  seeded.personas.push({ ...seeded.personas[0], id: "bea", name: "Bea" });
  await page.evaluate(state => localStorage.setItem("living-blueprint.project.v1", JSON.stringify(state)), seeded);
  await page.reload();
  const positions = [[1.5, 0, .6], [1.6, 0, .6]];
  await page.route(api, route => route.fulfill({ json: { ...regionalPatch, targetFindings: [],
    operations: [{ ...regionalPatch.operations[0], position: positions.shift() }] } }));
  for (const [index, message] of ["more issues", "No change"].entries()) {
    await capture.click();
    await page.getByText("Edit a selected area", { exact: true }).click();
    await dragArea(page, [.01, .01], [9.59, 8.59]);
    await page.getByRole("textbox", { name: "Redesign instruction" }).fill("Reposition the sofa inside this area");
    await page.getByRole("button", { name: "Preview regional redesign" }).click();
    await page.getByRole("button", { name: "Approve redesign" }).click();
    await expect(page.locator("#studio-replay-status")).toContainText(message);
    const collisions = page.getByRole("rowheader", { name: "Collisions" }).locator("..").locator("td");
    await expect(collisions).toHaveText(index === 0 ? ["0", "1"] : ["1", "1"]);
    expect((await project(page)).personas).toEqual(seeded.personas);
  }
});
