import {
  applyObjectOperation, fitItemInHouse, getDoorWorldPose, getRoomAtPoint,
  isObjectLocked, mergeHouseFixturesIntoItems, normalizeHouse,
} from "../../house-model.js";
import { toSceneObject } from "../contracts/scene.js";
import { parseReplayProposal, parseReplaySuggestionInput, replayContextLimits, replaySuggestionApiPath } from "./replay-suggestion-contract.js";

export function buildReplaySuggestionInput(finding, rawHouse, items) {
  const house = normalizeHouse(rawHouse);
  const endpoints = new Set([finding.fromRoomId, finding.toRoomId]);
  const nearbyIds = new Set(endpoints);
  for (const door of house.doors) {
    if (door.roomIds.some((id) => endpoints.has(id))) {
      for (const id of door.roomIds) nearbyIds.add(id);
    }
  }
  const rooms = house.rooms.filter(({ id }) => nearbyIds.has(id))
    .sort((a, b) => Number(endpoints.has(b.id)) - Number(endpoints.has(a.id)))
    .slice(0, replayContextLimits.rooms)
    .map(({ id, name, bounds }) => ({
      id, name: name.slice(0, 160), bounds: [bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ],
    }));
  const roomIds = new Set(rooms.map(({ id }) => id));
  const doors = house.doors.filter((door) => door.roomIds.some((id) => endpoints.has(id)))
    .map((door) => getDoorWorldPose(house, door))
    .filter(Boolean)
    .slice(0, replayContextLimits.doors)
    .map(({ roomIds: connections, x, z, width }) => ({
      roomIds: connections.filter((id) => roomIds.has(id)), position: [x, z], width,
    }));
  const anchors = [finding.location.position, ...doors.map(({ position }) => position)];
  const distanceToRoute = ({ x, z }) =>
    Math.min(...anchors.map(([anchorX, anchorZ]) => Math.hypot(x - anchorX, z - anchorZ)));
  const placementItems = mergeHouseFixturesIntoItems(house, items);
  const objects = placementItems.map(toSceneObject)
    .map((item) => ({ ...item, roomId: getRoomAtPoint(house, item.x, item.z)?.id ?? item.roomId }))
    .filter(({ roomId }) => roomIds.has(roomId))
    .sort((a, b) => distanceToRoute(a) - distanceToRoute(b))
    .slice(0, replayContextLimits.objects)
    .map((item) => {
      const { id, name, kind, roomId, position, width, height, depth, rotation } = item;
      const locked = isObjectLocked(item);
      const fit = locked ? null : fitItemInHouse(item, house, placementItems, roomId);
      const hint = fit && fit.rotation === rotation && (fit.x !== item.x || fit.z !== item.z)
        ? [fit.x, position[1], fit.z] : null;
      return {
        id, name: (name || kind).slice(0, 160), kind, roomId, position,
        dimensions: [width, height, depth], rotation, locked,
        ...(hint ? { relocationHint: hint } : {}),
      };
    });
  return parseReplaySuggestionInput({ finding, rooms, doors, objects });
}

export async function requestReplaySuggestion(input, signal) {
  const response = await fetch(replaySuggestionApiPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || "Gemini could not suggest a move. Try again.");
  }
  return parseReplayProposal(payload, input.objects);
}

export function previewReplaySuggestion(proposal, rawHouse, items) {
  const objects = items.map(toSceneObject);
  const { scenePatch: { operations: [operation] } } = parseReplayProposal(proposal, objects);
  if (rawHouse.fixtures?.some(({ id }) => id === operation.objectId)) {
    throw new Error("The proposed fixture is locked. Try again.");
  }
  const house = normalizeHouse(rawHouse);
  const placement = applyObjectOperation(mergeHouseFixturesIntoItems(house, items), operation, house);
  if (!placement.ok) {
    throw new Error("The proposed move did not pass whole-home placement checks. Try again.");
  }
  const movedItem = placement.items.find(({ id }) => id === operation.objectId);
  const after = toSceneObject(movedItem);
  const nextItem = Array.isArray(movedItem.position) ? { ...movedItem, position: after.position } : movedItem;
  return {
    items: items.map((item) => item.id === operation.objectId ? nextItem : item),
    before: objects.find(({ id }) => id === operation.objectId),
    after,
  };
}
