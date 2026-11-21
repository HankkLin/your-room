import {
  DEFAULT_AGENT_RADIUS,
  DEFAULT_GRID_CELL_SIZE,
  FINDING_TYPES,
} from "../../contracts/simulation.js";
import { polygonBounds } from "../../spatial/floorplan-geometry.js";
import {
  buildNavigationModel,
  resolveExitPosition,
  resolveSafeRoomPosition,
} from "../navigation-grid.js";
import { findPath } from "../pathfinding.js";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round2 = (n) => Math.round(n * 100) / 100;

export const DEFAULT_WHEELCHAIR_WIDTH_METERS = 0.84;
export const DEFAULT_WHEELCHAIR_RADIUS_METERS = 0.42;
export const MIN_ACCESSIBLE_DOOR_WIDTH_METERS = 0.82;
export const REQUIRED_TURN_DIAMETER_METERS = 1.5; // 1.50 m ADA / universal design 360° turning circle
export const REQUIRED_TURN_RADIUS_METERS = REQUIRED_TURN_DIAMETER_METERS / 2; // 0.75 m radial clearance

const ESSENTIAL_ROOM_KINDS = new Set([
  "living",
  "kitchen",
  "bedroom",
  "bathroom",
]);

function isAccessibilityRelevantForHousehold(household = [], forceCheck = false) {
  if (forceCheck) return true;
  if (!Array.isArray(household)) return false;
  return household.some(
    (member) =>
      Boolean(member?.usesWheelchair) ||
      Number(member?.needs?.accessibility ?? 0) >= 0.75,
  );
}

function pickEssentialRooms(rooms = []) {
  return rooms.filter(
    (r) =>
      r &&
      (ESSENTIAL_ROOM_KINDS.has(r.kind) ||
        /^(?:living|kitchen|bedroom|bathroom)/i.test(String(r.id || ""))),
  );
}

function measureRoomMaxTurnClearance(navigation, roomId) {
  const roomIdx = navigation.roomIndexById.get(roomId);
  if (roomIdx == null) return { maxRadiusMeters: 0, bestPosition: null };

  const room = navigation.rooms[roomIdx];
  const rBounds = polygonBounds(room.polygon);
  const cMin = Math.max(
    0,
    Math.floor((rBounds.minX - navigation.origin[0]) / navigation.cellSize),
  );
  const cMax = Math.min(
    navigation.width - 1,
    Math.ceil((rBounds.maxX - navigation.origin[0]) / navigation.cellSize),
  );
  const rMin = Math.max(
    0,
    Math.floor((rBounds.minZ - navigation.origin[1]) / navigation.cellSize),
  );
  const rMax = Math.min(
    navigation.height - 1,
    Math.ceil((rBounds.maxZ - navigation.origin[1]) / navigation.cellSize),
  );

  let maxClearance = 0;
  let bestPos = [
    round2((rBounds.minX + rBounds.maxX) / 2),
    round2((rBounds.minZ + rBounds.maxZ) / 2),
  ];

  for (let row = rMin; row <= rMax; row += 1) {
    for (let col = cMin; col <= cMax; col += 1) {
      const idx = row * navigation.width + col;
      if (navigation.roomIndexGrid[idx] !== roomIdx) continue;
      const clr = navigation.clearanceGrid[idx];
      if (clr > maxClearance) {
        maxClearance = clr;
        bestPos = navigation.cellToWorld(col, row);
      }
    }
  }

  return {
    maxRadiusMeters: round2(maxClearance),
    bestPosition: [round2(bestPos[0]), round2(bestPos[1])],
  };
}

/**
 * Deterministic Wheelchair & Mobility Accessibility Validator (`src/simulation/validators/accessibility.js`).
 *
 * Evaluates:
 * 1. `ACCESSIBILITY_CLEARANCE_FAIL`: Doorways narrower than `0.82 m` or key walkway/corridor
 *    pinch points narrower than wheelchair width (`0.84 m`).
 * 2. `ACCESSIBILITY_TURN_RADIUS_FAIL`: Essential rooms (`living`, `kitchen`, `bedroom`, `bathroom`)
 *    lacking an unobstructed `1.50 m` diameter (`0.75 m` radius) turning circle.
 * 3. `ACCESSIBILITY_ROUTE_BLOCKED`: Essential rooms unreachable from the entry / living hub at
 *    wheelchair clearance radius (`0.42 m`).
 *
 * Works in both daily household mode (when any member has `usesWheelchair: true` or
 * `needs.accessibility >= 0.75`) and in the `grandparents-visit` scenario (`forceCheck: true`).
 *
 * @param {object} params
 * @param {object} params.house
 * @param {Array<object>} [params.household=[]]
 * @param {object} [params.navigation]
 * @param {boolean} [params.forceCheck=false]
 * @param {number} [params.wheelchairRadiusMeters=0.42]
 * @param {number} [params.minDoorWidthMeters=0.82]
 * @param {number} [params.requiredTurnDiameterMeters=1.5]
 */
export function validateAccessibility({
  house,
  household = [],
  navigation: prebuiltNav = null,
  forceCheck = false,
  wheelchairRadiusMeters = DEFAULT_WHEELCHAIR_RADIUS_METERS,
  minDoorWidthMeters = MIN_ACCESSIBLE_DOOR_WIDTH_METERS,
  requiredTurnDiameterMeters = REQUIRED_TURN_DIAMETER_METERS,
} = {}) {
  if (!house || !Array.isArray(house.rooms) || house.rooms.length === 0) {
    return { active: false, findings: [], checks: [] };
  }

  const active = isAccessibilityRelevantForHousehold(household, forceCheck);
  if (!active) {
    return { active: false, findings: [], checks: [] };
  }

  const navigation =
    prebuiltNav ??
    buildNavigationModel(house, {
      cellSize: DEFAULT_GRID_CELL_SIZE,
      agentRadius: DEFAULT_AGENT_RADIUS,
    });

  const wheelchairUsers = (Array.isArray(household) ? household : []).filter(
    (m) =>
      Boolean(m?.usesWheelchair) || Number(m?.needs?.accessibility ?? 0) >= 0.75,
  );
  const primaryAgentId = wheelchairUsers[0]?.id ?? null;
  const relatedAgentIds = wheelchairUsers.map((m) => m.id).filter(Boolean);

  const findings = [];
  const checks = [];
  const requiredTurnRadius = requiredTurnDiameterMeters / 2;

  // 1. Doorway width clearance checks (`ACCESSIBILITY_CLEARANCE_FAIL`)
  const essentialRoomIds = new Set(pickEssentialRooms(house.rooms).map((r) => r.id));
  for (const door of navigation.doors) {
    const measuredWidth = round2(Number(door.width) || 0.85);
    const touchesEssential =
      door.kind === "exterior" ||
      essentialRoomIds.has(door.roomA) ||
      (door.roomB && essentialRoomIds.has(door.roomB));
    if (!touchesEssential) continue;

    const passes = measuredWidth + 1e-6 >= minDoorWidthMeters;
    const targetRoomId =
      (door.roomB && essentialRoomIds.has(door.roomB) ? door.roomB : door.roomA) ||
      door.roomA;

    checks.push({
      checkType: "door_width",
      doorId: door.id,
      roomId: targetRoomId,
      measuredWidthMeters: measuredWidth,
      requiredWidthMeters: minDoorWidthMeters,
      passed: passes,
    });

    if (!passes) {
      const deficit = minDoorWidthMeters - measuredWidth;
      const severity = round2(clamp(0.55 + (deficit / 0.18) * 0.4, 0.48, 0.96));
      findings.push({
        type: FINDING_TYPES.ACCESSIBILITY_CLEARANCE_FAIL,
        roomId: targetRoomId,
        agentId: primaryAgentId,
        location: {
          roomId: targetRoomId,
          position: [round2(door.position[0]), round2(door.position[1])],
        },
        severity,
        evidence: {
          doorId: door.id,
          measuredWidthMeters: measuredWidth,
          requiredWidthMeters: minDoorWidthMeters,
          wheelchairWidthMeters: round2(wheelchairRadiusMeters * 2),
          agentIds: relatedAgentIds,
        },
      });
    }
  }

  // 2. Origin hub for wheelchair reachability (exterior entry or living room)
  const entryTarget =
    resolveExitPosition(navigation, wheelchairRadiusMeters) ||
    resolveSafeRoomPosition(
      navigation,
      house.rooms.find((r) => r.kind === "living")?.id || house.rooms[0].id,
      { agentRadius: wheelchairRadiusMeters, house },
    ) ||
    resolveExitPosition(navigation, DEFAULT_AGENT_RADIUS) ||
    resolveSafeRoomPosition(navigation, house.rooms[0].id, {
      agentRadius: DEFAULT_AGENT_RADIUS,
      house,
    });

  const originRoomId = entryTarget?.roomId ?? house.rooms[0].id;
  const essentialRooms = pickEssentialRooms(house.rooms);

  // 3. Per-essential-room wheelchair reachability & 1.50 m turning circle check
  for (const room of essentialRooms) {
    const turn = measureRoomMaxTurnClearance(navigation, room.id);
    const measuredDiameter = round2(turn.maxRadiusMeters * 2);
    const turnPasses = turn.maxRadiusMeters + 1e-6 >= requiredTurnRadius;

    checks.push({
      checkType: "turn_radius",
      roomId: room.id,
      measuredTurnDiameterMeters: measuredDiameter,
      requiredTurnDiameterMeters: requiredTurnDiameterMeters,
      passed: turnPasses,
    });

    if (!turnPasses) {
      const ratio =
        (requiredTurnDiameterMeters - measuredDiameter) /
        Math.max(0.3, requiredTurnDiameterMeters);
      const severity = round2(clamp(0.45 + ratio * 0.55, 0.42, 0.94));
      findings.push({
        type: FINDING_TYPES.ACCESSIBILITY_TURN_RADIUS_FAIL,
        roomId: room.id,
        agentId: primaryAgentId,
        location: {
          roomId: room.id,
          position: turn.bestPosition,
        },
        severity,
        evidence: {
          roomId: room.id,
          measuredTurnDiameterMeters: measuredDiameter,
          requiredTurnDiameterMeters: round2(requiredTurnDiameterMeters),
          agentIds: relatedAgentIds,
        },
      });
    }

    // Wheelchair route reachability from origin
    if (!entryTarget?.position) continue;
    const goalInRoom = resolveSafeRoomPosition(navigation, room.id, {
      agentRadius: wheelchairRadiusMeters,
      house,
    });

    if (!goalInRoom) {
      checks.push({
        checkType: "wheelchair_route",
        fromRoomId: originRoomId,
        toRoomId: room.id,
        passed: false,
        reason: "NO_WHEELCHAIR_STANDING_SPACE",
      });
      findings.push({
        type: FINDING_TYPES.ACCESSIBILITY_ROUTE_BLOCKED,
        roomId: room.id,
        fromRoomId: originRoomId,
        toRoomId: room.id,
        agentId: primaryAgentId,
        location: {
          roomId: room.id,
          position: turn.bestPosition,
        },
        severity: 0.9,
        evidence: {
          fromRoomId: originRoomId,
          toRoomId: room.id,
          wheelchairWidthMeters: round2(wheelchairRadiusMeters * 2),
          reason: "NO_WHEELCHAIR_STANDING_SPACE",
          agentIds: relatedAgentIds,
        },
      });
      continue;
    }

    if (room.id === originRoomId) {
      checks.push({
        checkType: "wheelchair_route",
        fromRoomId: originRoomId,
        toRoomId: room.id,
        passed: true,
        distanceMeters: 0,
      });
      continue;
    }

    // Check if start itself is pinched for a wheelchair; if so, evaluate from nearest wheelchair-valid cell in origin room
    const originStand = navigation.isPointWalkable(
      entryTarget.position[0],
      entryTarget.position[1],
      wheelchairRadiusMeters,
    )
      ? entryTarget
      : resolveSafeRoomPosition(navigation, originRoomId, {
          agentRadius: wheelchairRadiusMeters,
          house,
        });

    const routeResult = originStand
      ? findPath({
          navigation,
          start: originStand.position,
          goal: goalInRoom.position,
          agentRadius: wheelchairRadiusMeters,
        })
      : { success: false, reason: "ORIGIN_BLOCKED" };

    checks.push({
      checkType: "wheelchair_route",
      fromRoomId: originRoomId,
      toRoomId: room.id,
      passed: routeResult.success,
      distanceMeters: routeResult.distanceMeters ?? null,
    });

    if (!routeResult.success) {
      // Identify whether an able-bodied walker CAN reach it (pinpointing narrow doorway/furniture pinch)
      const walkerGoal = resolveSafeRoomPosition(navigation, room.id, {
        agentRadius: DEFAULT_AGENT_RADIUS,
        house,
      });
      const walkerRoute = walkerGoal
        ? findPath({
            navigation,
            start: entryTarget.position,
            goal: walkerGoal.position,
            agentRadius: DEFAULT_AGENT_RADIUS,
          })
        : { success: false };

      const blockingDoorId = walkerRoute.success
        ? walkerRoute.doorsTraversed?.[0] ?? null
        : null;
      const blockingDoor = blockingDoorId
        ? navigation.doors.find((d) => d.id === blockingDoorId)
        : null;

      findings.push({
        type: FINDING_TYPES.ACCESSIBILITY_ROUTE_BLOCKED,
        roomId: room.id,
        fromRoomId: originRoomId,
        toRoomId: room.id,
        agentId: primaryAgentId,
        location: {
          roomId: room.id,
          position: blockingDoor
            ? [round2(blockingDoor.position[0]), round2(blockingDoor.position[1])]
            : goalInRoom.position,
        },
        severity: room.kind === "bathroom" ? 0.92 : 0.86,
        evidence: {
          fromRoomId: originRoomId,
          toRoomId: room.id,
          exitDoorId: blockingDoorId,
          blockingDoorId,
          wheelchairWidthMeters: round2(wheelchairRadiusMeters * 2),
          ableBodiedReachable: Boolean(walkerRoute.success),
          agentIds: relatedAgentIds,
        },
      });
    } else {
      // Even when reachable at 0.42m, check if minimum path corridor clearance is tight (< 0.46m radius = 0.92m comfortable wheelchair passage)
      let minClearanceOnPath = Infinity;
      let tightestPt = routeResult.path[0];
      for (let i = 0; i < routeResult.path.length - 1; i += 1) {
        const a = routeResult.path[i];
        const b = routeResult.path[i + 1];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(1, Math.ceil(segLen / (navigation.cellSize * 0.5)));
        for (let s = 0; s <= steps; s += 1) {
          const frac = s / steps;
          const px = a[0] + (b[0] - a[0]) * frac;
          const pz = a[1] + (b[1] - a[1]) * frac;
          if (navigation.getDoorAt(px, pz)) continue; // doors already checked above
          const clr = navigation.getClearanceAt(px, pz);
          if (clr < minClearanceOnPath) {
            minClearanceOnPath = clr;
            tightestPt = [round2(px), round2(pz)];
          }
        }
      }

      if (minClearanceOnPath < wheelchairRadiusMeters + 0.03) {
        const alreadyReported = findings.some(
          (f) =>
            f.type === FINDING_TYPES.ACCESSIBILITY_CLEARANCE_FAIL &&
            f.roomId === room.id &&
            !f.evidence?.doorId,
        );
        if (!alreadyReported) {
          findings.push({
            type: FINDING_TYPES.ACCESSIBILITY_CLEARANCE_FAIL,
            roomId: room.id,
            agentId: primaryAgentId,
            location: {
              roomId: room.id,
              position: tightestPt,
            },
            severity: 0.58,
            evidence: {
              measuredWidthMeters: round2(minClearanceOnPath * 2),
              requiredWidthMeters: round2((wheelchairRadiusMeters + 0.04) * 2),
              wheelchairWidthMeters: round2(wheelchairRadiusMeters * 2),
              agentIds: relatedAgentIds,
            },
          });
        }
      }
    }
  }

  return {
    active: true,
    findings,
    checks,
  };
}
