import {
  DEFAULT_CEILING_HEIGHT,
  DEFAULT_DOOR_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  DEFAULT_WINDOW_HEAD_HEIGHT,
  DEFAULT_WINDOW_SILL_HEIGHT,
  DOOR_KINDS,
  FIXTURE_KINDS,
  HOUSE_UNITS,
  ROOM_KINDS,
  normalizeCalibrationSource,
} from "../contracts/scene.js";

const roundM = (value, decimals = 3) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return n;
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const FIXTURE_DEFAULTS = {
  toilet: { width: 0.46, depth: 0.7, height: 0.78, label: "Toilet" },
  sink: { width: 0.65, depth: 0.55, height: 0.86, label: "Sink" },
  bathtub: { width: 1.65, depth: 0.78, height: 0.58, label: "Bathtub" },
  shower: { width: 0.95, depth: 0.95, height: 2.1, label: "Shower" },
  kitchen_counter: {
    width: 0.65,
    depth: 2.2,
    height: 0.9,
    label: "Kitchen Counter",
  },
  stove: { width: 0.65, depth: 0.76, height: 0.9, label: "Stove" },
  closet: { width: 0.65, depth: 1.6, height: 2.4, label: "Built-in Closet" },
};

/**
 * Check if a value is a valid finite 2D coordinate [x, z].
 * @param {unknown} pt
 * @returns {pt is [number, number]}
 */
export function isFinitePoint2D(pt) {
  return (
    Array.isArray(pt) &&
    pt.length >= 2 &&
    typeof pt[0] === "number" &&
    typeof pt[1] === "number" &&
    Number.isFinite(pt[0]) &&
    Number.isFinite(pt[1])
  );
}

/**
 * Signed area via the Shoelace formula.
 * @param {Array<[number, number]>} polygon
 * @returns {number}
 */
export function polygonSignedArea(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (!isFinitePoint2D(a) || !isFinitePoint2D(b)) return NaN;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/**
 * Unsigned area of a 2D polygon.
 * @param {Array<[number, number]>} polygon
 * @returns {number}
 */
export function polygonArea(polygon) {
  return Math.abs(polygonSignedArea(polygon));
}

/**
 * Axis-aligned bounding box of a 2D point list.
 * @param {Array<[number, number]>} points
 */
export function polygonBounds(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return { minX: 0, minZ: 0, maxX: 0, maxZ: 0, width: 0, depth: 0 };
  }
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const pt of points) {
    if (!isFinitePoint2D(pt)) continue;
    minX = Math.min(minX, pt[0]);
    minZ = Math.min(minZ, pt[1]);
    maxX = Math.max(maxX, pt[0]);
    maxZ = Math.max(maxZ, pt[1]);
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minZ: 0, maxX: 0, maxZ: 0, width: 0, depth: 0 };
  }
  return {
    minX: roundM(minX),
    minZ: roundM(minZ),
    maxX: roundM(maxX),
    maxZ: roundM(maxZ),
    width: roundM(maxX - minX),
    depth: roundM(maxZ - minZ),
  };
}

function cross2D(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function onSegment2D(p, a, b, eps = 1e-7) {
  return (
    p[0] >= Math.min(a[0], b[0]) - eps &&
    p[0] <= Math.max(a[0], b[0]) + eps &&
    p[1] >= Math.min(a[1], b[1]) - eps &&
    p[1] <= Math.max(a[1], b[1]) + eps
  );
}

/**
 * Detect whether two non-adjacent segments intersect or overlap.
 * @param {[number, number]} a1
 * @param {[number, number]} a2
 * @param {[number, number]} b1
 * @param {[number, number]} b2
 * @returns {boolean}
 */
export function segmentsIntersect2D(a1, a2, b1, b2) {
  const eps = 1e-7;
  const d1 = cross2D(b1, b2, a1);
  const d2 = cross2D(b1, b2, a2);
  const d3 = cross2D(a1, a2, b1);
  const d4 = cross2D(a1, a2, b2);

  if (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  ) {
    return true;
  }

  if (Math.abs(d1) <= eps && onSegment2D(a1, b1, b2, eps)) return true;
  if (Math.abs(d2) <= eps && onSegment2D(a2, b1, b2, eps)) return true;
  if (Math.abs(d3) <= eps && onSegment2D(b1, a1, a2, eps)) return true;
  if (Math.abs(d4) <= eps && onSegment2D(b2, a1, a2, eps)) return true;
  return false;
}

/**
 * Detect self-intersections or folded consecutive edges in a 2D polygon.
 * @param {Array<[number, number]>} polygon
 * @returns {boolean}
 */
export function hasPolygonSelfIntersection(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  const n = polygon.length;
  for (let i = 0; i < n; i += 1) {
    const a1 = polygon[i];
    const a2 = polygon[(i + 1) % n];
    if (!isFinitePoint2D(a1) || !isFinitePoint2D(a2)) return true;
    if (Math.hypot(a2[0] - a1[0], a2[1] - a1[1]) < 1e-5) return true;

    // Check immediate fold-back (180-degree spike) on adjacent edge
    const a3 = polygon[(i + 2) % n];
    if (isFinitePoint2D(a3)) {
      const ux = a1[0] - a2[0];
      const uz = a1[1] - a2[1];
      const vx = a3[0] - a2[0];
      const vz = a3[1] - a2[1];
      const uLen = Math.hypot(ux, uz);
      const vLen = Math.hypot(vx, vz);
      if (uLen > 1e-5 && vLen > 1e-5) {
        const cross = Math.abs(ux * vz - uz * vx) / (uLen * vLen);
        const dot = (ux * vx + uz * vz) / (uLen * vLen);
        if (cross < 1e-4 && dot > 0.999) return true;
      }
    }

    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue; // adjacent wrap-around edge
      const b1 = polygon[j];
      const b2 = polygon[(j + 1) % n];
      if (!isFinitePoint2D(b1) || !isFinitePoint2D(b2)) return true;
      if (segmentsIntersect2D(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Project a 2D point onto a line segment and return nearest point + distance.
 * @param {[number, number]} pt
 * @param {[number, number]} segStart
 * @param {[number, number]} segEnd
 */
export function projectPointOnSegment(pt, segStart, segEnd) {
  const dx = segEnd[0] - segStart[0];
  const dz = segEnd[1] - segStart[1];
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-9) {
    return {
      point: [segStart[0], segStart[1]],
      t: 0,
      distance: Math.hypot(pt[0] - segStart[0], pt[1] - segStart[1]),
    };
  }
  const t = clamp(
    ((pt[0] - segStart[0]) * dx + (pt[1] - segStart[1]) * dz) / lenSq,
    0,
    1,
  );
  const projX = segStart[0] + t * dx;
  const projZ = segStart[1] + t * dz;
  return {
    point: [roundM(projX), roundM(projZ)],
    t,
    distance: Math.hypot(pt[0] - projX, pt[1] - projZ),
  };
}

/**
 * Minimum distance from a 2D point to a segment.
 */
export function pointToSegmentDistance(pt, segStart, segEnd) {
  return projectPointOnSegment(pt, segStart, segEnd).distance;
}

/**
 * Ray-casting point-in-polygon check (inclusive of boundary within tolerance).
 * @param {[number, number]} pt
 * @param {Array<[number, number]>} polygon
 * @returns {boolean}
 */
export function pointInPolygon(pt, polygon) {
  if (!isFinitePoint2D(pt) || !Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (isFinitePoint2D(a) && isFinitePoint2D(b)) {
      if (pointToSegmentDistance(pt, a, b) <= 0.05) return true;
    }
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

export function slugifyId(value, fallback = "item") {
  const cleaned = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

export function inferRoomKind(nameOrKind) {
  const raw = String(nameOrKind ?? "").trim().toLowerCase();
  if (ROOM_KINDS.includes(raw)) return raw;
  if (/living|lounge|family|great/.test(raw)) return "living";
  if (/kitchen|pantry|kitchenette/.test(raw)) return "kitchen";
  if (/bed|master|guest|nursery/.test(raw)) return "bedroom";
  if (/bath|powder|restroom|wc|lavatory|ensuite/.test(raw)) return "bathroom";
  if (/hall|corridor|entry|foyer|vestibule|passage/.test(raw)) return "hallway";
  if (/dining|breakfast/.test(raw)) return "dining";
  if (/office|study|den|work/.test(raw)) return "office";
  if (/closet|wardrobe|storage|laundry|utility/.test(raw)) return "closet";
  return "other";
}

export function normalizeFixtureKind(rawKind) {
  const raw = String(rawKind ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (FIXTURE_KINDS.includes(raw)) return raw;
  if (/toilet|wc|commode/.test(raw)) return "toilet";
  if (/sink|vanity|basin/.test(raw)) return "sink";
  if (/tub|bath/.test(raw)) return "bathtub";
  if (/shower/.test(raw)) return "shower";
  if (/counter|island|cabinet/.test(raw)) return "kitchen_counter";
  if (/stove|range|cooktop|oven/.test(raw)) return "stove";
  if (/closet|wardrobe/.test(raw)) return "closet";
  return "kitchen_counter";
}

export function normalizeDoorKind(rawKind, roomB) {
  const raw = String(rawKind ?? "").trim().toLowerCase();
  if (DOOR_KINDS.includes(raw)) return raw;
  if (/exterior|entry|front|entrance|outside|balcony|patio/.test(raw)) {
    return "exterior";
  }
  if (/unknown|opening|arch|cased|pass/.test(raw)) {
    return "unknown_opening";
  }
  if (/interior|internal|room/.test(raw)) {
    return "interior";
  }
  return roomB ? "interior" : "exterior";
}

function canonicalSegmentKey(p1, p2) {
  const snapCoord = (v) => Math.round(v * 20) / 20; // 5 cm tolerance for shared walls
  const a = [snapCoord(p1[0]), snapCoord(p1[1])];
  const b = [snapCoord(p2[0]), snapCoord(p2[1])];
  const forward = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
  const first = forward ? a : b;
  const second = forward ? b : a;
  return `${first[0].toFixed(2)},${first[1].toFixed(2)}->${second[0].toFixed(2)},${second[1].toFixed(2)}`;
}

/**
 * Split collinear polygon edges at T-junction vertices of neighboring rooms so
 * shared interior wall segments align cleanly even when rooms have different spans.
 */
function splitPolygonEdgesAtVertices(polygon, allVertices) {
  const segments = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    if (!isFinitePoint2D(start) || !isFinitePoint2D(end)) continue;
    const edgeLen = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (edgeLen < 0.05) continue;

    const splits = [0, 1];
    for (const v of allVertices) {
      if (!isFinitePoint2D(v)) continue;
      const proj = projectPointOnSegment(v, start, end);
      if (proj.distance <= 0.04 && proj.t > 0.01 && proj.t < 0.99) {
        splits.push(proj.t);
      }
    }
    splits.sort((a, b) => a - b);
    const uniqueT = splits.filter(
      (t, idx) => idx === 0 || t - splits[idx - 1] > 0.01,
    );
    for (let k = 0; k < uniqueT.length - 1; k += 1) {
      const t0 = uniqueT[k];
      const t1 = uniqueT[k + 1];
      const s = [
        roundM(start[0] + t0 * (end[0] - start[0])),
        roundM(start[1] + t0 * (end[1] - start[1])),
      ];
      const e = [
        roundM(start[0] + t1 * (end[0] - start[0])),
        roundM(start[1] + t1 * (end[1] - start[1])),
      ];
      if (Math.hypot(e[0] - s[0], e[1] - s[1]) >= 0.05) {
        segments.push([s, e]);
      }
    }
  }
  return segments;
}

/**
 * Derive deduplicated exterior and interior walls from room polygons,
 * preserving explicit walls when valid.
 */
export function deriveWallsFromRooms(
  rooms,
  explicitWalls = [],
  ceilingHeight = DEFAULT_CEILING_HEIGHT,
) {
  if (Array.isArray(explicitWalls) && explicitWalls.length > 0) {
    return explicitWalls.map((wall, idx) => ({
      id: wall.id || `wall-${idx + 1}`,
      start: [roundM(wall.start[0]), roundM(wall.start[1])],
      end: [roundM(wall.end[0]), roundM(wall.end[1])],
      thickness: roundM(wall.thickness ?? DEFAULT_WALL_THICKNESS),
      height: roundM(wall.height ?? ceilingHeight),
      kind: wall.kind === "interior" ? "interior" : "exterior",
      roomIds: Array.isArray(wall.roomIds) ? [...wall.roomIds] : [],
      locked: true,
      confidence: roundM(clamp(Number(wall.confidence ?? 0.9), 0, 1), 2),
    }));
  }

  const allVertices = rooms.flatMap((r) =>
    Array.isArray(r.polygon) ? r.polygon : [],
  );
  const wallMap = new Map();

  for (const room of rooms) {
    if (!Array.isArray(room.polygon) || room.polygon.length < 3) continue;
    const subSegments = splitPolygonEdgesAtVertices(room.polygon, allVertices);
    for (const [start, end] of subSegments) {
      const key = canonicalSegmentKey(start, end);
      if (!wallMap.has(key)) {
        wallMap.set(key, {
          start,
          end,
          roomIds: [room.id],
          confidenceSum: Number(room.confidence ?? 0.88),
          count: 1,
        });
      } else {
        const entry = wallMap.get(key);
        if (!entry.roomIds.includes(room.id)) {
          entry.roomIds.push(room.id);
        }
        entry.confidenceSum += Number(room.confidence ?? 0.88);
        entry.count += 1;
      }
    }
  }

  let wallIndex = 1;
  const walls = [];
  for (const entry of wallMap.values()) {
    const isInterior = entry.roomIds.length > 1;
    walls.push({
      id: `wall-${wallIndex++}`,
      start: entry.start,
      end: entry.end,
      thickness: isInterior ? 0.12 : DEFAULT_WALL_THICKNESS,
      height: roundM(ceilingHeight),
      kind: isInterior ? "interior" : "exterior",
      roomIds: entry.roomIds,
      locked: true,
      confidence: roundM(
        clamp(entry.confidenceSum / Math.max(1, entry.count), 0, 1),
        2,
      ),
    });
  }
  return walls;
}

/**
 * Find the nearest wall segment to a 2D point.
 */
export function findNearestWall(pt, walls) {
  if (!isFinitePoint2D(pt) || !Array.isArray(walls) || walls.length === 0) {
    return null;
  }
  let best = null;
  for (const wall of walls) {
    if (!isFinitePoint2D(wall.start) || !isFinitePoint2D(wall.end)) continue;
    const proj = projectPointOnSegment(pt, wall.start, wall.end);
    if (!best || proj.distance < best.distance) {
      best = {
        wall,
        point: proj.point,
        distance: proj.distance,
        t: proj.t,
      };
    }
  }
  return best;
}

/**
 * Generate room connectivity graph from validated doors.
 * @param {Array<object>} rooms
 * @param {Array<object>} doors
 */
export function buildRoomAdjacencyGraph(rooms, doors) {
  const validRoomIds = new Set(
    (Array.isArray(rooms) ? rooms : []).map((r) => r?.id).filter(Boolean),
  );
  const edges = [];
  for (const door of Array.isArray(doors) ? doors : []) {
    if (!door?.id || !door.roomA || !door.roomB) continue;
    if (door.roomA === door.roomB) continue;
    if (!validRoomIds.has(door.roomA) || !validRoomIds.has(door.roomB)) continue;
    edges.push({
      fromRoomId: door.roomA,
      toRoomId: door.roomB,
      viaDoorId: door.id,
      doorKind: door.kind ?? "interior",
    });
  }
  return edges;
}

function rectangleFootprint(centerX, centerZ, width, depth, yawRadians = 0) {
  const hw = width / 2;
  const hd = depth / 2;
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  const local = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return local.map(([lx, lz]) => [
    roundM(centerX + lx * cos - lz * sin),
    roundM(centerZ + lx * sin + lz * cos),
  ]);
}

/**
 * Normalize a raw candidate (pixel-space or meter-space) into canonical House JSON.
 *
 * When `calibration.source === "unknown"`, coordinates are scaled using a provisional
 * display factor ONLY so polygon shapes can be inspected visually, while
 * `calibration.metersPerPixel` remains `null` and `calibration.source` remains `"unknown"`,
 * ensuring `validateHouseGeometry` blocks confirmation until calibrated.
 *
 * @param {object} rawCandidate
 * @param {object} [options]
 * @param {object} [options.calibration]
 * @param {string[]} [options.extraWarnings]
 * @returns {object}
 */
export function normalizeHouseGeometry(rawCandidate = {}, options = {}) {
  const alreadyMeters =
    rawCandidate.units === HOUSE_UNITS &&
    !rawCandidate.coordinateSpace?.includes("pixel") &&
    Array.isArray(rawCandidate.rooms) &&
    rawCandidate.rooms.every((r) => !r.polygonPx);

  const rawCalibration = options.calibration ?? rawCandidate.calibration ?? {};
  const source = normalizeCalibrationSource(rawCalibration.source);
  const hasRealScale =
    source !== "unknown" &&
    Number.isFinite(Number(rawCalibration.metersPerPixel)) &&
    Number(rawCalibration.metersPerPixel) > 0;

  // Provisional factor used strictly to preserve relative geometry when scale is unknown
  const provisionalFactor = 0.01;
  const scaleFactor = alreadyMeters
    ? 1
    : hasRealScale
      ? Number(rawCalibration.metersPerPixel)
      : provisionalFactor;

  const ceilingHeight = roundM(
    clamp(
      Number(rawCandidate.ceilingHeight ?? DEFAULT_CEILING_HEIGHT) ||
        DEFAULT_CEILING_HEIGHT,
      2.1,
      6.0,
    ),
  );

  // Collect raw rooms and compute shift so house top-left origin sits at [0, 0]
  const rawRooms = Array.isArray(rawCandidate.rooms) ? rawCandidate.rooms : [];
  const scaledRoomPolygons = rawRooms.map((room) => {
    const srcPoly = Array.isArray(room?.polygonPx)
      ? room.polygonPx
      : Array.isArray(room?.polygon)
        ? room.polygon
        : [];
    return srcPoly.map((pt) =>
      Array.isArray(pt) && pt.length >= 2
        ? [Number(pt[0]) * scaleFactor, Number(pt[1]) * scaleFactor]
        : [NaN, NaN],
    );
  });

  let originX = Infinity;
  let originZ = Infinity;
  for (const poly of scaledRoomPolygons) {
    for (const pt of poly) {
      if (isFinitePoint2D(pt)) {
        originX = Math.min(originX, pt[0]);
        originZ = Math.min(originZ, pt[1]);
      }
    }
  }
  if (!Number.isFinite(originX)) originX = 0;
  if (!Number.isFinite(originZ)) originZ = 0;

  const toWorld2D = (pt) => {
    if (!Array.isArray(pt) || pt.length < 2) return [NaN, NaN];
    return [
      roundM(Number(pt[0]) * scaleFactor - originX),
      roundM(Number(pt[1]) * scaleFactor - originZ),
    ];
  };

  const rooms = rawRooms.map((room, index) => {
    const polygon = scaledRoomPolygons[index].map((pt) =>
      isFinitePoint2D(pt)
        ? [roundM(pt[0] - originX), roundM(pt[1] - originZ)]
        : [NaN, NaN],
    );
    const name = String(room?.name || `Room ${index + 1}`).trim();
    const id =
      room?.id !== undefined && room?.id !== null
        ? String(room.id).trim()
        : slugifyId(name, `room-${index + 1}`);
    const area = polygonArea(polygon);
    return {
      id,
      name,
      kind: inferRoomKind(room?.kind || name),
      polygon,
      areaSqMeters: Number.isFinite(area) ? roundM(area, 2) : 0,
      confidence: roundM(clamp(Number(room?.confidence ?? 0.85), 0, 1), 2),
    };
  });

  const explicitWalls =
    Array.isArray(rawCandidate.walls) && rawCandidate.walls.length > 0
      ? rawCandidate.walls
          .filter((w) => (w?.startPx || w?.start) && (w?.endPx || w?.end))
          .map((w, idx) => ({
            id: w.id || `wall-${idx + 1}`,
            start: toWorld2D(w.startPx ?? w.start),
            end: toWorld2D(w.endPx ?? w.end),
            thickness: w.thickness ?? DEFAULT_WALL_THICKNESS,
            height: w.height ?? ceilingHeight,
            kind: w.kind,
            roomIds: w.roomIds,
            confidence: w.confidence,
          }))
      : [];

  const walls = deriveWallsFromRooms(rooms, explicitWalls, ceilingHeight);

  const rawDoors = Array.isArray(rawCandidate.doors) ? rawCandidate.doors : [];
  const doors = rawDoors.map((door, index) => {
    const rawPos = door?.positionPx ?? door?.position;
    let position = toWorld2D(rawPos);
    const nearest = findNearestWall(position, walls);
    const wallId =
      door?.wallId && walls.some((w) => w.id === door.wallId)
        ? door.wallId
        : nearest && nearest.distance <= 0.35
          ? nearest.wall.id
          : (door?.wallId ?? null);

    if (nearest && nearest.distance <= 0.22) {
      position = nearest.point;
    }

    let width = null;
    let widthEstimated = Boolean(door?.widthEstimated);
    if (door?.width != null && alreadyMeters) {
      width = roundM(Number(door.width));
    } else if (door?.widthMeters != null) {
      width = roundM(Number(door.widthMeters));
    } else if (door?.widthPx != null && hasRealScale) {
      width = roundM(Number(door.widthPx) * scaleFactor);
    } else if (door?.width != null && hasRealScale) {
      width = roundM(Number(door.width));
    } else if (door?.estimatedWidthMeters != null) {
      width = roundM(Number(door.estimatedWidthMeters));
      widthEstimated = true;
    }

    const roomA = door?.roomA ? String(door.roomA).trim() : null;
    const roomB = door?.roomB ? String(door.roomB).trim() : null;
    const kind = normalizeDoorKind(door?.kind, roomB);

    return {
      id: door?.id ? String(door.id).trim() : `door-${index + 1}`,
      kind,
      wallId,
      roomA,
      roomB: kind === "exterior" ? null : roomB,
      position,
      width,
      widthEstimated,
      height: roundM(Number(door?.height ?? DEFAULT_DOOR_HEIGHT)),
      confidence: roundM(clamp(Number(door?.confidence ?? 0.84), 0, 1), 2),
    };
  });

  const rawWindows = Array.isArray(rawCandidate.windows)
    ? rawCandidate.windows
    : [];
  const windows = rawWindows.map((win, index) => {
    const rawPos = win?.positionPx ?? win?.position;
    let position = toWorld2D(rawPos);
    const nearest = findNearestWall(position, walls);
    let wallId = win?.wallId ?? null;
    if (!wallId && nearest && nearest.distance <= 0.3) {
      wallId = nearest.wall.id;
    }
    if (nearest && nearest.distance <= 0.18) {
      position = nearest.point;
    }

    let width = 1.2;
    if (win?.width != null && alreadyMeters) {
      width = roundM(Number(win.width));
    } else if (win?.widthMeters != null) {
      width = roundM(Number(win.widthMeters));
    } else if (win?.widthPx != null && hasRealScale) {
      width = roundM(Number(win.widthPx) * scaleFactor);
    } else if (win?.width != null) {
      width = roundM(Number(win.width));
    }

    let roomId = win?.roomId ? String(win.roomId).trim() : null;
    if (!roomId && nearest?.wall?.roomIds?.length) {
      roomId = nearest.wall.roomIds[0];
    }

    return {
      id: win?.id ? String(win.id).trim() : `window-${index + 1}`,
      type: "window",
      wallId,
      roomId,
      position,
      width: clamp(width || 1.2, 0.3, 8.0),
      sillHeight: roundM(Number(win?.sillHeight ?? DEFAULT_WINDOW_SILL_HEIGHT)),
      headHeight: roundM(Number(win?.headHeight ?? DEFAULT_WINDOW_HEAD_HEIGHT)),
      confidence: roundM(clamp(Number(win?.confidence ?? 0.8), 0, 1), 2),
    };
  });

  const rawFixtures = Array.isArray(rawCandidate.fixtures)
    ? rawCandidate.fixtures
    : [];
  const fixtures = rawFixtures.map((fix, index) => {
    const kind = normalizeFixtureKind(fix?.kind);
    const defaults = FIXTURE_DEFAULTS[kind] ?? FIXTURE_DEFAULTS.kitchen_counter;

    let center2D;
    if (Array.isArray(fix?.position) && fix.position.length === 3 && alreadyMeters) {
      center2D = [
        roundM(Number(fix.position[0]) - originX),
        roundM(Number(fix.position[2]) - originZ),
      ];
    } else {
      center2D = toWorld2D(fix?.positionPx ?? fix?.centerPx ?? fix?.position ?? [0, 0]);
    }

    const width = roundM(
      alreadyMeters && fix?.dimensions?.width
        ? Number(fix.dimensions.width)
        : fix?.widthPx != null
          ? Number(fix.widthPx) * scaleFactor
          : Number(fix?.dimensions?.width ?? fix?.width ?? defaults.width),
    );
    const depth = roundM(
      alreadyMeters && fix?.dimensions?.depth
        ? Number(fix.dimensions.depth)
        : fix?.depthPx != null
          ? Number(fix.depthPx) * scaleFactor
          : Number(fix?.dimensions?.depth ?? fix?.depth ?? defaults.depth),
    );
    const height = roundM(
      Number(fix?.dimensions?.height ?? fix?.height ?? defaults.height),
    );
    const yaw = Number(
      Array.isArray(fix?.rotation) ? fix.rotation[1] : (fix?.yawRadians ?? 0),
    ) || 0;

    let roomId = fix?.roomId ? String(fix.roomId).trim() : null;
    if (!roomId) {
      const containing = rooms.find((r) => pointInPolygon(center2D, r.polygon));
      roomId = containing?.id ?? null;
    }

    const footprint =
      Array.isArray(fix?.footprint) && fix.footprint.length >= 3 && alreadyMeters
        ? fix.footprint.map((pt) => [
            roundM(Number(pt[0]) - originX),
            roundM(Number(pt[1]) - originZ),
          ])
        : Array.isArray(fix?.footprintPx) && fix.footprintPx.length >= 3
          ? fix.footprintPx.map(toWorld2D)
          : rectangleFootprint(center2D[0], center2D[1], width, depth, yaw);

    return {
      id: fix?.id ? String(fix.id).trim() : `fixture-${kind}-${index + 1}`,
      kind,
      type: "fixed",
      name: String(fix?.name || defaults.label).trim(),
      roomId,
      position: [center2D[0], 0, center2D[1]],
      rotation: [0, roundM(yaw, 4), 0],
      dimensions: { width, height, depth },
      footprint,
      locked: true,
      confidence: roundM(clamp(Number(fix?.confidence ?? 0.86), 0, 1), 2),
    };
  });

  const allPoints = rooms.flatMap((r) => r.polygon);
  const bounds = polygonBounds(allPoints);
  const adjacency = buildRoomAdjacencyGraph(rooms, doors);

  const warningSet = new Set([
    ...(Array.isArray(rawCandidate.warnings) ? rawCandidate.warnings : []),
    ...(Array.isArray(options.extraWarnings) ? options.extraWarnings : []),
  ]);
  if (!hasRealScale && !alreadyMeters) {
    warningSet.add("No printed scale detected; manual calibration required.");
  }

  const confidences = [
    ...rooms.map((r) => r.confidence),
    ...doors.map((d) => d.confidence),
    ...windows.map((w) => w.confidence),
    ...fixtures.map((f) => f.confidence),
  ].filter(Number.isFinite);

  const overallConfidence =
    rawCandidate.confidence != null
      ? roundM(clamp(Number(rawCandidate.confidence), 0, 1), 2)
      : confidences.length
        ? roundM(
            confidences.reduce((sum, c) => sum + c, 0) / confidences.length,
            2,
          )
        : 0.75;

  const houseId = String(
    rawCandidate.id || rawCandidate.houseId || "imported-house-001",
  ).trim();

  return {
    id: houseId,
    houseId,
    name: String(rawCandidate.name || "Imported Floorplan Home").trim(),
    units: HOUSE_UNITS,
    ceilingHeight,
    bounds,
    calibration: hasRealScale
      ? {
          source,
          knownDistanceMeters:
            rawCalibration.knownDistanceMeters != null
              ? Number(rawCalibration.knownDistanceMeters)
              : null,
          pixelDistance:
            rawCalibration.pixelDistance != null
              ? Number(rawCalibration.pixelDistance)
              : null,
          metersPerPixel: Number(rawCalibration.metersPerPixel),
          ...(rawCalibration.pointA ? { pointA: rawCalibration.pointA } : {}),
          ...(rawCalibration.pointB ? { pointB: rawCalibration.pointB } : {}),
        }
      : alreadyMeters && source !== "unknown"
        ? {
            source,
            knownDistanceMeters: rawCalibration.knownDistanceMeters ?? null,
            pixelDistance: rawCalibration.pixelDistance ?? null,
            metersPerPixel: rawCalibration.metersPerPixel ?? 1,
          }
        : {
            source: "unknown",
            knownDistanceMeters: null,
            pixelDistance: null,
            metersPerPixel: null,
          },
    confidence: overallConfidence,
    warnings: [...warningSet].filter(Boolean),
    rooms,
    walls,
    doors,
    windows,
    adjacency,
    fixtures,
    objects: Array.isArray(rawCandidate.objects)
      ? structuredClone(rawCandidate.objects)
      : [],
    environment:
      rawCandidate.environment && typeof rawCandidate.environment === "object"
        ? structuredClone(rawCandidate.environment)
        : {},
  };
}

/**
 * Project the primary habitable room of a validated House JSON into Stillroom's
 * existing single-room `state.room` structure so existing single-room views stay
 * functional before `feat/whole-home-scene` merges.
 *
 * @param {object} house
 */
export function houseToPrimaryStudioRoom(house) {
  const rooms = Array.isArray(house?.rooms) ? house.rooms : [];
  const preferred =
    rooms.find((r) => r.kind === "living") ||
    [...rooms].sort((a, b) => (b.areaSqMeters ?? 0) - (a.areaSqMeters ?? 0))[0];

  if (!preferred) {
    return {
      width: 5.4,
      depth: 4.2,
      height: clamp(Number(house?.ceilingHeight) || 2.7, 2.1, 4.5),
      shape: "rectangle",
      openings: [
        { kind: "window", wall: "back", offset: 0.5 },
        { kind: "door", wall: "front", offset: 0.2 },
      ],
      floorFinish: "oak",
      wallColor: "#eee7dc",
    };
  }

  const box = polygonBounds(preferred.polygon);
  const width = roundM(clamp(box.width || 5.4, 3, 9), 1);
  const depth = roundM(clamp(box.depth || 4.2, 3, 9), 1);
  const height = roundM(clamp(Number(house?.ceilingHeight) || 2.7, 2.1, 4.5), 2);

  const openings = [];
  const classifyWallSide = (pt) => {
    const dBack = Math.abs(pt[1] - box.minZ);
    const dFront = Math.abs(pt[1] - box.maxZ);
    const dLeft = Math.abs(pt[0] - box.minX);
    const dRight = Math.abs(pt[0] - box.maxX);
    const min = Math.min(dBack, dFront, dLeft, dRight);
    if (min === dBack) {
      return {
        wall: "back",
        offset: clamp((pt[0] - box.minX) / Math.max(0.5, box.width), 0.12, 0.88),
      };
    }
    if (min === dFront) {
      return {
        wall: "front",
        offset: clamp((pt[0] - box.minX) / Math.max(0.5, box.width), 0.12, 0.88),
      };
    }
    if (min === dLeft) {
      return {
        wall: "left",
        offset: clamp((pt[1] - box.minZ) / Math.max(0.5, box.depth), 0.12, 0.88),
      };
    }
    return {
      wall: "right",
      offset: clamp((pt[1] - box.minZ) / Math.max(0.5, box.depth), 0.12, 0.88),
    };
  };

  for (const win of house?.windows ?? []) {
    if (win.roomId === preferred.id && isFinitePoint2D(win.position)) {
      const side = classifyWallSide(win.position);
      openings.push({ kind: "window", ...side });
    }
  }
  for (const door of house?.doors ?? []) {
    if (
      (door.roomA === preferred.id || door.roomB === preferred.id) &&
      isFinitePoint2D(door.position)
    ) {
      const side = classifyWallSide(door.position);
      openings.push({ kind: "door", ...side });
    }
  }

  // Ensure openings on the same wall do not conflict in legacy single-room preview
  const deduplicatedOpenings = [];
  for (const candidate of openings) {
    const clash = deduplicatedOpenings.some(
      (existing) =>
        existing.wall === candidate.wall &&
        Math.abs(existing.offset - candidate.offset) < 0.34,
    );
    if (!clash) deduplicatedOpenings.push(candidate);
  }

  return {
    width,
    depth,
    height,
    shape: "rectangle",
    openings:
      deduplicatedOpenings.length > 0
        ? deduplicatedOpenings.slice(0, 4)
        : [{ kind: "door", wall: "front", offset: 0.2 }],
    floorFinish: "oak",
    wallColor: "#eee7dc",
  };
}
