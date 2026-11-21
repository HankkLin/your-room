import { ROOM, footprintsOverlap } from "./model.js";
import {
  footprintCorners,
  normalizeArchitecture,
  roomWalls,
  wallOpenings,
} from "./room-layout.js";
import {
  canModifyObject,
  isObjectLocked,
  toSceneObject,
  validateHouseScene,
} from "./src/contracts/scene.js";

export { canModifyObject, isObjectLocked, toSceneObject, validateHouseScene };

export const DEFAULT_CEILING_HEIGHT = 2.7;
export const DEFAULT_WALL_THICKNESS = 0.12;

const EPSILON = 1e-4;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function polygonBounds(polygon) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
}

function rectPolygon(bounds) {
  const { minX, maxX, minZ, maxZ } = bounds;
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ];
}

export function distanceToSegment(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq <= 1e-9) return Math.hypot(px - x1, pz - z1);
  const t = clamp(((px - x1) * dx + (pz - z1) * dz) / lenSq, 0, 1);
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

export function isPointInPolygon(x, z, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x1, z1] = polygon[j];
    const [x2, z2] = polygon[i];
    if (distanceToSegment(x, z, x1, z1, x2, z2) <= EPSILON) return true;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    const intersects =
      zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function normalizeWall(wall, ceilingHeight) {
  const x1 = Number(wall.x1);
  const z1 = Number(wall.z1);
  const x2 = Number(wall.x2);
  const z2 = Number(wall.z2);
  const length = Math.hypot(x2 - x1, z2 - z1);
  const ux = length > 0 ? (x2 - x1) / length : 1;
  const uz = length > 0 ? (z2 - z1) / length : 0;
  const angle = Math.atan2(-uz, ux);
  return {
    id: wall.id,
    x1,
    z1,
    x2,
    z2,
    cx: (x1 + x2) / 2,
    cz: (z1 + z2) / 2,
    length,
    angle,
    ux,
    uz,
    // Inward normal when exterior walls wind clockwise on X/Z
    nx: -uz,
    nz: ux,
    thickness: Number(wall.thickness) || DEFAULT_WALL_THICKNESS,
    height: Number(wall.height) || ceilingHeight,
    exterior: Boolean(wall.exterior),
    roomIds: Array.isArray(wall.roomIds) ? [...wall.roomIds] : [],
    locked: true,
  };
}

/**
 * Normalize a structured House definition into one authoritative model.
 */
export function normalizeHouse(input) {
  const ceilingHeight =
    Number(input?.ceilingHeight) > 0
      ? Number(input.ceilingHeight)
      : DEFAULT_CEILING_HEIGHT;

  const rooms = (input?.rooms ?? []).map((room) => {
    const polygon =
      Array.isArray(room.polygon) && room.polygon.length >= 3
        ? room.polygon.map(([x, z]) => [Number(x), Number(z)])
        : rectPolygon(room.bounds);
    const bounds = polygonBounds(polygon);
    return {
      id: String(room.id),
      name: String(room.name || room.id),
      kind: room.kind || "living",
      polygon,
      bounds,
      floorFinish: ["oak", "walnut", "stone"].includes(room.floorFinish)
        ? room.floorFinish
        : "oak",
      wallColor: /^#[\da-f]{6}$/i.test(room.wallColor) ? room.wallColor : null,
      viewpoint: room.viewpoint || null,
    };
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const room of rooms) {
    minX = Math.min(minX, room.bounds.minX);
    maxX = Math.max(maxX, room.bounds.maxX);
    minZ = Math.min(minZ, room.bounds.minZ);
    maxZ = Math.max(maxZ, room.bounds.maxZ);
  }
  if (!Number.isFinite(minX)) {
    minX = -2.7;
    maxX = 2.7;
    minZ = -2.1;
    maxZ = 2.1;
  }

  const bounds = {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };

  const walls = (input?.walls ?? []).map((w) => normalizeWall(w, ceilingHeight));

  const doors = (input?.doors ?? []).map((door) => ({
    id: String(door.id),
    wallId: String(door.wallId),
    offset: clamp(Number(door.offset ?? 0.5), 0.05, 0.95),
    width: Number(door.width) || 0.9,
    height: Math.min(Number(door.height) || 2.1, ceilingHeight - 0.12),
    roomIds: Array.isArray(door.roomIds) ? [...door.roomIds] : [],
    exterior: Boolean(door.exterior),
    locked: true,
  }));

  const windows = (input?.windows ?? []).map((win) => {
    const sillHeight = clamp(Number(win.sillHeight ?? 0.95), 0.3, ceilingHeight - 0.5);
    const height = Math.min(
      Number(win.height) || 1.3,
      ceilingHeight - sillHeight - 0.18,
    );
    return {
      id: String(win.id),
      wallId: String(win.wallId),
      offset: clamp(Number(win.offset ?? 0.5), 0.06, 0.94),
      width: Number(win.width) || 1.6,
      sillHeight,
      height,
      roomIds: Array.isArray(win.roomIds) ? [...win.roomIds] : [],
      locked: true,
    };
  });

  const baseHouse = {
    id: String(input?.id || input?.houseId || "house-01"),
    houseId: String(input?.houseId || input?.id || "house-01"),
    name: String(input?.name || "Connected home"),
    isWholeHome: Boolean(input?.isWholeHome ?? rooms.length > 1),
    ceilingHeight,
    bounds,
    rooms,
    walls,
    doors,
    windows,
    fixtures: [],
    objects: [],
    environment: input?.environment ? { ...input.environment } : {},
  };

  const combined = new Map();
  for (const fixture of input?.fixtures ?? []) {
    const normalized = toSceneObject({ ...fixture, type: "fixed", locked: true, owned: true, price: 0 });
    combined.set(normalized.id, normalized);
  }
  for (const obj of input?.objects ?? []) {
    const normalized = toSceneObject(obj);
    combined.set(normalized.id, normalized);
  }

  const objects = [...combined.values()].map((obj) => ({
    ...obj,
    roomId: obj.roomId || getRoomAtPoint(baseHouse, obj.x, obj.z)?.id || rooms[0]?.id || null,
  }));

  baseHouse.objects = objects;
  baseHouse.fixtures = objects.filter((obj) => obj.type === "fixed");
  return baseHouse;
}

/**
 * Synchronize authoritative house.objects / house.fixtures with a flat items array.
 */
export function syncHouseObjects(house, items = []) {
  if (!house) return null;
  const normalizedHouse = house.bounds ? house : normalizeHouse(house);
  const objects = items.map((item) => {
    const sceneObj = toSceneObject(item);
    return {
      ...sceneObj,
      roomId:
        getRoomAtPoint(normalizedHouse, sceneObj.x, sceneObj.z)?.id ||
        sceneObj.roomId ||
        normalizedHouse.rooms[0]?.id ||
        null,
    };
  });
  return {
    ...normalizedHouse,
    objects,
    fixtures: objects.filter((obj) => obj.type === "fixed"),
  };
}

/**
 * Backward-compatibility adapter: wraps a single Stillroom room into a valid 1-room House.
 */
export function roomToHouse(room = ROOM, items = [], { id = "single-room-house", name = "Living room" } = {}) {
  const layout = normalizeArchitecture(room);
  const roomId = "main-room";
  const polygon = footprintCorners(layout);
  const sides = roomWalls(layout);

  const walls = sides.map((side) => {
    const half = side.length / 2;
    const cos = Math.cos(side.angle);
    const sin = Math.sin(side.angle);
    return {
      id: `wall-${side.id}`,
      sourceSideId: side.id,
      x1: side.x - half * cos,
      z1: side.z + half * sin,
      x2: side.x + half * cos,
      z2: side.z - half * sin,
      thickness: DEFAULT_WALL_THICKNESS,
      height: layout.height,
      exterior: true,
      roomIds: [roomId],
      locked: true,
    };
  });

  const doors = [];
  const windows = [];
  for (const side of sides) {
    const holes = wallOpenings(layout, side);
    holes.forEach((hole, index) => {
      const center = (hole.left + hole.right) / 2;
      const offset = clamp(center / side.length + 0.5, 0.05, 0.95);
      const width = hole.right - hole.left;
      if (hole.kind === "door") {
        doors.push({
          id: `door-${side.id}-${index + 1}`,
          wallId: `wall-${side.id}`,
          offset,
          width,
          height: hole.top - hole.bottom,
          roomIds: [roomId],
          exterior: true,
          locked: true,
        });
      } else {
        windows.push({
          id: `window-${side.id}-${index + 1}`,
          wallId: `wall-${side.id}`,
          offset,
          width,
          sillHeight: hole.bottom,
          height: hole.top - hole.bottom,
          roomIds: [roomId],
          locked: true,
        });
      }
    });
  }

  return normalizeHouse({
    id,
    name,
    isWholeHome: false,
    ceilingHeight: layout.height,
    rooms: [
      {
        id: roomId,
        name,
        kind: "living",
        polygon,
        floorFinish: layout.floorFinish,
        wallColor: layout.wallColor,
      },
    ],
    walls,
    doors,
    windows,
    objects: items,
  });
}

export function getRoomAtPoint(house, x, z) {
  if (!house?.rooms) return null;
  return house.rooms.find((room) => isPointInPolygon(x, z, room.polygon)) ?? null;
}

export function getWallOpeningsInHouse(house, wall) {
  const edgeMargin = 0.06;
  const list = [];

  for (const door of house.doors ?? []) {
    if (door.wallId !== wall.id) continue;
    const width = Math.min(door.width, Math.max(0.4, wall.length - edgeMargin * 2));
    const center = (door.offset - 0.5) * wall.length;
    const left = clamp(
      center - width / 2,
      -wall.length / 2 + edgeMargin,
      wall.length / 2 - edgeMargin - width,
    );
    list.push({
      id: door.id,
      kind: "door",
      exterior: Boolean(door.exterior),
      roomIds: door.roomIds,
      left,
      right: left + width,
      bottom: 0,
      top: Math.min(door.height, wall.height - 0.1),
    });
  }

  for (const win of house.windows ?? []) {
    if (win.wallId !== wall.id) continue;
    const width = Math.min(win.width, Math.max(0.4, wall.length - edgeMargin * 2));
    const center = (win.offset - 0.5) * wall.length;
    const left = clamp(
      center - width / 2,
      -wall.length / 2 + edgeMargin,
      wall.length / 2 - edgeMargin - width,
    );
    list.push({
      id: win.id,
      kind: "window",
      exterior: true,
      roomIds: win.roomIds,
      left,
      right: left + width,
      bottom: win.sillHeight,
      top: Math.min(win.sillHeight + win.height, wall.height - 0.14),
    });
  }

  return list.sort((a, b) => a.left - b.left);
}

export function getDoorWorldPose(house, doorOrId) {
  const door =
    typeof doorOrId === "string"
      ? house.doors?.find((d) => d.id === doorOrId)
      : doorOrId;
  if (!door) return null;
  const wall = house.walls?.find((w) => w.id === door.wallId);
  if (!wall) return null;
  const hole = getWallOpeningsInHouse(house, wall).find((h) => h.id === door.id);
  if (!hole) return null;
  const mid = (hole.left + hole.right) / 2;
  return {
    id: door.id,
    wallId: wall.id,
    x: wall.cx + mid * wall.ux,
    z: wall.cz + mid * wall.uz,
    width: hole.right - hole.left,
    height: hole.top,
    nx: wall.nx,
    nz: wall.nz,
    ux: wall.ux,
    uz: wall.uz,
    roomIds: door.roomIds,
    exterior: Boolean(door.exterior),
  };
}

export function getWindowWorldPose(house, winOrId) {
  const win =
    typeof winOrId === "string"
      ? house.windows?.find((w) => w.id === winOrId)
      : winOrId;
  if (!win) return null;
  const wall = house.walls?.find((w) => w.id === win.wallId);
  if (!wall) return null;
  const hole = getWallOpeningsInHouse(house, wall).find((h) => h.id === win.id);
  if (!hole) return null;
  const mid = (hole.left + hole.right) / 2;
  return {
    id: win.id,
    wallId: wall.id,
    x: wall.cx + mid * wall.ux,
    z: wall.cz + mid * wall.uz,
    width: hole.right - hole.left,
    sillHeight: hole.bottom,
    height: hole.top - hole.bottom,
    nx: wall.nx,
    nz: wall.nz,
    roomIds: win.roomIds,
  };
}

/**
 * Compute solid (non-walkable) wall segments by carving out interior door openings.
 */
export function getSolidWallSegments(house, { passExteriorDoors = false } = {}) {
  const segments = [];
  for (const wall of house?.walls ?? []) {
    const passableDoors = getWallOpeningsInHouse(house, wall).filter(
      (hole) => hole.kind === "door" && (passExteriorDoors || !hole.exterior),
    );
    let cursor = -wall.length / 2;
    const edge = wall.length / 2;
    let index = 0;

    for (const door of passableDoors) {
      if (door.left > cursor + 0.01) {
        segments.push({
          id: `${wall.id}-seg-${++index}`,
          wallId: wall.id,
          x1: wall.cx + cursor * wall.ux,
          z1: wall.cz + cursor * wall.uz,
          x2: wall.cx + door.left * wall.ux,
          z2: wall.cz + door.left * wall.uz,
          thickness: wall.thickness,
          exterior: wall.exterior,
        });
      }
      cursor = Math.max(cursor, door.right);
    }

    if (edge > cursor + 0.01) {
      segments.push({
        id: `${wall.id}-seg-${++index}`,
        wallId: wall.id,
        x1: wall.cx + cursor * wall.ux,
        z1: wall.cz + cursor * wall.uz,
        x2: wall.cx + edge * wall.ux,
        z2: wall.cz + edge * wall.uz,
        thickness: wall.thickness,
        exterior: wall.exterior,
      });
    }
  }
  return segments;
}

export function getObjectBoundingBox(item) {
  const x = Number(item.x) || 0;
  const z = Number(item.z) || 0;
  const minY = Number(item.elevation ?? item.y) || 0;
  const width = Math.max(0.05, Number(item.width) || 0.6);
  const depth = Math.max(0.05, Number(item.depth) || 0.6);
  const height = Math.max(0.008, Number(item.height) || 0.75);
  const radians = ((Number(item.rotation) || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const halfX = (cos * width + sin * depth) / 2;
  const halfZ = (sin * width + cos * depth) / 2;

  return {
    id: item.id,
    kind: item.kind,
    minX: x - halfX,
    maxX: x + halfX,
    minZ: z - halfZ,
    maxZ: z + halfZ,
    minY,
    maxY: minY + height,
    halfX,
    halfZ,
    width,
    depth,
    height,
    center: [x, minY + height / 2, z],
    walkable: height <= 0.13 || minY >= 1.85,
    locked: isObjectLocked(item),
  };
}

export function getHouseObstacles(house, items = house?.objects ?? []) {
  return {
    wallSegments: getSolidWallSegments(house),
    objectBoxes: items
      .map(getObjectBoundingBox)
      .filter((box) => !box.walkable),
  };
}

/**
 * Determine whether an avatar/person can stand at world point (x, z).
 * Allows walking cleanly through interior door openings while blocking walls and furniture/fixtures.
 */
export function isWalkablePoint(
  house,
  x,
  z,
  { items = house?.objects ?? [], clearance = 0.16 } = {},
) {
  if (!getRoomAtPoint(house, x, z)) return false;

  const segments = getSolidWallSegments(house);
  for (const seg of segments) {
    const minDist = seg.thickness / 2 + clearance;
    if (distanceToSegment(x, z, seg.x1, seg.z1, seg.x2, seg.z2) < minDist) {
      return false;
    }
  }

  for (const item of items) {
    const minY = Number(item.elevation ?? item.y) || 0;
    if ((Number(item.height) || 0) <= 0.13 || minY >= 1.85) continue;
    const radians = ((Number(item.rotation) || 0) * Math.PI) / 180;
    const dx = x - item.x;
    const dz = z - item.z;
    const xLocal = dx * Math.cos(radians) - dz * Math.sin(radians);
    const zLocal = dx * Math.sin(radians) + dz * Math.cos(radians);
    if (
      Math.abs(xLocal) < item.width / 2 + 0.09 &&
      Math.abs(zLocal) < item.depth / 2 + 0.09
    ) {
      return false;
    }
  }

  return true;
}

function segmentIntersectsRect(x1, z1, x2, z2, minX, maxX, minZ, maxZ) {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dz = z2 - z1;
  const checks = [
    [-dx, x1 - minX],
    [dx, maxX - x1],
    [-dz, z1 - minZ],
    [dz, maxZ - z1],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 <= t1;
}

export function withinHouseRoom(item, house) {
  const box = getObjectBoundingBox(item);
  const corners = [
    [item.x, item.z],
    [box.minX, box.minZ],
    [box.maxX, box.minZ],
    [box.maxX, box.maxZ],
    [box.minX, box.maxZ],
  ];
  if (corners.some(([px, pz]) => !getRoomAtPoint(house, px, pz))) {
    return false;
  }

  for (const wall of house.walls ?? []) {
    const pad = wall.thickness / 2 + 0.02;
    if (
      segmentIntersectsRect(
        wall.x1,
        wall.z1,
        wall.x2,
        wall.z2,
        box.minX - pad,
        box.maxX + pad,
        box.minZ - pad,
        box.maxZ + pad,
      )
    ) {
      return false;
    }
  }
  return true;
}

export function clearsHouseDoorways(item, house) {
  if (item.kind === "rug" || (Number(item.elevation ?? item.y) || 0) >= 1.85) {
    return true;
  }
  const approach = 0.92;
  for (const door of house.doors ?? []) {
    const pose = getDoorWorldPose(house, door);
    if (!pose) continue;
    const alongX = Math.abs(pose.ux) >= Math.abs(pose.uz);
    const zones = door.exterior
      ? [
          {
            x: pose.x + pose.nx * (approach / 2),
            z: pose.z + pose.nz * (approach / 2),
            width: alongX ? pose.width : approach,
            depth: alongX ? approach : pose.width,
            rotation: 0,
          },
        ]
      : [
          {
            x: pose.x,
            z: pose.z,
            width: alongX ? pose.width : approach * 1.9,
            depth: alongX ? approach * 1.9 : pose.width,
            rotation: 0,
          },
        ];
    for (const zone of zones) {
      if (footprintsOverlap(item, zone, 0.04)) return false;
    }
  }
  return true;
}

function itemsOverlap3D(a, b, clearance = 0) {
  const aY = Number(a.elevation ?? a.y) || 0;
  const bY = Number(b.elevation ?? b.y) || 0;
  if (aY >= bY + (b.height ?? 0.75) || bY >= aY + (a.height ?? 0.75)) {
    return false;
  }
  return footprintsOverlap(a, b, clearance);
}

export function canPlaceInHouse(item, house, items = [], clearance = 0) {
  return (
    withinHouseRoom(item, house) &&
    clearsHouseDoorways(item, house) &&
    !items.some(
      (other) =>
        other !== item &&
        (item.id == null || other.id !== item.id) &&
        itemsOverlap3D(item, other, clearance),
    )
  );
}

export function constrainToHouse(house, x, z, halfX = 0, halfZ = halfX) {
  if (!house?.bounds) return [x, z];
  const { minX, maxX, minZ, maxZ } = house.bounds;
  const clampedX = clamp(x, minX + halfX + 0.08, maxX - halfX - 0.08);
  const clampedZ = clamp(z, minZ + halfZ + 0.08, maxZ - halfZ - 0.08);
  const room = getRoomAtPoint(house, clampedX, clampedZ);
  if (room) {
    const rb = room.bounds;
    const rx = clamp(clampedX, rb.minX + halfX + 0.08, rb.maxX - halfX - 0.08);
    const rz = clamp(clampedZ, rb.minZ + halfZ + 0.08, rb.maxZ - halfZ - 0.08);
    if (Number.isFinite(rx) && Number.isFinite(rz) && rb.width > halfX * 2 + 0.16 && rb.depth > halfZ * 2 + 0.16) {
      return [rx, rz];
    }
  }
  return [clampedX, clampedZ];
}

export function fitItemInHouse(item, house, items = [], preferredRoomId = null) {
  if (canPlaceInHouse(item, house, items, 0.08)) {
    return {
      ...item,
      roomId: getRoomAtPoint(house, item.x, item.z)?.id ?? item.roomId ?? null,
    };
  }

  const orderedRooms = [...(house.rooms ?? [])].sort(
    (a, b) => Number(b.id === preferredRoomId) - Number(a.id === preferredRoomId),
  );

  for (const room of orderedRooms) {
    const { minX, maxX, minZ, maxZ, centerX, centerZ } = room.bounds;
    const candidates = [
      [centerX, centerZ, item.rotation ?? 0],
      [centerX, centerZ, ((item.rotation ?? 0) + 90) % 360],
    ];
    for (let z = minZ + 0.55; z <= maxZ - 0.55; z += 0.45) {
      for (let x = minX + 0.55; x <= maxX - 0.55; x += 0.45) {
        candidates.push([x, z, 0], [x, z, 90]);
      }
    }
    for (const [x, z, rotation] of candidates) {
      const candidate = { ...item, x, z, rotation, roomId: room.id };
      if (canPlaceInHouse(candidate, house, items, 0.08)) return candidate;
    }
  }
  return null;
}

/**
 * Deterministic model guard for object mutations (move, rotate, remove, replace, lock, unlock).
 * Locked objects reject move, rotate, remove, and replace operations.
 */
export function applyObjectOperation(items, operation, house = null) {
  const target = items.find((item) => item.id === operation?.objectId);
  if (!target && operation?.type !== "add") {
    return { ok: false, reason: "NOT_FOUND", items };
  }
  if (!canModifyObject(target, operation?.type)) {
    return { ok: false, reason: "LOCKED_OBJECT", items };
  }

  if (operation.type === "lock" || operation.type === "unlock") {
    const nextLocked = operation.type === "lock";
    return {
      ok: true,
      items: items.map((i) =>
        i.id === target.id ? { ...i, locked: nextLocked } : i,
      ),
    };
  }

  if (operation.type === "remove") {
    return {
      ok: true,
      items: items.filter((i) => i.id !== target.id),
    };
  }

  if (operation.type === "move") {
    const next = {
      ...target,
      x: Number(operation.x ?? operation.position?.[0] ?? target.x),
      z: Number(operation.z ?? operation.position?.[2] ?? target.z),
    };
    if (house && !canPlaceInHouse(next, house, items)) {
      return { ok: false, reason: "INVALID_PLACEMENT", items };
    }
    next.roomId = house ? getRoomAtPoint(house, next.x, next.z)?.id ?? next.roomId : next.roomId;
    return {
      ok: true,
      items: items.map((i) => (i.id === target.id ? next : i)),
    };
  }

  if (operation.type === "rotate") {
    const next = {
      ...target,
      rotation: Number(operation.rotation ?? (target.rotation + 90) % 360),
    };
    if (house && !canPlaceInHouse(next, house, items)) {
      return { ok: false, reason: "INVALID_PLACEMENT", items };
    }
    return {
      ok: true,
      items: items.map((i) => (i.id === target.id ? next : i)),
    };
  }

  if (operation.type === "replace" && operation.replacement) {
    const remaining = items.filter((i) => i.id !== target.id);
    const next = {
      ...operation.replacement,
      x: operation.replacement.x ?? target.x,
      z: operation.replacement.z ?? target.z,
      rotation: operation.replacement.rotation ?? target.rotation,
    };
    if (house && !canPlaceInHouse(next, house, remaining)) {
      return { ok: false, reason: "INVALID_PLACEMENT", items };
    }
    next.roomId = house ? getRoomAtPoint(house, next.x, next.z)?.id ?? target.roomId : target.roomId;
    return {
      ok: true,
      items: [...remaining, next],
    };
  }

  if (operation.type === "add" && operation.item) {
    const placed = house
      ? fitItemInHouse(operation.item, house, items, operation.roomId)
      : operation.item;
    if (!placed) return { ok: false, reason: "NO_SPACE", items };
    return {
      ok: true,
      items: [...items, placed],
    };
  }

  return { ok: false, reason: "UNSUPPORTED_OPERATION", items };
}
