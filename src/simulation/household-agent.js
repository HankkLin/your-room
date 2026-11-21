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

  const defaultSpeed =
    rawAgent.ageGroup === "olderAdult" || (rawAgent.needs?.accessibility ?? 0) >= 0.7
      ? 1.05
      : DEFAULT_MOVEMENT_SPEED_MPS;
  const movementSpeedMps = Math.max(
    0.2,
    Math.min(4.0, Number(rawAgent.movementSpeedMps ?? defaultSpeed) || defaultSpeed),
  );

  const radiusMeters = Math.max(
    0.05,
    Number(rawAgent.radiusMeters ?? navigation.agentRadius ?? DEFAULT_AGENT_RADIUS),
  );

  const personalSpaceMeters = Math.max(
    radiusMeters,
    Number(rawAgent.personalSpaceMeters ?? DEFAULT_PERSONAL_SPACE_RADIUS),
  );

  const schedule = normalizeSchedule(rawAgent.schedule ?? []);

  // Determine starting room at `startMinute`
  let initialRoomId = rawAgent.currentRoomId ?? null;
  let initialActivity = rawAgent.currentActivity ?? "idle";

  if (!initialRoomId) {
    const activeAtStart = [...schedule]
      .reverse()
      .find((item) => item.startMinute <= startMinute && item.destination.roomId);
    if (activeAtStart) {
      initialRoomId = activeAtStart.destination.roomId;
      initialActivity = activeAtStart.activity;
    } else if (schedule[0]?.destination?.roomId) {
      initialRoomId = schedule[0].destination.roomId;
    } else {
      initialRoomId =
        navigation.rooms.find((r) => r.kind === "bedroom")?.id ||
        navigation.rooms[0]?.id ||
        null;
    }
  }

  let initialPosition = null;
  if (isFinitePoint2D(rawAgent.currentPosition)) {
    initialPosition = [
      Number(rawAgent.currentPosition[0]),
      Number(rawAgent.currentPosition[1]),
    ];
    if (!rawAgent.currentRoomId) {
      initialRoomId =
        navigation.getRoomIdAt(initialPosition[0], initialPosition[1]) ??
        initialRoomId;
    }
  } else if (initialRoomId && navigation.roomsById.has(initialRoomId)) {
    const slot = roomSlotCounts.get(initialRoomId) ?? 0;
    roomSlotCounts.set(initialRoomId, slot + 1);
    const safe = resolveSafeRoomPosition(navigation, initialRoomId, {
      slotIndex: slot,
      agentRadius: radiusMeters,
      activity: initialActivity,
      house,
    });
    if (safe) {
      initialPosition = safe.position;
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
    ageGroup: rawAgent.ageGroup ?? "adult",
    needs: rawAgent.needs ? structuredClone(rawAgent.needs) : null,
    movementSpeedMps,
    radiusMeters,
    personalSpaceMeters,
    currentRoomId: initialRoomId,
    currentPosition: [...initialPosition],
    activity: initialActivity,
    moving: false,
    yaw: 0,
    schedule,
    activeRoute: null,
  };
}
