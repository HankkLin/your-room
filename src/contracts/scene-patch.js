/**
 * Shared ScenePatch Contract (AGENTS.md §4 & Task 4 §4–6).
 *
 * Gemini proposes layout changes strictly through a controlled `ScenePatch`
 * containing movable-furniture operations (`move`, `rotate`, `add`, `remove`,
 * `replace`). Application code deterministically validates and applies patches.
 */

export const SCENE_PATCH_OPERATION_TYPES = Object.freeze([
  "move",
  "rotate",
  "add",
  "remove",
  "replace",
]);

export const PATCH_ERROR_CODES = Object.freeze({
  INVALID_PATCH: "INVALID_PATCH",
  EMPTY_OPERATIONS: "EMPTY_OPERATIONS",
  TOO_MANY_OPERATIONS: "TOO_MANY_OPERATIONS",
  UNSUPPORTED_OPERATION: "UNSUPPORTED_OPERATION",
  DUPLICATE_OBJECT_MUTATION: "DUPLICATE_OBJECT_MUTATION",

  // Locked reality protection (Task 4 §5)
  MOVE_LOCKED_OBJECT: "MOVE_LOCKED_OBJECT",
  ROTATE_LOCKED_OBJECT: "ROTATE_LOCKED_OBJECT",
  REMOVE_LOCKED_OBJECT: "REMOVE_LOCKED_OBJECT",
  REPLACE_LOCKED_OBJECT: "REPLACE_LOCKED_OBJECT",

  // Reference & schema checks (Task 4 §6)
  UNKNOWN_OBJECT: "UNKNOWN_OBJECT",
  DUPLICATE_OBJECT_ID: "DUPLICATE_OBJECT_ID",
  MISSING_REPLACEMENT_DATA: "MISSING_REPLACEMENT_DATA",
  INVALID_COORDINATES: "INVALID_COORDINATES",
  INVALID_ROTATION: "INVALID_ROTATION",
  INVALID_DIMENSIONS: "INVALID_DIMENSIONS",
  INVALID_ELEVATION: "INVALID_ELEVATION",

  // Spatial placement & navigation preservation (Task 4 §7–8)
  OUTSIDE_ROOM_BOUNDS: "OUTSIDE_ROOM_BOUNDS",
  WALL_INTERSECTION: "WALL_INTERSECTION",
  FIXTURE_COLLISION: "FIXTURE_COLLISION",
  OBJECT_COLLISION: "OBJECT_COLLISION",
  DOOR_BLOCKED: "DOOR_BLOCKED",
  PATCH_BLOCKS_REQUIRED_ROUTE: "PATCH_BLOCKS_REQUIRED_ROUTE",
});

export const MAX_SCENE_PATCH_OPERATIONS = 10;

/**
 * Format a compact canonical finding target tag (e.g. `"CONGESTION:kitchen"`).
 * @param {object} finding
 * @returns {string}
 */
export function formatFindingTag(finding) {
  if (!finding || typeof finding !== "object") return "UNKNOWN";
  const roomPart = finding.roomId ?? finding.location?.roomId ?? "home";
  return `${finding.type}:${roomPart}`;
}

/**
 * OpenAPI-style Gemini `responseSchema` for fast, non-hanging structured `ScenePatch` generation.
 */
export const SCENE_PATCH_GEMINI_SCHEMA = {
  type: "OBJECT",
  required: ["id", "reasoning", "targetFindings", "operations"],
  properties: {
    id: { type: "STRING" },
    reasoning: { type: "STRING" },
    targetFindings: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    operations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["type", "objectId"],
        properties: {
          type: {
            type: "STRING",
            enum: [...SCENE_PATCH_OPERATION_TYPES],
          },
          objectId: { type: "STRING" },
          position: {
            type: "ARRAY",
            items: { type: "NUMBER" },
            nullable: true,
          },
          rotation: {
            type: "ARRAY",
            items: { type: "NUMBER" },
            nullable: true,
          },
          productId: { type: "STRING", nullable: true },
          object: {
            type: "OBJECT",
            nullable: true,
            properties: {
              kind: { type: "STRING", nullable: true },
              name: { type: "STRING", nullable: true },
              roomId: { type: "STRING", nullable: true },
              width: { type: "NUMBER", nullable: true },
              height: { type: "NUMBER", nullable: true },
              depth: { type: "NUMBER", nullable: true },
            },
          },
        },
      },
    },
  },
};

/**
 * Standard JSON Schema representation of `ScenePatch`.
 */
export const SCENE_PATCH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "reasoning", "targetFindings", "operations"],
  properties: {
    id: { type: "string" },
    reasoning: { type: "string" },
    targetFindings: {
      type: "array",
      items: { type: "string" },
    },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: MAX_SCENE_PATCH_OPERATIONS,
      items: {
        type: "object",
        required: ["type", "objectId"],
        properties: {
          type: {
            type: "string",
            enum: [...SCENE_PATCH_OPERATION_TYPES],
          },
          objectId: { type: "string" },
          position: {
            type: "array",
            items: { type: "number" },
            minItems: 3,
            maxItems: 3,
          },
          rotation: {
            type: "array",
            items: { type: "number" },
            minItems: 3,
            maxItems: 3,
          },
          productId: { type: "string" },
          object: {
            type: "object",
            properties: {
              id: { type: "string" },
              kind: { type: "string" },
              name: { type: "string" },
              roomId: { type: "string" },
              color: { type: "string" },
              productId: { type: "string" },
              variantId: { type: "string" },
              merchant: { type: "string" },
              price: { type: "number" },
              modelUrl: { type: "string" },
              dimensions: {
                type: "object",
                required: ["width", "height", "depth"],
                properties: {
                  width: { type: "number" },
                  height: { type: "number" },
                  depth: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
  },
};
