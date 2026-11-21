import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { catalog } from "./model.js";
import { createWholeHomeDemoHouse, createWholeHomeDemoState } from "./house-demo.js";
import { validatePersonas } from "./src/contracts/persona.js";
import * as simContract from "./src/contracts/simulation.js";
import { listPersonaRooms } from "./src/persona/rooms.js";
import { createSimulationSceneLayer } from "./src/components/avatar/simulation-scene-layer.js";
import {
  renderControlPanelMarkup,
  renderResultsDeckMarkup,
} from "./src/components/simulation/demo-controls.js";
import { createSimulationPlaybackController } from "./src/components/simulation/playback-controller.js";
import {
  captureStudioLayout,
  resolveHouseholdForSimulation,
  runScenarioPlaybackDataset,
} from "./simulation-integration.js";

test("I1 — Combined src/contracts/simulation.js exports both deterministic engine and UI symbols", () => {
  // Engine symbols
  assert.equal(simContract.CELL_WALKABLE, 1);
  assert.equal(typeof simContract.DEFAULT_GRID_CELL_SIZE, "number");
  assert.equal(simContract.FINDING_TYPES.CONGESTION, "CONGESTION");
  assert.equal(simContract.FINDING_TYPES.PRIVACY_SIGHTLINE, "PRIVACY_SIGHTLINE");
  assert.equal(simContract.STRESS_SCENARIO_TYPES.FIRE_EVACUATION, "fire-evacuation");
  assert.ok(Array.isArray(simContract.EXPERIENCE_CATEGORIES));
  assert.equal(simContract.SIMULATION_EVENT_TYPES.ARRIVED, "ARRIVED");
  assert.equal(typeof simContract.isValidSimulationFinding, "function");

  // UI symbols
  assert.equal(simContract.DEMO_SCENARIOS.length, 4);
  assert.deepEqual(simContract.SIMULATION_SPEEDS, [1, 5, 20]);
  assert.ok(simContract.SIMULATION_STATUSES.includes("RUNNING"));
  assert.equal(simContract.SCORE_CATEGORIES.length, 5);
  assert.ok(simContract.FINDING_LEVELS.includes("critical"));
  assert.equal(typeof simContract.resolveFindingLevel, "function");
  assert.equal(typeof simContract.normalizeSimulationViewState, "function");
});

test("I2 — Whole-home demo personas and fallback household use valid room IDs passing validatePersonas", () => {
  const demoState = createWholeHomeDemoState();
  const rooms = listPersonaRooms(demoState);
  assert.equal(validatePersonas(demoState.personas, rooms), null);

  const { household: fromState, usedFallback: fallbackA } =
    resolveHouseholdForSimulation(demoState.house, demoState.personas, rooms);
  assert.equal(fallbackA, false);
  assert.equal(fromState.length, 2);

  // Empty or invalid personas fall back cleanly to createDemoHousehold(house) with valid roomIds
  const { household: fromFallback, usedFallback: fallbackB } =
    resolveHouseholdForSimulation(demoState.house, [], rooms);
  assert.equal(fallbackB, true);
  assert.equal(fromFallback.length, 2);
  const validRoomIds = new Set(rooms.map((r) => r.id));
  for (const member of fromFallback) {
    for (const entry of member.schedule) {
      if (entry.destination?.type === "room") {
        assert.ok(validRoomIds.has(entry.destination.roomId));
      }
    }
  }
});

test("I3 — Real Morning Routine runs simulateHouse() rather than mock timeline", () => {
  const demoState = createWholeHomeDemoState();
  const dataset = runScenarioPlaybackDataset("morning-routine", {
    house: demoState.house,
    items: demoState.items,
    personas: demoState.personas,
  });

  assert.equal(dataset.isMockData, false);
  assert.ok(Array.isArray(dataset.simulation.routes));
  assert.ok(dataset.simulation.routes.length > 0);
  assert.ok(Array.isArray(dataset.simulation.events));
  assert.ok(dataset.simulation.events.length > 0);
  // Real simulation produces deterministic summary metrics (`pathFailures`, `collisions`, `congestionEvents`)
  assert.equal(typeof dataset.simulation.summary.pathFailures, "number");
  assert.equal(dataset.redesignActions.length, 0);
});

test("I4 — Furniture moved in state.items appears at updated coordinates in captured simulation House and preserves Shopify product metadata", () => {
  const demoState = createWholeHomeDemoState();
  const chairIdx = demoState.items.findIndex((i) => i.id === "home-chair");
  assert.ok(chairIdx >= 0);
  const originalChair = demoState.items[chairIdx];
  const catalogEntry = catalog.find((p) => p.id === originalChair.productId);
  assert.ok(catalogEntry);

  const movedItems = demoState.items.map((item, idx) =>
    idx === chairIdx
      ? {
          ...item,
          x: -2.6,
          z: 1.25,
          store: catalogEntry.store,
          url: catalogEntry.url,
          variant: catalogEntry.variant,
        }
      : item,
  );

  const captured = captureStudioLayout(demoState.house, movedItems);
  const capturedChair = captured.objects.find((o) => o.id === "home-chair");
  assert.ok(capturedChair);
  assert.equal(capturedChair.x, -2.6);
  assert.equal(capturedChair.z, 1.25);
  assert.deepEqual(capturedChair.position, [-2.6, 0, 1.25]);
  // Shopify / product metadata is preserved intact
  assert.equal(capturedChair.productId, originalChair.productId);
  assert.equal(capturedChair.price, originalChair.price);
  assert.equal(capturedChair.store, catalogEntry.store);
  assert.equal(capturedChair.url, catalogEntry.url);
  assert.equal(capturedChair.variant, catalogEntry.variant);
});

test("I5 — Real simulation playback spawns 3D avatars using getSimulationSnapshotAt()", () => {
  const house = createWholeHomeDemoHouse();
  const dataset = runScenarioPlaybackDataset("morning-routine", {
    house,
    items: house.objects,
    personas: [],
  });

  const threeScene = new THREE.Scene();
  const layer = createSimulationSceneLayer({ scene: threeScene });
  const playback = createSimulationPlaybackController({
    onFrame({ snapshots, visibleRoutes, agentMeta }) {
      layer.updateAvatars(snapshots, agentMeta);
      layer.updateRoutes(visibleRoutes, agentMeta);
    },
  });

  playback.load({
    simulation: dataset.simulation,
    getSnapshotAt: dataset.getSnapshotAt,
  });
  playback.play();
  playback.step(500);

  assert.equal(layer.getAvatarCount(), 2);
  assert.notEqual(layer.getAvatarMesh("kevin"), null);
  assert.notEqual(layer.getAvatarMesh("alice"), null);

  playback.dispose();
  layer.dispose();
});

test("I6 & I7 — Mock badges disappear for real simulation and only one unified control/results UI renders", () => {
  const demoState = createWholeHomeDemoState();
  const realDataset = runScenarioPlaybackDataset("morning-routine", {
    house: demoState.house,
    items: demoState.items,
    personas: demoState.personas,
  });

  const controlMarkup = renderControlPanelMarkup({
    status: "COMPLETE",
    scenarioId: "morning-routine",
    isMockData: realDataset.isMockData,
  });
  const resultsMarkup = renderResultsDeckMarkup(
    {
      status: "COMPLETE",
      scenarioId: "morning-routine",
      findings: realDataset.findings,
      scores: realDataset.scores,
      beforeScores: realDataset.beforeScores,
      redesignActions: realDataset.redesignActions,
      redesignStatus: realDataset.redesignStatus,
      isMockData: realDataset.isMockData,
    },
    {
      layoutCompare: {
        enabled: true,
        canCapture: true,
        canCompare: false,
        hasBaseline: false,
        statusMessage: "",
      },
    },
  );

  assert.equal(controlMarkup.includes("Demo mock"), false);
  assert.equal(resultsMarkup.includes("Mock preview"), false);
  // Consolidated manual layout comparison lives inside the unified results deck
  assert.equal(resultsMarkup.includes('id="sim-capture-baseline-btn"'), true);

  // Stress scenario without desktop hook remains honestly badged as mock
  const stressMock = runScenarioPlaybackDataset("fire-emergency", {
    house: demoState.house,
    items: demoState.items,
    personas: demoState.personas,
  });
  assert.equal(stressMock.isMockData, true);
});
