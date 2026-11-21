import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { createWholeHomeDemoState } from "./house-demo.js";
import { createEnvironmentSnapshot } from "./src/environment/environment-context.js";
import { runTwinScenario } from "./src/twin-integration.js";
import { canModifyObject, isObjectLocked } from "./src/contracts/scene.js";
import {
  PATCH_ERROR_CODES,
  applyScenePatch,
  buildFallbackScenePatch,
  compareEvaluations,
  createRedesignDemoHouse,
  evaluateCandidatePatch,
  runRedesignReplay,
  toRedesignUiPayload,
  validateScenePatch,
} from "./src/redesign/index.js";
import {
  FINDING_TYPES,
  MORNING_ROUTINE_SCENARIO,
  createDemoHousehold,
  evaluateHouseholdExperience,
} from "./src/simulation/index.js";
import { importSampleFloorplan } from "./src/spatial/floorplan-importer.js";

test("ScenePatch SP1 — Move movable object succeeds and updates room/position", () => {
  const house = createRedesignDemoHouse();
  const patch = {
    id: "sp1-move-table",
    reasoning: "Relocate breakfast table into clear south-east dining corner.",
    targetFindings: ["CONGESTION:kitchen"],
    operations: [
      {
        type: "move",
        objectId: "kitchen-table-1",
        position: [7.85, 0, 3.35],
        rotation: [0, 0, 0],
      },
      {
        type: "move",
        objectId: "kitchen-chair-1",
        position: [7.1, 0, 3.35],
        rotation: [0, 1.571, 0],
      },
    ],
  };

  const validation = validateScenePatch(house, patch);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.deepEqual(validation.errors, []);

  const updated = applyScenePatch(house, patch);
  const movedTable = updated.objects.find((o) => o.id === "kitchen-table-1");
  assert.deepEqual(movedTable.position, [7.85, 0, 3.35]);
  assert.equal(movedTable.roomId, "kitchen");
});

test("ScenePatch SP2 & SP3 — Locked architectural fixtures and locked furniture reject move, rotate, replace, and remove", () => {
  const house = createRedesignDemoHouse();
  house.objects.push({
    id: "locked-heirloom-piano",
    type: "existing",
    kind: "console",
    name: "Heirloom Piano",
    roomId: "living-room",
    locked: true,
    position: [1.0, 0, 2.2],
    rotation: [0, 0, 0],
    dimensions: { width: 1.4, height: 1.1, depth: 0.6 },
  });

  const toilet = house.fixtures.find((f) => f.kind === "toilet") || house.fixtures[0];
  const counter =
    house.fixtures.find((f) => f.kind === "kitchen_counter") || house.fixtures[0];

  assert.equal(isObjectLocked({ ...toilet, type: "fixed" }), true);
  assert.equal(canModifyObject({ ...toilet, type: "fixed" }, "move"), false);

  // SP2a: Move fixed bathroom toilet -> MOVE_LOCKED_OBJECT
  const moveToilet = validateScenePatch(house, {
    id: "sp2-move-toilet",
    reasoning: "Try moving fixed plumbing.",
    targetFindings: [],
    operations: [{ type: "move", objectId: toilet.id, position: [6.2, 0, 6.2] }],
  });
  assert.equal(moveToilet.valid, false);
  assert.equal(moveToilet.errors[0].code, PATCH_ERROR_CODES.MOVE_LOCKED_OBJECT);

  // SP2b: Move user-locked furniture -> MOVE_LOCKED_OBJECT
  const movePiano = validateScenePatch(house, {
    id: "sp2-move-piano",
    reasoning: "Try moving locked heirloom.",
    targetFindings: [],
    operations: [
      { type: "move", objectId: "locked-heirloom-piano", position: [2.0, 0, 2.2] },
    ],
  });
  assert.equal(movePiano.valid, false);
  assert.equal(movePiano.errors[0].code, PATCH_ERROR_CODES.MOVE_LOCKED_OBJECT);

  // SP2c: Rotate locked fixture -> ROTATE_LOCKED_OBJECT
  const rotateCounter = validateScenePatch(house, {
    id: "sp2-rotate-counter",
    reasoning: "Try rotating built-in counter.",
    targetFindings: [],
    operations: [
      { type: "rotate", objectId: counter.id, rotation: [0, 1.57, 0] },
    ],
  });
  assert.equal(rotateCounter.valid, false);
  assert.equal(
    rotateCounter.errors[0].code,
    PATCH_ERROR_CODES.ROTATE_LOCKED_OBJECT,
  );

  // SP2d: Replace locked fixture -> REPLACE_LOCKED_OBJECT
  const replaceCounter = validateScenePatch(house, {
    id: "sp2-replace-counter",
    reasoning: "Try replacing built-in counter.",
    targetFindings: [],
    operations: [
      {
        type: "replace",
        objectId: counter.id,
        object: { kind: "table", dimensions: { width: 1, height: 0.8, depth: 0.6 } },
      },
    ],
  });
  assert.equal(replaceCounter.valid, false);
  assert.equal(
    replaceCounter.errors[0].code,
    PATCH_ERROR_CODES.REPLACE_LOCKED_OBJECT,
  );

  // SP3: Remove locked fixture -> REMOVE_LOCKED_OBJECT
  const removeToilet = validateScenePatch(house, {
    id: "sp3-remove-toilet",
    reasoning: "Try deleting fixed toilet.",
    targetFindings: [],
    operations: [{ type: "remove", objectId: toilet.id }],
  });
  assert.equal(removeToilet.valid, false);
  assert.equal(
    removeToilet.errors[0].code,
    PATCH_ERROR_CODES.REMOVE_LOCKED_OBJECT,
  );
});

test("ScenePatch SP4 & SP5 — Unknown object ID and invalid coordinates/elevation rejected", () => {
  const house = createRedesignDemoHouse();

  // SP4: Unknown object ID
  const unknownRes = validateScenePatch(house, {
    id: "sp4-unknown",
    reasoning: "Move imaginary chair.",
    targetFindings: [],
    operations: [{ type: "move", objectId: "chair-999", position: [2, 0, 2] }],
  });
  assert.equal(unknownRes.valid, false);
  assert.equal(unknownRes.errors[0].code, PATCH_ERROR_CODES.UNKNOWN_OBJECT);

  // SP5a: NaN coordinates
  const nanRes = validateScenePatch(house, {
    id: "sp5-nan",
    reasoning: "NaN coordinate.",
    targetFindings: [],
    operations: [
      { type: "move", objectId: "kitchen-table-1", position: [Number.NaN, 0, 2] },
    ],
  });
  assert.equal(nanRes.valid, false);
  assert.equal(nanRes.errors[0].code, PATCH_ERROR_CODES.INVALID_COORDINATES);

  // SP5b: Infinity coordinates
  const infRes = validateScenePatch(house, {
    id: "sp5-inf",
    reasoning: "Infinite coordinate.",
    targetFindings: [],
    operations: [
      {
        type: "move",
        objectId: "kitchen-table-1",
        position: [7.5, 0, Number.POSITIVE_INFINITY],
      },
    ],
  });
  assert.equal(infRes.valid, false);
  assert.equal(infRes.errors[0].code, PATCH_ERROR_CODES.INVALID_COORDINATES);

  // SP5c: Out-of-range vertical elevation
  const elevRes = validateScenePatch(house, {
    id: "sp5-elev",
    reasoning: "Floating above ceiling.",
    targetFindings: [],
    operations: [
      { type: "move", objectId: "kitchen-table-1", position: [7.8, 3.2, 3.2] },
    ],
  });
  assert.equal(elevRes.valid, false);
  assert.equal(elevRes.errors[0].code, PATCH_ERROR_CODES.INVALID_ELEVATION);
});

test("ScenePatch SP6 & SP7 — Wall collision, doorway blockage, and required route blockage rejected", () => {
  const house = createRedesignDemoHouse();

  // SP6: Object pushed into interior wall between living-room and kitchen (x = 5.6)
  const wallRes = validateScenePatch(house, {
    id: "sp6-wall-hit",
    reasoning: "Place table straddling interior partition wall.",
    targetFindings: [],
    operations: [
      { type: "move", objectId: "kitchen-table-1", position: [5.65, 0, 1.5] },
    ],
  });
  assert.equal(wallRes.valid, false);
  assert.equal(wallRes.errors[0].code, PATCH_ERROR_CODES.WALL_INTERSECTION);

  // SP7a: Object placed directly in front of kitchen doorway
  const kitchenDoor = house.doors.find(
    (d) => d.roomA === "kitchen" || d.roomB === "kitchen",
  );
  const doorRes = validateScenePatch(house, {
    id: "sp7-door-blocked",
    reasoning: "Put table right in doorway threshold.",
    targetFindings: [],
    operations: [
      {
        type: "move",
        objectId: "kitchen-table-1",
        position: [kitchenDoor.position[0] + 0.32, 0, kitchenDoor.position[1]],
      },
    ],
  });
  assert.equal(doorRes.valid, false);
  assert(
    [
      PATCH_ERROR_CODES.DOOR_BLOCKED,
      PATCH_ERROR_CODES.WALL_INTERSECTION,
    ].includes(doorRes.errors[0].code),
  );

  // SP7b: Wide console added just past doorway clearance zone that seals off narrow hallway route
  const narrowCorridorHouse = {
    id: "corridor-route-test",
    units: "meters",
    ceilingHeight: 2.7,
    rooms: [
      {
        id: "living-room",
        name: "Living",
        kind: "living",
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
      },
      {
        id: "hallway",
        name: "Hallway",
        kind: "hallway",
        polygon: [
          [4, 1.4],
          [7, 1.4],
          [7, 2.6],
          [4, 2.6],
        ],
      },
      {
        id: "bedroom",
        name: "Bedroom",
        kind: "bedroom",
        polygon: [
          [7, 0],
          [11, 0],
          [11, 4],
          [7, 4],
        ],
      },
    ],
    walls: [
      { id: "w1", start: [0, 0], end: [4, 0], thickness: 0.12 },
      { id: "w2", start: [0, 4], end: [4, 4], thickness: 0.12 },
      { id: "w3", start: [0, 0], end: [0, 4], thickness: 0.12 },
      { id: "w4", start: [4, 0], end: [4, 4], thickness: 0.12 },
      { id: "w5", start: [4, 1.4], end: [7, 1.4], thickness: 0.12 },
      { id: "w6", start: [4, 2.6], end: [7, 2.6], thickness: 0.12 },
      { id: "w7", start: [7, 0], end: [7, 4], thickness: 0.12 },
      { id: "w8", start: [7, 0], end: [11, 0], thickness: 0.12 },
      { id: "w9", start: [7, 4], end: [11, 4], thickness: 0.12 },
      { id: "w10", start: [11, 0], end: [11, 4], thickness: 0.12 },
    ],
    doors: [
      {
        id: "d-ext",
        kind: "exterior",
        wallId: "w3",
        roomA: "living-room",
        roomB: null,
        position: [0, 2.0],
        width: 0.9,
      },
      {
        id: "d-lh",
        kind: "interior",
        wallId: "w4",
        roomA: "living-room",
        roomB: "hallway",
        position: [4, 2.0],
        width: 0.9,
      },
      {
        id: "d-hb",
        kind: "interior",
        wallId: "w7",
        roomA: "hallway",
        roomB: "bedroom",
        position: [7, 2.0],
        width: 0.9,
      },
    ],
    windows: [],
    fixtures: [],
    objects: [],
  };

  const sealHallRes = validateScenePatch(narrowCorridorHouse, {
    id: "sp7-seal-corridor",
    reasoning: "Place console across middle of narrow hallway.",
    targetFindings: [],
    operations: [
      {
        type: "add",
        objectId: "hall-blocker-console",
        position: [5.5, 0, 2.0],
        rotation: [0, 0, 0],
        object: {
          id: "hall-blocker-console",
          kind: "console",
          name: "Hall Blocker",
          roomId: "hallway",
          dimensions: { width: 0.45, height: 0.85, depth: 0.92 },
        },
      },
    ],
  });
  assert.equal(sealHallRes.valid, false);
  assert.equal(
    sealHallRes.errors[0].code,
    PATCH_ERROR_CODES.PATCH_BLOCKS_REQUIRED_ROUTE,
  );
});

test("ScenePatch SP8 — Non-mutating applyScenePatch and full Shopify product metadata preservation on replace", () => {
  const house = createRedesignDemoHouse();
  const snapshot = structuredClone(house);

  const candidateProducts = [
    {
      productId: "gid://shopify/Product/987654321",
      variantId: "gid://shopify/ProductVariant/11223344",
      merchant: "Nordic Studio Home",
      price: 349,
      kind: "table",
      name: "Slim Oak Bistro Table",
      modelUrl: "https://cdn.example.com/models/slim-bistro.glb",
      url: "https://shop.example.com/products/slim-oak-bistro",
      dimensions: { width: 0.72, height: 0.74, depth: 0.58 },
    },
  ];

  const replacePatch = {
    id: "sp8-shopify-replace",
    reasoning: "Swap breakfast table with narrower Shopify Oak Bistro Table in clear corner.",
    targetFindings: ["CONGESTION:kitchen"],
    operations: [
      {
        type: "replace",
        objectId: "kitchen-table-1",
        productId: "gid://shopify/Product/987654321",
        position: [7.9, 0, 3.35],
        rotation: [0, 0, 0],
      },
      {
        type: "remove",
        objectId: "kitchen-chair-1",
      },
    ],
  };

  const validation = validateScenePatch(house, replacePatch, { candidateProducts });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));

  const afterHouse = applyScenePatch(house, replacePatch, { candidateProducts });

  // Original house is untouched
  assert.deepEqual(house, snapshot);

  // Replaced object preserves Shopify metadata
  const replaced = afterHouse.objects.find((o) => o.id === "kitchen-table-1");
  assert(replaced);
  assert.equal(replaced.type, "shopify");
  assert.equal(replaced.owned, false);
  assert.equal(replaced.productId, "gid://shopify/Product/987654321");
  assert.equal(replaced.variantId, "gid://shopify/ProductVariant/11223344");
  assert.equal(replaced.merchant, "Nordic Studio Home");
  assert.equal(replaced.price, 349);
  assert.equal(replaced.modelUrl, "https://cdn.example.com/models/slim-bistro.glb");
  assert.deepEqual(replaced.dimensions, { width: 0.72, height: 0.74, depth: 0.58 });
  assert.equal(replaced.product.productId, "gid://shopify/Product/987654321");
  assert.equal(replaced.product.variantId, "gid://shopify/ProductVariant/11223344");
});

test("Replay R1, R2, R4 — Identical baseline delta=0, deterministic fallback resolves CONGESTION:kitchen and raises score", () => {
  const house = createRedesignDemoHouse();
  const household = createDemoHousehold(house);

  // R1: Same house + same scenario = identical evaluation
  const evalA = evaluateHouseholdExperience({
    house,
    household,
    scenario: MORNING_ROUTINE_SCENARIO,
  });
  const evalB = evaluateHouseholdExperience({
    house: structuredClone(house),
    household: structuredClone(household),
    scenario: MORNING_ROUTINE_SCENARIO,
  });
  const sameCmp = compareEvaluations(evalA, evalB);
  assert.equal(sameCmp.delta.overall, 0);
  assert.equal(sameCmp.resolvedFindings.length, 0);
  assert.equal(sameCmp.introducedFindings.length, 0);
  assert.equal(sameCmp.accepted, false); // Zero improvement is not accepted as a redesign

  // R2 & R4: Known deterministic fallback patch resolves CONGESTION:kitchen and improves movement & overall score
  assert(
    evalA.findings.some(
      (f) => f.type === FINDING_TYPES.CONGESTION && f.roomId === "kitchen",
    ),
  );

  const fallbackPatch = buildFallbackScenePatch({ house, evaluation: evalA });
  assert(fallbackPatch);
  assert.equal(fallbackPatch.isFallback, true);
  assert.equal(fallbackPatch.source, "deterministic_fallback");

  const candidateOutcome = evaluateCandidatePatch({
    house,
    patch: fallbackPatch,
    beforeEvaluation: evalA,
    household,
    scenario: MORNING_ROUTINE_SCENARIO,
  });

  assert.equal(candidateOutcome.valid, true);
  assert.equal(candidateOutcome.accepted, true);
  assert(candidateOutcome.comparison.delta.overall > 0);
  assert(candidateOutcome.comparison.delta.categories.movement > 0);

  // R4: Resolved finding is recorded in resolvedFindings and absent in afterEvaluation.findings
  assert(
    candidateOutcome.comparison.resolvedFindings.some(
      (f) => f.type === FINDING_TYPES.CONGESTION && f.roomId === "kitchen",
    ),
  );
  assert.equal(
    candidateOutcome.afterEvaluation.findings.some(
      (f) => f.type === FINDING_TYPES.CONGESTION && f.roomId === "kitchen",
    ),
    false,
  );

  // Also verify raw unfurnished sample floorplan fallback works cleanly
  const { house: rawSampleHouse } = importSampleFloorplan();
  const rawHousehold = createDemoHousehold(rawSampleHouse);
  const rawBefore = evaluateHouseholdExperience({
    house: rawSampleHouse,
    household: rawHousehold,
    scenario: MORNING_ROUTINE_SCENARIO,
  });
  const rawFallback = buildFallbackScenePatch({
    house: rawSampleHouse,
    evaluation: rawBefore,
  });
  assert(rawFallback);
  const rawOutcome = evaluateCandidatePatch({
    house: rawSampleHouse,
    patch: rawFallback,
    beforeEvaluation: rawBefore,
    household: rawHousehold,
    scenario: MORNING_ROUTINE_SCENARIO,
  });
  assert.equal(rawOutcome.valid, true);
  assert.equal(rawOutcome.accepted, true);
});

test("Replay R3 & R5 — Regression patch introducing TV_OCCLUDED is detected in newFindings and rejected", () => {
  const house = createRedesignDemoHouse();
  const household = createDemoHousehold(house);
  const beforeEvaluation = evaluateHouseholdExperience({
    house,
    household,
    scenario: MORNING_ROUTINE_SCENARIO,
  });

  // Patch fixes kitchen congestion BUT moves tall potted tree directly between living-sofa-1 [2.9, 3.25] and living-tv-1 [2.9, 0.3]
  const regressingPatch = {
    id: "r3-occlude-tv",
    reasoning: "Fix kitchen table, put plant in middle of living room.",
    targetFindings: ["CONGESTION:kitchen"],
    operations: [
      {
        type: "move",
        objectId: "kitchen-table-1",
        position: [7.85, 0, 3.35],
      },
      {
        type: "move",
        objectId: "kitchen-chair-1",
        position: [7.1, 0, 3.35],
      },
      {
        type: "move",
        objectId: "living-plant-1",
        position: [2.9, 0, 1.8],
      },
    ],
  };

  const evaluated = evaluateCandidatePatch({
    house,
    patch: regressingPatch,
    beforeEvaluation,
    household,
    scenario: MORNING_ROUTINE_SCENARIO,
  });

  assert.equal(evaluated.valid, true);
  // R5: Newly introduced TV_OCCLUDED appears in introducedFindings / newFindings
  assert(
    evaluated.comparison.introducedFindings.some(
      (f) => f.type === FINDING_TYPES.TV_OCCLUDED,
    ),
  );
  assert(
    evaluated.comparison.newFindings.some(
      (f) => f.type === FINDING_TYPES.TV_OCCLUDED,
    ),
  );
  // R3: Visibility drops sharply -> patch is rejected
  assert(evaluated.comparison.delta.categories.visibility < -4);
  assert.equal(evaluated.accepted, false);
  assert(evaluated.rejectedBecause.length > 0);
});

test("Self-Correction Retry Loop — Rejects locked & doorway-blocking proposals, passes rejection feedback, and accepts valid Attempt 3", async () => {
  const house = createRedesignDemoHouse();
  const toilet = house.fixtures.find((f) => f.kind === "toilet") || house.fixtures[0];
  const kitchenDoor = house.doors.find(
    (d) => d.roomA === "kitchen" || d.roomB === "kitchen",
  );

  const seenContexts = [];
  const mockGenerator = async ({ context, attempt }) => {
    seenContexts.push(context);
    if (attempt === 1) {
      // Attempt 1: Illegal mutation of locked fixture
      return {
        id: "attempt-1-locked",
        reasoning: "Move fixed toilet.",
        targetFindings: ["CONGESTION:kitchen"],
        operations: [{ type: "move", objectId: toilet.id, position: [6.2, 0, 6.2] }],
      };
    }
    if (attempt === 2) {
      // Attempt 2: Blocks kitchen doorway
      return {
        id: "attempt-2-door",
        reasoning: "Move table into kitchen doorway.",
        targetFindings: ["CONGESTION:kitchen"],
        operations: [
          {
            type: "move",
            objectId: "kitchen-table-1",
            position: [kitchenDoor.position[0] + 0.3, 0, kitchenDoor.position[1]],
          },
        ],
      };
    }
    // Attempt 3: Clean relocation into south-central dining corner
    return {
      id: "attempt-3-clean",
      reasoning: "Relocate breakfast table and chair into open south-central dining corner.",
      targetFindings: ["CONGESTION:kitchen"],
      operations: [
        {
          type: "move",
          objectId: "kitchen-table-1",
          position: [7.55, 0, 3.44],
          rotation: [0, 0, 0],
        },
        {
          type: "move",
          objectId: "kitchen-chair-1",
          position: [7.55, 0, 2.76],
          rotation: [0, 0, 0],
        },
      ],
    };
  };

  const t0 = performance.now();
  const replay = await runRedesignReplay({
    house,
    patchGenerator: mockGenerator,
    useFallbackOnFailure: false,
    maxAttempts: 3,
  });
  const elapsedMs = performance.now() - t0;
  assert(elapsedMs < 1000, `Deterministic 3-attempt replay took ${elapsedMs} ms`);

  assert.equal(replay.status, "IMPROVED");
  assert.equal(replay.attempts.length, 3);
  assert.equal(replay.attempts[0].valid, false);
  assert.match(replay.attempts[0].rejectedBecause[0], /MOVE_LOCKED_OBJECT/);
  assert.equal(replay.attempts[1].valid, false);
  assert.equal(replay.attempts[2].valid, true);
  assert.equal(replay.attempts[2].accepted, true);

  // Verify rejection feedback was passed to subsequent attempts
  assert.equal(seenContexts[0].previousAttempts.length, 0);
  assert.equal(seenContexts[1].previousAttempts.length, 1);
  assert.match(
    seenContexts[1].previousAttempts[0].rejectedBecause[0],
    /MOVE_LOCKED_OBJECT/,
  );
  assert.equal(seenContexts[2].previousAttempts.length, 2);

  assert(replay.delta.overall > 0);
  assert(
    replay.resolvedFindings.some(
      (f) => f.type === FINDING_TYPES.CONGESTION && f.roomId === "kitchen",
    ),
  );

  // Verify UI payload contract (Task 4 §25)
  const ui = toRedesignUiPayload(replay);
  assert.equal(ui.status, "COMPLETE");
  assert.equal(ui.isMockData, false);
  assert.equal(ui.isFallback, false);
  assert(ui.afterScores.movement > ui.beforeScores.movement);
  assert.equal(ui.redesignActions.length, 2);

  // Verify maxAttempts exhaustion returns FAILED when fallback is disabled
  const alwaysBadReplay = await runRedesignReplay({
    house,
    patchGenerator: async () => ({
      id: "always-locked",
      reasoning: "Move locked toilet.",
      targetFindings: [],
      operations: [{ type: "move", objectId: toilet.id, position: [6.2, 0, 6.2] }],
    }),
    useFallbackOnFailure: false,
    maxAttempts: 2,
  });
  assert.equal(alwaysBadReplay.status, "FAILED");
  assert.equal(alwaysBadReplay.attempts.length, 2);
  assert.equal(alwaysBadReplay.selectedPatch, null);
});

test("Replay freezes the measured sun, routine, and household when a later environment is saved", () => {
  const state = createWholeHomeDemoState();
  const conditions = {
    location: { label: "New York", latitude: 40.74785, longitude: -73.98507 },
    orientationDegrees: 170, timeZone: "America/New_York", weather: null,
  };
  const sceneAt = (instant) => ({
    ...state.house,
    environment: { snapshot: createEnvironmentSnapshot({ ...conditions, instant }) },
  });
  const morning = runTwinScenario("morning-routine", {
    state, items: state.items, house: sceneAt("2026-11-01T13:00:00Z"),
  });
  const afternoon = { state, items: state.items, house: sceneAt("2026-11-01T19:00:00Z") };
  const independentlyMeasured = runTwinScenario("morning-routine", afternoon);
  const compared = runTwinScenario("morning-routine", { ...afternoon, comparisonRun: morning });
  const glare = (run) => run.findings.filter(finding => finding.type === "SUN_GLARE");
  assert(glare(morning).some(finding => finding.evidence.targetObjectId === "home-desk" &&
    finding.evidence.windowId === "win-bedroom-north"));
  assert.equal(glare(independentlyMeasured).length, 0);
  assert.deepEqual(glare(compared), glare(morning));
  assert.equal(compared.environment, morning.environment);
  assert.equal(compared.household, morning.household);
  assert.equal(compared.scenarioConfig, morning.scenarioConfig);
});
