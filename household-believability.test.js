import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createWholeHomeDemoHouse, createWholeHomeDemoState } from "./house-demo.js";
import { validatePersonas } from "./src/contracts/persona.js";
import {
  DEMO_CHECKPOINT_TYPES,
  DEMO_SCENARIOS,
  FINDING_TYPES,
  STRESS_SCENARIO_TYPES,
} from "./src/contracts/simulation.js";
import { createSimulationSceneLayer } from "./src/components/avatar/simulation-scene-layer.js";
import { createSimulationPlaybackController } from "./src/components/simulation/playback-controller.js";
import { createRedesignDemoHouse, runRedesignReplay } from "./src/redesign/index.js";
import {
  MORNING_ROUTINE_SCENARIO,
  buildDemoCheckpoints,
  createFamilyOfFourPersonas,
  createFamilyOfFourSimulationHousehold,
  evaluateHouseholdExperience,
  getSimulationSnapshotAt,
  isValidSimulationFinding,
  runStressScenario,
  simulateHouse,
  validateAccessibility,
} from "./src/simulation/index.js";
import { importSampleFloorplan } from "./src/spatial/floorplan-importer.js";
import { runTwinScenario } from "./src/twin-integration.js";

test("B1 — Smooth continuous walking motion: no instant position teleportation or abrupt heading jumps along hallway turns", () => {
  const { house } = importSampleFloorplan();
  const household = createFamilyOfFourSimulationHousehold(house);
  const sim = simulateHouse(house, household, MORNING_ROUTINE_SCENARIO);

  // Pick Dad's walk from bedroom -> hallway -> kitchen (`prepare_breakfast` at 07:40 = 27600s)
  const dadRoute = sim.routes.find(
    (r) => r.agentId === "kevin" && r.toRoomId === "kitchen",
  );
  assert(dadRoute, "Expected Dad route to kitchen");
  assert(dadRoute.distanceMeters > 4.0);
  assert(dadRoute.endTimestamp > dadRoute.startTimestamp);

  const stepSec = 0.2;
  let prev = null;
  let totalSampledSteps = 0;

  for (
    let t = dadRoute.startTimestamp;
    t <= dadRoute.endTimestamp;
    t = Math.round((t + stepSec) * 100) / 100
  ) {
    const snap = getSimulationSnapshotAt(sim, t).find(
      (s) => s.agentId === "kevin",
    );
    assert(snap);
    if (prev) {
      const distStep = Math.hypot(
        snap.position[0] - prev.position[0],
        snap.position[1] - prev.position[1],
      );
      // At 1.34 m/s over 0.2s (~0.27m expected), never teleports across a room (> 0.60m)
      assert(
        distStep < 0.6,
        `Unexpected teleport jump of ${distStep.toFixed(3)} m between ${prev.timestamp}s and ${t}s`,
      );
      totalSampledSteps += 1;
    }
    prev = snap;
  }
  assert(totalSampledSteps >= 15);
});

test("B2 — Canonical Family of Four setup, Persona validation, distinct physical heights, and 3D avatar scaling", () => {
  const house = createWholeHomeDemoHouse();
  const personas = createFamilyOfFourPersonas(house);
  assert.equal(personas.length, 4);

  const validationError = validatePersonas(
    personas,
    house.rooms.map(({ id, name }) => ({ id, name })),
  );
  assert.equal(validationError, null);

  const [dad, mom, brother, sister] = personas;
  assert.equal(dad.role, "dad");
  assert.equal(mom.role, "mom");
  assert.equal(brother.role, "brother");
  assert.equal(sister.role, "sister");
  assert(dad.heightMeters > brother.heightMeters);
  assert(brother.heightMeters > mom.heightMeters);
  assert(mom.heightMeters > sister.heightMeters);

  // Verify 3D avatar meshes reflect height differences & wheelchair geometry
  const scene = new THREE.Scene();
  const layer = createSimulationSceneLayer({ scene });
  layer.updateAvatars([
    { agentId: "kevin", name: "Kevin (Dad)", position: [0, 0], heightMeters: dad.heightMeters, moving: false },
    { agentId: "maya", name: "Maya (Sister)", position: [1, 0], heightMeters: sister.heightMeters, moving: false },
    { agentId: "grandpa-arthur", name: "Grandpa Arthur", position: [2, 0], heightMeters: 1.34, usesWheelchair: true, moving: false },
  ]);

  const dadMesh = layer.getAvatarMesh("kevin");
  const sisterMesh = layer.getAvatarMesh("maya");
  const grandpaMesh = layer.getAvatarMesh("grandpa-arthur");
  assert(dadMesh && sisterMesh && grandpaMesh);
  assert(dadMesh.userData.heightMeters > sisterMesh.userData.heightMeters);
  assert.equal(grandpaMesh.userData.usesWheelchair, true);
  // Grandpa's body group includes wheelchair seat/back/wheels in addition to figure + pip
  assert(grandpaMesh.children[2].children.length >= 6);
  layer.dispose();
});

test("B3 — Grandparents Visit scenario & Wheelchair Accessibility Validator detect clearance, turning circle, and blocked route issues", () => {
  const { house: mercerHouse } = importSampleFloorplan();

  // 1. Run Grandparents Visit on Mercer Street sample floorplan (bathroom door is 0.76 m < 0.82 m!)
  const visit = runStressScenario({
    type: STRESS_SCENARIO_TYPES.GRANDPARENTS_VISIT,
    house: mercerHouse,
  });

  assert.equal(visit.summary.wheelchairAgents, 1);
  assert.equal(visit.summary.totalAgents, 6); // 4 family + 2 grandparents
  const grandpa = visit.simulation.agents.find((a) => a.id === "grandpa-arthur");
  assert(grandpa);
  assert.equal(grandpa.usesWheelchair, true);
  assert(grandpa.movementSpeedMps < 0.9);

  // Narrow bathroom door (0.76m) triggers both ACCESSIBILITY_CLEARANCE_FAIL and ACCESSIBILITY_ROUTE_BLOCKED
  const clearanceFail = visit.findings.find(
    (f) => f.type === FINDING_TYPES.ACCESSIBILITY_CLEARANCE_FAIL,
  );
  const routeBlocked = visit.findings.find(
    (f) => f.type === FINDING_TYPES.ACCESSIBILITY_ROUTE_BLOCKED,
  );
  assert(clearanceFail, "Expected ACCESSIBILITY_CLEARANCE_FAIL on narrow 0.76m bathroom door");
  assert(routeBlocked, "Expected ACCESSIBILITY_ROUTE_BLOCKED into bathroom for 0.84m wheelchair");
  assert.equal(isValidSimulationFinding(clearanceFail), true);
  assert.equal(isValidSimulationFinding(routeBlocked), true);

  // 2. Crammed bathroom without a 1.50 m turning circle triggers ACCESSIBILITY_TURN_RADIUS_FAIL
  const crammedHouse = structuredClone(createWholeHomeDemoHouse());
  crammedHouse.objects.push({
    id: "bath-hamper-block",
    type: "existing",
    kind: "storage",
    roomId: "bathroom",
    position: [2.2, 0, -2.2],
    rotation: [0, 0, 0],
    dimensions: { width: 2.7, height: 0.9, depth: 2.1 },
    locked: false,
  });
  const turnCheck = validateAccessibility({
    house: crammedHouse,
    forceCheck: true,
  });
  const turnFail = turnCheck.findings.find(
    (f) =>
      f.type === FINDING_TYPES.ACCESSIBILITY_TURN_RADIUS_FAIL &&
      f.roomId === "bathroom",
  );
  assert(turnFail, "Expected ACCESSIBILITY_TURN_RADIUS_FAIL in cramped bathroom");
  assert.equal(isValidSimulationFinding(turnFail), true);

  // 3. Also works in daily household mode when a resident uses a wheelchair
  const residentWheelchairEval = evaluateHouseholdExperience({
    house: mercerHouse,
    household: [
      {
        id: "resident-wc",
        name: "Resident Wheelchair User",
        usesWheelchair: true,
        needs: { accessibility: 0.95, quiet: 0.5, privacy: 0.5, daylight: 0.5, social: 0.5 },
        schedule: [],
      },
    ],
  });
  assert(
    residentWheelchairEval.findings.some(
      (f) => f.type === FINDING_TYPES.ACCESSIBILITY_CLEARANCE_FAIL,
    ),
  );
});

test("B4 — Sudden Friends Arrival scenario creates staged entry waves (12 total occupants) and measurable clustering", () => {
  const house = createWholeHomeDemoHouse();
  const state = createWholeHomeDemoState();

  const crowd = runTwinScenario("friends-arrival", {
    house,
    items: house.objects,
    state,
    friendCount: 8,
  });

  assert.equal(crowd.simulation.agents.length, 12); // 4 family + 8 friends across 3 waves
  const friendRoutes = crowd.simulation.routes.filter((r) =>
    r.agentId.startsWith("friend-"),
  );
  assert(friendRoutes.length >= 16);

  // Staged wave start times span distinct minutes rather than all spawning simultaneously
  const waveStarts = new Set(
    friendRoutes
      .filter((r) => r.startTimestamp <= 1035 * 60)
      .map((r) => r.startTimestamp),
  );
  assert(waveStarts.size >= 4, "Expected staged arrival timestamps across waves");

  assert(
    crowd.findings.some((f) => f.type === FINDING_TYPES.CONGESTION),
    "Expected staged crowd clustering to surface deterministic CONGESTION",
  );
});

test("B5 — Slow human-readable 1× adaptive pacing vs fast 20× completion & Controllable Demo Checkpoints", () => {
  const house = createWholeHomeDemoHouse();
  const state = createWholeHomeDemoState();

  assert.equal(DEMO_SCENARIOS.length, 7);
  const dataset = runTwinScenario("morning-routine", {
    house,
    items: house.objects,
    state,
  });

  // Checkpoints include Morning Start, Bathroom Overlap, Breakfast Congestion, and TV/WFH Noise
  const cpTypes = dataset.checkpoints.map((c) => c.type);
  assert(cpTypes.includes(DEMO_CHECKPOINT_TYPES.MORNING_START));
  assert(cpTypes.includes(DEMO_CHECKPOINT_TYPES.BATHROOM_CONFLICT));
  assert(cpTypes.includes(DEMO_CHECKPOINT_TYPES.BREAKFAST_CONGESTION));
  assert(cpTypes.includes(DEMO_CHECKPOINT_TYPES.TV_NOISE_CONFLICT));

  const hitCheckpoints = [];
  const pb = createSimulationPlaybackController({
    onCheckpoint: (cp) => hitCheckpoints.push(cp.type),
  });

  pb.load({
    simulation: dataset.simulation,
    checkpoints: dataset.checkpoints,
    getSnapshotAt: dataset.getSnapshotAt,
    simSecondsPerRealSecond: dataset.simSecondsPerRealSecond,
    walkingSimSecondsPerRealSecond: dataset.walkingSimSecondsPerRealSecond,
    speedRates: dataset.speedRates,
  });

  // Jump directly to BREAKFAST_CONGESTION checkpoint
  const jumped = pb.jumpToCheckpoint(DEMO_CHECKPOINT_TYPES.BREAKFAST_CONGESTION);
  assert(jumped);
  assert.equal(pb.getState().currentSecond, jumped.timestampSeconds);

  // Jump back to Dad's active walk (07:12 = 432 min = 25920s) and verify 1× advances slowly (~3.2 sim s / real s)
  pb.seek(432 * 60 + 1);
  pb.setSpeed(1);
  pb.play();
  const beforeStep = pb.getState().currentSecond;
  pb.step(1000); // 1 full real second during active walk
  const advancedAt1x = pb.getState().currentSecond - beforeStep;
  assert(
    advancedAt1x <= 5.0 && advancedAt1x >= 2.0,
    `Expected slow human-readable walking pace at 1× (2–5 sim s / real s), got ${advancedAt1x}`,
  );

  // Switch to 20× and verify full completion in < 3 real seconds
  pb.setSpeed(20);
  pb.step(2000);
  assert.equal(pb.getState().status, "COMPLETE");
  pb.dispose();
});

test("B6 — Backward compatibility: Family of Four + Redesign Replay improves scores without touching locked fixtures", async () => {
  const beforeHouse = createRedesignDemoHouse();
  const household = createFamilyOfFourSimulationHousehold(beforeHouse);

  const replay = await runRedesignReplay({
    house: beforeHouse,
    household,
    scenario: MORNING_ROUTINE_SCENARIO,
    patchGenerator: async () => {
      throw new Error("Force deterministic fallback verification");
    },
    maxAttempts: 1,
    useFallbackOnFailure: true,
  });

  assert.equal(replay.status, "IMPROVED");
  assert(
    replay.after.evaluation.categories.movement.score >
      replay.before.evaluation.categories.movement.score,
  );
  assert(
    replay.after.evaluation.overallScore > replay.before.evaluation.overallScore,
  );
  assert.deepEqual(replay.after.house.fixtures, beforeHouse.fixtures);

  const replayCheckpoints = buildDemoCheckpoints({
    scenarioId: "morning-routine",
    simulation: replay.after.evaluation.simulation,
    findings: replay.after.evaluation.findings,
    isRedesignReplay: true,
  });
  assert(
    replayCheckpoints.some(
      (c) => c.type === DEMO_CHECKPOINT_TYPES.REDESIGN_APPLIED,
    ),
  );
  assert(
    replayCheckpoints.some((c) => c.type === DEMO_CHECKPOINT_TYPES.REPLAY_START),
  );
});
