import assert from "node:assert/strict";
import test from "node:test";
import { ROOM, initialState } from "./model.js";
import {
  applyObjectOperation,
  canPlaceInHouse,
  getDoorWorldPose,
  getHouseObstacles,
  getObjectBoundingBox,
  getRoomAtPoint,
  isObjectLocked,
  isWalkablePoint,
  mergeHouseFixturesIntoItems,
  normalizeHouse,
  roomToHouse,
  validateHouseScene,
} from "./house-model.js";
import {
  createWholeHomeDemoHouse,
  createWholeHomeDemoState,
} from "./house-demo.js";
import {
  clearConfirmedImportedHouse,
  confirmImportedHouse,
  getConfirmedImportedHouse,
  importSampleFloorplan,
} from "./src/spatial/floorplan-importer.js";

test("sample whole-home contains multiple connected rooms including living room, kitchen, bedroom, and bathroom", () => {
  const house = createWholeHomeDemoHouse();
  assert(house.rooms.length >= 4);
  const names = house.rooms.map((r) => r.name);
  assert(names.includes("Living Room"));
  assert(names.includes("Kitchen"));
  assert(names.includes("Bedroom"));
  assert(names.includes("Bathroom"));
});

test("every room, wall, door, window, and object in the sample home has a unique ID", () => {
  const house = createWholeHomeDemoHouse();
  const checkUnique = (list, label) => {
    const ids = list.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, `Duplicate ${label} IDs found`);
  };
  checkUnique(house.rooms, "room");
  checkUnique(house.walls, "wall");
  checkUnique(house.doors, "door");
  checkUnique(house.windows, "window");
  checkUnique(house.objects, "object");
});

test("door and window connections reference valid rooms and deduplicated walls", () => {
  const house = createWholeHomeDemoHouse();
  const validation = validateHouseScene(house);
  assert.equal(validation.valid, true, validation.errors.join("; "));

  const wallIds = new Set(house.walls.map((w) => w.id));
  const roomIds = new Set(house.rooms.map((r) => r.id));
  const interiorDoors = house.doors.filter((d) => !d.exterior);
  assert(interiorDoors.length >= 3);

  for (const door of house.doors) {
    assert(wallIds.has(door.wallId));
    for (const roomId of door.roomIds) {
      assert(roomIds.has(roomId));
    }
    const pose = getDoorWorldPose(house, door);
    assert(pose && Number.isFinite(pose.x) && Number.isFinite(pose.z));
  }

  // Verify reachability across Living Room -> Kitchen -> Bedroom -> Bathroom via interior doors
  const adj = new Map([...roomIds].map((id) => [id, new Set()]));
  for (const door of interiorDoors) {
    const [a, b] = door.roomIds;
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  const visited = new Set(["living-room"]);
  const queue = ["living-room"];
  while (queue.length) {
    const current = queue.shift();
    for (const next of adj.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  assert.deepEqual(visited, roomIds);
});

test("locked fixtures remain identifiable as locked and reject automated or manual mutations", () => {
  const state = createWholeHomeDemoState();
  const { house, items } = state;

  const kinds = new Set(house.fixtures.map((f) => f.kind));
  assert(kinds.has("toilet"));
  assert(kinds.has("sink"));
  assert(kinds.has("kitchen_counter"));
  assert(kinds.has("refrigerator") || kinds.has("stove"));
  assert(house.walls.every((w) => w.locked === true));
  assert(house.fixtures.every((f) => isObjectLocked(f) === true));

  const movable = items.filter((i) => !isObjectLocked(i));
  assert(movable.length >= 6);

  const toilet = items.find((i) => i.kind === "toilet");
  for (const type of ["move", "rotate", "remove", "replace", "unlock"]) {
    const res = applyObjectOperation(
      items,
      { type, objectId: toilet.id, x: 1.5, z: -2.0, rotation: 90 },
      house,
    );
    assert.equal(res.ok, false, `Expected ${type} on locked fixture to fail`);
    assert.equal(res.reason, "LOCKED_OBJECT");
  }

  const chair = items.find((i) => i.id === "home-chair");
  const rotated = applyObjectOperation(
    items,
    { type: "rotate", objectId: chair.id },
    house,
  );
  assert.equal(rotated.ok, true);
});

test("house geometry uses valid finite meter dimensions and non-overlapping placements", () => {
  const house = createWholeHomeDemoHouse();
  assert(Number.isFinite(house.ceilingHeight) && house.ceilingHeight > 2);
  assert(Number.isFinite(house.bounds.width) && house.bounds.width > 5);
  assert(Number.isFinite(house.bounds.depth) && house.bounds.depth > 5);

  for (const item of house.objects) {
    const bbox = getObjectBoundingBox(item);
    assert(
      Number.isFinite(bbox.minX) &&
        Number.isFinite(bbox.maxX) &&
        Number.isFinite(bbox.minZ) &&
        Number.isFinite(bbox.maxZ) &&
        bbox.width > 0 &&
        bbox.depth > 0 &&
        bbox.height > 0,
    );
    assert.equal(
      canPlaceInHouse(item, house, house.objects),
      true,
      `Object ${item.id} (${item.name}) violates room/wall/door/overlap constraints`,
    );
  }

  const obstacles = getHouseObstacles(house, house.objects);
  assert(obstacles.wallSegments.length > 0);
  assert(obstacles.objectBoxes.length > 0);
});

test("interior door openings are walkable while solid wall segments block passage", () => {
  const house = createWholeHomeDemoHouse();
  for (const door of house.doors.filter((d) => !d.exterior)) {
    const pose = getDoorWorldPose(house, door);
    assert.equal(
      isWalkablePoint(house, pose.x, pose.z),
      true,
      `Interior door ${door.id} should be walkable at center`,
    );
  }

  // Solid wall point between Living Room and Kitchen away from doorway (x=1.6, z=3.4)
  assert.equal(isWalkablePoint(house, 1.6, 3.4), false);
  // Outside the house perimeter
  assert.equal(isWalkablePoint(house, -8, 0), false);
  assert.equal(getRoomAtPoint(house, -2.0, 1.5)?.id, "living-room");
  assert.equal(getRoomAtPoint(house, 2.8, 1.8)?.id, "kitchen");
  assert.equal(getRoomAtPoint(house, -2.0, -2.0)?.id, "bedroom");
  assert.equal(getRoomAtPoint(house, 2.0, -2.0)?.id, "bathroom");
});

test("single-room adapter converts existing rectangular and alcove rooms into valid House scenes", () => {
  const single = initialState();
  const adapted = roomToHouse(single.room ?? ROOM, single.items, {
    name: single.roomName,
  });
  assert.equal(adapted.rooms.length, 1);
  assert.equal(adapted.isWholeHome, false);
  assert.equal(validateHouseScene(adapted).valid, true);
  assert.equal(adapted.objects.length, single.items.length);

  const alcove = roomToHouse({ ...ROOM, shape: "alcove" }, []);
  assert.equal(alcove.rooms[0].polygon.length, 6);
  assert.equal(validateHouseScene(alcove).valid, true);
});

test("sample floorplan importer produces confirmed House JSON that normalizes cleanly for 3D rendering and room-to-room walking", () => {
  clearConfirmedImportedHouse();
  const session = importSampleFloorplan();
  const confirmed = confirmImportedHouse(session);
  const retrieved = getConfirmedImportedHouse();
  assert.deepEqual(retrieved, confirmed);

  const renderHouse = normalizeHouse(retrieved);
  assert.equal(renderHouse.rooms.length, 5);
  assert.equal(renderHouse.walls.length > 0, true);
  assert.equal(renderHouse.doors.length, 6);
  assert.equal(renderHouse.windows.length, 4);

  const items = mergeHouseFixturesIntoItems(renderHouse, []);
  assert.equal(items.length, 7);
  assert.equal(items.every((i) => isObjectLocked(i)), true);

  for (const door of renderHouse.doors.filter((d) => !d.exterior)) {
    const pose = getDoorWorldPose(renderHouse, door);
    assert.equal(
      isWalkablePoint(renderHouse, pose.x, pose.z, { items }),
      true,
      `Imported interior door ${door.id} should be walkable`,
    );
  }
  clearConfirmedImportedHouse();
});
