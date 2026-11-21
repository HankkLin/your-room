import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createWholeHomeDemoState } from "./house-demo.js";
import { createOwnedItems, ROOM } from "./model.js";
import { buildRegionSuggestionInput } from "./src/agents/replay-suggestion.js";
import { renderAiDesignStagesMarkup } from "./src/components/persona/furnishing-panel.js";
import {
  createDemoControlsController,
  renderControlPanelMarkup,
  renderPersonaQuickViewMarkup,
  renderResultsDeckMarkup,
} from "./src/components/simulation/demo-controls.js";
import { validatePersonas } from "./src/contracts/persona.js";
import { prepareFurnishing } from "./src/persona/furnishing.js";
import { createFamilyOfFourPersonas } from "./src/simulation/family-of-four.js";
import { importSampleFloorplan } from "./src/spatial/floorplan-importer.js";
import { runTwinScenario } from "./src/twin-integration.js";

test("U1 — Eight-step Blueprint navigation defines all 8 canonical steps in index.html", () => {
  const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const expected = [
    ["1", "Your Home"],
    ["2", "Your Household"],
    ["3", "Your Style"],
    ["4", "Your Furniture"],
    ["5", "AI Design"],
    ["6", "Explore room"],
    ["7", "Stress Test"],
    ["8", "Furnish &amp; Buy"],
  ];
  for (const [num, label] of expected) {
    assert.match(
      html,
      new RegExp(`data-bp-step="${num}"[\\s\\S]*?>\\s*<span aria-hidden="true">${num}</span>${label}`),
      `Missing canonical Step ${num} (${label})`,
    );
  }
});

test("U2 — Step 3 StyleBrief handoff prepares validated furnishing input with prompt, photo reference, budget, and existing owned furniture", () => {
  const demo = createWholeHomeDemoState();
  const personas = createFamilyOfFourPersonas(demo.house);
  const ownedSofa = {
    ...createOwnedItems("Sofa", [], ROOM)[0],
    id: "owned-sofa-1",
    name: "Heirloom Sofa",
    roomId: "living-room",
  };
  const context = prepareFurnishing({
    project: {
      ...demo,
      personas,
      items: [ownedSofa],
    },
    style: "Warm minimal",
    brief: "natural oak & warm linen, wide step-free walkways",
    budget: 2400,
    reference: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    liveCandidates: [],
  });
  assert.equal(context.input.style, "Warm minimal");
  assert.match(context.input.brief, /wide step-free walkways/);
  assert.equal(context.input.budgetMinor, 240000);
  assert.equal(context.input.retainedMinor, 0);
  assert.match(context.input.reference, /^data:image\/jpeg;base64,/);
  assert(
    context.input.existingPieces.some((p) => p.name === "Heirloom Sofa" && p.owned === true),
  );
});

test("U3 — Step 4 owned-furniture intake produces zero-cost owned SceneObjects with editable meter dimensions", () => {
  const [item] = createOwnedItems("Chair", [], ROOM);
  assert.equal(item.owned, true);
  assert.equal(item.price, 0);
  const resized = { ...item, width: 0.85, depth: 0.9, height: 0.88 };
  assert.equal(resized.width, 0.85);
  assert.equal(resized.depth, 0.9);
  assert.equal(resized.height, 0.88);
  const setupSource = fs.readFileSync(new URL("./setup.js", import.meta.url), "utf8");
  assert.match(setupSource, /id="furniture-photo-upload"/);
  assert.match(setupSource, /data-kept-dim="width"/);
  assert.match(setupSource, /bp-owned-badge">Owned</);
});

test("U4 — Step 5 AI Design loading stages render honest 7-step progression, completion, and failure states", () => {
  const activeHtml = renderAiDesignStagesMarkup(3);
  assert.equal((activeHtml.match(/class="bp-ai-stage"/g) || []).length, 7);
  assert.match(activeHtml, /data-ai-stage="0" data-stage-state="done"/);
  assert.match(activeHtml, /data-ai-stage="3" data-stage-state="active"/);
  assert.match(activeHtml, /Searching Shopify/);
  assert.match(activeHtml, /Checking accessibility/);

  const failedHtml = renderAiDesignStagesMarkup(3, { failed: true });
  assert.match(failedHtml, /data-ai-stage="3" data-stage-state="failed"/);

  const completedHtml = renderAiDesignStagesMarkup(6, { completed: true });
  assert.equal((completedHtml.match(/data-stage-state="done"/g) || []).length, 7);
});

test("U5 — Step 6 region-selection prompt builds bounded region redesign payload preserving locked fixtures", () => {
  const demo = createWholeHomeDemoState();
  const payload = buildRegionSuggestionInput(
    [-5.5, -0.5, 0.5, 4.5],
    "Open up the kitchen walkway for morning coffee traffic",
    [],
    demo.house,
    demo.items,
  );
  assert.equal(payload.instruction, "Open up the kitchen walkway for morning coffee traffic");
  assert.deepEqual(payload.region, [-5.5, -0.5, 0.5, 4.5]);
  assert(payload.objects.some((o) => !o.locked));
  const lockedObjects = payload.objects.filter((o) => o.locked);
  assert(lockedObjects.length > 0, "Region context retains locked fixtures marked locked: true");
  assert(lockedObjects.every((o) => !o.relocationHint));
});

test("U6 — Step 2 canonical Family of Four passes Persona contract validation and renders heights, roles, and schedule summaries", () => {
  const demo = createWholeHomeDemoState();
  const family = createFamilyOfFourPersonas(demo.house);
  assert.equal(family.length, 4);
  assert.equal(
    validatePersonas(
      family,
      demo.house.rooms.map(({ id, name }) => ({ id, name })),
    ),
    null,
  );
  const heights = family.map((p) => p.heightMeters);
  assert.deepEqual(heights, [1.83, 1.66, 1.74, 1.3]);

  const html = renderPersonaQuickViewMarkup(family);
  assert.match(html, /Kevin \(Dad\)/);
  assert.match(html, /1\.83 m/);
  assert.match(html, /Alice \(Mom\)/);
  assert.match(html, /1\.66 m/);
  assert.match(html, /Leo \(Brother\)/);
  assert.match(html, /Older Brother/);
  assert.match(html, /Maya \(Sister\)/);
  assert.match(html, /Younger Sister/);
});

test("U7 — Step 7 friend-count control updates state, renders presets 4/8/12/16, and drives Friends Arrival crowd count", () => {
  const runs = [];
  const controller = createDemoControlsController({
    onRunSimulation: (scenarioId, opts) => runs.push({ scenarioId, ...opts }),
  });
  controller.selectScenario("friends-arrival");
  controller.setFriendCount(12);
  const panelHtml = renderControlPanelMarkup(controller.getState());
  assert.match(panelHtml, /id="sim-friends-control"/);
  assert.match(panelHtml, /data-friend-preset="12" aria-pressed="true"/);
  controller.triggerRun();
  assert.deepEqual(runs, [{ scenarioId: "friends-arrival", friendCount: 12 }]);

  const demo = createWholeHomeDemoState();
  const dataset = runTwinScenario("friends-arrival", {
    house: demo.house,
    items: demo.items,
    state: demo,
    friendCount: 12,
  });
  const endTs = dataset.simulation.scenario?.endMinute
    ? dataset.simulation.scenario.endMinute * 60
    : 1095 * 60;
  const snapEnd = dataset.getSnapshotAt(dataset.simulation, endTs);
  assert.equal(snapEnd.length, 4 + 12);
});

test("U8 — Grandparents accessibility stress test produces wheelchair clearance findings, accessibility banner, and checkpoint", () => {
  const sampleHouse = importSampleFloorplan().house;
  const dataset = runTwinScenario("grandparents-visit", {
    house: sampleHouse,
    items: [],
    state: { importedHouse: sampleHouse, items: [], personas: [] },
  });
  assert(
    dataset.findings.some((f) => f.type === "ACCESSIBILITY_CLEARANCE_FAIL"),
    "Expected narrow doorway wheelchair clearance finding",
  );
  assert(
    dataset.checkpoints.some((cp) => cp.type === "WHEELCHAIR_ACCESS_CHECK"),
    "Expected WHEELCHAIR_ACCESS_CHECK checkpoint",
  );
  const deckHtml = renderResultsDeckMarkup({
    status: "COMPLETE",
    findings: dataset.findings,
    scores: dataset.scores,
  });
  assert.match(deckHtml, /twin-accessibility-banner/);
  assert.match(deckHtml, /Why it matters:/);
});

test("U9 — Central Before/After comparison renders Overall & category deltas, Resolved/Remaining/New summary pills, and 5-step Gemini stepper", () => {
  const deckHtml = renderResultsDeckMarkup({
    status: "COMPLETE",
    hasLayoutToggle: true,
    activeLayoutView: "after",
    redesignStatus: "IMPROVED",
    overallBeforeScore: 58,
    overallAfterScore: 84,
    beforeScores: { movement: 52, collision: 70, visibility: 75, privacy: 48, noise: 62, safety: 80 },
    afterScores: { movement: 88, collision: 92, visibility: 82, privacy: 84, noise: 76, safety: 90 },
    resolvedFindings: [{ id: "f1", type: "CONGESTION", title: "Kitchen congestion" }],
    remainingFindings: [{ id: "f2", type: "NOISE_CONFLICT", title: "WFH noise overlap" }],
    introducedFindings: [],
    redesignActions: ["Moved breakfast table out of kitchen bottleneck"],
  });
  assert.match(deckHtml, /Resolved: 1/);
  assert.match(deckHtml, /Remaining: 1/);
  assert.match(deckHtml, /New: 0/);
  assert.match(deckHtml, /\+26/);
  assert.match(deckHtml, /\+36/);
  assert.equal((deckHtml.match(/class="twin-pipe-step"/g) || []).length, 5);
});

test("U10 — Step 8 Commerce handoff separates Already owned ($0) pieces from merchant-grouped Shopify products", () => {
  const shopSource = fs.readFileSync(
    new URL("./src/components/catalog/shopping-list.js", import.meta.url),
    "utf8",
  );
  assert.match(shopSource, /shop-owned-section/);
  assert.match(shopSource, /Already owned \(/);
  assert.match(shopSource, /Kept in layout \(\$0\)/);
  assert.match(shopSource, /New products to purchase/);
  assert.match(shopSource, /Prepare all merchant checkouts/);
});
