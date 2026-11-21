import {
  DEFAULT_AGENT_RADIUS,
  DEFAULT_GRID_CELL_SIZE,
  FINDING_TYPES,
  STRESS_SCENARIO_TYPES,
} from "../../contracts/simulation.js";
import { createDemoHousehold } from "../demo-household.js";
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

/**
 * Create the 8 temporary guest agents with deterministic staggered arrivals
 * (`18:00`, `18:01`, ..., `18:07`) and sequence:
 * `Entry -> Living Room -> Kitchen/Dining -> Living Room -> Exit`.
 */
export function createDinnerPartyGuests({
  house,
  navigation: prebuiltNav = null,
  guestCount = 8,
} = {}) {
  const rooms = Array.isArray(house?.rooms) ? house.rooms : [];
  const nav =
    prebuiltNav ??
    buildNavigationModel(house, {
      cellSize: DEFAULT_GRID_CELL_SIZE,
      agentRadius: DEFAULT_AGENT_RADIUS,
    });

  const livingRoomId = findRoomByPreference(
    rooms,
    ["living-room", "living"],
    ["living", "dining"],
  );
  const kitchenDiningId = findRoomByPreference(
    rooms,
    ["dining-room", "kitchen"],
    ["dining", "kitchen", "living"],
  );

  const exitTarget = resolveExitPosition(nav, nav.agentRadius);
  const entryRoomId =
    exitTarget?.roomId ??
    findRoomByPreference(rooms, ["hallway", "entry"], ["hallway", "living"]);

  const hasExteriorExit = Boolean(exitTarget);
  const count = Math.max(1, Math.floor(Number(guestCount) || 8));
  const guests = [];

  for (let i = 0; i < count; i += 1) {
    const arrivalMinute = 1080 + i; // 18:00 + i min
    const diningMinute = 1096 + (i % 4) * 2;
    const postDinnerMinute = 1124 + (i % 4) * 2;
    const exitMinute = 1152 + i;
    const speed = Number((1.22 + (i % 3) * 0.04).toFixed(2));

    guests.push({
      id: `guest-${i + 1}`,
      name: `Guest ${i + 1}`,
      isGuest: true,
      movementSpeedMps: speed,
      currentRoomId: entryRoomId,
      ...(exitTarget ? { currentPosition: [...exitTarget.position] } : {}),
      schedule: [
        {
          startMinute: arrivalMinute,
          endMinute: diningMinute,
          activity: "socialize",
          destination: { type: "room", roomId: livingRoomId },
        },
        {
          startMinute: diningMinute,
          endMinute: postDinnerMinute,
          activity: "eat",
          destination: { type: "room", roomId: kitchenDiningId },
        },
        {
          startMinute: postDinnerMinute,
          endMinute: exitMinute,
          activity: "socialize",
          destination: { type: "room", roomId: livingRoomId },
        },
        {
          startMinute: exitMinute,
          endMinute: 1170,
          activity: "other",
          destination: hasExteriorExit
            ? { type: "exit" }
            : { type: "room", roomId: entryRoomId },
        },
      ],
    });
  }

  return guests;
}

function buildHostPartySchedules(house, baseHousehold) {
  const rooms = Array.isArray(house?.rooms) ? house.rooms : [];
  const livingRoomId = findRoomByPreference(
    rooms,
    ["living-room", "living"],
    ["living", "dining"],
  );
  const kitchenId = findRoomByPreference(
    rooms,
    ["kitchen", "dining-room"],
    ["kitchen", "dining", "living"],
  );

  const rawHosts =
    Array.isArray(baseHousehold) && baseHousehold.length > 0
      ? baseHousehold
      : createDemoHousehold(house);

  return rawHosts.map((host, idx) => ({
    id: host.id || `host-${idx + 1}`,
    name: host.name || `Host ${idx + 1}`,
    movementSpeedMps: host.movementSpeedMps ?? 1.3,
    currentRoomId: idx % 2 === 0 ? kitchenId : livingRoomId,
    schedule: [
      {
        startMinute: 1080,
        endMinute: 1105,
        activity: idx % 2 === 0 ? "cook" : "socialize",
        destination: {
          type: "room",
          roomId: idx % 2 === 0 ? kitchenId : livingRoomId,
        },
      },
      {
        startMinute: 1105,
        endMinute: 1135,
        activity: "eat",
        destination: { type: "room", roomId: kitchenId },
      },
      {
        startMinute: 1135,
        endMinute: 1170,
        activity: "socialize",
        destination: { type: "room", roomId: livingRoomId },
      },
    ],
  }));
}

/**
 * Run the deterministic 8-Guest Dinner Party stress scenario (Task 3A §16–18).
 */
export function createDinnerPartyScenario({
  house,
  household,
  guestCount = 8,
  stepSeconds = 2,
} = {}) {
  const navigation = buildNavigationModel(house, {
    cellSize: DEFAULT_GRID_CELL_SIZE,
    agentRadius: DEFAULT_AGENT_RADIUS,
  });

  const hosts = buildHostPartySchedules(house, household);
  const guests = createDinnerPartyGuests({
    house,
    navigation,
    guestCount,
  });
  const allAgents = [...hosts, ...guests];

  const simulation = runSimulation({
    house,
    agents: allAgents,
    startMinute: 1080, // 18:00
    endMinute: 1170, // 19:30
    stepSeconds,
    navigation,
    congestion: {
      minAgents: 3,
      radiusMeters: 1.65,
      minDurationSeconds: 60,
    },
  });

  const congestionFindings = simulation.findings.filter(
    (f) => f.type === FINDING_TYPES.CONGESTION,
  );

  const durationByRoom = new Map();
  let totalCongestionDurationSeconds = 0;
  for (const cf of congestionFindings) {
    const dur = Number(cf.evidence?.durationSeconds) || 0;
    totalCongestionDurationSeconds += dur;
    if (cf.roomId) {
      durationByRoom.set(cf.roomId, (durationByRoom.get(cf.roomId) || 0) + dur);
    }
  }

  let worstCongestionRoomId = null;
  let worstDuration = 0;
  for (const [roomId, dur] of durationByRoom.entries()) {
    if (dur > worstDuration) {
      worstDuration = dur;
      worstCongestionRoomId = roomId;
    }
  }

  return {
    scenario: {
      type: STRESS_SCENARIO_TYPES.DINNER_PARTY,
      name: "Dinner Party (8 Guests)",
      startMinute: 1080,
      endMinute: 1170,
      guestCount: guests.length,
    },
    guests,
    hosts,
    simulation,
    findings: simulation.findings,
    summary: {
      scenario: "dinner-party",
      maxConcurrentAgents: allAgents.length,
      hostCount: hosts.length,
      guestCount: guests.length,
      collisionCount: simulation.summary.collisions,
      congestionEvents: simulation.summary.congestionEvents,
      totalCongestionDurationSeconds,
      worstCongestionRoomId,
    },
  };
}
