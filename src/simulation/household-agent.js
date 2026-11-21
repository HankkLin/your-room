import {
  DEFAULT_AGENT_RADIUS,
  DEFAULT_MOVEMENT_SPEED_MPS,
  DEFAULT_PERSONAL_SPACE_RADIUS,
} from "../contracts/simulation.js";
import { isFinitePoint2D } from "../spatial/floorplan-geometry.js";
import { resolveSafeRoomPosition } from "./navigation-grid.js";
import { normalizeSchedule } from "./schedule.js";

/**
 * Normalize a simulation agent or Persona record into a concrete simulation-ready
 * household agent without mutating the caller's input.
 *
 * Compatible with both:
 * - Task 2 simulation agents (`{ id, name, movementSpeedMps, currentRoomId, currentPosition, schedule }`)
 * - Persona contract records (`{ id, name, ageGroup, needs, preferences, dislikes, schedule }`)
 *
 * @param {object} rawAgent
 * @param {object} context
 * @param {object} context.navigation
 * @param {object} context.house
 * @param {number} [context.agentIndex=0]
 * @param {number} [context.startMinute=0]
 * @param {Map<string, number>} [context.roomSlotCounts]
 */
const round2 = (n) => Math.round(n * 100) / 100;

function inferDefaultHeightMeters(rawAgent) {
  if (Number.isFinite(Number(rawAgent.heightMeters)) && Number(rawAgent.heightMeters) > 0.7) {
    return round2(Number(rawAgent.heightMeters));
  }
  const role = String(rawAgent.role || "").toLowerCase();
  const ageGroup = String(rawAgent.ageGroup || "adult");
  if (rawAgent.usesWheelchair) return 1.34; // seated wheelchair height
  if (role === "dad" || role === "father") return 1.83;
  if (role === "mom" || role === "mother") return 1.66;
  if (role === "brother") return 1.74;
  if (role === "sister") return 1.3;
  if (role === "grandfather") return 1.68;
  if (role === "grandmother") return 1.58;
  if (ageGroup === "child") return 1.32;
  if (ageGroup === "teen") return 1.7;
  if (ageGroup === "olderAdult") return 1.62;
  return 1.72;
}

function inferDefaultSpeedMps(rawAgent) {
  if (rawAgent.usesWheelchair) return 0.78;
  const role = String(rawAgent.role || "").toLowerCase();
  const ageGroup = String(rawAgent.ageGroup || "adult");
  if (ageGroup === "olderAdult" || (rawAgent.needs?.accessibility ?? 0) >= 0.7) {
    return 0.96;
  }
  if (ageGroup === "child" || role === "sister") return 1.18;
  if (ageGroup === "teen" || role === "brother") return 1.36;
  if (role === "dad") return 1.34;
  if (role === "mom") return 1.28;
  return DEFAULT_MOVEMENT_SPEED_MPS;
}

export function createHouseholdAgentState(
  rawAgent,
  {
    navigation,
    house,
    agentIndex = 0,
    startMinute = 0,
    roomSlotCounts = new Map(),
  },
) {
  if (!rawAgent || typeof rawAgent !== "object") {
    throw new Error("Household agent must be an object.");
  }

  const id = String(rawAgent.id || `agent-${agentIndex + 1}`).trim();
  const name = String(rawAgent.name || id).trim();
  const usesWheelchair = Boolean(rawAgent.usesWheelchair);
  const role = rawAgent.role ? String(rawAgent.role).trim() : null;
  const heightMeters = inferDefaultHeightMeters(rawAgent);
  const eyeHeightMeters = Number.isFinite(Number(rawAgent.eyeHeightMeters))
    ? round2(Number(rawAgent.eyeHeightMeters))
    : usesWheelchair
      ? 1.18
      : round2(heightMeters * 0.91);

  const defaultSpeed = inferDefaultSpeedMps(rawAgent);
  const movementSpeedMps = Math.max(
    0.2,
    Math.min(4.0, Number(rawAgent.movementSpeedMps ?? defaultSpeed) || defaultSpeed),
  );

  const defaultRadius = usesWheelchair
    ? 0.42
    : rawAgent.ageGroup === "child"
      ? 0.2
      : navigation.agentRadius ?? DEFAULT_AGENT_RADIUS;
  const radiusMeters = Math.max(
    0.05,
    Number(rawAgent.radiusMeters ?? defaultRadius),
  );

  const personalSpaceMeters = Math.max(
    radiusMeters,
    Number(
      rawAgent.personalSpaceMeters ??
        (usesWheelchair ? 0.52 : DEFAULT_PERSONAL_SPACE_RADIUS),
    ),
  );

  const turningRadiusMeters = Math.max(
    radiusMeters,
    Number(rawAgent.turningRadiusMeters ?? (usesWheelchair ? 0.75 : 0.35)),
  );

  const schedule = normalizeSchedule(rawAgent.schedule ?? []);

  // Determine starting room at `startMinute`
  let initialRoomId = rawAgent.currentRoomId ?? null;
  let initialActivity = rawAgent.currentActivity ?? "idle";
  let initialEventLabel = rawAgent.currentEventLabel ?? "At home";

  if (!initialRoomId) {
    const activeAtStart = [...schedule]
      .reverse()
      .find((item) => item.startMinute <= startMinute && item.destination.roomId);
    if (activeAtStart) {
      initialRoomId = activeAtStart.destination.roomId;
      initialActivity = activeAtStart.activity;
      initialEventLabel = activeAtStart.eventLabel || initialEventLabel;
    } else if (schedule[0]?.destination?.roomId) {
      initialRoomId = schedule[0].destination.roomId;
    } else {
      initialRoomId =
        navigation.rooms.find((r) => r.kind === "bedroom")?.id ||
        navigation.rooms[0]?.id ||
        null;
    }
  } else {
    const activeAtStart = [...schedule]
      .reverse()
      .find((item) => item.startMinute <= startMinute);
    if (activeAtStart?.eventLabel) {
      initialEventLabel = activeAtStart.eventLabel;
    }
  }

  let initialPosition = null;
  if (isFinitePoint2D(rawAgent.currentPosition)) {
    const basePos = [
      Number(rawAgent.currentPosition[0]),
      Number(rawAgent.currentPosition[1]),
    ];
    if (!rawAgent.currentRoomId) {
      initialRoomId =
        navigation.getRoomIdAt(basePos[0], basePos[1]) ??
        initialRoomId;
    }
    const existingList = roomSlotCounts.get(`pos:${initialRoomId}`) || [];
    const overlapsExisting = existingList.some(
      (p) => Math.hypot(p[0] - basePos[0], p[1] - basePos[1]) < Math.max(0.58, radiusMeters * 2.1),
    );
    if (!overlapsExisting) {
      initialPosition = basePos;
      existingList.push(basePos);
      roomSlotCounts.set(`pos:${initialRoomId}`, existingList);
    } else if (initialRoomId && navigation.roomsById.has(initialRoomId)) {
      const safe = resolveSafeRoomPosition(navigation, initialRoomId, {
        slotIndex: existingList.length,
        agentRadius: radiusMeters,
        activity: initialActivity,
        house,
        occupiedPositions: existingList,
      });
      initialPosition = safe ? safe.position : basePos;
      existingList.push(initialPosition);
      roomSlotCounts.set(`pos:${initialRoomId}`, existingList);
    } else {
      initialPosition = basePos;
    }
  } else if (initialRoomId && navigation.roomsById.has(initialRoomId)) {
    const slot = roomSlotCounts.get(initialRoomId) ?? 0;
    roomSlotCounts.set(initialRoomId, slot + 1);
    const existingList = roomSlotCounts.get(`pos:${initialRoomId}`) || [];
    const safe = resolveSafeRoomPosition(navigation, initialRoomId, {
      slotIndex: slot,
      agentRadius: radiusMeters,
      activity: initialActivity,
      house,
      occupiedPositions: existingList,
    });
    if (safe) {
      initialPosition = safe.position;
      existingList.push(initialPosition);
      roomSlotCounts.set(`pos:${initialRoomId}`, existingList);
    }
  }

  if (!initialPosition) {
    // Fallback to any walkable room in the house
    for (const room of navigation.rooms) {
      const safe = resolveSafeRoomPosition(navigation, room.id, {
        slotIndex: agentIndex,
        agentRadius: radiusMeters,
        house,
      });
      if (safe) {
        initialPosition = safe.position;
        initialRoomId = room.id;
        break;
      }
    }
  }

  if (!initialPosition) {
    initialPosition = [0, 0];
  }

  return {
    id,
    name,
    role,
    ageGroup: rawAgent.ageGroup ?? "adult",
    color: typeof rawAgent.color === "string" ? rawAgent.color : null,
    heightMeters,
    eyeHeightMeters,
    usesWheelchair,
    turningRadiusMeters,
    needs: rawAgent.needs ? structuredClone(rawAgent.needs) : null,
    movementSpeedMps,
    radiusMeters,
    personalSpaceMeters,
    currentRoomId: initialRoomId,
    currentPosition: [...initialPosition],
    activity: initialActivity,
    eventLabel: initialEventLabel,
    moving: false,
    yaw: 0,
    schedule,
    activeRoute: null,
  };
}
