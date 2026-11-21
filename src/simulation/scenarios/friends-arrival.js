import {
  DEFAULT_AGENT_RADIUS,
  DEFAULT_GRID_CELL_SIZE,
  FINDING_TYPES,
  STRESS_SCENARIO_TYPES,
} from "../../contracts/simulation.js";
import { createFamilyOfFourSimulationHousehold } from "../family-of-four.js";
import { buildNavigationModel, resolveExitPosition } from "../navigation-grid.js";
import { runSimulation } from "../simulation-engine.js";

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

const FRIEND_NAMES = [
  "Sam",
  "Chloe",
  "Devon",
  "Priya",
  "Marcus",
  "Zoe",
  "Liam",
  "Nina",
  "Ethan",
  "Aria",
];

/**
 * Create staged friend arrival waves (`Wave 1`, `Wave 2`, `Wave 3`) at the front entry:
 * - Wave 1 (`17:02`): early pair arrives at entry -> living room -> kitchen snacks
 * - Wave 2 (`17:06`): main group of 3–4 arrives together -> clusters in entry/hallway -> living room -> kitchen
 * - Wave 3 (`17:11`): final group arrives -> entry -> kitchen snacks -> living room
 *
 * Configurable `friendCount` (`6`, `8`, `10+`), combining with the 4-person family for `10–14` total occupants.
 */
export function createFriendsArrivalWaves({
  house,
  navigation: prebuiltNav = null,
  friendCount = 8,
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
  const kitchenId = findRoomByPreference(
    rooms,
    ["kitchen", "dining-room"],
    ["kitchen", "dining", "living"],
  );
  const bathroomId = findRoomByPreference(
    rooms,
    ["bathroom"],
    ["bathroom", "living"],
  );

  const exitTarget = resolveExitPosition(nav, nav.agentRadius);
  const entryRoomId =
    exitTarget?.roomId ??
    findRoomByPreference(rooms, ["hallway", "entry"], ["hallway", "living"]);
  const hasExteriorExit = Boolean(exitTarget);

  const count = Math.max(4, Math.floor(Number(friendCount) || 8));
  const wave1Count = Math.max(2, Math.round(count * 0.25));
  const wave2Count = Math.max(2, Math.round(count * 0.4));
  const friends = [];

  for (let i = 0; i < count; i += 1) {
    const waveIndex =
      i < wave1Count ? 1 : i < wave1Count + wave2Count ? 2 : 3;
    const withinWaveIdx =
      waveIndex === 1
        ? i
        : waveIndex === 2
          ? i - wave1Count
          : i - wave1Count - wave2Count;

    const arrivalMinute =
      (waveIndex === 1 ? 1022 : waveIndex === 2 ? 1026 : 1031) +
      withinWaveIdx * 0.5;
    const snackMinute = 1036 + (i % 3) * 3;
    const hangoutMinute = 1054 + (i % 4) * 2;
    const departMinute = 1072 + i * 0.8;

    const isTeenFriend = i % 2 === 0;
    const heightMeters = isTeenFriend
      ? Number((1.66 + (i % 3) * 0.05).toFixed(2))
      : Number((1.62 + (i % 4) * 0.06).toFixed(2));
    const speed = Number((1.24 + (i % 3) * 0.06).toFixed(2));
    const labelName = FRIEND_NAMES[i % FRIEND_NAMES.length];

    const schedule = [
      {
        startMinute: arrivalMinute,
        endMinute: snackMinute,
        activity: "socialize",
        eventType: "friends_visit",
        eventLabel: `Wave ${waveIndex} arrives at entry`,
        destination: { type: "room", roomId: livingId },
      },
      {
        startMinute: snackMinute,
        endMinute: hangoutMinute,
        activity: "eat",
        eventType: "kitchen_snacks",
        eventLabel: "Grab snacks & drinks in kitchen",
        destination: { type: "room", roomId: kitchenId },
      },
    ];

    if (i % 4 === 1) {
      schedule.push({
        startMinute: hangoutMinute,
        endMinute: hangoutMinute + 6,
        activity: "bathroom",
        eventType: "use_bathroom",
        eventLabel: "Guest bathroom stop",
        destination: { type: "room", roomId: bathroomId },
      });
      schedule.push({
        startMinute: hangoutMinute + 6,
        endMinute: departMinute,
        activity: "socialize",
        eventType: "friends_hangout",
        eventLabel: "Hang out in living room",
        destination: { type: "room", roomId: livingId },
      });
    } else {
      schedule.push({
        startMinute: hangoutMinute,
        endMinute: departMinute,
        activity: "socialize",
        eventType: "friends_hangout",
        eventLabel: "Hang out in living room",
        destination: { type: "room", roomId: livingId },
      });
    }

    schedule.push({
      startMinute: departMinute,
      endMinute: 1085,
      activity: "other",
      eventType: "friends_depart",
      eventLabel: "Wave goodbye at entry",
      destination: hasExteriorExit
        ? { type: "exit" }
        : { type: "room", roomId: entryRoomId },
    });

    friends.push({
      id: `friend-${i + 1}`,
      name: `${labelName} (Wave ${waveIndex})`,
      role: "friend",
      ageGroup: isTeenFriend ? "teen" : "adult",
      isGuest: true,
      wave: waveIndex,
      heightMeters,
      movementSpeedMps: speed,
      currentRoomId: entryRoomId,
      ...(exitTarget ? { currentPosition: [...exitTarget.position] } : {}),
      schedule,
    });
  }

  return friends;
}

function buildFamilyFriendsHostSchedules(house, baseHousehold) {
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

  const family =
    Array.isArray(baseHousehold) && baseHousehold.length > 0
      ? baseHousehold
      : createFamilyOfFourSimulationHousehold(house);

  return family.map((member, idx) => ({
    ...member,
    currentRoomId: idx % 2 === 0 ? livingId : kitchenId,
    schedule: [
      {
        startMinute: 1020,
        endMinute: 1040,
        activity: idx === 1 ? "cook" : "socialize",
        eventType: "friends_visit",
        eventLabel: idx === 1 ? "Set out snacks in kitchen" : "Greet friends at door",
        destination: {
          type: "room",
          roomId: idx === 1 ? kitchenId : livingId,
        },
      },
      {
        startMinute: 1040,
        endMinute: 1062,
        activity: "eat",
        eventType: "kitchen_snacks",
        eventLabel: "Host snack counter",
        destination: { type: "room", roomId: kitchenId },
      },
      {
        startMinute: 1062,
        endMinute: 1085,
        activity: "socialize",
        eventType: "friends_hangout",
        eventLabel: "Group hangout",
        destination: { type: "room", roomId: livingId },
      },
    ],
  }));
}

/**
 * Run the staged Sudden Friends Arrival crowd scenario (`17:00–18:05`).
 */
export function createFriendsArrivalScenario({
  house,
  household,
  friendCount = 8,
  stepSeconds = 1,
} = {}) {
  const navigation = buildNavigationModel(house, {
    cellSize: DEFAULT_GRID_CELL_SIZE,
    agentRadius: DEFAULT_AGENT_RADIUS,
  });

  const hosts = buildFamilyFriendsHostSchedules(house, household);
  const friends = createFriendsArrivalWaves({
    house,
    navigation,
    friendCount,
  });
  const allAgents = [...hosts, ...friends];

  const simulation = runSimulation({
    house,
    agents: allAgents,
    startMinute: 1020, // 17:00 (5:00 PM)
    endMinute: 1085, // 18:05 (6:05 PM)
    stepSeconds,
    navigation,
    congestion: {
      minAgents: 3,
      radiusMeters: 1.65,
      minDurationSeconds: 45,
    },
  });

  const congestionFindings = simulation.findings.filter(
    (f) => f.type === FINDING_TYPES.CONGESTION,
  );

  return {
    scenario: {
      type: STRESS_SCENARIO_TYPES.FRIENDS_ARRIVAL,
      name: `Friends Arrive (${friends.length} Friends, 3 Waves)`,
      startMinute: 1020,
      endMinute: 1085,
      friendCount: friends.length,
      hostCount: hosts.length,
      totalAgents: allAgents.length,
      waveCount: 3,
    },
    simulation,
    findings: simulation.findings,
    summary: {
      totalAgents: allAgents.length,
      friendCount: friends.length,
      waveCount: 3,
      congestionCount: congestionFindings.length,
      collisionCount: simulation.summary.collisions,
      pathFailures: simulation.summary.pathFailures,
    },
  };
}
