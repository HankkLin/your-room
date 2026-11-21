import { isObjectLocked, toSceneObject } from "../contracts/scene.js";
import {
  MAX_SCENE_PATCH_OPERATIONS,
  PATCH_ERROR_CODES,
  SCENE_PATCH_OPERATION_TYPES,
} from "../contracts/scene-patch.js";
import {
  buildNavigationModel,
  resolveExitPosition,
  resolveSafeRoomPosition,
} from "../simulation/navigation-grid.js";
import { findPath } from "../simulation/pathfinding.js";
import { buildOpaqueWallSegments } from "../simulation/validators/sightline.js";
import {
  deriveWallsFromRooms,
  isFinitePoint2D,
  pointInPolygon,
  pointToSegmentDistance,
  projectPointOnSegment,
  segmentsIntersect2D,
} from "../spatial/floorplan-geometry.js";
import {
  applyScenePatch,
  lookupCandidateProduct,
  livePatchError,
  parsePositionTriple,
  parseRotationTriple,
} from "./apply-scene-patch.js";

function patchError(code, message, operationIndex = null, objectId = null) {
  return {
    code,
    message,
    ...(operationIndex != null ? { operationIndex } : {}),
    ...(objectId != null ? { objectId } : {}),
  };
}

function objectFootprintPolygon(sceneObj) {
  const cx = sceneObj.position[0];
  const cz = sceneObj.position[2];
  const hw = sceneObj.dimensions.width / 2;
  const hd = sceneObj.dimensions.depth / 2;
  const yaw = Array.isArray(sceneObj.rotation)
    ? sceneObj.rotation[1] || 0
    : Array.isArray(sceneObj.rotationRadians)
      ? sceneObj.rotationRadians[1] || 0
      : ((Number(sceneObj.rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([lx, lz]) => [cx + lx * cos - lz * sin, cz + lx * sin + lz * cos]);
}

function polygonsOverlap2D(polyA, polyB) {
  if (polyA.some((pt) => pointInPolygon(pt, polyB))) return true;
  if (polyB.some((pt) => pointInPolygon(pt, polyA))) return true;

  for (let i = 0; i < polyA.length; i += 1) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j += 1) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      if (segmentsIntersect2D(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function verticalRangesOverlap(minA, maxA, minB, maxB) {
  return minA < maxB - 0.01 && minB < maxA - 0.01;
}

function polygonIntersectsWallSegment(poly, segStart, segEnd, halfThickness) {
  if (pointInPolygon(segStart, poly) || pointInPolygon(segEnd, poly)) {
    return true;
  }
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (segmentsIntersect2D(a, b, segStart, segEnd)) return true;
    if (pointToSegmentDistance(a, segStart, segEnd) < halfThickness + 0.015) {
      return true;
    }
  }
  return false;
}

function buildDoorwayClearancePolygons(house) {
  const walls =
    Array.isArray(house.walls) && house.walls.length > 0
      ? house.walls
      : deriveWallsFromRooms(house.rooms || [], [], house.ceilingHeight ?? 2.7);
  const zones = [];

  for (const door of Array.isArray(house.doors) ? house.doors : []) {
    if (!door || door.blocked === true || door.closed === true) continue;
    if (!isFinitePoint2D(door.position)) continue;

    let yaw = 0;
    for (const wall of walls) {
      if (!isFinitePoint2D(wall.start) || !isFinitePoint2D(wall.end)) continue;
      const proj = projectPointOnSegment(door.position, wall.start, wall.end);
      if (door.wallId === wall.id || proj.distance <= 0.25) {
        yaw = Math.atan2(
          wall.end[1] - wall.start[1],
          wall.end[0] - wall.start[0],
        );
        break;
      }
    }

    const hw = Math.max(0.3, ((Number(door.width) || 0.85) * 0.86) / 2);
    const hd = 0.42; // 84 cm total clear swing/threshold band across the doorway
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const cx = door.position[0];
    const cz = door.position[1];

    zones.push({
      doorId: door.id,
      polygon: [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ].map(([lx, lz]) => [cx + lx * cos - lz * sin, cz + lx * sin + lz * cos]),
    });
  }
  return zones;
}

function lockedErrorCodeForOp(opType) {
  switch (opType) {
    case "move":
      return PATCH_ERROR_CODES.MOVE_LOCKED_OBJECT;
    case "rotate":
      return PATCH_ERROR_CODES.ROTATE_LOCKED_OBJECT;
    case "remove":
      return PATCH_ERROR_CODES.REMOVE_LOCKED_OBJECT;
    case "replace":
      return PATCH_ERROR_CODES.REPLACE_LOCKED_OBJECT;
    default:
      return PATCH_ERROR_CODES.MOVE_LOCKED_OBJECT;
  }
}

function isValidDimensions(dims, ceilingHeight) {
  if (!dims || typeof dims !== "object") return false;
  const w = Number(dims.width);
  const h = Number(dims.height);
  const d = Number(dims.depth);
  if (![w, h, d].every(Number.isFinite)) return false;
  if (w < 0.08 || w > 6.5 || d < 0.08 || d > 6.5) return false;
  if (h < 0.01 || h > ceilingHeight - 0.02) return false;
  return true;
}

/**
 * Deterministically validate a proposed `ScenePatch` against:
 * 1. Schema & operation limits
 * 2. Absolute locked-object immutability (`MOVE_LOCKED_OBJECT`, `REMOVE_LOCKED_OBJECT`, etc.)
 * 3. Object ID existence & non-duplicate mutation
 * 4. Finite coordinates, elevation, rotation, and reasonable dimensions
 * 5. Room containment, wall non-intersection, locked fixture clearance, furniture non-overlap, and doorway clearance
 * 6. Whole-home navigation preservation (no newly unreachable rooms or exterior exits)
 *
 * @param {object} house
 * @param {object} patch
 * @param {object} [options]
 * @param {Array<object>} [options.candidateProducts=[]]
 */
export function validateScenePatch(house, patch, options = {}) {
  const errors = [];

  if (!house || typeof house !== "object" || !Array.isArray(house.rooms)) {
    return {
      valid: false,
      errors: [patchError(PATCH_ERROR_CODES.INVALID_PATCH, "Invalid House JSON.")],
    };
  }

  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return {
      valid: false,
      errors: [
        patchError(
          PATCH_ERROR_CODES.INVALID_PATCH,
          "ScenePatch must be a non-null JSON object.",
        ),
      ],
    };
  }

  if (!Array.isArray(patch.operations) || patch.operations.length === 0) {
    return {
      valid: false,
      errors: [
        patchError(
          PATCH_ERROR_CODES.EMPTY_OPERATIONS,
          "ScenePatch must contain at least one operation.",
        ),
      ],
    };
  }

  if (patch.operations.length > MAX_SCENE_PATCH_OPERATIONS) {
    return {
      valid: false,
      errors: [
        patchError(
          PATCH_ERROR_CODES.TOO_MANY_OPERATIONS,
          `ScenePatch exceeds maximum of ${MAX_SCENE_PATCH_OPERATIONS} operations.`,
        ),
      ],
    };
  }

  const ceilingHeight = Number(house.ceilingHeight) || 2.7;
  const candidateProducts = options.candidateProducts || [];

  // Index locked architectural reality + locked objects vs movable objects
  const lockedIds = new Map();
  for (const wall of house.walls || []) {
    if (wall?.id) lockedIds.set(wall.id, wall);
  }
  for (const door of house.doors || []) {
    if (door?.id) lockedIds.set(door.id, door);
  }
  for (const win of house.windows || []) {
    if (win?.id) lockedIds.set(win.id, win);
  }
  for (const fix of house.fixtures || []) {
    if (fix?.id) lockedIds.set(fix.id, fix);
  }

  const movableIds = new Map();
  for (const obj of house.objects || []) {
    if (!obj?.id) continue;
    if (isObjectLocked(obj)) {
      lockedIds.set(obj.id, obj);
    } else {
      movableIds.set(obj.id, obj);
    }
  }

  const mutatedIds = new Set();
  const touchedAfterIds = new Map(); // objectId -> operationIndex

  patch.operations.forEach((op, index) => {
    if (!op || typeof op !== "object") {
      errors.push(
        patchError(
          PATCH_ERROR_CODES.INVALID_PATCH,
          `Operation at index ${index} must be an object.`,
          index,
        ),
      );
      return;
    }

    const opType = op.type;
    const objectId = typeof op.objectId === "string" ? op.objectId.trim() : "";

    if (!SCENE_PATCH_OPERATION_TYPES.includes(opType)) {
      errors.push(
        patchError(
          PATCH_ERROR_CODES.UNSUPPORTED_OPERATION,
          `Unsupported ScenePatch operation type "${String(opType)}".`,
          index,
          objectId || null,
        ),
      );
      return;
    }

    if (!objectId) {
      errors.push(
        patchError(
          PATCH_ERROR_CODES.UNKNOWN_OBJECT,
          `Operation "${opType}" at index ${index} is missing objectId.`,
          index,
        ),
      );
      return;
    }

    if (mutatedIds.has(objectId)) {
      errors.push(
        patchError(
          PATCH_ERROR_CODES.DUPLICATE_OBJECT_MUTATION,
          `Object "${objectId}" is mutated more than once in the same ScenePatch.`,
          index,
          objectId,
        ),
      );
      return;
    }
    mutatedIds.add(objectId);

    // 1. Absolute locked-object check BEFORE unknown-object check
    if (opType !== "add" && lockedIds.has(objectId)) {
      const code = lockedErrorCodeForOp(opType);
      errors.push(
        patchError(
          code,
          `Cannot ${opType} locked object or fixed fixture "${objectId}".`,
          index,
          objectId,
        ),
      );
      return;
    }

    if (opType === "add" || opType === "replace") {
      const candidate = lookupCandidateProduct(op.productId ?? op.object?.productId, candidateProducts);
      const message = livePatchError(op, candidate);
      if (message) {
        errors.push(patchError(PATCH_ERROR_CODES.INVALID_PATCH, message, index, objectId));
        return;
      }
      if (candidate?.offerSignature && !isValidDimensions(candidate.dimensions, ceilingHeight)) {
        errors.push(patchError(PATCH_ERROR_CODES.INVALID_DIMENSIONS, "This Shopify product does not fit the home.", index, objectId));
        return;
      }
    }
    if (opType === "add") {
      if (lockedIds.has(objectId) || movableIds.has(objectId)) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.DUPLICATE_OBJECT_ID,
            `Cannot add object "${objectId}": ID already exists in scene.`,
            index,
            objectId,
          ),
        );
        return;
      }
      const pos = parsePositionTriple(op.position ?? op.object?.position);
      if (!pos) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.INVALID_COORDINATES,
            `Add operation for "${objectId}" requires finite [x, y, z] coordinates.`,
            index,
            objectId,
          ),
        );
        return;
      }
      if (op.rotation != null && !parseRotationTriple(op.rotation)) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.INVALID_ROTATION,
            `Add operation for "${objectId}" has invalid rotation.`,
            index,
            objectId,
          ),
        );
        return;
      }
      const product = lookupCandidateProduct(
        op.productId ?? op.object?.productId,
        candidateProducts,
      );
      const dims =
        op.object?.dimensions ??
        (op.object?.width != null
          ? {
              width: op.object.width,
              height: op.object.height,
              depth: op.object.depth,
            }
          : null) ??
        product?.dimensions ??
        (product
          ? {
              width: product.width,
              height: product.height,
              depth: product.depth,
            }
          : null);
      if (!isValidDimensions(dims, ceilingHeight)) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.INVALID_DIMENSIONS,
            `Add operation for "${objectId}" requires valid dimensions { width, height, depth }.`,
            index,
            objectId,
          ),
        );
        return;
      }
      if (pos[1] < -1e-4 || pos[1] + Number(dims.height) > ceilingHeight + 0.02) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.INVALID_ELEVATION,
            `Add operation for "${objectId}" has invalid elevation ${pos[1]} m.`,
            index,
            objectId,
          ),
        );
        return;
      }
      touchedAfterIds.set(objectId, index);
      return;
    }

    // Non-add operations must reference an existing movable object
    const existing = movableIds.get(objectId);
    if (!existing) {
      errors.push(
        patchError(
          PATCH_ERROR_CODES.UNKNOWN_OBJECT,
          `Unknown movable object "${objectId}".`,
          index,
          objectId,
        ),
      );
      return;
    }

    if (opType === "move") {
      const pos = parsePositionTriple(op.position);
      if (!pos) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.INVALID_COORDINATES,
            `Move operation for "${objectId}" requires finite [x, y, z] coordinates.`,
            index,
            objectId,
          ),
        );
        return;
      }
      const objHeight = Number(existing.dimensions?.height ?? existing.height ?? 0.8);
      if (pos[1] < -1e-4 || pos[1] + objHeight > ceilingHeight + 0.02) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.INVALID_ELEVATION,
            `Move operation for "${objectId}" places object at invalid elevation ${pos[1]} m.`,
            index,
            objectId,
          ),
        );
        return;
      }
      if (op.rotation != null && !parseRotationTriple(op.rotation)) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.INVALID_ROTATION,
            `Move operation for "${objectId}" has invalid rotation.`,
            index,
            objectId,
          ),
        );
        return;
      }
      touchedAfterIds.set(objectId, index);
    } else if (opType === "rotate") {
      if (!parseRotationTriple(op.rotation)) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.INVALID_ROTATION,
            `Rotate operation for "${objectId}" requires finite rotation [rx, ry, rz].`,
            index,
            objectId,
          ),
        );
        return;
      }
      touchedAfterIds.set(objectId, index);
    } else if (opType === "replace") {
      const product = lookupCandidateProduct(
        op.productId ?? op.object?.productId,
        candidateProducts,
      );
      const hasReplacementSpec = Boolean(
        product ||
          (op.object &&
            typeof op.object === "object" &&
            (op.object.dimensions || op.object.kind || op.object.name)),
      );
      if (!hasReplacementSpec) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.MISSING_REPLACEMENT_DATA,
            `Replace operation for "${objectId}" requires a known productId or replacement object specification.`,
            index,
            objectId,
          ),
        );
        return;
      }
      if (op.position != null && !parsePositionTriple(op.position)) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.INVALID_COORDINATES,
            `Replace operation for "${objectId}" has invalid coordinates.`,
            index,
            objectId,
          ),
        );
        return;
      }
      if (op.rotation != null && !parseRotationTriple(op.rotation)) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.INVALID_ROTATION,
            `Replace operation for "${objectId}" has invalid rotation.`,
            index,
            objectId,
          ),
        );
        return;
      }
      if (
        op.object?.dimensions &&
        !isValidDimensions(op.object.dimensions, ceilingHeight)
      ) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.INVALID_DIMENSIONS,
            `Replace operation for "${objectId}" has invalid replacement dimensions.`,
            index,
            objectId,
          ),
        );
        return;
      }
      touchedAfterIds.set(op.object?.id || objectId, index);
    }
  });

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // 2. Spatial placement checks on candidate patched house
  const candidateHouse = applyScenePatch(house, patch, { candidateProducts });
  const rooms = candidateHouse.rooms || [];
  const solidWallSegments = buildOpaqueWallSegments(candidateHouse);
  const rawWallsById = new Map(
    (
      (Array.isArray(candidateHouse.walls) && candidateHouse.walls.length > 0
        ? candidateHouse.walls
        : deriveWallsFromRooms(rooms, [], ceilingHeight)) || []
    ).map((w) => [w.id, w]),
  );

  const fixtureShapes = (candidateHouse.fixtures || []).map((fix) => {
    const normalized = toSceneObject({ ...fix, type: "fixed", locked: true });
    return {
      id: normalized.id,
      minY: normalized.position[1],
      maxY: normalized.position[1] + normalized.dimensions.height,
      polygon:
        Array.isArray(fix.footprint) &&
        fix.footprint.length >= 3 &&
        fix.footprint.every(isFinitePoint2D)
          ? fix.footprint
          : objectFootprintPolygon(normalized),
    };
  });

  const doorwayZones = buildDoorwayClearancePolygons(candidateHouse);
  const allObjects = (candidateHouse.objects || []).map((o) => toSceneObject(o));

  for (const [objId, opIndex] of touchedAfterIds.entries()) {
    const obj = allObjects.find((o) => o.id === objId);
    if (!obj) continue;

    const poly = objectFootprintPolygon(obj);
    const center2D = [obj.position[0], obj.position[2]];
    const minY = obj.position[1];
    const maxY = minY + obj.dimensions.height;
    const isRug = obj.kind === "rug" || obj.dimensions.height <= 0.06;

    // Check center lies inside a valid room
    const centerRoom = rooms.find((r) => pointInPolygon(center2D, r.polygon));
    if (!centerRoom) {
      errors.push(
        patchError(
          PATCH_ERROR_CODES.OUTSIDE_ROOM_BOUNDS,
          `Object "${objId}" center [${center2D[0]}, ${center2D[1]}] lies outside all rooms.`,
          opIndex,
          objId,
        ),
      );
      continue;
    }

    // Check wall collision BEFORE corner room-bounds check so wall overlaps report WALL_INTERSECTION
    let hitWall = null;
    for (const seg of solidWallSegments) {
      const halfT = (Number(rawWallsById.get(seg.objectId)?.thickness) || 0.14) / 2;
      if (polygonIntersectsWallSegment(poly, seg.start, seg.end, halfT)) {
        hitWall = seg.objectId;
        break;
      }
    }
    if (hitWall) {
      errors.push(
        patchError(
          PATCH_ERROR_CODES.WALL_INTERSECTION,
          `Object "${objId}" intersects wall "${hitWall}".`,
          opIndex,
          objId,
        ),
      );
      continue;
    }

    // Verify all 4 footprint corners remain inside house rooms
    const allCornersInHouse = poly.every((corner) =>
      rooms.some((r) => pointInPolygon(corner, r.polygon)),
    );
    if (!allCornersInHouse) {
      errors.push(
        patchError(
          PATCH_ERROR_CODES.OUTSIDE_ROOM_BOUNDS,
          `Object "${objId}" extends outside room boundaries.`,
          opIndex,
          objId,
        ),
      );
      continue;
    }

    if (isRug) continue;

    // Check doorway blockage
    const blockedDoor = doorwayZones.find((dz) =>
      polygonsOverlap2D(poly, dz.polygon),
    );
    if (blockedDoor) {
      errors.push(
        patchError(
          PATCH_ERROR_CODES.DOOR_BLOCKED,
          `Object "${objId}" obstructs doorway clearance for "${blockedDoor.doorId}".`,
          opIndex,
          objId,
        ),
      );
      continue;
    }

    // Check locked fixture collision
    const hitFixture = fixtureShapes.find(
      (fix) =>
        verticalRangesOverlap(minY, maxY, fix.minY, fix.maxY) &&
        polygonsOverlap2D(poly, fix.polygon),
    );
    if (hitFixture) {
      errors.push(
        patchError(
          PATCH_ERROR_CODES.FIXTURE_COLLISION,
          `Object "${objId}" collides with locked fixture "${hitFixture.id}".`,
          opIndex,
          objId,
        ),
      );
      continue;
    }

    // Check collision against other non-rug objects
    for (const other of allObjects) {
      if (other.id === obj.id) continue;
      const otherIsRug =
        other.kind === "rug" || other.dimensions.height <= 0.06;
      if (otherIsRug) continue;
      const otherMinY = other.position[1];
      const otherMaxY = otherMinY + other.dimensions.height;
      if (!verticalRangesOverlap(minY, maxY, otherMinY, otherMaxY)) continue;

      const otherPoly = objectFootprintPolygon(other);
      if (polygonsOverlap2D(poly, otherPoly)) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.OBJECT_COLLISION,
            `Object "${objId}" overlaps with furniture "${other.id}".`,
            opIndex,
            objId,
          ),
        );
        break;
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // 3. Navigation preservation: ensure previously reachable rooms & exits stay reachable
  const beforeNav = buildNavigationModel(house);
  const afterNav = buildNavigationModel(candidateHouse);

  const beforeSafeByRoom = new Map();
  const afterSafeByRoom = new Map();
  for (const room of rooms) {
    const bSafe = resolveSafeRoomPosition(beforeNav, room.id, { house });
    const aSafe = resolveSafeRoomPosition(afterNav, room.id, {
      house: candidateHouse,
    });
    if (bSafe) beforeSafeByRoom.set(room.id, bSafe.position);
    if (aSafe) afterSafeByRoom.set(room.id, aSafe.position);
    if (bSafe && !aSafe) {
      errors.push(
        patchError(
          PATCH_ERROR_CODES.PATCH_BLOCKS_REQUIRED_ROUTE,
          `ScenePatch leaves room "${room.id}" with no walkable standing space.`,
        ),
      );
    }
  }

  if (errors.length === 0 && beforeSafeByRoom.size >= 2) {
    const [anchorRoomId, beforeAnchorPos] = [...beforeSafeByRoom.entries()][0];
    const afterAnchorPos = afterSafeByRoom.get(anchorRoomId);

    for (const [targetRoomId, beforeTargetPos] of beforeSafeByRoom.entries()) {
      if (targetRoomId === anchorRoomId) continue;
      const wasReachable = findPath({
        navigation: beforeNav,
        start: beforeAnchorPos,
        goal: beforeTargetPos,
      }).success;
      if (!wasReachable) continue;

      const afterTargetPos = afterSafeByRoom.get(targetRoomId);
      const stillReachable =
        afterAnchorPos &&
        afterTargetPos &&
        findPath({
          navigation: afterNav,
          start: afterAnchorPos,
          goal: afterTargetPos,
        }).success;

      if (!stillReachable) {
        errors.push(
          patchError(
            PATCH_ERROR_CODES.PATCH_BLOCKS_REQUIRED_ROUTE,
            `ScenePatch blocks required route between "${anchorRoomId}" and "${targetRoomId}".`,
          ),
        );
        break;
      }
    }

    // Also verify exterior exit reachability if previously reachable
    const beforeExit = resolveExitPosition(beforeNav);
    if (beforeExit) {
      const wasExitReachable = findPath({
        navigation: beforeNav,
        start: beforeAnchorPos,
        goal: beforeExit.position,
      }).success;
      if (wasExitReachable) {
        const afterExit = resolveExitPosition(afterNav);
        const stillExitReachable =
          afterAnchorPos &&
          afterExit &&
          findPath({
            navigation: afterNav,
            start: afterAnchorPos,
            goal: afterExit.position,
          }).success;
        if (!stillExitReachable) {
          errors.push(
            patchError(
              PATCH_ERROR_CODES.PATCH_BLOCKS_REQUIRED_ROUTE,
              "ScenePatch blocks required evacuation route to exterior exit.",
            ),
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
