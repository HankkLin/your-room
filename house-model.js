import { ROOM, footprintsOverlap } from "./model.js";
import {
  footprintCorners,
  normalizeArchitecture,
  roomWalls,
  wallOpenings,
} from "./room-layout.js";
import {
  DEFAULT_CEILING_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  HOUSE_UNITS,
  canModifyObject,
  houseFixturesAsSceneObjects,
  isObjectLocked,
  toSceneObject,
} from "./src/contracts/scene.js";
import { validateHouseGeometry } from "./src/lib/validators/house-validator.js";
import { buildRoomAdjacencyGraph } from "./src/spatial/floorplan-geometry.js";

export {
  DEFAULT_CEILING_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  HOUSE_UNITS,
  canModifyObject,
  houseFixturesAsSceneObjects,
  isObjectLocked,
  toSceneObject,
  validateHouseGeometry,
};

export function validateHouseScene(house) {
  const res = validateHouseGeometry(house);
  return {
    valid: res.valid,
    errors: res.errors.map((e) => e.message),
    warnings: res.warnings,
    summary: res.summary,
  };
}

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

function defaultFloorForRoomKind(kind) {
  if (kind === "kitchen" || kind === "bathroom") return "stone";
  if (kind === "bedroom" || kind === "office") return "walnut";
  return "oak";
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

function normalizeWall(wall, ceilingHeight, rooms, houseBounds) {
  const x1 = Number(wall.start?.[0] ?? wall.x1);
  const z1 = Number(wall.start?.[1] ?? wall.z1);
  const x2 = Number(wall.end?.[0] ?? wall.x2);
  const z2 = Number(wall.end?.[1] ?? wall.z2);
  const length = Math.hypot(x2 - x1, z2 - z1);
  const ux = length > 0 ? (x2 - x1) / length : 1;
  const uz = length > 0 ? (z2 - z1) / length : 0;
  const angle = Math.atan2(-uz, ux);
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const exterior = wall.kind ? wall.kind === "exterior" : Boolean(wall.exterior);

  // Local +Z axis in Three.js wall anchor frame is (baseNx, baseNz) = (-uz, ux)
  const baseNx = -uz;
  const baseNz = ux;
  let inwardSign = 1;
  if (exterior && rooms.length > 0) {
    const probeDist = 0.2;
    const plusInside = rooms.some((r) =>
      isPointInPolygon(cx + baseNx * probeDist, cz + baseNz * probeDist, r.polygon),
    );
    const minusInside = rooms.some((r) =>
      isPointInPolygon(cx - baseNx * probeDist, cz - baseNz * probeDist, r.polygon),
    );
    if (plusInside && !minusInside) inwardSign = 1;
    else if (minusInside && !plusInside) inwardSign = -1;
    else {
      const toCenter =
        (houseBounds.centerX - cx) * baseNx + (houseBounds.centerZ - cz) * baseNz;
      inwardSign = toCenter >= 0 ? 1 : -1;
    }
  }

  return {
    id: String(wall.id),
    start: [x1, z1],
    end: [x2, z2],
    x1,
    z1,
    x2,
    z2,
    cx,
    cz,
    length,
    angle,
    ux,
    uz,
    inwardSign,
    nx: baseNx * inwardSign,
    nz: baseNz * inwardSign,
    thickness: Number(wall.thickness) || (exterior ? DEFAULT_WALL_THICKNESS : 0.12),
    height: Number(wall.height) || ceilingHeight,
    kind: exterior ? "exterior" : "interior",
    exterior,
    roomIds: Array.isArray(wall.roomIds) ? [...wall.roomIds] : [],
    locked: true,
    ...(wall.confidence != null ? { confidence: wall.confidence } : {}),
  };
}

function findClosestWall(walls, px, pz) {
  let best = null;
  let bestDist = Infinity;
  for (const wall of walls) {
    const d = distanceToSegment(px, pz, wall.x1, wall.z1, wall.x2, wall.z2);
    if (d < bestDist) {
      bestDist = d;
      best = wall;
    }
  }
  return bestDist <= 0.45 ? best : null;
}

/**
 * Normalize a canonical House JSON (in meters) for rendering, collision, and placement
 * while preserving full compatibility with `validateHouseGeometry`.
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
    const kind = room.kind || "living";
    return {
      ...room,
      id: String(room.id),
      name: String(room.name || room.id),
      kind,
      polygon,
      bounds,
      floorFinish: ["oak", "walnut", "stone"].includes(room.floorFinish)
        ? room.floorFinish
        : defaultFloorForRoomKind(kind),
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

  const walls = (input?.walls ?? []).map((w) =>
    normalizeWall(w, ceilingHeight, rooms, bounds),
  );

  const doors = (input?.doors ?? []).map((door, index) => {
    let wall = walls.find((w) => w.id === door.wallId) ?? null;
    if (!wall && Array.isArray(door.position) && door.position.length >= 2) {
      wall = findClosestWall(walls, Number(door.position[0]), Number(door.position[1]));
    }
    let offset = Number(door.offset);
    let position = Array.isArray(door.position)
      ? [Number(door.position[0]), Number(door.position[1])]
      : null;

    if (wall) {
      if (position && Number.isFinite(position[0]) && Number.isFinite(position[1])) {
        const proj =
          ((position[0] - wall.x1) * wall.ux + (position[1] - wall.z1) * wall.uz) /
          Math.max(0.01, wall.length);
        offset = clamp(proj, 0.04, 0.96);
      } else {
        offset = clamp(Number.isFinite(offset) ? offset : 0.5, 0.04, 0.96);
        position = [
          wall.x1 + offset * (wall.x2 - wall.x1),
          wall.z1 + offset * (wall.z2 - wall.z1),
        ];
      }
    } else {
      offset = clamp(Number.isFinite(offset) ? offset : 0.5, 0.04, 0.96);
      position = position ?? [bounds.centerX, bounds.centerZ];
    }

    const kind =
      door.kind || (door.exterior ? "exterior" : "interior");
    const exterior = kind === "exterior";
    const roomIds =
      Array.isArray(door.roomIds) && door.roomIds.length > 0
        ? [...door.roomIds]
        : [door.roomA, door.roomB].filter(Boolean);
    const roomA = door.roomA ?? roomIds[0] ?? null;
    const roomB = exterior ? null : (door.roomB ?? roomIds[1] ?? null);

    return {
      ...door,
      id: String(door.id || `door-${index + 1}`),
      kind,
      wallId: wall?.id ?? door.wallId ?? null,
      offset,
      position,
      width: Number(door.width) > 0 ? Number(door.width) : 0.9,
      height: Math.min(Number(door.height) || 2.08, ceilingHeight - 0.1),
      roomA,
      roomB,
      roomIds,
      exterior,
      locked: true,
    };
  });

  const windows = (input?.windows ?? []).map((win, index) => {
    let wall = walls.find((w) => w.id === win.wallId) ?? null;
    if (!wall && Array.isArray(win.position) && win.position.length >= 2) {
      wall = findClosestWall(walls, Number(win.position[0]), Number(win.position[1]));
    }
    let offset = Number(win.offset);
    let position = Array.isArray(win.position)
      ? [Number(win.position[0]), Number(win.position[1])]
      : null;

    if (wall) {
      if (position && Number.isFinite(position[0]) && Number.isFinite(position[1])) {
        const proj =
          ((position[0] - wall.x1) * wall.ux + (position[1] - wall.z1) * wall.uz) /
          Math.max(0.01, wall.length);
        offset = clamp(proj, 0.04, 0.96);
      } else {
        offset = clamp(Number.isFinite(offset) ? offset : 0.5, 0.04, 0.96);
        position = [
          wall.x1 + offset * (wall.x2 - wall.x1),
          wall.z1 + offset * (wall.z2 - wall.z1),
        ];
      }
    } else {
      offset = clamp(Number.isFinite(offset) ? offset : 0.5, 0.04, 0.96);
      position = position ?? [bounds.centerX, bounds.minZ];
    }

    const sillHeight = clamp(Number(win.sillHeight ?? 0.9), 0.25, ceilingHeight - 0.45);
    const rawHeight =
      win.headHeight != null
        ? Number(win.headHeight) - sillHeight
        : Number(win.height) || 1.25;
    const height = clamp(rawHeight, 0.3, ceilingHeight - sillHeight - 0.12);
    const headHeight = sillHeight + height;
    const roomId = win.roomId ?? win.roomIds?.[0] ?? null;
    const roomIds =
      Array.isArray(win.roomIds) && win.roomIds.length > 0
        ? [...win.roomIds]
        : roomId
          ? [roomId]
          : [];

    return {
      ...win,
      id: String(win.id || `window-${index + 1}`),
      type: "window",
      wallId: wall?.id ?? win.wallId ?? null,
      roomId,
      roomIds,
      offset,
      position,
      width: Number(win.width) > 0 ? Number(win.width) : 1.4,
      sillHeight,
      headHeight,
      height,
      locked: true,
    };
  });

  // Populate default viewpoints for rooms that do not specify one
  for (const room of rooms) {
    if (room.viewpoint) continue;
    const roomDoor = doors.find(
      (d) => !d.exterior && d.roomIds.includes(room.id) && Array.isArray(d.position),
    );
    room.viewpoint = {
      x: room.bounds.centerX,
      z: room.bounds.centerZ,
      targetX: roomDoor ? roomDoor.position[0] : bounds.centerX,
      targetZ: roomDoor ? roomDoor.position[1] : bounds.centerZ,
    };
  }

  const baseHouse = {
    ...input,
    id: String(input?.id || input?.houseId || "house-01"),
    houseId: String(input?.houseId || input?.id || "house-01"),
    name: String(input?.name || "Connected home"),
    units: HOUSE_UNITS,
    isWholeHome: Boolean(input?.isWholeHome ?? rooms.length > 1),
    ceilingHeight,
    bounds,
    rooms,
    walls,
    doors,
    windows,
    adjacency: Array.isArray(input?.adjacency)
      ? input.adjacency
      : buildRoomAdjacencyGraph(rooms, doors),
    fixtures: [],
    objects: [],
    environment: input?.environment ? { ...input.environment } : {},
  };

  const canonicalFixtures = (input?.fixtures ?? []).map((fix) => {
    const sceneObj = toSceneObject({
      ...fix,
      type: "fixed",
      locked: true,
      owned: true,
      price: 0,
    });
    return {
      ...fix,
      id: sceneObj.id,
      kind: sceneObj.kind,
      type: "fixed",
      name: sceneObj.name || sceneObj.kind,
      roomId:
        fix.roomId ||
        getRoomAtPoint(baseHouse, sceneObj.x, sceneObj.z)?.id ||
        rooms[0]?.id ||
        null,
      position: sceneObj.position,
      rotation: Array.isArray(fix.rotation)
        ? fix.rotation
        : sceneObj.rotationRadians,
      dimensions: sceneObj.dimensions,
      locked: true,
    };
  });

  const combined = new Map();
  for (const fix of canonicalFixtures) {
    combined.set(
      fix.id,
      toSceneObject({ ...fix, fromHouseFixture: true }),
    );
  }
  for (const obj of input?.objects ?? []) {
    const normalized = toSceneObject(obj);
    combined.set(normalized.id, {
      ...normalized,
      roomId:
        normalized.roomId ||
        getRoomAtPoint(baseHouse, normalized.x, normalized.z)?.id ||
        rooms[0]?.id ||
        null,
    });
  }

  baseHouse.fixtures = canonicalFixtures;
  baseHouse.objects = [...combined.values()];
  return baseHouse;
}

/**
 * Project a confirmed House's fixed architectural fixtures into Living Blueprint's items array
 * without duplicating fixtures or discarding movable furniture.
 */
export function mergeHouseFixturesIntoItems(house, existingItems = []) {
  if (!house) return existingItems.filter((i) => !i.fromHouseFixture);
  const normalized = house.isWholeHome !== undefined && house.walls?.[0]?.ux !== undefined
    ? house
    : normalizeHouse(house);
  const fixtureItems = houseFixturesAsSceneObjects(normalized).map((f) =>
    toSceneObject({
      ...f,
      fromHouseFixture: true,
      owned: true,
      locked: true,
      price: 0,
    }),
  );
  const fixtureIds = new Set(fixtureItems.map((f) => f.id));
  const movable = existingItems.filter(
    (item) => !item.fromHouseFixture && !fixtureIds.has(item.id),
  );
  return [...fixtureItems, ...movable];
}

/**
 * Synchronize authoritative house.objects with a flat items array while preserving
 * canonical house.fixtures untouched.
 */
export function syncHouseObjects(house, items = []) {
  if (!house) return null;
  const normalizedHouse =
    house.walls?.[0]?.ux !== undefined ? house : normalizeHouse(house);
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
  };
}

/**
 * Backward-compatibility adapter: wraps a single Living Blueprint room into a valid 1-room House.
 */
export function roomToHouse(
  room = ROOM,
  items = [],
  { id = "single-room-house", name = "Living room" } = {},
) {
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
      start: [side.x - half * cos, side.z + half * sin],
      end: [side.x + half * cos, side.z - half * sin],
      thickness: 0.12,
      height: layout.height,
      kind: "exterior",
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
      const pos = [
        side.x + center * Math.cos(side.angle),
        side.z - center * Math.sin(side.angle),
      ];
      const width = hole.right - hole.left;
      if (hole.kind === "door") {
        doors.push({
          id: `door-${side.id}-${index + 1}`,
          kind: "exterior",
          wallId: `wall-${side.id}`,
          roomA: roomId,
          roomB: null,
          position: pos,
          width,
          height: hole.top - hole.bottom,
        });
      } else {
        windows.push({
          id: `window-${side.id}-${index + 1}`,
          wallId: `wall-${side.id}`,
          roomId,
          position: pos,
          width,
          sillHeight: hole.bottom,
          headHeight: hole.top,
        });
      }
    });
  }

  return normalizeHouse({
    id,
    name,
    units: HOUSE_UNITS,
    isWholeHome: false,
    ceilingHeight: layout.height,
    calibration: {
      source: "manual_calibration",
      knownDistanceMeters: layout.width,
      pixelDistance: 100,
      metersPerPixel: 1,
    },
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
    fixtures: [],
    objects: items,
  });
}

export function getRoomAtPoint(house, x, z) {
  if (!house?.rooms) return null;
  return house.rooms.find((room) => isPointInPolygon(x, z, room.polygon)) ?? null;
}

export function getWallOpeningsInHouse(house, wall) {
  const edgeMargin = 0.05;
  const list = [];

  for (const door of house.doors ?? []) {
    if (door.wallId !== wall.id) continue;
    const width = Math.min(door.width, Math.max(0.4, wall.length - edgeMargin * 2));
    const center = ((door.offset ?? 0.5) - 0.5) * wall.length;
    const left = clamp(
      center - width / 2,
      -wall.length / 2 + edgeMargin,
      wall.length / 2 - edgeMargin - width,
    );
    list.push({
      id: door.id,
      kind: "door",
      exterior: Boolean(door.exterior || door.kind === "exterior"),
      roomIds: door.roomIds,
      left,
      right: left + width,
      bottom: 0,
      top: Math.min(door.height || 2.08, wall.height - 0.1),
    });
  }

  for (const win of house.windows ?? []) {
    if (win.wallId !== wall.id) continue;
    const width = Math.min(win.width, Math.max(0.3, wall.length - edgeMargin * 2));
    const center = ((win.offset ?? 0.5) - 0.5) * wall.length;
    const left = clamp(
      center - width / 2,
      -wall.length / 2 + edgeMargin,
      wall.length / 2 - edgeMargin - width,
    );
    const bottom = win.sillHeight ?? 0.9;
    const top = Math.min(
      win.headHeight ?? bottom + (win.height || 1.25),
      wall.height - 0.12,
    );
    list.push({
      id: win.id,
      kind: "window",
      exterior: true,
      roomIds: win.roomIds,
      left,
      right: left + width,
      bottom,
      top,
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
    exterior: Boolean(door.exterior || door.kind === "exterior"),
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
  const normalized = toSceneObject(item);
  const { x, z, y: minY, width, depth, height, rotation } = normalized;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const halfX = (cos * width + sin * depth) / 2;
  const halfZ = (sin * width + cos * depth) / 2;

  return {
    id: normalized.id,
    kind: normalized.kind,
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
    locked: isObjectLocked(normalized),
  };
}

export function getHouseObstacles(house, items = house?.objects ?? []) {
  return {
    wallSegments: getSolidWallSegments(house),
    objectBoxes: items.map(getObjectBoundingBox).filter((box) => !box.walkable),
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
  { items = house?.objects ?? [], clearance = 0.15 } = {},
) {
  if (!getRoomAtPoint(house, x, z)) return false;

  const segments = getSolidWallSegments(house);
  for (const seg of segments) {
    const minDist = seg.thickness / 2 + clearance;
    if (distanceToSegment(x, z, seg.x1, seg.z1, seg.x2, seg.z2) < minDist) {
      return false;
    }
  }

  for (const rawItem of items) {
    const item = rawItem.width !== undefined ? rawItem : toSceneObject(rawItem);
    const minY = Number(item.elevation ?? item.y) || 0;
    if ((Number(item.height) || 0) <= 0.13 || minY >= 1.85) continue;
    const deg = Array.isArray(item.rotation)
      ? (Number(item.rotation[1] || 0) * 180) / Math.PI
      : Number(item.rotation) || 0;
    const radians = (deg * Math.PI) / 180;
    const dx = x - item.x;
    const dz = z - item.z;
    const xLocal = dx * Math.cos(radians) - dz * Math.sin(radians);
    const zLocal = dx * Math.sin(radians) + dz * Math.cos(radians);
    if (
      Math.abs(xLocal) < item.width / 2 + 0.08 &&
      Math.abs(zLocal) < item.depth / 2 + 0.08
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
  const approach = 0.88;
  for (const door of house.doors ?? []) {
    const pose = getDoorWorldPose(house, door);
    if (!pose) continue;
    const alongX = Math.abs(pose.ux) >= Math.abs(pose.uz);
    const zones = pose.exterior
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
            width: alongX ? pose.width : approach * 1.85,
            depth: alongX ? approach * 1.85 : pose.width,
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
  const aObj = a.width !== undefined ? a : toSceneObject(a);
  const bObj = b.width !== undefined ? b : toSceneObject(b);
  const aY = Number(aObj.elevation ?? aObj.y) || 0;
  const bY = Number(bObj.elevation ?? bObj.y) || 0;
  if (aY >= bY + (bObj.height ?? 0.75) || bY >= aY + (aObj.height ?? 0.75)) {
    return false;
  }
  return footprintsOverlap(aObj, bObj, clearance);
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
    if (
      Number.isFinite(rx) &&
      Number.isFinite(rz) &&
      rb.width > halfX * 2 + 0.16 &&
      rb.depth > halfZ * 2 + 0.16
    ) {
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
    next.roomId = house
      ? getRoomAtPoint(house, next.x, next.z)?.id ?? next.roomId
      : next.roomId;
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
    next.roomId = house
      ? getRoomAtPoint(house, next.x, next.z)?.id ?? target.roomId
      : target.roomId;
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
