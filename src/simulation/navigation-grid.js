import {
  CELL_BLOCKED,
  CELL_DOOR,
  CELL_OUTSIDE,
  CELL_WALKABLE,
  DEFAULT_AGENT_RADIUS,
  DEFAULT_GRID_CELL_SIZE,
} from "../contracts/simulation.js";
import {
  buildRoomAdjacencyGraph,
  deriveWallsFromRooms,
  isFinitePoint2D,
  pointInPolygon,
  pointToSegmentDistance,
  polygonBounds,
  projectPointOnSegment,
} from "../spatial/floorplan-geometry.js";

const MAX_CLEARANCE_TRACKED = 3.0;
const round3 = (n) => Math.round(n * 1000) / 1000;

function orientedBoxPolygon(centerX, centerZ, width, depth, yawRadians = 0) {
  const hw = Math.max(0.02, Number(width) || 0.5) / 2;
  const hd = Math.max(0.02, Number(depth) || 0.5) / 2;
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  const corners = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return corners.map(([lx, lz]) => [
    centerX + lx * cos - lz * sin,
    centerZ + lx * sin + lz * cos,
  ]);
}

function pointInPolygonStrict(pt, polygon) {
  if (!isFinitePoint2D(pt) || !Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const zi = polygon[i][1];
    const xj = polygon[j][0];
    const zj = polygon[j][1];
    const intersect =
      zi > pt[1] !== zj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToPolygon(pt, polygon) {
  if (pointInPolygonStrict(pt, polygon)) return 0;
  let minDist = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const d = pointToSegmentDistance(pt, a, b);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function subtractIntervals(totalLength, rawCutouts) {
  if (!rawCutouts.length) return [[0, totalLength]];
  const cutouts = rawCutouts
    .map(([a, b]) => [Math.max(0, a), Math.min(totalLength, b)])
    .filter(([a, b]) => b - a > 1e-3)
    .sort((x, y) => x[0] - y[0]);

  const merged = [];
  for (const interval of cutouts) {
    const prev = merged.at(-1);
    if (!prev || interval[0] > prev[1] + 1e-4) {
      merged.push([...interval]);
    } else {
      prev[1] = Math.max(prev[1], interval[1]);
    }
  }

  const remaining = [];
  let cursor = 0;
  for (const [cutStart, cutEnd] of merged) {
    if (cutStart - cursor > 0.015) {
      remaining.push([cursor, cutStart]);
    }
    cursor = Math.max(cursor, cutEnd);
  }
  if (totalLength - cursor > 0.015) {
    remaining.push([cursor, totalLength]);
  }
  return remaining;
}

function distanceToOrientedWallSegment(pt, segStart, segEnd, halfThickness) {
  const dx = segEnd[0] - segStart[0];
  const dz = segEnd[1] - segStart[1];
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) {
    return Math.max(
      0,
      Math.hypot(pt[0] - segStart[0], pt[1] - segStart[1]) - halfThickness,
    );
  }
  const tx = dx / length;
  const tz = dz / length;
  const relX = pt[0] - segStart[0];
  const relZ = pt[1] - segStart[1];
  const along = relX * tx + relZ * tz;
  const perp = Math.abs(-relX * tz + relZ * tx);

  const du = along < 0 ? -along : along > length ? along - length : 0;
  const dv = Math.max(0, perp - halfThickness);
  return Math.hypot(du, dv);
}

function extractObstaclePolygons(house) {
  const polygons = [];

  // 1. Immovable fixtures (`house.fixtures`)
  for (const fix of Array.isArray(house.fixtures) ? house.fixtures : []) {
    if (!fix || fix.passable === true) continue;
    if (Array.isArray(fix.footprint) && fix.footprint.length >= 3) {
      if (fix.footprint.every(isFinitePoint2D)) {
        polygons.push({
          id: fix.id,
          kind: fix.kind || "fixture",
          locked: Boolean(fix.locked ?? true),
          polygon: fix.footprint,
        });
        continue;
      }
    }
    if (Array.isArray(fix.position) && fix.position.length >= 3) {
      const yaw = Array.isArray(fix.rotation) ? Number(fix.rotation[1]) || 0 : 0;
      polygons.push({
        id: fix.id,
        kind: fix.kind || "fixture",
        locked: Boolean(fix.locked ?? true),
        polygon: orientedBoxPolygon(
          Number(fix.position[0]),
          Number(fix.position[2]),
          fix.dimensions?.width ?? 0.6,
          fix.dimensions?.depth ?? 0.6,
          yaw,
        ),
      });
    }
  }

  // 2. Scene objects (`house.objects` per AGENTS.md §4)
  for (const obj of Array.isArray(house.objects) ? house.objects : []) {
    if (!obj || obj.kind === "rug" || obj.passable === true) continue;
    if (Array.isArray(obj.footprint) && obj.footprint.length >= 3) {
      polygons.push({
        id: obj.id,
        kind: obj.kind || obj.type || "object",
        locked: Boolean(obj.locked),
        polygon: obj.footprint,
      });
      continue;
    }
    if (Array.isArray(obj.position) && obj.position.length >= 2) {
      const cx = Number(obj.position[0]);
      const cz =
        obj.position.length >= 3
          ? Number(obj.position[2])
          : Number(obj.position[1]);
      const yaw = Array.isArray(obj.rotation)
        ? Number(obj.rotation[1]) || 0
        : ((Number(obj.rotation) || 0) * Math.PI) / 180;
      polygons.push({
        id: obj.id,
        kind: obj.kind || obj.type || "object",
        locked: Boolean(obj.locked),
        polygon: orientedBoxPolygon(
          cx,
          cz,
          obj.dimensions?.width ?? obj.width ?? 0.7,
          obj.dimensions?.depth ?? obj.depth ?? 0.7,
          yaw,
        ),
      });
    }
  }

  // 3. Optional legacy Stillroom `items` compatibility (`x, z, width, depth, rotation` in deg)
  for (const item of Array.isArray(house.items) ? house.items : []) {
    if (!item || item.kind === "rug" || item.passable === true) continue;
    if (Number.isFinite(item.x) && Number.isFinite(item.z)) {
      const yaw = ((Number(item.rotation) || 0) * Math.PI) / 180;
      polygons.push({
        id: item.id,
        kind: item.kind || "furniture",
        locked: Boolean(item.locked),
        polygon: orientedBoxPolygon(
          Number(item.x),
          Number(item.z),
          item.width ?? 0.7,
          item.depth ?? 0.7,
          yaw,
        ),
      });
    }
  }

  return polygons;
}

/**
 * Build a deterministic 2D navigation grid + room connectivity graph from
 * a validated whole-home `House JSON`.
 *
 * Zero Three.js or DOM dependencies.
 *
 * @param {object} house
 * @param {object} [options]
 * @param {number} [options.cellSize=0.1]
 * @param {number} [options.agentRadius=0.24]
 */
export function buildNavigationModel(house, options = {}) {
  if (!house || !Array.isArray(house.rooms) || house.rooms.length === 0) {
    throw new Error("House JSON with at least one room is required to build navigation.");
  }

  const cellSize = Math.max(
    0.05,
    Math.min(0.5, Number(options.cellSize ?? DEFAULT_GRID_CELL_SIZE)),
  );
  const agentRadius = Math.max(
    0,
    Number(options.agentRadius ?? DEFAULT_AGENT_RADIUS),
  );

  const rooms = house.rooms;
  const roomsById = new Map();
  const roomIndexById = new Map();
  rooms.forEach((room, idx) => {
    roomsById.set(room.id, room);
    roomIndexById.set(room.id, idx);
  });

  const allRoomVertices = rooms.flatMap((r) =>
    Array.isArray(r.polygon) ? r.polygon : [],
  );
  const rawBounds =
    house.bounds &&
    Number.isFinite(house.bounds.minX) &&
    Number.isFinite(house.bounds.maxX) &&
    house.bounds.width > 0
      ? house.bounds
      : polygonBounds(allRoomVertices);

  const pad = Math.max(cellSize * 3, 0.3);
  const minX = round3(rawBounds.minX - pad);
  const minZ = round3(rawBounds.minZ - pad);
  const maxX = round3(rawBounds.maxX + pad);
  const maxZ = round3(rawBounds.maxZ + pad);

  const width = Math.max(1, Math.ceil((maxX - minX) / cellSize));
  const height = Math.max(1, Math.ceil((maxZ - minZ) / cellSize));
  const totalCells = width * height;

  const walls =
    Array.isArray(house.walls) && house.walls.length > 0
      ? house.walls
      : deriveWallsFromRooms(rooms, [], house.ceilingHeight ?? 2.7);

  // Filter valid traversable doors
  const traversableDoors = [];
  for (const door of Array.isArray(house.doors) ? house.doors : []) {
    if (!door || door.blocked === true || door.closed === true) continue;
    if (!isFinitePoint2D(door.position)) continue;
    if (!door.roomA || !roomsById.has(door.roomA)) continue;
    if (door.kind === "interior" && (!door.roomB || !roomsById.has(door.roomB))) {
      continue;
    }
    if (door.roomB != null && !roomsById.has(door.roomB)) continue;
    traversableDoors.push(door);
  }

  // Carve door openings out of walls and build door threshold zones
  const solidWallSegments = [];
  const doorThresholds = [];

  const doorsMatched = new Set();
  for (const wall of walls) {
    if (!isFinitePoint2D(wall.start) || !isFinitePoint2D(wall.end)) continue;
    const dx = wall.end[0] - wall.start[0];
    const dz = wall.end[1] - wall.start[1];
    const wallLen = Math.hypot(dx, dz);
    if (wallLen < 1e-4) continue;
    const tx = dx / wallLen;
    const tz = dz / wallLen;
    const wallThickness = Number(wall.thickness) || 0.14;

    const cutouts = [];
    traversableDoors.forEach((door, doorIdx) => {
      const proj = projectPointOnSegment(door.position, wall.start, wall.end);
      const matchesWall =
        door.wallId === wall.id
          ? proj.distance <= Math.max(0.35, wallThickness * 2)
          : proj.distance <= Math.max(0.22, wallThickness * 1.5);
      if (!matchesWall) return;

      const doorWidth = Math.max(0.3, Number(door.width) || 0.85);
      const centerS = proj.t * wallLen;
      cutouts.push([centerS - doorWidth / 2, centerS + doorWidth / 2]);

      if (!doorsMatched.has(doorIdx)) {
        doorsMatched.add(doorIdx);
        const yaw = Math.atan2(dz, dx);
        doorThresholds.push({
          doorIndex: doorIdx,
          door,
          center: proj.point,
          polygon: orientedBoxPolygon(
            proj.point[0],
            proj.point[1],
            doorWidth,
            wallThickness + Math.max(0.36, cellSize * 3),
            yaw,
          ),
        });
      }
    });

    const subIntervals = subtractIntervals(wallLen, cutouts);
    for (const [s0, s1] of subIntervals) {
      solidWallSegments.push({
        wallId: wall.id,
        start: [wall.start[0] + tx * s0, wall.start[1] + tz * s0],
        end: [wall.start[0] + tx * s1, wall.start[1] + tz * s1],
        halfThickness: wallThickness / 2,
      });
    }
  }

  // Any traversable door not matched to a specific wall still gets a local threshold
  traversableDoors.forEach((door, doorIdx) => {
    if (doorsMatched.has(doorIdx)) return;
    const doorWidth = Math.max(0.3, Number(door.width) || 0.85);
    doorThresholds.push({
      doorIndex: doorIdx,
      door,
      center: [...door.position],
      polygon: orientedBoxPolygon(
        door.position[0],
        door.position[1],
        doorWidth,
        0.45,
        0,
      ),
    });
  });

  const floorGrid = new Uint8Array(totalCells);
  const cells = new Uint8Array(totalCells);
  const roomIndexGrid = new Int16Array(totalCells).fill(-1);
  const doorIndexGrid = new Int16Array(totalCells).fill(-1);
  const clearanceGrid = new Float32Array(totalCells);

  // Precompute room polygon bounds for fast culling
  const roomBBoxes = rooms.map((r) => polygonBounds(r.polygon));

  for (let row = 0; row < height; row += 1) {
    const wz = minZ + (row + 0.5) * cellSize;
    for (let col = 0; col < width; col += 1) {
      const wx = minX + (col + 0.5) * cellSize;
      const idx = row * width + col;
      const pt = [wx, wz];

      for (let rIdx = 0; rIdx < rooms.length; rIdx += 1) {
        const box = roomBBoxes[rIdx];
        if (
          wx < box.minX - 0.02 ||
          wx > box.maxX + 0.02 ||
          wz < box.minZ - 0.02 ||
          wz > box.maxZ + 0.02
        ) {
          continue;
        }
        if (pointInPolygon(pt, rooms[rIdx].polygon)) {
          floorGrid[idx] = CELL_WALKABLE;
          roomIndexGrid[idx] = rIdx;
          clearanceGrid[idx] = MAX_CLEARANCE_TRACKED;
          break;
        }
      }
    }
  }

  // Stamp door threshold cells so rooms across shared walls connect cleanly
  for (const threshold of doorThresholds) {
    const box = polygonBounds(threshold.polygon);
    const cMin = Math.max(0, Math.floor((box.minX - minX) / cellSize));
    const cMax = Math.min(width - 1, Math.ceil((box.maxX - minX) / cellSize));
    const rMin = Math.max(0, Math.floor((box.minZ - minZ) / cellSize));
    const rMax = Math.min(height - 1, Math.ceil((box.maxZ - minZ) / cellSize));
    const defaultRoomIdx = roomIndexById.get(threshold.door.roomA) ?? -1;

    for (let row = rMin; row <= rMax; row += 1) {
      const wz = minZ + (row + 0.5) * cellSize;
      for (let col = cMin; col <= cMax; col += 1) {
        const wx = minX + (col + 0.5) * cellSize;
        if (!pointInPolygon([wx, wz], threshold.polygon)) continue;
        const idx = row * width + col;
        floorGrid[idx] = CELL_DOOR;
        doorIndexGrid[idx] = threshold.doorIndex;
        if (roomIndexGrid[idx] === -1) roomIndexGrid[idx] = defaultRoomIdx;
        if (clearanceGrid[idx] === 0) {
          clearanceGrid[idx] = MAX_CLEARANCE_TRACKED;
        }
      }
    }
  }

  // Apply solid wall sub-segments to clearanceGrid
  for (const seg of solidWallSegments) {
    const reach = MAX_CLEARANCE_TRACKED + seg.halfThickness;
    const bMinX = Math.min(seg.start[0], seg.end[0]) - reach;
    const bMaxX = Math.max(seg.start[0], seg.end[0]) + reach;
    const bMinZ = Math.min(seg.start[1], seg.end[1]) - reach;
    const bMaxZ = Math.max(seg.start[1], seg.end[1]) + reach;

    const cMin = Math.max(0, Math.floor((bMinX - minX) / cellSize));
    const cMax = Math.min(width - 1, Math.ceil((bMaxX - minX) / cellSize));
    const rMin = Math.max(0, Math.floor((bMinZ - minZ) / cellSize));
    const rMax = Math.min(height - 1, Math.ceil((bMaxZ - minZ) / cellSize));

    for (let row = rMin; row <= rMax; row += 1) {
      const wz = minZ + (row + 0.5) * cellSize;
      for (let col = cMin; col <= cMax; col += 1) {
        const idx = row * width + col;
        if (floorGrid[idx] === CELL_OUTSIDE) continue;
        const wx = minX + (col + 0.5) * cellSize;
        const d = distanceToOrientedWallSegment(
          [wx, wz],
          seg.start,
          seg.end,
          seg.halfThickness,
        );
        if (d < clearanceGrid[idx]) clearanceGrid[idx] = d;
      }
    }
  }

  // Apply immovable fixtures and placed furniture obstacles to clearanceGrid
  const obstacles = extractObstaclePolygons(house);
  for (const obs of obstacles) {
    const box = polygonBounds(obs.polygon);
    const cMin = Math.max(
      0,
      Math.floor((box.minX - MAX_CLEARANCE_TRACKED - minX) / cellSize),
    );
    const cMax = Math.min(
      width - 1,
      Math.ceil((box.maxX + MAX_CLEARANCE_TRACKED - minX) / cellSize),
    );
    const rMin = Math.max(
      0,
      Math.floor((box.minZ - MAX_CLEARANCE_TRACKED - minZ) / cellSize),
    );
    const rMax = Math.min(
      height - 1,
      Math.ceil((box.maxZ + MAX_CLEARANCE_TRACKED - minZ) / cellSize),
    );

    for (let row = rMin; row <= rMax; row += 1) {
      const wz = minZ + (row + 0.5) * cellSize;
      for (let col = cMin; col <= cMax; col += 1) {
        const idx = row * width + col;
        if (floorGrid[idx] === CELL_OUTSIDE) continue;
        const wx = minX + (col + 0.5) * cellSize;
        const d = distanceToPolygon([wx, wz], obs.polygon);
        if (d < clearanceGrid[idx]) clearanceGrid[idx] = d;
      }
    }
  }

  // Materialize default cell states for `agentRadius`
  let walkableCellCount = 0;
  for (let idx = 0; idx < totalCells; idx += 1) {
    if (floorGrid[idx] === CELL_OUTSIDE) {
      cells[idx] = CELL_OUTSIDE;
    } else if (clearanceGrid[idx] < agentRadius) {
      cells[idx] = CELL_BLOCKED;
    } else {
      cells[idx] = floorGrid[idx];
      walkableCellCount += 1;
    }
  }

  // Build room connectivity graph from `house.adjacency` or `traversableDoors`
  const adjacencyList =
    Array.isArray(house.adjacency) && house.adjacency.length > 0
      ? house.adjacency
      : buildRoomAdjacencyGraph(rooms, traversableDoors);

  const roomGraph = new Map(rooms.map((r) => [r.id, []]));
  for (const edge of adjacencyList) {
    if (roomGraph.has(edge.fromRoomId) && roomGraph.has(edge.toRoomId)) {
      roomGraph.get(edge.fromRoomId).push({
        toRoomId: edge.toRoomId,
        viaDoorId: edge.viaDoorId,
      });
      roomGraph.get(edge.toRoomId).push({
        toRoomId: edge.fromRoomId,
        viaDoorId: edge.viaDoorId,
      });
    }
  }

  function worldToCell(x, z) {
    return [
      Math.floor((x - minX) / cellSize),
      Math.floor((z - minZ) / cellSize),
    ];
  }

  function cellToWorld(col, row) {
    return [
      round3(minX + (col + 0.5) * cellSize),
      round3(minZ + (row + 0.5) * cellSize),
    ];
  }

  function inGridBounds(col, row) {
    return col >= 0 && col < width && row >= 0 && row < height;
  }

  function isCellWalkable(col, row, radius = agentRadius) {
    if (!inGridBounds(col, row)) return false;
    const idx = row * width + col;
    return floorGrid[idx] !== CELL_OUTSIDE && clearanceGrid[idx] >= radius;
  }

  function isPointWalkable(x, z, radius = agentRadius) {
    const [col, row] = worldToCell(x, z);
    return isCellWalkable(col, row, radius);
  }

  function getClearanceAt(x, z) {
    const [col, row] = worldToCell(x, z);
    if (!inGridBounds(col, row)) return 0;
    return clearanceGrid[row * width + col];
  }

  function getRoomIdAt(x, z) {
    const [col, row] = worldToCell(x, z);
    if (!inGridBounds(col, row)) return null;
    const rIdx = roomIndexGrid[row * width + col];
    return rIdx >= 0 ? rooms[rIdx].id : null;
  }

  function getDoorAt(x, z) {
    const [col, row] = worldToCell(x, z);
    if (!inGridBounds(col, row)) return null;
    const dIdx = doorIndexGrid[row * width + col];
    return dIdx >= 0 ? traversableDoors[dIdx] : null;
  }

  return {
    cellSize,
    agentRadius,
    width,
    height,
    origin: [minX, minZ],
    bounds: { minX, minZ, maxX, maxZ, width: maxX - minX, depth: maxZ - minZ },
    walkableCellCount,
    cells,
    floorGrid,
    clearanceGrid,
    roomIndexGrid,
    doorIndexGrid,
    rooms,
    roomsById,
    roomIndexById,
    doors: traversableDoors,
    obstacles,
    solidWallSegments,
    roomGraph,
    worldToCell,
    cellToWorld,
    inGridBounds,
    isCellWalkable,
    isPointWalkable,
    getClearanceAt,
    getRoomIdAt,
    getDoorAt,
  };
}

/**
 * Deterministically select a safe walkable target `[x, z]` inside a room,
 * avoiding walls, locked fixtures, and furniture obstacles.
 *
 * When `slotIndex > 0`, selects a distinct nearby safe position so multiple
 * agents in the same room stand naturally side-by-side rather than stacking
 * on identical coordinates.
 *
 * @param {object} navigation
 * @param {string} roomId
 * @param {object} [options]
 * @param {number} [options.slotIndex=0]
 * @param {number} [options.agentRadius]
 * @param {string} [options.activity]
 * @param {object} [options.house]
 * @returns {{ position: [number, number], roomId: string } | null}
 */
export function resolveSafeRoomPosition(navigation, roomId, options = {}) {
  const roomIdx = navigation.roomIndexById.get(roomId);
  if (roomIdx == null) return null;

  const radius = Number(options.agentRadius ?? navigation.agentRadius);
  const slotIndex = Math.max(0, Math.floor(Number(options.slotIndex) || 0));
  const room = navigation.rooms[roomIdx];
  const rBounds = polygonBounds(room.polygon);
  const centroid = [
    (rBounds.minX + rBounds.maxX) / 2,
    (rBounds.minZ + rBounds.maxZ) / 2,
  ];

  // Bias activity reference toward relevant movable furniture or room fixtures when present
  let targetRef = centroid;
  const activity = String(options.activity || "").toLowerCase();
  const fixtures = Array.isArray(options.house?.fixtures)
    ? options.house.fixtures.filter((f) => f.roomId === roomId)
    : [];
  const roomObjects = Array.isArray(options.house?.objects)
    ? options.house.objects.filter((o) => {
        if (!o || o.kind === "rug") return false;
        if (o.roomId) return o.roomId === roomId;
        const ox = Number(o.position?.[0] ?? o.x);
        const oz = Number(o.position?.[2] ?? o.z);
        return Number.isFinite(ox) && Number.isFinite(oz) && pointInPolygon([ox, oz], room.polygon);
      })
    : [];

  const standInFrontOf = (px, pz, maxStandOff = 0.85, refPt = centroid) => {
    const vx = refPt[0] - px;
    const vz = refPt[1] - pz;
    const vLen = Math.hypot(vx, vz) || 1;
    const standOff = Math.min(maxStandOff, Math.max(0.42, vLen * 0.65));
    return [px + (vx / vLen) * standOff, pz + (vz / vLen) * standOff];
  };

  let matchedObject = null;
  let hasDedicatedActivityAnchor = false;
  if (/eat|breakfast|dine/.test(activity)) {
    matchedObject =
      roomObjects.find((o) => o.kind === "chair") ||
      roomObjects.find((o) => o.kind === "table") ||
      null;
  } else if (/work|study|wfh/.test(activity)) {
    matchedObject =
      roomObjects.find((o) => o.kind === "desk") ?? null;
  } else if (/watchtv|relax/.test(activity)) {
    matchedObject =
      roomObjects.find((o) => o.kind === "sofa" || o.kind === "chair") ?? null;
  }

  if (matchedObject) {
    const ox = Number(matchedObject.position?.[0] ?? matchedObject.x);
    const oz = Number(matchedObject.position?.[2] ?? matchedObject.z);
    if (Number.isFinite(ox) && Number.isFinite(oz)) {
      const pairingTable =
        matchedObject.kind === "chair"
          ? roomObjects.find((o) => o.kind === "table")
          : null;
      const pullToward = pairingTable
        ? [
            Number(pairingTable.position?.[0] ?? pairingTable.x),
            Number(pairingTable.position?.[2] ?? pairingTable.z),
          ]
        : centroid;
      targetRef = standInFrontOf(ox, oz, 0.56, pullToward);
      hasDedicatedActivityAnchor = true;
    }
  } else if (fixtures.length > 0) {
    let preferredFixture = null;
    if (/cook|breakfast|eat|kitchen/.test(activity)) {
      preferredFixture =
        fixtures.find((f) => f.kind === "sink" || f.kind === "stove") ||
        fixtures.find((f) => f.kind === "kitchen_counter");
    } else if (/bath|wash|toilet|groom/.test(activity)) {
      preferredFixture =
        fixtures.find((f) => f.kind === "sink") ||
        fixtures.find((f) => f.kind === "toilet");
    }
    if (preferredFixture && Array.isArray(preferredFixture.position)) {
      targetRef = standInFrontOf(
        preferredFixture.position[0],
        preferredFixture.position[2],
        0.85,
      );
      hasDedicatedActivityAnchor = true;
    }
  }

  const cMin = Math.max(
    0,
    Math.floor((rBounds.minX - navigation.origin[0]) / navigation.cellSize),
  );
  const cMax = Math.min(
    navigation.width - 1,
    Math.ceil((rBounds.maxX - navigation.origin[0]) / navigation.cellSize),
  );
  const rMin = Math.max(
    0,
    Math.floor((rBounds.minZ - navigation.origin[1]) / navigation.cellSize),
  );
  const rMax = Math.min(
    navigation.height - 1,
    Math.ceil((rBounds.maxZ - navigation.origin[1]) / navigation.cellSize),
  );

  const candidates = [];
  for (let row = rMin; row <= rMax; row += 1) {
    for (let col = cMin; col <= cMax; col += 1) {
      const idx = row * navigation.width + col;
      if (navigation.roomIndexGrid[idx] !== roomIdx) continue;
      if (navigation.floorGrid[idx] !== CELL_WALKABLE) continue;
      const clearance = navigation.clearanceGrid[idx];
      if (clearance < radius) continue;

      const pos = navigation.cellToWorld(col, row);
      const distToRef = Math.hypot(
        pos[0] - targetRef[0],
        pos[1] - targetRef[1],
      );
      const comfortBonus = Math.min(clearance, 0.65) * 0.55;
      const score = distToRef - comfortBonus;
      candidates.push({ pos, score, idx, col, row });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.score - b.score || a.idx - b.idx);

  // Filter out tiny isolated furniture pockets inside the room by keeping cells connected to the room's largest walkable component
  if (candidates.length > 1) {
    const inRoomSet = new Set(candidates.map((c) => c.idx));
    const visited = new Set();
    let bestComponent = null;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const cand of candidates) {
      if (visited.has(cand.idx)) continue;
      const comp = new Set([cand.idx]);
      visited.add(cand.idx);
      const queue = [cand.idx];
      while (queue.length > 0) {
        const cur = queue.pop();
        const cc = cur % navigation.width;
        const cr = (cur - cc) / navigation.width;
        for (const [dc, dr] of dirs) {
          const nc = cc + dc;
          const nr = cr + dr;
          if (!navigation.inGridBounds(nc, nr)) continue;
          const nIdx = nr * navigation.width + nc;
          // Allow stepping across CELL_DOOR thresholds inside the room bounds too
          if (visited.has(nIdx)) continue;
          if (
            inRoomSet.has(nIdx) ||
            (navigation.roomIndexGrid[nIdx] === roomIdx &&
              navigation.clearanceGrid[nIdx] >= radius)
          ) {
            visited.add(nIdx);
            comp.add(nIdx);
            queue.push(nIdx);
          }
        }
      }
      if (!bestComponent || comp.size > bestComponent.size) {
        bestComponent = comp;
      }
    }
    if (bestComponent && bestComponent.size < candidates.length) {
      const mainCandidates = candidates.filter((c) => bestComponent.has(c.idx));
      if (mainCandidates.length > 0) {
        candidates.length = 0;
        candidates.push(...mainCandidates);
      }
    }
  }

  // When an activity binds directly to dedicated movable furniture (e.g. `eat` at a dining table
  // while another occupant `cook`s at the stove), stand directly at that furniture's best spot
  // unless an already-occupied position is supplied in `occupiedPositions`.
  const occupiedPositions = Array.isArray(options.occupiedPositions)
    ? options.occupiedPositions.filter(isFinitePoint2D)
    : [];

  if (hasDedicatedActivityAnchor) {
    const nonOverlapping =
      candidates.find((cand) =>
        occupiedPositions.every(
          (occ) =>
            Math.hypot(cand.pos[0] - occ[0], cand.pos[1] - occ[1]) >=
            radius * 2.2,
        ),
      ) || candidates[0];
    return { position: nonOverlapping.pos, roomId };
  }

  if (slotIndex === 0 && occupiedPositions.length === 0) {
    return { position: candidates[0].pos, roomId };
  }

  const selected = [candidates[0].pos];
  const minRoomSpan = Math.min(rBounds.width, rBounds.depth);
  const desiredSeparation = Math.max(
    0.72,
    Math.min(2.25, minRoomSpan * 0.25),
  );
  for (let s = 1; s <= slotIndex; s += 1) {
    const next =
      candidates.find((cand) =>
        selected.every(
          (prev) =>
            Math.hypot(cand.pos[0] - prev[0], cand.pos[1] - prev[1]) >=
            desiredSeparation,
        ),
      ) ||
      candidates.find((cand) =>
        selected.every(
          (prev) =>
            Math.hypot(cand.pos[0] - prev[0], cand.pos[1] - prev[1]) >=
            radius * 2.1,
        ),
      ) ||
      candidates[Math.min(s, candidates.length - 1)];
    selected.push(next.pos);
  }

  return { position: selected[slotIndex], roomId };
}

/**
 * Resolve an exit destination near the home's primary exterior door.
 */
export function resolveExitPosition(navigation, agentRadius) {
  const radius = Number(agentRadius ?? navigation.agentRadius);
  const exteriorDoor =
    navigation.doors.find((d) => d.kind === "exterior") || navigation.doors[0];
  if (!exteriorDoor) return null;

  const [doorCol, doorRow] = navigation.worldToCell(
    exteriorDoor.position[0],
    exteriorDoor.position[1],
  );
  const searchCells = Math.ceil(1.2 / navigation.cellSize);
  let best = null;

  for (let dr = -searchCells; dr <= searchCells; dr += 1) {
    for (let dc = -searchCells; dc <= searchCells; dc += 1) {
      const col = doorCol + dc;
      const row = doorRow + dr;
      if (!navigation.isCellWalkable(col, row, radius)) continue;
      const idx = row * navigation.width + col;
      const rIdx = navigation.roomIndexGrid[idx];
      if (rIdx < 0 || navigation.rooms[rIdx].id !== exteriorDoor.roomA) {
        continue;
      }
      const pos = navigation.cellToWorld(col, row);
      const dist = Math.hypot(
        pos[0] - exteriorDoor.position[0],
        pos[1] - exteriorDoor.position[1],
      );
      if (!best || dist < best.dist) {
        best = { position: pos, roomId: exteriorDoor.roomA, dist };
      }
    }
  }

  return best ? { position: best.position, roomId: best.roomId } : null;
}
