import assert from "node:assert/strict";
import { toSceneObject } from "./src/contracts/scene.js";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  FINDING_TYPES,
  STRESS_SCENARIO_TYPES,
  checkSightline,
  createDinnerPartyScenario,
  createFireEvacuationScenario,
  evaluateHouseholdExperience,
  formatHouseholdExperienceReport,
  isValidSimulationFinding,
  runStressScenario,
  validateEvacuation,
  validateHouseholdExperience,
  validateNoiseConflicts,
  validatePrivacySightlines,
  validateSunlight,
  validateTvVisibility,
} from "./src/simulation/index.js";
import { importSampleFloorplan } from "./src/spatial/floorplan-importer.js";

function makeBaseStudioHouse() {
  return {
    id: "validator-test-house",
    units: "meters",
    ceilingHeight: 2.7,
    rooms: [
      {
        id: "living-room",
        name: "Living Room",
        kind: "living",
        polygon: [
          [0, 0],
          [6, 0],
          [6, 5],
          [0, 5],
        ],
      },
      {
        id: "bedroom",
        name: "Bedroom",
        kind: "bedroom",
        polygon: [
          [6, 0],
          [11, 0],
          [11, 5],
          [6, 5],
        ],
      },
    ],
    walls: [
      { id: "w-n", start: [0, 0], end: [11, 0], thickness: 0.14, kind: "exterior" },
      { id: "w-s", start: [0, 5], end: [11, 5], thickness: 0.14, kind: "exterior" },
      { id: "w-w", start: [0, 0], end: [0, 5], thickness: 0.14, kind: "exterior" },
      { id: "w-e", start: [11, 0], end: [11, 5], thickness: 0.14, kind: "exterior" },
      { id: "w-mid", start: [6, 0], end: [6, 5], thickness: 0.12, kind: "interior" },
    ],
    doors: [
      {
        id: "front-door",
        kind: "exterior",
        wallId: "w-w",
        roomA: "living-room",
        roomB: null,
        position: [0, 2.5],
        width: 0.92,
      },
      {
        id: "door-bed",
        kind: "interior",
        wallId: "w-mid",
        roomA: "living-room",
        roomB: "bedroom",
        position: [6, 2.5],
        width: 0.9,
      },
    ],
    windows: [
      {
        id: "win-west",
        wallId: "w-w",
        roomId: "living-room",
        position: [0, 1.1],
        width: 1.4,
        sillHeight: 0.85,
        headHeight: 2.15,
      },
    ],
    fixtures: [],
    objects: [],
  };
}

test("Privacy P1 & P2 — Solid wall blocks sightline while open doorway allows sightline", () => {
  const house = makeBaseStudioHouse();

  // P1: Ray at z = 1.0 hits solid portion of interior wall `w-mid` at [6, 1.0]
  const blocked = checkSightline({
    house,
    observer: [2.0, 1.0],
    target: [8.5, 1.0],
  });
  assert.equal(blocked.visible, false);
  assert.equal(blocked.occluded, true);
  assert(blocked.blockingObjectIds.includes("w-mid"));

  // P2: Ray at z = 2.5 passes straight through open doorway `door-bed` at [6, 2.5]
  const open = checkSightline({
    house,
    observer: [2.0, 2.5],
    target: [8.5, 2.5],
  });
  assert.equal(open.visible, true);
  assert.equal(open.occluded, false);
  assert.deepEqual(open.blockingObjectIds, []);
});

test("Privacy P3 & P4 — Front door -> bed sightline detected, disappears when shielded, and no bed = no finding", () => {
  const emptyHouse = makeBaseStudioHouse();

  // P4: No bed or bathroom fixture present -> zero privacy findings fabricated
  const noneResult = validatePrivacySightlines({ house: emptyHouse });
  assert.equal(noneResult.findings.length, 0);

  // P3: Place bed at [8.5, 0, 2.5] directly aligned with front-door [0, 2.5] and open door-bed [6, 2.5]
  const exposedHouse = structuredClone(emptyHouse);
  exposedHouse.objects.push({
    id: "bed-1",
    type: "existing",
    kind: "bed",
    name: "Queen Bed",
    roomId: "bedroom",
    position: [8.5, 0, 2.5],
    rotation: [0, 0, 0],
    dimensions: { width: 1.6, height: 0.9, depth: 2.0 },
    locked: false,
  });

  const exposedResult = validatePrivacySightlines({ house: exposedHouse });
  assert.equal(exposedResult.findings.length, 1);
  const finding = exposedResult.findings[0];
  assert.equal(finding.type, FINDING_TYPES.PRIVACY_SIGHTLINE);
  assert.equal(isValidSimulationFinding(finding), true);
  assert.equal(finding.evidence.sourceType, "entry-door");
  assert.equal(finding.evidence.targetType, "bed");
  assert.equal(finding.evidence.directLineOfSight, true);

  // Add a privacy entryway partition wall at x = 2.0 blocking [0, 2.5] -> [8.5, 2.5]
  const shieldedHouse = structuredClone(exposedHouse);
  shieldedHouse.walls.push({
    id: "w-foyer-screen",
    start: [2.0, 1.5],
    end: [2.0, 3.5],
    thickness: 0.12,
    kind: "interior",
  });
  // Also shift bedroom door to z = 0.8 so living-room center [3, 2.5] doesn't see bed either
  shieldedHouse.doors[1].position = [6, 0.8];

  const shieldedResult = validatePrivacySightlines({ house: shieldedHouse });
  assert.equal(shieldedResult.findings.length, 0);
});

test("TV Visibility V1, V2, V3, V4 — Clear view, occlusion, bad angle, and missing TV", () => {
  const noTvHouse = makeBaseStudioHouse();
  // V4: Missing TV safely skipped
  assert.equal(validateTvVisibility({ house: noTvHouse }).findings.length, 0);

  // V1: Clear sofa -> TV with low coffee table in between (0.40 m table does NOT occlude)
  const clearHouse = makeBaseStudioHouse();
  clearHouse.objects.push(
    {
      id: "tv-1",
      kind: "tv",
      name: "Living TV",
      roomId: "living-room",
      position: [3.0, 0, 0.25],
      rotation: [0, 0, 0], // faces +Z [0, 1]
      dimensions: { width: 1.2, height: 1.15, depth: 0.15 },
    },
    {
      id: "coffee-table-1",
      kind: "table",
      name: "Coffee Table",
      roomId: "living-room",
      position: [3.0, 0, 1.7],
      rotation: [0, 0, 0],
      dimensions: { width: 1.1, height: 0.4, depth: 0.6 },
    },
    {
      id: "sofa-1",
      kind: "sofa",
      name: "Sofa",
      roomId: "living-room",
      position: [3.0, 0, 3.2],
      rotation: [0, Math.PI, 0], // faces -Z [0, -1] toward TV
      dimensions: { width: 2.1, height: 0.85, depth: 0.9 },
    },
  );
  const clearTv = validateTvVisibility({ house: clearHouse });
  assert.equal(clearTv.findings.length, 0);
  assert.equal(clearTv.evaluations.length, 1);
  assert.equal(clearTv.evaluations[0].usable, true);
  assert.equal(clearTv.evaluations[0].occluded, false);

  // V2: Place a tall 1.75m bookcase between sofa and TV -> TV_OCCLUDED
  const occludedHouse = structuredClone(clearHouse);
  occludedHouse.objects.push({
    id: "bookcase-blocker",
    kind: "bookcase",
    name: "Tall Bookcase",
    roomId: "living-room",
    position: [3.0, 0, 1.7],
    rotation: [0, 0, 0],
    dimensions: { width: 1.0, height: 1.75, depth: 0.38 },
  });
  const occResult = validateTvVisibility({ house: occludedHouse });
  assert(
    occResult.findings.some((f) => f.type === FINDING_TYPES.TV_OCCLUDED),
  );

  // V3: Off-axis bad viewing angle (> 45 degrees) -> TV_BAD_ANGLE
  const angledHouse = structuredClone(clearHouse);
  angledHouse.objects.find((o) => o.id === "sofa-1").position = [5.4, 0, 0.9];
  angledHouse.objects.find((o) => o.id === "sofa-1").rotation = [0, -Math.PI / 2, 0];
  const angleResult = validateTvVisibility({ house: angledHouse });
  assert(
    angleResult.findings.some((f) => f.type === FINDING_TYPES.TV_BAD_ANGLE),
  );
});

test("TV suitability uses modeled width at the seat and preserves a distance-only fallback", () => {
  const tv = { id: "display", kind: "tv", x: 3, z: 0.25, facing: [0, 1], width: 0.45 };
  const seat = { id: "seat", kind: "chair", x: 3, z: 3.25 };
  const evaluate = (screen, viewer = seat) => validateTvVisibility({ house: { objects: [screen, viewer] } });
  const narrow = evaluate(tv);
  assert.equal(narrow.findings[0].type, FINDING_TYPES.TV_TOO_FAR);
  assert.equal(narrow.findings[0].evidence.apparentScreenAngleDegrees, 8.6);
  assert.equal(narrow.findings[0].evidence.modeledTvWidthMeters, 0.45);
  assert.equal(narrow.findings[0].evidence.distanceMeters, 3);
  assert.equal(narrow.findings[0].evidence.minScreenAngleDegrees, 20);
  assert.equal(evaluate({ ...tv, width: 1.4 }).findings.length, 0);
  assert.equal(evaluate({ ...tv, width: 2.3 }, { ...seat, z: 6.25 }).findings.length, 0);
  const unknown = toSceneObject({ ...tv, width: undefined });
  assert.equal(evaluate(unknown).findings.length, 0);
  const far = evaluate(unknown, { ...seat, z: 6.25 }).findings[0];
  assert.equal(far.evidence.maxDistanceMeters, 4.8);
  assert.equal(far.evidence.modeledTvWidthMeters, undefined);
});

test("Noise N1, N2, N3, N4 — Schedule overlap, wall attenuation, and distance attenuation", () => {
  const house = makeBaseStudioHouse();

  // N1: Non-overlapping WFH (09:00–12:00) and TV (18:00–20:00) -> 0 conflicts
  const nonOverlapping = validateNoiseConflicts({
    house,
    household: [
      {
        id: "kevin",
        name: "Kevin",
        schedule: [
          { startMinute: 540, endMinute: 720, activity: "work", roomId: "bedroom" },
        ],
      },
      {
        id: "alice",
        name: "Alice",
        schedule: [
          { startMinute: 1080, endMinute: 1200, activity: "watchTv", roomId: "living-room" },
        ],
      },
    ],
  });
  assert.equal(nonOverlapping.findings.length, 0);

  // N2: Overlapping WFH (09:00–17:00) and TV (15:00–16:00) in open/nearby layout -> NOISE_CONFLICT
  const openLoft = structuredClone(house);
  openLoft.walls = openLoft.walls.filter((w) => w.id !== "w-mid");
  openLoft.doors = openLoft.doors.filter((d) => d.id !== "door-bed");

  const overlappingAgents = [
    {
      id: "kevin",
      name: "Kevin",
      schedule: [
        {
          startMinute: 540,
          endMinute: 1020,
          activity: "work",
          destination: { type: "position", position: [6.8, 2.5], roomId: "bedroom" },
        },
      ],
    },
    {
      id: "alice",
      name: "Alice",
      schedule: [
        {
          startMinute: 900,
          endMinute: 960,
          activity: "watchTv",
          destination: { type: "position", position: [3.0, 2.5], roomId: "living-room" },
        },
      ],
    },
  ];

  const openNoise = validateNoiseConflicts({
    house: openLoft,
    household: overlappingAgents,
  });
  assert.equal(openNoise.findings.length, 1);
  assert.equal(openNoise.findings[0].type, FINDING_TYPES.NOISE_CONFLICT);
  assert.equal(openNoise.findings[0].evidence.overlapMinutes, 60);

  // N3: Adding a solid partition wall strictly reduces estimated noise level
  const walledHouse = makeBaseStudioHouse();
  walledHouse.doors[1].position = [6, 0.6]; // Move door away from direct [3.0,2.5]->[6.8,2.5] ray
  const walledNoise = validateNoiseConflicts({
    house: walledHouse,
    household: overlappingAgents,
  });
  assert(
    walledNoise.evaluations[0].estimatedLevel <
      openNoise.evaluations[0].estimatedLevel,
  );
  assert(walledNoise.evaluations[0].wallsCrossed >= 1);

  // N4: Increasing distance strictly reduces estimated noise level
  const farAgents = structuredClone(overlappingAgents);
  farAgents[0].schedule[0].destination.position = [10.4, 4.4];
  farAgents[1].schedule[0].destination.position = [0.8, 0.8];
  const farNoise = validateNoiseConflicts({
    house: openLoft,
    household: farAgents,
  });
  assert(
    farNoise.evaluations[0].estimatedLevel <
      openNoise.evaluations[0].estimatedLevel,
  );
});

test("Fire Evacuation F1, F2, F3, F4 — Valid escape, blocked exit, finite duration, and narrow exit bottleneck", () => {
  const { house } = importSampleFloorplan();

  // F1 & F3: Valid bedroom -> exterior exit path with finite positive duration
  const evac = createFireEvacuationScenario({ house });
  assert.equal(evac.summary.blockedCount, 0);
  assert.equal(evac.summary.evacuatedCount, 2);
  const kevinRoute = evac.agentRoutes.find((r) => r.agentId === "kevin");
  assert(kevinRoute.reachable);
  assert.equal(kevinRoute.exitDoorId, "door-entry");
  assert(Number.isFinite(kevinRoute.estimatedSeconds) && kevinRoute.estimatedSeconds > 0);
  assert(Number.isFinite(kevinRoute.distanceMeters) && kevinRoute.distanceMeters > 0);

  // F2: Blocked exterior exit produces NO_EVACUATION_PATH
  const blockedExitHouse = structuredClone(house);
  blockedExitHouse.doors.find((d) => d.id === "door-entry").blocked = true;
  const blockedEvac = validateEvacuation({ house: blockedExitHouse });
  assert(
    blockedEvac.findings.some(
      (f) => f.type === FINDING_TYPES.NO_EVACUATION_PATH,
    ),
  );

  // F4: Multiple occupants converging simultaneously on a narrow 0.78m exit create EVACUATION_BOTTLENECK
  const narrowExitHouse = makeBaseStudioHouse();
  narrowExitHouse.doors[0].width = 0.78;
  const groupOccupants = [
    { id: "o1", name: "O1", currentRoomId: "living-room", currentPosition: [3.2, 1.8] },
    { id: "o2", name: "O2", currentRoomId: "living-room", currentPosition: [3.4, 2.5] },
    { id: "o3", name: "O3", currentRoomId: "living-room", currentPosition: [3.2, 3.2] },
    { id: "o4", name: "O4", currentRoomId: "living-room", currentPosition: [3.8, 2.5] },
  ];
  const bottleneckEvac = runStressScenario({
    type: STRESS_SCENARIO_TYPES.FIRE_EVACUATION,
    house: narrowExitHouse,
    household: groupOccupants,
  });
  const bottleneck = bottleneckEvac.findings.find(
    (f) => f.type === FINDING_TYPES.EVACUATION_BOTTLENECK,
  );
  assert(bottleneck);
  assert(bottleneck.evidence.convergingAgentCount >= 3);
  assert(bottleneck.evidence.estimatedQueueDelaySeconds > 0);
});

test("Dinner Party G1, G2, G3, G4 — 8 guests, deterministic replay, and small vs large layout congestion", () => {
  const { house: compactHouse } = importSampleFloorplan();

  const partyA = runStressScenario({
    type: STRESS_SCENARIO_TYPES.DINNER_PARTY,
    house: compactHouse,
  });
  const partyB = runStressScenario({
    type: STRESS_SCENARIO_TYPES.DINNER_PARTY,
    house: compactHouse,
  });

  // G1: Creates exactly 8 guest agents (+ 2 hosts = 10 concurrent agents)
  assert.equal(partyA.guests.length, 8);
  assert.equal(partyA.summary.guestCount, 8);
  assert.equal(partyA.summary.maxConcurrentAgents, 10);

  // G2: Strictly deterministic across repeated runs
  assert.deepEqual(partyA, partyB);

  // G3: Compact apartment produces measurable dinner-party congestion
  assert(partyA.summary.congestionEvents >= 1);
  assert(partyA.summary.totalCongestionDurationSeconds > 0);
  assert(partyA.summary.worstCongestionRoomId);

  // G4: Spacious open-plan layout produces strictly less congestion than compact layout
  const spaciousHouse = {
    id: "spacious-open-villa",
    units: "meters",
    ceilingHeight: 3.2,
    rooms: [
      {
        id: "living-room",
        name: "Grand Living Hall",
        kind: "living",
        polygon: [
          [0, 0],
          [14, 0],
          [14, 12],
          [0, 12],
        ],
      },
      {
        id: "kitchen",
        name: "Open Chef Kitchen & Dining",
        kind: "kitchen",
        polygon: [
          [14, 0],
          [26, 0],
          [26, 12],
          [14, 12],
        ],
      },
    ],
    walls: [
      { id: "v-n", start: [0, 0], end: [26, 0], thickness: 0.16, kind: "exterior" },
      { id: "v-s", start: [0, 12], end: [26, 12], thickness: 0.16, kind: "exterior" },
      { id: "v-w", start: [0, 0], end: [0, 12], thickness: 0.16, kind: "exterior" },
      { id: "v-e", start: [26, 0], end: [26, 12], thickness: 0.16, kind: "exterior" },
      { id: "v-mid", start: [14, 0], end: [14, 12], thickness: 0.14, kind: "interior" },
    ],
    doors: [
      {
        id: "villa-entry",
        kind: "exterior",
        wallId: "v-w",
        roomA: "living-room",
        roomB: null,
        position: [0, 6],
        width: 1.8,
      },
      {
        id: "villa-arch",
        kind: "interior",
        wallId: "v-mid",
        roomA: "living-room",
        roomB: "kitchen",
        position: [14, 6],
        width: 3.6,
      },
    ],
    windows: [],
    fixtures: [],
    objects: [],
  };

  const spaciousParty = runStressScenario({
    type: STRESS_SCENARIO_TYPES.DINNER_PARTY,
    house: spaciousHouse,
  });
  assert(
    spaciousParty.summary.totalCongestionDurationSeconds <
      partyA.summary.totalCongestionDurationSeconds,
  );
});

test("Sunlight glare, unified evaluateHouseholdExperience, category scores, and before/after improvement", () => {
  // Build a flawed "before" home with exposed bed, occluded TV, west desk glare, and WFH/TV overlap
  const beforeHouse = makeBaseStudioHouse();
  // Remove interior wall door offset so front-door sees bed directly
  beforeHouse.objects.push(
    {
      id: "bed-main",
      kind: "bed",
      roomId: "bedroom",
      position: [8.5, 0, 2.5],
      dimensions: { width: 1.6, height: 0.9, depth: 2.0 },
    },
    {
      id: "desk-wfh",
      kind: "desk",
      roomId: "living-room",
      position: [1.8, 0, 1.1], // Directly east of `win-west` [0, 1.1] -> afternoon west glare!
      dimensions: { width: 1.2, height: 0.76, depth: 0.6 },
    },
    {
      id: "tv-main",
      kind: "tv",
      roomId: "living-room",
      position: [3.2, 0, 0.25],
      rotation: [0, 0, 0],
      dimensions: { width: 1.2, height: 1.15, depth: 0.15 },
    },
    {
      id: "divider-shelf",
      kind: "bookcase",
      roomId: "living-room",
      position: [3.2, 0, 1.8],
      dimensions: { width: 1.1, height: 1.8, depth: 0.4 },
    },
    {
      id: "sofa-main",
      kind: "sofa",
      roomId: "living-room",
      position: [3.2, 0, 3.6],
      rotation: [0, Math.PI, 0],
      dimensions: { width: 2.1, height: 0.85, depth: 0.9 },
    },
  );

  // Verify sunlight glare validator directly
  const afternoonGlare = validateSunlight({
    house: beforeHouse,
    sun: { azimuthDegrees: 270, elevationDegrees: 20 },
  });
  assert.equal(afternoonGlare.findings.length, 1);
  assert.equal(afternoonGlare.findings[0].type, FINDING_TYPES.SUN_GLARE);

  const household = [
    {
      id: "kevin",
      name: "Kevin",
      currentRoomId: "living-room",
      schedule: [
        { startMinute: 540, endMinute: 660, activity: "work", roomId: "living-room" },
      ],
    },
    {
      id: "alice",
      name: "Alice",
      currentRoomId: "living-room",
      schedule: [
        { startMinute: 570, endMinute: 630, activity: "watchTv", roomId: "living-room" },
      ],
    },
  ];

  const t0 = performance.now();
  const beforeEval = evaluateHouseholdExperience({
    house: beforeHouse,
    household,
    sun: { azimuthDegrees: 270, elevationDegrees: 20 },
  });
  const evalMs = performance.now() - t0;
  assert(evalMs < 500);

  // Verify validateHouseholdExperience flat helper matches
  assert.deepEqual(
    validateHouseholdExperience({
      house: beforeHouse,
      household,
      sun: { azimuthDegrees: 270, elevationDegrees: 20 },
    }),
    beforeEval.findings,
  );

  // Redesign ("afterHouse"): move desk into quiet bedroom away from west window, remove TV-blocking bookcase, shift bed out of doorway sightline
  const afterHouse = structuredClone(beforeHouse);
  afterHouse.objects = afterHouse.objects
    .filter((o) => o.id !== "divider-shelf")
    .map((o) => {
      if (o.id === "bed-main") return { ...o, position: [9.0, 0, 0.9] };
      if (o.id === "desk-wfh") {
        return { ...o, roomId: "bedroom", position: [9.5, 0, 4.2] };
      }
      return o;
    });

  const afterHousehold = structuredClone(household);
  afterHousehold[0].currentRoomId = "bedroom";
  afterHousehold[0].schedule[0].roomId = "bedroom";

  const afterEval = evaluateHouseholdExperience({
    house: afterHouse,
    household: afterHousehold,
    sun: { azimuthDegrees: 270, elevationDegrees: 20 },
  });

  assert(afterEval.categories.privacy.score > beforeEval.categories.privacy.score);
  assert(
    afterEval.categories.visibility.score >
      beforeEval.categories.visibility.score,
  );
  assert(afterEval.categories.noise.score > beforeEval.categories.noise.score);
  assert(afterEval.overallScore > beforeEval.overallScore);

  const reportText = formatHouseholdExperienceReport(beforeEval);
  assert.match(reportText, /HOUSEHOLD EXPERIENCE/);
  assert.match(reportText, /Privacy/);
  assert.match(reportText, /Visibility/);
  assert.match(reportText, /Safety/);
});
