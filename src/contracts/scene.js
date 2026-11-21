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
