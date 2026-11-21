import { isRegionFinding } from "./regional-findings.js";
import { intersectsRegion, parseRegionInput, parseRegionPatch, regionContainsItem, validRegion } from "./region-redesign.js";
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
    .map(item => describeItem(item, house, placementItems));
  return parseReplaySuggestionInput({ finding, rooms, doors, objects });
}

function describeItem(item, house, placementItems) {
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

}

export function buildRegionSuggestionInput(region, instruction, findings, rawHouse, items) {
  if (!validRegion(region)) throw new Error("Select an area on the floor plan.");
  const house = normalizeHouse(rawHouse);
  const relevantRooms = house.rooms.filter(room => intersectsRegion(region, room.bounds));
  if (relevantRooms.length > replayContextLimits.rooms) throw new Error("Select an area with fewer rooms.");
  const rooms = relevantRooms.map(({ id, name, bounds }) => ({
    id, name: name.slice(0, 160), bounds: [bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ],
  }));
  const roomIds = new Set(rooms.map(room => room.id));
  const doors = house.doors.filter(door => door.roomIds.some(id => roomIds.has(id)))
    .map(door => getDoorWorldPose(house, door)).filter(Boolean).slice(0, replayContextLimits.doors)
    .map(({ roomIds: connections, x, z, width }) => ({
      roomIds: connections.filter(id => roomIds.has(id)), position: [x, z], width,
    }));
  const placement = mergeHouseFixturesIntoItems(house, items);
  const nearby = placement.map(toSceneObject)
    .map(item => ({ ...item, roomId: getRoomAtPoint(house, item.x, item.z)?.id ?? item.roomId }))
    .filter(item => roomIds.has(item.roomId));
  const selected = nearby.filter(item => regionContainsItem(region, item));
  if (selected.length > replayContextLimits.objects) throw new Error("Select an area with fewer furniture pieces.");
  const inScope = new Set(selected.map(item => item.id));
  const objects = [...selected, ...nearby.filter(item => !inScope.has(item.id))]
    .slice(0, replayContextLimits.objects).map(item => describeItem(item, house, placement));
  const relevant = findings.filter(finding => isRegionFinding(finding, region, roomIds));
  return parseRegionInput({ region, instruction, rooms, doors, objects, findings: relevant.slice(0, 16) });
}

export function previewRegionPatch(patch, input, house, items) {
  const verified = parseRegionPatch(patch, input);
  let afterItems = items;
  const moves = [];
  for (const op of verified.operations) {
    const step = previewReplaySuggestion({ explanation: verified.reasoning, scenePatch: { operations: [op] } }, house, afterItems);
    if (!regionContainsItem(input.region, step.before) || !regionContainsItem(input.region, step.after)) {
      throw new Error("The furniture extends outside the selected area.");
    }
    moves.push({ before: step.before, after: step.after });
    afterItems = step.items;
  }
  return { items: afterItems, moves };
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
  return input.region ? parseRegionPatch(payload, input) : parseReplayProposal(payload, input.objects);
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
