/**
 * Shared spatial contracts for the Household Digital Twin.
 *
 * Conventions:
 * - World units: meters
 * - Floor plane: X / Z
 * - Vertical axis: Y (0 = floor, +Y = up)
 */

export const ALLOWED_PATCH_OPS = new Set([
  "move",
  "rotate",
  "add",
  "remove",
  "replace",
  "lock",
  "unlock",
]);

export const IMMUTABLE_LOCKED_OPS = new Set([
  "move",
  "rotate",
  "remove",
  "replace",
]);

/**
 * Determine whether a scene object or architectural element is locked.
 * @param {object | null | undefined} target
 * @returns {boolean}
 */
export function isObjectLocked(target) {
  if (!target) return false;
  return Boolean(target.locked || target.type === "fixed");
}

/**
 * Check whether an operation is permitted on a scene object.
 * Fixed architectural fixtures cannot be unlocked or mutated automatically.
 * @param {object | null | undefined} target
 * @param {string} operationType
 * @returns {boolean}
 */
export function canModifyObject(target, operationType) {
  if (!ALLOWED_PATCH_OPS.has(operationType)) return false;
  if (!target) return operationType === "add";
  if (target.type === "fixed") return false;
  if (isObjectLocked(target) && IMMUTABLE_LOCKED_OPS.has(operationType)) {
    return false;
  }
  return true;
}

/**
 * Convert an internal item/fixture into the shared SceneObject contract shape
 * while preserving flat properties used by the Stillroom UI and renderer.
 * @param {object} item
 * @returns {object}
 */
export function toSceneObject(item) {
  const x = Number(item.x ?? item.position?.[0]) || 0;
  const y = Number(item.elevation ?? item.y ?? item.position?.[1]) || 0;
  const z = Number(item.z ?? item.position?.[2]) || 0;
  const width = Math.max(0.05, Number(item.width ?? item.dimensions?.width) || 0.6);
  const height = Math.max(0.008, Number(item.height ?? item.dimensions?.height) || 0.75);
  const depth = Math.max(0.05, Number(item.depth ?? item.dimensions?.depth) || 0.6);
  const deg = Number(item.rotation) || 0;
  const type =
    item.type || (item.locked ? "fixed" : item.owned ? "existing" : "shopify");
  const locked = Boolean(item.locked || type === "fixed");

  return {
    ...item,
    type,
    locked,
    x,
    y,
    elevation: y,
    z,
    width,
    height,
    depth,
    rotation: deg,
    position: [x, y, z],
    rotationRadians: [0, (deg * Math.PI) / 180, 0],
    dimensions: { width, height, depth },
  };
}

/**
 * Validate a whole-home Scene / House contract deterministically.
 * @param {object} house
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateHouseScene(house) {
  const errors = [];
  if (!house || typeof house !== "object") {
    return { valid: false, errors: ["House scene must be an object."] };
  }
  if (!house.id || typeof house.id !== "string") {
    errors.push("House must have a string id.");
  }
  if (!Number.isFinite(house.ceilingHeight) || house.ceilingHeight <= 0) {
    errors.push("House ceilingHeight must be a positive finite number.");
  }
  if (!Array.isArray(house.rooms) || house.rooms.length === 0) {
    errors.push("House must contain at least one room.");
  }

  const roomIds = new Set();
  for (const room of house.rooms ?? []) {
    if (!room?.id || typeof room.id !== "string") {
      errors.push("Every room must have a string id.");
      continue;
    }
    if (roomIds.has(room.id)) {
      errors.push(`Duplicate room id: ${room.id}`);
    }
    roomIds.add(room.id);
    if (!Array.isArray(room.polygon) || room.polygon.length < 3) {
      errors.push(`Room ${room.id} must have a polygon with >= 3 vertices.`);
    } else {
      for (const pt of room.polygon) {
        if (!Array.isArray(pt) || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
          errors.push(`Room ${room.id} has non-finite polygon coordinates.`);
          break;
        }
      }
    }
  }

  const wallIds = new Set();
  for (const wall of house.walls ?? []) {
    if (!wall?.id) {
      errors.push("Every wall must have an id.");
      continue;
    }
    if (wallIds.has(wall.id)) {
      errors.push(`Duplicate wall id: ${wall.id}`);
    }
    wallIds.add(wall.id);
    const coords = [wall.x1, wall.z1, wall.x2, wall.z2, wall.thickness, wall.height];
    if (coords.some((v) => !Number.isFinite(v))) {
      errors.push(`Wall ${wall.id} has non-finite geometry.`);
    }
    if (Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1) <= 0.01) {
      errors.push(`Wall ${wall.id} has zero length.`);
    }
  }

  for (const door of house.doors ?? []) {
    if (!door?.id) errors.push("Every door must have an id.");
    if (!wallIds.has(door.wallId)) {
      errors.push(`Door ${door?.id} references unknown wall ${door?.wallId}.`);
    }
    if (!Array.isArray(door.roomIds) || door.roomIds.length === 0) {
      errors.push(`Door ${door?.id} must reference at least one room.`);
    } else {
      for (const roomId of door.roomIds) {
        if (!roomIds.has(roomId)) {
          errors.push(`Door ${door.id} references unknown room ${roomId}.`);
        }
      }
      if (!door.exterior && door.roomIds.length < 2) {
        errors.push(`Interior door ${door.id} must connect two valid rooms.`);
      }
    }
    if (!Number.isFinite(door.width) || door.width <= 0) {
      errors.push(`Door ${door?.id} must have a positive finite width.`);
    }
  }

  for (const win of house.windows ?? []) {
    if (!win?.id) errors.push("Every window must have an id.");
    if (!wallIds.has(win.wallId)) {
      errors.push(`Window ${win?.id} references unknown wall ${win?.wallId}.`);
    }
    for (const roomId of win.roomIds ?? []) {
      if (!roomIds.has(roomId)) {
        errors.push(`Window ${win.id} references unknown room ${roomId}.`);
      }
    }
  }

  for (const obj of house.objects ?? []) {
    const nums = [obj.x, obj.z, obj.width, obj.depth, obj.height];
    if (nums.some((v) => !Number.isFinite(v)) || obj.width <= 0 || obj.depth <= 0 || obj.height <= 0) {
      errors.push(`Object ${obj?.id} has invalid dimensions or coordinates.`);
    }
  }

  return { valid: errors.length === 0, errors };
}
