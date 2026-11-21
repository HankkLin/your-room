import {
  DEFAULT_AGENT_RADIUS,
  DEFAULT_GRID_CELL_SIZE,
  STRESS_SCENARIO_TYPES,
} from "../../contracts/simulation.js";
import { createFamilyOfFourSimulationHousehold } from "../family-of-four.js";
import { buildNavigationModel, resolveExitPosition } from "../navigation-grid.js";
import { runSimulation } from "../simulation-engine.js";
import { validateAccessibility } from "../validators/accessibility.js";

function findRoomByPreference(rooms, preferredIds, preferredKinds) {
  for (const id of preferredIds) {
    const match = rooms.find((r) => r.id === id);
    if (match) return match.id;
  }
  for (const kind of preferredKinds) {
    const match = rooms.find((r) => r.kind === kind);
    if (match) return match.id;
  }
  return rooms[0]?.id ?? null;
}

/**
 * Create Grandfather (wheelchair user) & Grandmother visiting agents for
 * `10:00 AM – 11:30 AM` (`600 – 690` minutes).
 */
export function createVisitingGrandparents({
  house,
  navigation: prebuiltNav = null,
} = {}) {
  const rooms = Array.isArray(house?.rooms) ? house.rooms : [];
  const nav =
    prebuiltNav ??
    buildNavigationModel(house, {
      cellSize: DEFAULT_GRID_CELL_SIZE,
      agentRadius: DEFAULT_AGENT_RADIUS,
    });

  const livingId = findRoomByPreference(
    rooms,
    ["living-room", "living"],
    ["living", "dining"],
  );
  const bathroomId = findRoomByPreference(
    rooms,
    ["bathroom"],
    ["bathroom", "living"],
  );
  const kitchenId = findRoomByPreference(
    rooms,
    ["kitchen", "dining-room"],
    ["kitchen", "dining", "living"],
  );
  const bedroomId = findRoomByPreference(
    rooms,
    ["bedroom"],
    ["bedroom", "living"],
  );

  // Entry arrival point: pick a safe point near exterior door at standard radius,
  // and also check if a 0.42m wheelchair user can start safely in the entry room.
  const exitWalker = resolveExitPosition(nav, DEFAULT_AGENT_RADIUS);
  const exitWheelchair = resolveExitPosition(nav, 0.42);
  const entryRoomId =
    exitWalker?.roomId ??
    findRoomByPreference(rooms, ["hallway", "living-room"], ["hallway", "living"]);

  return [
    {
      id: "grandpa-arthur",
      name: "Grandpa Arthur",
      role: "grandfather",
      ageGroup: "olderAdult",
      color: "#b88736",
      usesWheelchair: true,
      heightMeters: 1.34, // seated wheelchair height
      eyeHeightMeters: 1.18,
      movementSpeedMps: 0.78,
      radiusMeters: 0.42, // ~0.84 m wheelchair width clearance
      turningRadiusMeters: 0.75, // 1.50 m turning circle diameter
      currentRoomId: entryRoomId,
      ...(exitWheelchair
        ? { currentPosition: [...exitWheelchair.position] }
        : exitWalker
          ? { currentPosition: [...exitWalker.position] }
          : {}),
      needs: {
        privacy: 0.75,
        quiet: 0.85,
        accessibility: 0.98,
        daylight: 0.7,
        social: 0.75,
      },
      schedule: [
        {
          startMinute: 602, // 10:02 AM — arrives at entry & rolls into living room
          endMinute: 620,
          activity: "socialize",
          eventType: "grandparents_arrive",
          eventLabel: "Grandparents arrive — greet family",
          destination: { type: "room", roomId: livingId },
        },
        {
          startMinute: 620, // 10:20 AM — attempts wheelchair access to bathroom
          endMinute: 636,
          activity: "bathroom",
          eventType: "wheelchair_access_check",
          eventLabel: "Wheelchair bathroom access",
          destination: { type: "room", roomId: bathroomId },
        },
        {
          startMinute: 636, // 10:36 AM — visits bedroom / rest area
          endMinute: 654,
          activity: "relax",
          eventType: "wheelchair_room_visit",
          eventLabel: "Check guest rest space",
          destination: { type: "room", roomId: bedroomId },
        },
        {
          startMinute: 654, // 10:54 AM — joins family tea/brunch in kitchen
          endMinute: 678,
          activity: "eat",
          eventType: "sit_to_eat",
          eventLabel: "Tea & brunch with family",
          destination: { type: "room", roomId: kitchenId },
        },
        {
          startMinute: 678,
          endMinute: 690,
          activity: "socialize",
          eventType: "family_visit",
          eventLabel: "Chat in living room",
          destination: { type: "room", roomId: livingId },
        },
      ],
    },
    {
      id: "grandma-evelyn",
      name: "Grandma Evelyn",
      role: "grandmother",
      ageGroup: "olderAdult",
      color: "#9c5268",
      usesWheelchair: false,
      heightMeters: 1.58,
      eyeHeightMeters: 1.44,
      movementSpeedMps: 0.92,
      radiusMeters: 0.25,
      currentRoomId: entryRoomId,
      ...(exitWalker ? { currentPosition: [...exitWalker.position] } : {}),
      needs: {
        privacy: 0.7,
        quiet: 0.85,
        accessibility: 0.78,
        daylight: 0.82,
        social: 0.85,
      },
      schedule: [
        {
          startMinute: 603, // 10:03 AM — walks in right behind Grandpa
          endMinute: 626,
          activity: "socialize",
          eventType: "grandparents_arrive",
          eventLabel: "Arrive & hug grandkids",
          destination: { type: "room", roomId: livingId },
        },
        {
          startMinute: 626, // 10:26 AM — helps Mom prepare tea in kitchen
          endMinute: 652,
          activity: "cook",
          eventType: "prepare_tea",
          eventLabel: "Prepare tea in kitchen",
          destination: { type: "room", roomId: kitchenId },
        },
        {
          startMinute: 652,
          endMinute: 678,
          activity: "eat",
          eventType: "sit_to_eat",
          eventLabel: "Family brunch",
          destination: { type: "room", roomId: kitchenId },
        },
        {
          startMinute: 678,
          endMinute: 690,
          activity: "socialize",
          eventType: "family_visit",
          eventLabel: "Visit in living room",
          destination: { type: "room", roomId: livingId },
        },
      ],
    },
  ];
}

function buildFamilyHostVisitSchedules(house, baseHousehold) {
  const rooms = Array.isArray(house?.rooms) ? house.rooms : [];
  const livingId = findRoomByPreference(
    rooms,
    ["living-room", "living"],
    ["living", "dining"],
  );
  const kitchenId = findRoomByPreference(
    rooms,
    ["kitchen", "dining-room"],
    ["kitchen", "dining", "living"],
  );
  const bedroomId = findRoomByPreference(
    rooms,
    ["bedroom"],
    ["bedroom", "living"],
  );

  const family =
    Array.isArray(baseHousehold) && baseHousehold.length > 0
      ? baseHousehold
      : createFamilyOfFourSimulationHousehold(house);

  return family.map((member, idx) => {
    const startRoom = idx === 1 ? kitchenId : idx === 2 ? bedroomId : livingId;
    return {
      ...member,
      currentRoomId: startRoom,
      schedule: [
        {
          startMinute: 600,
          endMinute: 625,
          activity: "socialize",
          eventType: "welcome_grandparents",
          eventLabel: "Welcome Grandpa & Grandma",
          destination: { type: "room", roomId: livingId },
        },
        {
          startMinute: 625,
          endMinute: 654,
          activity: idx <= 1 ? "cook" : "socialize",
          eventType: idx <= 1 ? "prepare_tea" : "family_visit",
          eventLabel: idx <= 1 ? "Host brunch prep" : "Chat with grandparents",
          destination: {
            type: "room",
            roomId: idx <= 1 ? kitchenId : livingId,
          },
        },
        {
          startMinute: 654,
          endMinute: 680,
          activity: "eat",
          eventType: "sit_to_eat",
          eventLabel: "Family brunch",
          destination: {
            type: "room",
            roomId: idx < 3 ? kitchenId : livingId,
          },
        },
        {
          startMinute: 680,
          endMinute: 690,
          activity: "socialize",
          eventType: "family_visit",
          eventLabel: "Family visit",
          destination: { type: "room", roomId: livingId },
        },
      ],
    };
  });
}

/**
 * Run the deterministic Grandparents Visit + Wheelchair Accessibility scenario (`10:00–11:30 AM`).
 */
export function createGrandparentsVisitScenario({
  house,
  household,
  stepSeconds = 1,
} = {}) {
  const navigation = buildNavigationModel(house, {
    cellSize: DEFAULT_GRID_CELL_SIZE,
    agentRadius: DEFAULT_AGENT_RADIUS,
  });

  const hosts = buildFamilyHostVisitSchedules(house, household);
  const grandparents = createVisitingGrandparents({ house, navigation });
  const allAgents = [...hosts, ...grandparents];

  const simulation = runSimulation({
    house,
    agents: allAgents,
    startMinute: 600, // 10:00 AM
    endMinute: 690, // 11:30 AM
    stepSeconds,
    navigation,
    congestion: {
      minAgents: 3,
      radiusMeters: 1.65,
      minDurationSeconds: 60,
    },
  });

  const accessibility = validateAccessibility({
    house,
    household: allAgents,
    navigation,
    forceCheck: true,
  });

  // Deduplicate if simulation already emitted NO_PATH for the same wheelchair room block
  const combinedFindings = [...accessibility.findings, ...simulation.findings];

  return {
    scenario: {
      type: STRESS_SCENARIO_TYPES.GRANDPARENTS_VISIT,
      name: "Grandparents Visit — Accessibility",
      startMinute: 600,
      endMinute: 690,
      visitorCount: grandparents.length,
      totalAgents: allAgents.length,
    },
    simulation,
    accessibility,
    findings: combinedFindings,
    summary: {
      totalAgents: allAgents.length,
      wheelchairAgents: grandparents.filter((g) => g.usesWheelchair).length,
      accessibilityFindingCount: accessibility.findings.length,
      pathFailures: simulation.summary.pathFailures,
      congestionEvents: simulation.summary.congestionEvents,
    },
  };
}
