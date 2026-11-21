/**
 * Shared Whole-Home Scene & Imported House Contract.
 *
 * Coordinate convention (AGENTS.md §4):
 * - World units: meters ("meters")
 * - Floor plane: X / Z (2D floorplan points are [x, z] in meters)
 * - Vertical axis: Y (upward, floor at Y = 0)
 */

export const HOUSE_UNITS = "meters";
export const DEFAULT_CEILING_HEIGHT = 2.7;
export const DEFAULT_WALL_THICKNESS = 0.14;
export const DEFAULT_DOOR_HEIGHT = 2.08;
export const DEFAULT_WINDOW_SILL_HEIGHT = 0.9;
export const DEFAULT_WINDOW_HEAD_HEIGHT = 2.15;

export const CALIBRATION_SOURCES = Object.freeze([
  "printed_dimension",
  "manual_calibration",
  "scale_bar",
  "unknown",
]);

export const DOOR_KINDS = Object.freeze([
  "interior",
  "exterior",
  "unknown_opening",
]);

export const FIXTURE_KINDS = Object.freeze([
  "toilet",
  "sink",
  "bathtub",
  "shower",
  "kitchen_counter",
  "stove",
  "closet",
  "refrigerator",
  "ac",
]);

export const ROOM_KINDS = Object.freeze([
  "living",
  "kitchen",
  "bedroom",
  "bathroom",
  "hallway",
  "dining",
  "office",
  "closet",
  "other",
]);

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

const FIXTURE_COLORS = {
  toilet: "#f2efe9",
  sink: "#d9d0c1",
  bathtub: "#f3f0ea",
  shower: "#dce5e7",
  kitchen_counter: "#c5ab8b",
  counter: "#c5ab8b",
  stove: "#515356",
  closet: "#b99d7c",
  refrigerator: "#c8ccd0",
  ac: "#f4f3ee",
};

/**
 * Normalize shorthand calibration source labels into canonical enum values.
 * @param {string | null | undefined} source
 * @returns {"printed_dimension" | "manual_calibration" | "scale_bar" | "unknown"}
 */
export function normalizeCalibrationSource(source) {
  if (source === "manual" || source === "manual_calibration") {
    return "manual_calibration";
  }
  if (source === "printed" || source === "printed_dimension") {
    return "printed_dimension";
  }
  if (source === "scale_bar") {
    return "scale_bar";
  }
  return "unknown";
}

/**
 * Project locked architectural fixtures into SceneObject records compatible
 * with AGENTS.md §4 SceneObject shape when downstream consumers need fixed
 * fixtures merged with scene objects.
 *
 * @param {object} house
 * @returns {Array<object>}
 */
export function houseFixturesAsSceneObjects(house) {
  if (!house || !Array.isArray(house.fixtures)) return [];
  return house.fixtures.map((fixture) => ({
    id: fixture.id,
    type: "fixed",
    kind: fixture.kind,
    name: fixture.name,
    roomId: fixture.roomId ?? null,
    position: Array.isArray(fixture.position) ? [...fixture.position] : [0, 0, 0],
    rotation: Array.isArray(fixture.rotation) ? [...fixture.rotation] : [0, 0, 0],
    dimensions: {
      width: fixture.dimensions?.width ?? 0.6,
      height: fixture.dimensions?.height ?? 0.85,
      depth: fixture.dimensions?.depth ?? 0.6,
    },
    locked: true,
  }));
}

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
 * Normalize either a canonical FixedFixture / SceneObject (position: [x,y,z], rotation: [0,yawRad,0])
 * or a Living Blueprint flat item (x, z, rotation in degrees) into a unified renderable SceneObject.
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

  let deg = 0;
  let yawRad = 0;
  if (Array.isArray(item.rotation)) {
    yawRad = Number(item.rotation[1]) || 0;
    deg = (yawRad * 180) / Math.PI;
  } else {
    deg = Number(item.rotation) || 0;
    yawRad = (deg * Math.PI) / 180;
  }

  const type =
    item.type || (item.locked ? "fixed" : item.owned ? "existing" : "shopify");
  const locked = Boolean(item.locked || type === "fixed");
  const kind = item.kind || "console";

  return {
    ...item,
    kind,
    type,
    locked,
    owned: Boolean(item.owned || type === "fixed"),
    price: locked || item.owned ? 0 : (Number(item.price) || 0),
    color: item.color || FIXTURE_COLORS[kind] || "#c5b69e",
    x,
    y,
    elevation: y,
    z,
    width,
    height,
    depth,
    rotation: deg,
    position: [x, y, z],
    rotationRadians: [0, yawRad, 0],
    dimensions: { width, height, depth },
  };
}
