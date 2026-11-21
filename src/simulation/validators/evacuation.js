import {
  DEFAULT_AGENT_RADIUS,
  DEFAULT_GRID_CELL_SIZE,
  DEFAULT_MOVEMENT_SPEED_MPS,
  FINDING_TYPES,
  SIMULATION_EVENT_TYPES,
} from "../../contracts/simulation.js";
import { isFinitePoint2D } from "../../spatial/floorplan-geometry.js";
import { createDemoHousehold } from "../demo-household.js";
import { buildNavigationModel, resolveSafeRoomPosition } from "../navigation-grid.js";
import { findPath } from "../pathfinding.js";
import { runSimulation } from "../simulation-engine.js";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

function resolveExteriorDoorTarget(navigation, door, radius) {
  if (!door || door.kind !== "exterior") return null;
  if (door.blocked === true || door.closed === true) return null;
  if (!isFinitePoint2D(door.position)) return null;

  const [doorCol, doorRow] = navigation.worldToCell(
    door.position[0],
    door.position[1],
  );
  const searchCells = Math.ceil(0.85 / navigation.cellSize);
  let best = null;

  for (let dr = -searchCells; dr <= searchCells; dr += 1) {
    for (let dc = -searchCells; dc <= searchCells; dc += 1) {
      const col = doorCol + dc;
      const row = doorRow + dr;
      if (!navigation.isCellWalkable(col, row, radius)) continue;
      const idx = row * navigation.width + col;
      const rIdx = navigation.roomIndexGrid[idx];
      if (door.roomA && rIdx >= 0 && navigation.rooms[rIdx].id !== door.roomA) {
        continue;
      }
      const pos = navigation.cellToWorld(col, row);
      const dist = Math.hypot(
        pos[0] - door.position[0],
        pos[1] - door.position[1],
      );
      // Require threshold access right at the doorway (<= 0.65 m from door center)
      if (dist > 0.65) continue;
      if (!best || dist < best.dist) {
        best = {
          doorId: door.id,
          roomId: door.roomA ?? navigation.getRoomIdAt(pos[0], pos[1]),
          position: pos,
          doorWidthMeters: Number(door.width) || 0.9,
          doorPosition: [...door.position],
          dist,
        };
      }
    }
  }
  return best;
}

function assignPlausibleOccupiedAgents(house, rawHousehold, navigation) {
  const rooms = navigation.rooms;
  const fallbackRooms = [
    rooms.find((r) => r.kind === "bedroom")?.id,
    rooms.find((r) => r.kind === "living")?.id,
    rooms.find((r) => r.kind === "office")?.id,
    rooms.find((r) => r.kind === "kitchen")?.id,
    ...rooms.map((r) => r.id),
  ].filter(Boolean);

  const sourceList =
    Array.isArray(rawHousehold) && rawHousehold.length > 0
      ? rawHousehold
      : createDemoHousehold(house).map((demoAgent, idx) => ({
          ...demoAgent,
          currentRoomId: fallbackRooms[idx % fallbackRooms.length] ?? demoAgent.currentRoomId,
        }));

  const slotCounts = new Map();
  return sourceList.map((raw, idx) => {
    const id = String(raw?.id || `occupant-${idx + 1}`);
    const name = String(raw?.name || id);
    const speed = Math.max(
      0.3,
      Number(raw?.movementSpeedMps ?? DEFAULT_MOVEMENT_SPEED_MPS),
    );
    const radius = Math.max(
      0.05,
      Number(raw?.radiusMeters ?? navigation.agentRadius ?? DEFAULT_AGENT_RADIUS),
    );

    const roomId =
      raw?.evacuationRoomId ??
      raw?.currentRoomId ??
      fallbackRooms[idx % Math.max(1, fallbackRooms.length)] ??
      rooms[0]?.id ??
      null;

    let startPosition = null;
    if (isFinitePoint2D(raw?.currentPosition)) {
      startPosition = [Number(raw.currentPosition[0]), Number(raw.currentPosition[1])];
    } else if (roomId && navigation.roomsById.has(roomId)) {
      const slot = slotCounts.get(roomId) ?? 0;
      slotCounts.set(roomId, slot + 1);
      const safe = resolveSafeRoomPosition(navigation, roomId, {
        slotIndex: slot,
        agentRadius: radius,
        house,
      });
      startPosition = safe?.position ?? null;
    }

    return {
      id,
      name,
      movementSpeedMps: speed,
      radiusMeters: radius,
      startRoomId: roomId,
      startPosition,
    };
  });
}

/**
 * Deterministic Fire / Emergency Evacuation Validator (Task 3A §13–15).
 *
 * Evaluates layout evacuation geometry (nearest reachable exterior exit via A*,
 * route length, estimated travel time at walking speed, and multi-agent exit
 * convergence bottlenecks). Does not simulate fire/smoke physics.
 *
 * @param {object} params
 * @param {object} params.house
 * @param {Array<object>} [params.household]
 * @param {number} [params.maxSafeDistanceMeters=14.0]
 * @param {number} [params.maxSafeSeconds=12.0]
 * @param {object} [params.navigation]
 */
export function validateEvacuation({
  house,
  household,
  maxSafeDistanceMeters = 14.0,
  maxSafeSeconds = 12.0,
  navigation: prebuiltNav = null,
} = {}) {
  const navigation =
    prebuiltNav ??
    buildNavigationModel(house, {
      cellSize: DEFAULT_GRID_CELL_SIZE,
      agentRadius: DEFAULT_AGENT_RADIUS,
    });

  const exteriorDoors = (Array.isArray(house?.doors) ? house.doors : []).filter(
    (d) => d && d.kind === "exterior",
  );
  const candidateExits = exteriorDoors
    .map((door) =>
      resolveExteriorDoorTarget(navigation, door, navigation.agentRadius),
    )
    .filter(Boolean);

  const occupants = assignPlausibleOccupiedAgents(house, household, navigation);
  const findings = [];
  const agentResults = [];
  const simAgents = [];

  for (const occ of occupants) {
    if (!occ.startPosition || candidateExits.length === 0) {
      findings.push({
        type: FINDING_TYPES.NO_EVACUATION_PATH,
        severity: 1,
        agentId: occ.id,
        roomId: occ.startRoomId,
        location: {
          roomId: occ.startRoomId,
          position: occ.startPosition ?? [0, 0],
        },
        evidence: {
          fromRoomId: occ.startRoomId,
          reason:
            candidateExits.length === 0
              ? "NO_UNBLOCKED_EXTERIOR_EXIT"
              : "INVALID_START_POSITION",
        },
      });
      agentResults.push({
        agentId: occ.id,
        fromRoomId: occ.startRoomId,
        reachable: false,
        exitDoorId: null,
        distanceMeters: null,
        estimatedSeconds: null,
        path: [],
      });
      continue;
    }

    let bestChoice = null;
    for (const exit of candidateExits) {
      const route = findPath({
        navigation,
        start: occ.startPosition,
        goal: exit.position,
        agentRadius: occ.radiusMeters,
      });
      if (!route.success) continue;
      if (!bestChoice || route.distanceMeters < bestChoice.route.distanceMeters) {
        bestChoice = { exit, route };
      }
    }

    if (!bestChoice) {
      findings.push({
        type: FINDING_TYPES.NO_EVACUATION_PATH,
        severity: 1,
        agentId: occ.id,
        roomId: occ.startRoomId,
        location: {
          roomId: occ.startRoomId,
          position: occ.startPosition,
        },
        evidence: {
          fromRoomId: occ.startRoomId,
          candidateExitDoorIds: candidateExits.map((e) => e.doorId),
          reason: "NO_PATH",
        },
      });
      agentResults.push({
        agentId: occ.id,
        fromRoomId: occ.startRoomId,
        reachable: false,
        exitDoorId: null,
        distanceMeters: null,
        estimatedSeconds: null,
        path: [],
      });
      continue;
    }

    const distanceMeters = round3(bestChoice.route.distanceMeters);
    const estimatedSeconds = round2(distanceMeters / occ.movementSpeedMps);
    const exitDoorId = bestChoice.exit.doorId;

    agentResults.push({
      agentId: occ.id,
      fromRoomId: occ.startRoomId,
      reachable: true,
      exitDoorId,
      exitDoorWidthMeters: bestChoice.exit.doorWidthMeters,
      exitDoorPosition: bestChoice.exit.doorPosition,
      exitRoomId: bestChoice.exit.roomId,
      distanceMeters,
      estimatedSeconds,
      doorsTraversed: bestChoice.route.doorsTraversed,
      path: bestChoice.route.path,
    });

    if (
      distanceMeters > maxSafeDistanceMeters ||
      estimatedSeconds > maxSafeSeconds
    ) {
      const distRatio = distanceMeters / Math.max(1, maxSafeDistanceMeters);
      const timeRatio = estimatedSeconds / Math.max(1, maxSafeSeconds);
      const excess = Math.max(distRatio, timeRatio) - 1;
      const severity = round2(clamp(0.5 + excess * 0.55, 0.45, 0.95));

      findings.push({
        type: FINDING_TYPES.LONG_EVACUATION_ROUTE,
        severity,
        agentId: occ.id,
        roomId: occ.startRoomId,
        location: {
          roomId: occ.startRoomId,
          position: occ.startPosition,
        },
        evidence: {
          fromRoomId: occ.startRoomId,
          exitDoorId,
          distanceMeters: round2(distanceMeters),
          estimatedSeconds,
          maxSafeDistanceMeters,
          maxSafeSeconds,
        },
      });
    }

    simAgents.push({
      id: occ.id,
      name: occ.name,
      movementSpeedMps: occ.movementSpeedMps,
      radiusMeters: occ.radiusMeters,
      currentRoomId: occ.startRoomId,
      currentPosition: occ.startPosition,
      schedule: [
        {
          startMinute: 0,
          endMinute: 2,
          activity: "other",
          destination: {
            type: "position",
            position: bestChoice.exit.position,
            roomId: bestChoice.exit.roomId,
          },
        },
      ],
    });
  }

  // Run simultaneous evacuation movement timeline to measure corridor/exit collisions
  const maxSecondsNeeded = Math.max(
    15,
    ...agentResults
      .filter((r) => r.reachable)
      .map((r) => Math.ceil(r.estimatedSeconds) + 6),
  );
  const simulation = runSimulation({
    house,
    agents: simAgents,
    startMinute: 0,
    endMinute: round2(maxSecondsNeeded / 60),
    stepSeconds: 0.5,
    navigation,
    longPathThresholdMeters: Infinity, // Handled explicitly via LONG_EVACUATION_ROUTE above
  });

  // Check exit doorway convergence bottlenecks
  const byExit = new Map();
  for (const res of agentResults) {
    if (!res.reachable || !res.exitDoorId) continue;
    if (!byExit.has(res.exitDoorId)) byExit.set(res.exitDoorId, []);
    byExit.get(res.exitDoorId).push(res);
  }

  for (const [exitDoorId, group] of byExit.entries()) {
    if (group.length < 2) continue;
    const doorPos = group[0].exitDoorPosition;
    const doorWidth = group[0].exitDoorWidthMeters;
    const times = group.map((g) => g.estimatedSeconds).sort((a, b) => a - b);

    // Count largest simultaneous arrival burst within a 3.5-second window
    let burstAgents = [];
    for (let i = 0; i < group.length; i += 1) {
      const windowGroup = group.filter(
        (g) =>
          g.estimatedSeconds >= times[i] - 0.1 &&
          g.estimatedSeconds <= times[i] + 3.5,
      );
      if (windowGroup.length > burstAgents.length) burstAgents = windowGroup;
    }

    const collisionsNearExit = simulation.events.filter(
      (ev) =>
        ev.type === SIMULATION_EVENT_TYPES.AGENT_COLLISION &&
        Math.hypot(ev.position[0] - doorPos[0], ev.position[1] - doorPos[1]) <=
          2.8,
    ).length;

    const isNarrowExit = doorWidth <= 1.05;
    const hasBottleneck =
      (burstAgents.length >= 2 && isNarrowExit && collisionsNearExit >= 1) ||
      burstAgents.length >= 3;

    if (hasBottleneck) {
      const queueDelaySeconds = round2(
        (burstAgents.length - 1) * (0.9 / Math.max(0.55, doorWidth)) * 1.35,
      );
      const severity = round2(
        clamp(
          0.45 + (burstAgents.length - 1) * 0.16 + (1.0 - doorWidth) * 0.25,
          0.4,
          0.96,
        ),
      );

      findings.push({
        type: FINDING_TYPES.EVACUATION_BOTTLENECK,
        severity,
        roomId: group[0].exitRoomId,
        location: {
          roomId: group[0].exitRoomId,
          position: [round2(doorPos[0]), round2(doorPos[1])],
        },
        evidence: {
          exitDoorId,
          exitDoorWidthMeters: round2(doorWidth),
          convergingAgentCount: burstAgents.length,
          agentIds: burstAgents.map((a) => a.agentId),
          collisionCountNearExit: collisionsNearExit,
          estimatedQueueDelaySeconds: queueDelaySeconds,
        },
      });
    }
  }

  const reachableResults = agentResults.filter((r) => r.reachable);
  const maxEvacuationSeconds = reachableResults.length
    ? Math.max(...reachableResults.map((r) => r.estimatedSeconds))
    : null;

  return {
    findings,
    agentRoutes: agentResults,
    simulation,
    summary: {
      scenario: "fire-evacuation",
      occupantCount: occupants.length,
      evacuatedCount: reachableResults.length,
      blockedCount: occupants.length - reachableResults.length,
      maxEvacuationSeconds,
      collisionCount: simulation.summary.collisions,
    },
  };
}
