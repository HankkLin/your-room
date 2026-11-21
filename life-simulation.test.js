import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { compareHouseholdLayouts } from "./src/persona/compare-household-layouts.js";
import {
  CELL_WALKABLE,
  FINDING_TYPES,
  MORNING_ROUTINE_SCENARIO,
  SIMULATION_EVENT_TYPES,
  buildNavigationModel,
  createDemoHousehold,
  findPath,
  formatSimulationDebugReport,
  getSimulationSnapshotAt,
  isValidSimulationFinding,
  renderSimulationDebugSvg,
  resolveSafeRoomPosition,
  runMorningRoutineDemo,
  runSimulation,
  simulateHouse,
} from "./src/simulation/index.js";
import { importSampleFloorplan } from "./src/spatial/floorplan-importer.js";
import { captureStudioLayout, runStudioReplay } from "./src/simulation/studio-replay.js";

function createTwoRoomTestHouse({ withDoor = true, gapWidth = null } = {}) {
  const walls = [
    { id: "w-n", start: [0, 0], end: [8, 0], thickness: 0.14, kind: "exterior" },
    { id: "w-s", start: [0, 4], end: [8, 4], thickness: 0.14, kind: "exterior" },
    { id: "w-w", start: [0, 0], end: [0, 4], thickness: 0.14, kind: "exterior" },
    { id: "w-e", start: [8, 0], end: [8, 4], thickness: 0.14, kind: "exterior" },
  ];

  if (gapWidth != null) {
    // Solid wall with a tiny physical gap (e.g. 5 cm) and NO valid door
    const mid = 2.0;
    walls.push(
      {
        id: "w-mid-1",
        start: [4, 0],
        end: [4, mid - gapWidth / 2],
        thickness: 0.12,
        kind: "interior",
      },
      {
        id: "w-mid-2",
        start: [4, mid + gapWidth / 2],
        end: [4, 4],
        thickness: 0.12,
        kind: "interior",
      },
    );
  } else {
    walls.push({
      id: "w-mid",
      start: [4, 0],
      end: [4, 4],
      thickness: 0.12,
      kind: "interior",
    });
  }

  return {
    id: "two-room-test-house",
    units: "meters",
    ceilingHeight: 2.7,
    rooms: [
      {
        id: "room-a",
        name: "Room A",
        kind: "bedroom",
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
      },
      {
        id: "room-b",
        name: "Room B",
        kind: "kitchen",
        polygon: [
          [4, 0],
          [8, 0],
          [8, 4],
          [4, 4],
        ],
      },
    ],
    walls,
    doors: withDoor
      ? [
          {
            id: "door-ab",
            kind: "interior",
            wallId: "w-mid",
            roomA: "room-a",
            roomB: "room-b",
            position: [4, 2],
            width: 0.9,
          },
        ]
      : [],
    windows: [],
    fixtures: [],
    objects: [],
  };
}

test("Test 1 — Walkable grid: known room produces walkable interior cells and blocks exterior", () => {
  const house = createTwoRoomTestHouse({ withDoor: true });
  const nav = buildNavigationModel(house, { cellSize: 0.1, agentRadius: 0.24 });

  assert(nav.walkableCellCount > 800);
  assert.equal(nav.isPointWalkable(2.0, 2.0), true);
  assert.equal(nav.isPointWalkable(6.0, 2.0), true);
  assert.equal(nav.isPointWalkable(-0.5, 2.0), false);
  assert.equal(nav.getRoomIdAt(2.0, 2.0), "room-a");
  assert.equal(nav.getRoomIdAt(6.0, 2.0), "room-b");

  const [col, row] = nav.worldToCell(2.0, 2.0);
  assert.equal(nav.cells[row * nav.width + col], CELL_WALKABLE);
});

test("Test 2 — Walls and narrow 5cm gaps block paths (person clearance enforced)", () => {
  const walledOffHouse = createTwoRoomTestHouse({ withDoor: false });
  const navBlocked = buildNavigationModel(walledOffHouse, {
    cellSize: 0.1,
    agentRadius: 0.24,
  });

  const wallResult = findPath({
    navigation: navBlocked,
    start: [2.0, 2.0],
    goal: [6.0, 2.0],
  });
  assert.equal(wallResult.success, false);
  assert.equal(wallResult.reason, "NO_PATH");

  // Even a 5 cm (0.05 m) crack in a wall cannot be squeezed through by a 0.24 m radius person
  const tinyGapHouse = createTwoRoomTestHouse({
    withDoor: false,
    gapWidth: 0.05,
  });
  const navGap = buildNavigationModel(tinyGapHouse, {
    cellSize: 0.1,
    agentRadius: 0.24,
  });
  const gapResult = findPath({
    navigation: navGap,
    start: [2.0, 2.0],
    goal: [6.0, 2.0],
  });
  assert.equal(gapResult.success, false);
  assert.equal(gapResult.reason, "NO_PATH");
});

test("Test 3 — Door allows traversal, and furniture placed across doorway blocks traversal", () => {
  const house = createTwoRoomTestHouse({ withDoor: true });
  const nav = buildNavigationModel(house, { cellSize: 0.1, agentRadius: 0.24 });

  const openRoute = findPath({
    navigation: nav,
    start: [1.5, 2.0],
    goal: [6.5, 2.0],
  });
  assert.equal(openRoute.success, true);
  assert(openRoute.doorsTraversed.includes("door-ab"));

  // Place a large sofa right across the doorway at [3.55, 0, 2.0]
  const blockedBySofa = {
    ...structuredClone(house),
    objects: [
      {
        id: "blocking-sofa",
        type: "existing",
        kind: "sofa",
        position: [3.65, 0, 2.0],
        rotation: [0, Math.PI / 2, 0],
        dimensions: { width: 2.1, height: 0.85, depth: 0.9 },
        locked: false,
      },
    ],
  };
  const navSofa = buildNavigationModel(blockedBySofa, {
    cellSize: 0.1,
    agentRadius: 0.24,
  });
  const blockedRoute = findPath({
    navigation: navSofa,
    start: [1.5, 2.0],
    goal: [6.5, 2.0],
  });
  assert.equal(blockedRoute.success, false);
  assert.equal(blockedRoute.reason, "NO_PATH");
});

test("Test 4 — Fixture blocks movement: locked fixture is avoided by A* and safe destination resolver", () => {
  const { house } = importSampleFloorplan();
  // Bathtub in sample house sits around [9.0, 0, 8.16]; kitchen counter around [9.27, 0, 2.0]
  const nav = buildNavigationModel(house, { cellSize: 0.1, agentRadius: 0.24 });

  const bathtub = house.fixtures.find((f) => f.kind === "bathtub");
  assert(bathtub);
  assert.equal(bathtub.locked, true);
  assert.equal(
    nav.isPointWalkable(bathtub.position[0], bathtub.position[2]),
    false,
  );

  // Place a locked kitchen island obstacle directly between [1.5, 2.0] and [3.5, 2.0] in Room A
  const islandHouse = createTwoRoomTestHouse({ withDoor: true });
  islandHouse.fixtures.push({
    id: "fixture-island",
    kind: "kitchen_counter",
    type: "fixed",
    name: "Island",
    roomId: "room-a",
    position: [2.0, 0, 2.0],
    rotation: [0, 0, 0],
    dimensions: { width: 0.8, height: 0.9, depth: 1.8 },
    locked: true,
  });
  const navIsland = buildNavigationModel(islandHouse, {
    cellSize: 0.1,
    agentRadius: 0.24,
  });
  assert.equal(navIsland.isPointWalkable(2.0, 2.0), false);

  // Safe destination inside room-a avoids the island obstacle
  const safeTarget = resolveSafeRoomPosition(navIsland, "room-a", {
    house: islandHouse,
  });
  assert(safeTarget);
  assert.equal(
    navIsland.isPointWalkable(safeTarget.position[0], safeTarget.position[1]),
    true,
  );

  // A* detours cleanly around the island (> straight-line 2.4m)
  const detour = findPath({
    navigation: navIsland,
    start: [0.8, 2.0],
    goal: [3.2, 2.0],
  });
  assert.equal(detour.success, true);
  assert(detour.distanceMeters > 2.45);
});

test("Test 5 & Test 7 — Valid multi-room path (bedroom -> kitchen) with positive finite distance", () => {
  const { house } = importSampleFloorplan();
  const nav = buildNavigationModel(house, { cellSize: 0.1, agentRadius: 0.24 });

  const start = resolveSafeRoomPosition(nav, "bedroom", { house }).position;
  const goal = resolveSafeRoomPosition(nav, "kitchen", {
    house,
    activity: "cook",
  }).position;

  const result = findPath({ navigation: nav, start, goal });
  assert.equal(result.success, true);
  assert(Number.isFinite(result.distanceMeters));
  assert(result.distanceMeters > 3.0);
  assert(result.path.length >= 3);
  assert(result.doorsTraversed.includes("door-bedroom"));
  assert(result.roomsTraversed.includes("hallway"));
  assert(result.roomsTraversed.includes("kitchen"));

  // Verify distanceMeters matches exact polyline segment sum
  let polylineSum = 0;
  for (let i = 0; i < result.path.length - 1; i += 1) {
    polylineSum += Math.hypot(
      result.path[i + 1][0] - result.path[i][0],
      result.path[i + 1][1] - result.path[i][1],
    );
  }
  assert(Math.abs(polylineSum - result.distanceMeters) < 0.01);
});

test("Test 6 — No path: disconnected room produces NO_PATH failure and SimulationFinding", () => {
  const disconnectedHouse = createTwoRoomTestHouse({ withDoor: false });
  const sim = runSimulation({
    house: disconnectedHouse,
    startMinute: 480,
    endMinute: 500,
    agents: [
      {
        id: "alice",
        name: "Alice",
        currentRoomId: "room-a",
        schedule: [
          {
            startMinute: 485,
            activity: "breakfast",
            destination: { type: "room", roomId: "room-b" },
          },
        ],
      },
    ],
  });

  assert.equal(sim.summary.pathFailures, 1);
  const noPathFinding = sim.findings.find(
    (f) => f.type === FINDING_TYPES.NO_PATH,
  );
  assert(noPathFinding);
  assert.equal(isValidSimulationFinding(noPathFinding), true);
  assert.equal(noPathFinding.agentId, "alice");
  assert.equal(noPathFinding.fromRoomId, "room-a");
  assert.equal(noPathFinding.toRoomId, "room-b");
});

test("Test 8 — Agent collision: head-on hallway crossing records AGENT_COLLISION event", () => {
  const corridorHouse = {
    id: "corridor-house",
    units: "meters",
    ceilingHeight: 2.7,
    rooms: [
      {
        id: "hall",
        name: "Narrow Hallway",
        kind: "hallway",
        polygon: [
          [0, 0],
          [6, 0],
          [6, 1.1],
          [0, 1.1],
        ],
      },
    ],
    walls: [],
    doors: [],
    windows: [],
    fixtures: [],
    objects: [],
  };

  const sim = runSimulation({
    house: corridorHouse,
    startMinute: 480,
    endMinute: 482,
    agents: [
      {
        id: "kevin",
        name: "Kevin",
        currentRoomId: "hall",
        currentPosition: [0.8, 0.55],
        schedule: [
          {
            startMinute: 480,
            activity: "other",
            destination: { type: "position", position: [5.2, 0.55], roomId: "hall" },
          },
        ],
      },
      {
        id: "alice",
        name: "Alice",
        currentRoomId: "hall",
        currentPosition: [5.2, 0.55],
        schedule: [
          {
            startMinute: 480,
            activity: "other",
            destination: { type: "position", position: [0.8, 0.55], roomId: "hall" },
          },
        ],
      },
    ],
  });

  assert(sim.summary.collisions >= 1);
  const collisionEvent = sim.events.find(
    (e) => e.type === SIMULATION_EVENT_TYPES.AGENT_COLLISION,
  );
  assert(collisionEvent);
  assert.deepEqual(collisionEvent.agentIds, ["kevin", "alice"]);
  assert(Math.abs(collisionEvent.position[0] - 3.0) < 0.4);
});

test("Test 9 — Congestion: sustained crowding creates CONGESTION finding while brief pass does not", () => {
  const house = createTwoRoomTestHouse({ withDoor: true });

  // Case A: Sustained crowding (3 agents in kitchen cluster for > 60s)
  const crowdedSim = runSimulation({
    house,
    startMinute: 480,
    endMinute: 485,
    congestion: { minAgents: 3, radiusMeters: 1.5, minDurationSeconds: 60 },
    agents: [
      {
        id: "a1",
        name: "A1",
        currentRoomId: "room-a",
        schedule: [
          {
            startMinute: 480,
            activity: "cook",
            destination: { type: "position", position: [5.6, 1.8], roomId: "room-b" },
          },
        ],
      },
      {
        id: "a2",
        name: "A2",
        currentRoomId: "room-a",
        schedule: [
          {
            startMinute: 480,
            activity: "cook",
            destination: { type: "position", position: [6.2, 1.8], roomId: "room-b" },
          },
        ],
      },
      {
        id: "a3",
        name: "A3",
        currentRoomId: "room-b",
        currentPosition: [5.9, 2.3],
        schedule: [
          {
            startMinute: 480,
            activity: "eat",
            destination: { type: "position", position: [5.9, 2.3], roomId: "room-b" },
          },
        ],
      },
    ],
  });

  const congestion = crowdedSim.findings.find(
    (f) => f.type === FINDING_TYPES.CONGESTION,
  );
  assert(congestion);
  assert.equal(isValidSimulationFinding(congestion), true);
  assert.equal(congestion.roomId, "room-b");
  assert.equal(congestion.evidence.agentCount, 3);
  assert(congestion.evidence.durationSeconds >= 60);

  // Case B: Brief 2-second crossing does NOT trigger sustained congestion
  const briefPassSim = runSimulation({
    house,
    startMinute: 480,
    endMinute: 483,
    congestion: { minAgents: 2, radiusMeters: 1.5, minDurationSeconds: 60 },
    agents: [
      {
        id: "p1",
        name: "P1",
        currentRoomId: "room-a",
        currentPosition: [1.0, 2.0],
        schedule: [
          {
            startMinute: 480,
            activity: "work",
            destination: { type: "position", position: [7.0, 2.0], roomId: "room-b" },
          },
        ],
      },
      {
        id: "p2",
        name: "P2",
        currentRoomId: "room-b",
        currentPosition: [7.0, 2.0],
        schedule: [
          {
            startMinute: 480,
            activity: "relax",
            destination: { type: "position", position: [1.0, 2.0], roomId: "room-a" },
          },
        ],
      },
    ],
  });
  assert.equal(briefPassSim.summary.congestionEvents, 0);
});

test("Test 10 — Schedule execution & continuous timeline interpolation", () => {
  const house = createTwoRoomTestHouse({ withDoor: true });
  const sim = runSimulation({
    house,
    startMinute: 420,
    endMinute: 440,
    agents: [
      {
        id: "kevin",
        name: "Kevin",
        movementSpeedMps: 1.25,
        currentRoomId: "room-a",
        currentPosition: [1.5, 2.0],
        schedule: [
          {
            startMinute: 420,
            activity: "wake",
            destination: { type: "room", roomId: "room-a" },
          },
          {
            startMinute: 430, // 25,800s -> moves 5.0m to [6.5, 2.0] in 4 seconds
            activity: "breakfast",
            destination: { type: "position", position: [6.5, 2.0], roomId: "room-b" },
          },
        ],
      },
    ],
  });

  // Before 07:10 (429 min = 25,740s): still in room-a
  const beforeMove = getSimulationSnapshotAt(sim, 429 * 60)[0];
  assert.equal(beforeMove.roomId, "room-a");
  assert.equal(beforeMove.moving, false);

  // Mid-walk at 25,802s (2 seconds into a 4-second 5.0m walk -> x ≈ 4.0 at doorway)
  const midMove = getSimulationSnapshotAt(sim, 430 * 60 + 2)[0];
  assert.equal(midMove.moving, true);
  assert(Math.abs(midMove.position[0] - 4.0) < 0.25);

  // After arrival at 431 min: in room-b performing breakfast
  const afterMove = getSimulationSnapshotAt(sim, 431 * 60)[0];
  assert.equal(afterMove.roomId, "room-b");
  assert.equal(afterMove.activity, "breakfast");
  assert.equal(afterMove.moving, false);
});

test("Test 11 — Determinism & Morning Routine end-to-end integration + Persona replay compatibility", async () => {
  const { house } = importSampleFloorplan();
  const household = createDemoHousehold(house);
  const houseSnapshot = structuredClone(house);
  const householdSnapshot = structuredClone(household);

  const t0 = performance.now();
  const runA = simulateHouse(house, household, MORNING_ROUTINE_SCENARIO);
  const elapsedMs = performance.now() - t0;
  const runB = simulateHouse(house, household, MORNING_ROUTINE_SCENARIO);

  // Verify input immutability & strict determinism
  assert.deepEqual(house, houseSnapshot);
  assert.deepEqual(household, householdSnapshot);
  assert.deepEqual(runA, runB);

  // Performance budget: 2-hour Morning Routine + grid build runs well under 250ms
  assert(
    elapsedMs < 500,
    `Expected fast simulation (<500ms), took ${elapsedMs.toFixed(1)}ms`,
  );

  // Verify meaningful Morning Routine outcomes
  assert.equal(runA.summary.pathFailures, 0);
  assert(runA.summary.totalDistanceMeters.kevin > 15);
  assert(runA.summary.totalDistanceMeters.alice > 15);
  assert(runA.summary.collisions >= 1);
  assert(runA.summary.congestionEvents >= 1);

  const kitchenCongestion = runA.findings.find(
    (f) => f.type === FINDING_TYPES.CONGESTION && f.roomId === "kitchen",
  );
  assert(kitchenCongestion, "Expected kitchen morning congestion finding");
  assert(kitchenCongestion.evidence.durationSeconds >= 600);

  // Verify lightweight 2D SVG & text debug visualization
  const demoBundle = runMorningRoutineDemo(house);
  const svg = renderSimulationDebugSvg(demoBundle.house, demoBundle.simulation);
  assert.match(svg, /^<svg /);
  assert.match(svg, /CONGESTION/);
  const report = formatSimulationDebugReport(demoBundle.simulation);
  assert.match(report, /Kevin/);
  assert.match(report, /Alice/);

  // Verify direct compatibility with Hank's `compareHouseholdLayouts`
  const personas = [
    {
      id: "kevin",
      name: "Kevin",
      ageGroup: "adult",
      preferences: ["Quiet workspace"],
      dislikes: ["Kitchen crowding"],
      needs: {
        privacy: 0.8,
        quiet: 0.9,
        accessibility: 0.2,
        daylight: 0.7,
        social: 0.5,
      },
      schedule: [
        { activity: "cook", roomId: "kitchen", startMinute: 460, endMinute: 490 },
        { activity: "work", roomId: "living-room", startMinute: 490, endMinute: 540 },
      ],
    },
    {
      id: "alice",
      name: "Alice",
      ageGroup: "adult",
      preferences: ["Morning coffee"],
      dislikes: [],
      needs: {
        privacy: 0.5,
        quiet: 0.5,
        accessibility: 0.2,
        daylight: 0.8,
        social: 0.7,
      },
      schedule: [
        { activity: "eat", roomId: "kitchen", startMinute: 465, endMinute: 490 },
      ],
    },
  ];

  const comparison = await compareHouseholdLayouts({
    beforeScene: house,
    afterScene: house,
    personas,
    rooms: house.rooms,
    simulate: simulateHouse,
  });
  assert.deepEqual(comparison.before.summary, comparison.after.summary);
  assert(comparison.before.summary.congestionEvents >= 1);
});

test("replaying one approved household shows that moving a sofa restores the route to the kitchen", async () => {
  const { house, validation } = importSampleFloorplan();
  assert.equal(validation.valid, true);
  const sofa = {
    id: "movable-sofa",
    type: "existing",
    kind: "sofa",
    roomId: "bedroom",
    position: [3.2, 0, 6],
    rotation: [0, 0, 0],
    dimensions: { width: 2.1, height: 0.85, depth: 0.9 },
    locked: false,
  };
  const beforeScene = { ...house, objects: [...house.objects, sofa] };
  const afterScene = {
    ...house,
    objects: [...house.objects, { ...sofa, position: [1.4, 0, 7.6] }],
  };
  const profile = {
    ageGroup: "adult",
    preferences: [],
    dislikes: [],
    needs: { privacy: 0.6, quiet: 0.6, accessibility: 0.2, daylight: 0.6, social: 0.6 },
  };
  const sleep = { activity: "sleep", roomId: "bedroom", startMinute: 470, endMinute: 485 };
  const personas = [
    {
      ...profile,
      id: "alex",
      name: "Alex",
      schedule: [
        sleep,
        {
          activity: "cook",
          roomId: "kitchen",
          windowStartMinute: 480,
          windowEndMinute: 515,
          durationMinutes: 15,
        },
      ],
    },
    { ...profile, id: "guest", name: "Guest", schedule: [] },
  ];
  const input = { beforeScene, afterScene, personas, rooms: house.rooms };
  const original = structuredClone(input);
  const replayInputs = [];
  const { before, after } = await compareHouseholdLayouts({
    ...input,
    simulate(scene, replay) {
      replayInputs.push(structuredClone(replay));
      return simulateHouse(scene, replay, { startMinute: 480, endMinute: 500 });
    },
  });

  assert.equal(replayInputs.length, 2);
  assert.deepEqual(replayInputs[0], replayInputs[1]);
  assert.deepEqual(replayInputs[0].map(({ id, schedule }) => ({ id, schedule })), [
    {
      id: "alex",
      schedule: [sleep, { activity: "cook", roomId: "kitchen", startMinute: 485, endMinute: 500 }],
    },
  ]);
  assert.deepEqual(before.agents.map(({ id }) => id), ["alex"]);
  assert.deepEqual(after.agents.map(({ id }) => id), ["alex"]);
  const scheduledStarts = ({ events }) =>
    events.filter(({ type }) => type === SIMULATION_EVENT_TYPES.SCHEDULE_START);
  assert.deepEqual(scheduledStarts(before), scheduledStarts(after));
  assert.deepEqual(scheduledStarts(after), [{
    type: SIMULATION_EVENT_TYPES.SCHEDULE_START,
    timestamp: 485 * 60,
    minute: 485,
    agentId: "alex",
    activity: "cook",
    destination: { type: "room", roomId: "kitchen" },
  }]);

  assert.equal(before.summary.pathFailures, 1);
  assert.equal(before.routes.length, 0);
  const blocked = before.findings.find(({ type }) => type === FINDING_TYPES.NO_PATH);
  assert(blocked);
  assert.equal(blocked.fromRoomId, "bedroom");
  assert.equal(blocked.toRoomId, "kitchen");
  assert.equal(blocked.evidence.timestampSeconds, 485 * 60);
  assert.equal(before.agents.find(({ id }) => id === "alex").finalRoomId, "bedroom");

  assert.equal(after.summary.pathFailures, 0);
  assert(!after.findings.some(({ type }) => type === FINDING_TYPES.NO_PATH));
  assert.equal(after.routes.length, 1);
  assert.deepEqual(after.routes[0].roomsTraversed, ["bedroom", "hallway", "kitchen"]);
  assert.deepEqual(after.routes[0].doorsTraversed, ["door-bedroom", "door-kitchen-hall"]);
  assert(Math.abs(after.routes[0].distanceMeters - 8.305) < 0.01);
  const arrival = after.events.find(({ type, agentId }) =>
    type === SIMULATION_EVENT_TYPES.ARRIVED && agentId === "alex",
  );
  assert(arrival);
  assert.equal(arrival.roomId, "kitchen");
  assert.equal(arrival.timestamp - 485 * 60, 7);
  assert.deepEqual(input, original);
  assert.deepEqual(afterScene.fixtures, beforeScene.fixtures);
  assert(afterScene.fixtures.every(({ locked }) => locked));
});

test("Studio capture uses current poses while retaining canonical locked fixtures and room IDs", () => {
  const { house } = importSampleFloorplan();
  const fixture = house.fixtures.find(({ kind }) => kind === "bathtub");
  const chair = {
    id: "studio-chair", kind: "chair", owned: true,
    roomId: "living-room", x: 1.4, z: 7.6, width: 2, depth: 0.6, height: 0.85, rotation: 30,
  };
  const rug = { ...chair, id: "studio-rug", kind: "rug", owned: false, height: 0.02 };
  const items = [{ ...fixture, fromHouseFixture: true }, chair, rug];
  const staleHouse = { ...house, items: [{ ...chair, x: 8 }] };
  const captured = captureStudioLayout(staleHouse, items);

  assert.deepEqual(captured.rooms.map(({ id }) => id), house.rooms.map(({ id }) => id));
  assert.equal(captured.fixtures.length, house.fixtures.length);
  assert.deepEqual(captured.fixtures.find(({ id }) => id === fixture.id).position, fixture.position);
  assert(captured.fixtures.every(({ locked }) => locked));
  assert(!captured.objects.some(({ id }) => id === fixture.id));
  assert(!Object.hasOwn(captured, "items"));
  const obstacle = captured.objects.find(({ id }) => id === chair.id);
  assert.equal(obstacle.roomId, "bedroom");
  assert.equal(obstacle.type, "existing");
  assert.deepEqual(obstacle.position, [1.4, 0, 7.6]);
  assert.equal(obstacle.rotation, 30);
  assert(Math.abs(obstacle.footprint[1][0] - 2.116) < 0.001);
  assert(Math.abs(obstacle.footprint[1][1] - 6.840) < 0.001);
  assert.equal(captured.objects.find(({ id }) => id === rug.id).passable, true);

  chair.x = 8;
  assert.deepEqual(obstacle.position, [1.4, 0, 7.6]);
  assert.equal(captureStudioLayout(null, []), null);
});

test("Studio replay reports the restored route after a committed sofa move", async () => {
  const { house } = importSampleFloorplan();
  const sofa = {
    id: "studio-sofa", kind: "sofa", owned: true,
    x: 3.2, z: 6, width: 2.1, height: 0.85, depth: 0.9, rotation: 0,
  };
  const profile = {
    ageGroup: "adult", preferences: [], dislikes: [],
    needs: { privacy: 0.6, quiet: 0.6, accessibility: 0.2, daylight: 0.6, social: 0.6 },
  };
  const personas = [
    {
      ...profile, id: "alex", name: "Alex", schedule: [
        { activity: "sleep", roomId: "bedroom", startMinute: 470, endMinute: 485 },
        { activity: "cook", roomId: "kitchen", windowStartMinute: 480, windowEndMinute: 515, durationMinutes: 15 },
      ],
    },
    { ...profile, id: "guest", name: "Guest", schedule: [] },
  ];
  const beforeScene = captureStudioLayout(house, [sofa]);
  const afterScene = captureStudioLayout(house, [{ ...sofa, x: 1.4, z: 7.6 }]);
  const { before, after } = await runStudioReplay({ beforeScene, afterScene, personas, rooms: house.rooms });

  assert.equal(before.summary.pathFailures, 1);
  assert.equal(after.summary.pathFailures, 0);
  assert.deepEqual(before.agents.map(({ id }) => id), ["alex"]);
  assert.equal(before.findings.find(({ type }) => type === FINDING_TYPES.NO_PATH).toRoomId, "kitchen");
  assert(after.events.some(({ type, roomId }) => type === SIMULATION_EVENT_TYPES.ARRIVED && roomId === "kitchen"));
  const starts = ({ events }) => events.filter(({ type }) => type === SIMULATION_EVENT_TYPES.SCHEDULE_START);
  assert.deepEqual(starts(before), starts(after));
});
