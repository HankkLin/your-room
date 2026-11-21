import { FINDING_TYPES } from "../contracts/simulation.js";

export const replaySuggestionApiPath = "/api/replay/suggest-fix";
export const replayContextLimits = Object.freeze({ rooms: 24, doors: 32, objects: 16 });

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value, max = 160) => typeof value === "string" && value.trim() && value.length <= max;
const isVector = (value, length) =>
  Array.isArray(value) && value.length === length && Array.from(value).every(Number.isFinite);
const hasFields = (value, fields) =>
  isRecord(value) && Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));
const boundedList = (value, max) => Array.isArray(value) && value.length <= max;

const objectSchema = (properties) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});
export const replayProposalSchema = objectSchema({
  explanation: { type: "string", description: "One or two short sentences describing a possible fix." },
  scenePatch: objectSchema({
    operations: {
      type: "array", minItems: 1, maxItems: 1,
      items: objectSchema({
        type: { type: "string", enum: ["move"] },
        objectId: { type: "string" },
        position: {
          type: "array", minItems: 3, maxItems: 3, items: { type: "number" },
          description: "World position [x, y, z] in meters. Preserve the object's existing y.",
        },
      }),
    },
  }),
});

export function parseReplayProposal(value, objects) {
  const operations = value?.scenePatch?.operations;
  const move = operations?.[0];
  if (!hasFields(value, ["explanation", "scenePatch"]) || !isText(value.explanation, 400) ||
      !hasFields(value.scenePatch, ["operations"]) || !Array.isArray(operations) || operations.length !== 1 ||
      !hasFields(move, ["type", "objectId", "position"]) || move.type !== "move" ||
      !isText(move.objectId) || !isVector(move.position, 3)) {
    throw new Error("Gemini did not return a valid single furniture move. Try again.");
  }
  const target = objects.find(({ id }) => id === move.objectId);
  if (!target || target.locked || target.type === "fixed") {
    throw new Error("The proposed furniture is locked or unavailable. Try again.");
  }
  const [x, y, z] = move.position;
  if (y !== target.position[1] || (x === target.position[0] && z === target.position[2])) {
    throw new Error("The proposal must move the furniture across the floor at its current elevation. Try again.");
  }
  return { explanation: value.explanation.trim(), scenePatch: { operations: [move] } };
}

export function parseReplayGeometry(value) {
  const { rooms, doors, objects } = value ?? {};
  const invalid = () => new Error("Valid room and furniture geometry is required.");
  if (!boundedList(rooms, replayContextLimits.rooms) || !boundedList(doors, replayContextLimits.doors) ||
      !boundedList(objects, replayContextLimits.objects)) throw invalid();
  if (rooms.some((room) => !isText(room?.id) || !isText(room.name) || !isVector(room.bounds, 4))) throw invalid();
  const roomIds = new Set(rooms.map(({ id }) => id));
  if (doors.some((door) => !boundedList(door?.roomIds, 2) || !door.roomIds.length ||
      door.roomIds.some((id) => !roomIds.has(id)) || !isVector(door.position, 2) ||
      !Number.isFinite(door.width) || door.width <= 0)) throw invalid();
  const objectIds = new Set();
  for (const object of objects) {
    const { id, name, kind, roomId, position, dimensions, rotation, locked, relocationHint } = object ?? {};
    if (!isText(id) || objectIds.has(id) || !isText(name) || !isText(kind) ||
        !roomIds.has(roomId) || !isVector(position, 3) || !isVector(dimensions, 3) ||
        dimensions.some((size) => size <= 0) || !Number.isFinite(rotation) || typeof locked !== "boolean" ||
        (relocationHint !== undefined && (locked || !isVector(relocationHint, 3) || relocationHint[1] !== position[1]))) {
      throw invalid();
    }
    objectIds.add(id);
  }
  return {
    rooms: rooms.map(({ id, name, bounds }) => ({ id, name, bounds })),
    doors: doors.map(({ roomIds, position, width }) => ({ roomIds, position, width })),
    objects: objects.map(({ id, name, kind, roomId, position, dimensions, rotation, locked, relocationHint }) => ({
      id, name, kind, roomId, position, dimensions, rotation, locked,
      ...(relocationHint ? { relocationHint } : {}),
    })),
  };
}

export function parseReplaySuggestionInput(value) {
  const geometry = parseReplayGeometry(value);
  const roomIds = new Set(geometry.rooms.map(({ id }) => id));
  const finding = value.finding;
  const invalid = () => new Error("A measured blocked route and valid layout context are required.");
  const { type, fromRoomId, toRoomId, activity, location, evidence } = finding ?? {};
  if (type !== FINDING_TYPES.NO_PATH || !roomIds.has(fromRoomId) || !roomIds.has(toRoomId) ||
      !isText(activity) || !isVector(location?.position, 2) ||
      !Number.isFinite(evidence?.timestampSeconds) || evidence.timestampSeconds < 0 ||
      !isText(evidence.reason)) throw invalid();
  return {
    finding: {
      type, fromRoomId, toRoomId, activity,
      location: { position: location.position },
      evidence: { timestampSeconds: evidence.timestampSeconds, reason: evidence.reason },
    },
    ...geometry,
  };
}
