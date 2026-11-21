import {
  deriveWallsFromRooms,
  isFinitePoint2D,
  pointInPolygon,
  pointToSegmentDistance,
  polygonBounds,
  projectPointOnSegment,
} from "../../spatial/floorplan-geometry.js";

const round3 = (n) => Math.round(n * 1000) / 1000;

const DEFAULT_ENTITY_HEIGHTS = {
  rug: 0.03,
  table: 0.42,
  bathtub: 0.58,
  desk: 0.75,
  toilet: 0.78,
  chair: 0.83,
  sofa: 0.86,
  sink: 0.86,
  bed: 0.88,
  stove: 0.9,
  kitchen_counter: 0.9,
  console: 0.82,
  tv: 1.15,
  plant: 1.45,
  lamp: 1.5,
  bookcase: 1.75,
  shower: 2.1,
  closet: 2.4,
  partition: 2.0,
};

function orientedRectPolygon(cx, cz, width, depth, yawRadians = 0) {
  const hw = Math.max(0.02, Number(width) || 0.5) / 2;
  const hd = Math.max(0.02, Number(depth) || 0.5) / 2;
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([lx, lz]) => [
    round3(cx + lx * cos - lz * sin),
    round3(cz + lx * sin + lz * cos),
  ]);
}

export function classifySemanticType(raw) {
  const primary = String(
    raw?.semanticType ?? raw?.kind ?? raw?.category ?? "",
  )
    .trim()
    .toLowerCase();
  const label = String(raw?.name ?? "").trim().toLowerCase();

  const matchToken = (token) => {
    if (!token) return null;
    if (/^(?:tv|television|smart[_\s-]?tv|flatscreen|screen)$/.test(token)) {
      return "tv";
    }
    if (/^(?:bed|mattress|bunk)$/.test(token)) return "bed";
    if (/^(?:toilet|wc|commode)$/.test(token)) return "toilet";
    if (/^(?:shower|shower[_\s-]?stall)$/.test(token)) return "shower";
    if (/^(?:bathtub|tub|bath)$/.test(token)) return "bathtub";
    if (/^(?:sink|vanity|basin)$/.test(token)) return "sink";
    if (/^(?:desk|workstation)$/.test(token)) return "desk";
    if (/^(?:sofa|couch|sectional)$/.test(token)) return "sofa";
    if (/^(?:chair|armchair|recliner|lounge[_\s-]?chair)$/.test(token)) {
      return "chair";
    }
    if (/^(?:speaker|soundbar|stereo)$/.test(token)) return "speaker";
    if (/^(?:stove|range|cooktop|oven)$/.test(token)) return "stove";
    if (/^(?:kitchen_counter|counter|island)$/.test(token)) {
      return "kitchen_counter";
    }
    if (/^(?:bookcase|bookshelf|shelf|shelving)$/.test(token)) {
      return "bookcase";
    }
    if (/^(?:closet|wardrobe|armoire)$/.test(token)) return "closet";
    if (/^(?:partition|divider|pillar|column|screen_wall)$/.test(token)) {
      return "partition";
    }
    if (/^(?:table|coffee[_\s-]?table|dining[_\s-]?table)$/.test(token)) {
      return "table";
    }
    if (/^(?:console|cabinet|sideboard|media[_\s-]?console)$/.test(token)) {
      return "console";
    }
    if (/^(?:rug|carpet)$/.test(token)) return "rug";
    if (/^(?:lamp|floor[_\s-]?lamp)$/.test(token)) return "lamp";
    if (/^(?:plant|tree)$/.test(token)) return "plant";
    return null;
  };

  const fromPrimary = matchToken(primary);
  if (fromPrimary) return fromPrimary;

  // Fallback to structured word scan on name when kind is generic (e.g. "shopify" / "existing")
  if (/\b(?:tv|television)\b/.test(label)) return "tv";
  if (/\b(?:bed|mattress)\b/.test(label)) return "bed";
  if (/\b(?:toilet|commode)\b/.test(label)) return "toilet";
  if (/\bshower\b/.test(label)) return "shower";
  if (/\b(?:bathtub|tub)\b/.test(label)) return "bathtub";
  if (/\b(?:desk|workstation)\b/.test(label)) return "desk";
  if (/\b(?:sofa|couch|sectional)\b/.test(label)) return "sofa";
  if (/\b(?:armchair|lounge chair|chair)\b/.test(label)) return "chair";
  if (/\b(?:speaker|soundbar)\b/.test(label)) return "speaker";
  if (/\b(?:bookcase|bookshelf|divider|partition)\b/.test(label)) {
    return "bookcase";
  }
  if (/\b(?:closet|wardrobe)\b/.test(label)) return "closet";
  if (/\b(?:rug|carpet)\b/.test(label)) return "rug";
  if (/\btable\b/.test(label)) return "table";

  return primary || "object";
}

function normalizeUnit2D(vec) {
  if (!isFinitePoint2D(vec)) return null;
  const len = Math.hypot(vec[0], vec[1]);
  if (len < 1e-6) return null;
  return [vec[0] / len, vec[1] / len];
}

function inferInwardRoomFacing(center, room) {
  if (!room || !Array.isArray(room.polygon) || room.polygon.length < 3) {
    return [0, 1];
  }
  const b = polygonBounds(room.polygon);
  const roomCenter = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  const dx = roomCenter[0] - center[0];
  const dz = roomCenter[1] - center[1];
  const len = Math.hypot(dx, dz);
  return len > 1e-5 ? [dx / len, dz / len] : [0, 1];
}

/**
 * Extract unified semantic entities across `house.fixtures`, `house.objects`,
 * and optional legacy `house.items`.
 */
export function listSemanticEntities(house) {
  if (!house || typeof house !== "object") return [];
  const rooms = Array.isArray(house.rooms) ? house.rooms : [];
  const entities = [];

  const findContainingRoom = (pt, explicitRoomId) => {
    if (explicitRoomId && rooms.some((r) => r.id === explicitRoomId)) {
      return rooms.find((r) => r.id === explicitRoomId);
    }
    return rooms.find((r) => pointInPolygon(pt, r.polygon)) ?? null;
  };

  const addRecord = (raw, sourceCollection, defaultDegRotation = false) => {
    if (!raw || typeof raw !== "object") return;
    let cx = NaN;
    let cz = NaN;

    if (Array.isArray(raw.position)) {
      cx = Number(raw.position[0]);
      cz =
        raw.position.length >= 3
          ? Number(raw.position[2])
          : Number(raw.position[1]);
    } else if (Number.isFinite(raw.x) && Number.isFinite(raw.z)) {
      cx = Number(raw.x);
      cz = Number(raw.z);
    } else if (Array.isArray(raw.footprint) && raw.footprint.length >= 3) {
      const b = polygonBounds(raw.footprint);
      cx = (b.minX + b.maxX) / 2;
      cz = (b.minZ + b.maxZ) / 2;
    }
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) return;

    const semanticType = classifySemanticType(raw);
    const width = Number(raw.dimensions?.width ?? raw.width ?? 0.7);
    const depth = Number(raw.dimensions?.depth ?? raw.depth ?? 0.7);
    const fallbackHeight = DEFAULT_ENTITY_HEIGHTS[semanticType] ?? 1.4;
    const height = Number(
      raw.dimensions?.height ?? raw.height ?? fallbackHeight,
    );

    const hasExplicitRotation = raw.rotation != null || raw.rotationRadians != null;
    let yawRadians = 0;
    if (Array.isArray(raw.rotation)) {
      yawRadians = Number(raw.rotation[1]) || 0;
    } else if (Array.isArray(raw.rotationRadians)) {
      yawRadians = Number(raw.rotationRadians[1]) || 0;
    } else if (typeof raw.rotation === "number") {
      yawRadians = defaultDegRotation
        ? (raw.rotation * Math.PI) / 180
        : Math.abs(raw.rotation) > Math.PI * 2 + 0.01
          ? (raw.rotation * Math.PI) / 180
          : raw.rotation;
    }

    const room = findContainingRoom([cx, cz], raw.roomId);
    const explicitFacing = normalizeUnit2D(raw.facing);
    const hasExplicitOrientation = Boolean(
      explicitFacing || hasExplicitRotation,
    );
    const facing = explicitFacing
      ? explicitFacing
      : hasExplicitRotation
        ? [Math.sin(yawRadians), Math.cos(yawRadians)]
        : inferInwardRoomFacing([cx, cz], room);

    const polygon =
      Array.isArray(raw.footprint) &&
      raw.footprint.length >= 3 &&
      raw.footprint.every(isFinitePoint2D)
        ? raw.footprint
        : orientedRectPolygon(cx, cz, width, depth, yawRadians);

    entities.push({
      id: String(raw.id || `${semanticType}-${entities.length + 1}`),
      semanticType,
      kind: raw.kind ?? semanticType,
      name: String(raw.name || semanticType),
      roomId: room?.id ?? raw.roomId ?? null,
      center: [round3(cx), round3(cz)],
      yawRadians: round3(yawRadians),
      facing: [round3(facing[0]), round3(facing[1])],
      hasExplicitOrientation,
      dimensions: { width, height, depth },
      ...(semanticType === "tv" ? {
        modeledTvWidthMeters: !raw.widthDefaulted && Number(raw.dimensions?.width ?? raw.width) > 0 && Number.isFinite(width) ? width : null,
      } : {}),
      blocksSightline: raw.blocksSightline ?? null,
      passable: Boolean(raw.passable || semanticType === "rug"),
      polygon,
      sourceCollection,
    });
  };

  for (const fix of Array.isArray(house.fixtures) ? house.fixtures : []) {
    addRecord(fix, "fixtures", false);
  }
  for (const obj of Array.isArray(house.objects) ? house.objects : []) {
    addRecord(obj, "objects", false);
  }
  for (const item of Array.isArray(house.items) ? house.items : []) {
    addRecord(item, "items", true);
  }

  return entities;
}

function subtractDoorIntervals(wallLength, cutouts) {
  if (!cutouts.length) return [[0, wallLength]];
  const clamped = cutouts
    .map(([a, b]) => [Math.max(0, a), Math.min(wallLength, b)])
    .filter(([a, b]) => b - a > 1e-3)
    .sort((x, y) => x[0] - y[0]);

  const merged = [];
  for (const seg of clamped) {
    const prev = merged.at(-1);
    if (!prev || seg[0] > prev[1] + 1e-4) merged.push([...seg]);
    else prev[1] = Math.max(prev[1], seg[1]);
  }

  const parts = [];
  let cursor = 0;
  for (const [s0, s1] of merged) {
    if (s0 - cursor > 0.015) parts.push([cursor, s0]);
    cursor = Math.max(cursor, s1);
  }
  if (wallLength - cursor > 0.015) parts.push([cursor, wallLength]);
  return parts;
}

/**
 * Extract opaque wall segments with open doorways carved out.
 * Closed or blocked doors remain opaque.
 */
export function buildOpaqueWallSegments(house, options = {}) {
  const carveWindows = Boolean(options.carveWindows);
  const rooms = Array.isArray(house?.rooms) ? house.rooms : [];
  const walls =
    Array.isArray(house?.walls) && house.walls.length > 0
      ? house.walls
      : deriveWallsFromRooms(rooms, [], house?.ceilingHeight ?? 2.7);

  const openDoors = (Array.isArray(house?.doors) ? house.doors : []).filter(
    (d) =>
      d &&
      d.closed !== true &&
      d.blocked !== true &&
      isFinitePoint2D(d.position),
  );
  const windows = carveWindows
    ? (Array.isArray(house?.windows) ? house.windows : []).filter(
        (w) => w && isFinitePoint2D(w.position),
      )
    : [];

  const segments = [];
  for (const wall of walls) {
    if (!isFinitePoint2D(wall.start) || !isFinitePoint2D(wall.end)) continue;
    const dx = wall.end[0] - wall.start[0];
    const dz = wall.end[1] - wall.start[1];
    const wallLen = Math.hypot(dx, dz);
    if (wallLen < 1e-4) continue;
    const tx = dx / wallLen;
    const tz = dz / wallLen;
    const thickness = Number(wall.thickness) || 0.14;

    const cutouts = [];
    for (const door of openDoors) {
      const proj = projectPointOnSegment(door.position, wall.start, wall.end);
      const onWall =
        door.wallId === wall.id
          ? proj.distance <= Math.max(0.35, thickness * 2)
          : proj.distance <= Math.max(0.22, thickness * 1.5);
      if (!onWall) continue;
      const w = Math.max(0.3, Number(door.width) || 0.85);
      const s = proj.t * wallLen;
      cutouts.push([s - w / 2, s + w / 2]);
    }

    for (const win of windows) {
      const proj = projectPointOnSegment(win.position, wall.start, wall.end);
      const onWall =
        win.wallId === wall.id
          ? proj.distance <= Math.max(0.35, thickness * 2)
          : proj.distance <= Math.max(0.22, thickness * 1.5);
      if (!onWall) continue;
      const w = Math.max(0.3, Number(win.width) || 1.2);
      const s = proj.t * wallLen;
      cutouts.push([s - w / 2, s + w / 2]);
    }

    for (const [s0, s1] of subtractDoorIntervals(wallLen, cutouts)) {
      segments.push({
        objectId: wall.id,
        kind: "wall",
        start: [wall.start[0] + tx * s0, wall.start[1] + tz * s0],
        end: [wall.start[0] + tx * s1, wall.start[1] + tz * s1],
      });
    }
  }
  return segments;
}

/**
 * Extract all 2D sightline-blocking segments (solid wall sub-segments +
 * tall opaque furniture/fixtures).
 */
export function extractBlockingSegments(house, options = {}) {
  const minBlockingHeight = Number(options.minBlockingHeight ?? 1.05);
  const excluded = new Set(options.excludeIds || []);
  const segments = buildOpaqueWallSegments(house, {
    carveWindows: Boolean(options.carveWindows),
  });

  const entities = listSemanticEntities(house);
  for (const entity of entities) {
    if (excluded.has(entity.id) || entity.passable) continue;
    const blocks =
      entity.blocksSightline === true ||
      (entity.blocksSightline !== false &&
        entity.dimensions.height >= minBlockingHeight);
    if (!blocks) continue;

    const poly = entity.polygon;
    for (let i = 0; i < poly.length; i += 1) {
      segments.push({
        objectId: entity.id,
        kind: entity.semanticType,
        start: poly[i],
        end: poly[(i + 1) % poly.length],
      });
    }
  }

  return segments;
}

/**
 * Parametric intersection between ray segment P1->P2 (t in [0,1]) and
 * obstacle segment Q1->Q2 (u in [0,1]).
 */
export function raySegmentIntersection(p1, p2, q1, q2) {
  const rx = p2[0] - p1[0];
  const rz = p2[1] - p1[1];
  const sx = q2[0] - q1[0];
  const sz = q2[1] - q1[1];

  const denom = rx * sz - rz * sx;
  const qpx = q1[0] - p1[0];
  const qpz = q1[1] - p1[1];

  if (Math.abs(denom) < 1e-9) {
    // Parallel / collinear check
    const cross = Math.abs(qpx * rz - qpz * rx);
    const rLenSq = rx * rx + rz * rz;
    if (rLenSq < 1e-9 || cross / Math.sqrt(rLenSq) > 1e-4) return null;
    const t0 = (qpx * rx + qpz * rz) / rLenSq;
    const t1 = ((q2[0] - p1[0]) * rx + (q2[1] - p1[1]) * rz) / rLenSq;
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(1, Math.max(t0, t1));
    if (hi - lo > 1e-4) {
      return { t: lo, u: 0.5 };
    }
    return null;
  }

  const t = (qpx * sz - qpz * sx) / denom;
  const u = (qpx * rz - qpz * rx) / denom;
  const eps = 1e-6;
  if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
    return {
      t: Math.max(0, Math.min(1, t)),
      u: Math.max(0, Math.min(1, u)),
    };
  }
  return null;
}

/**
 * Deterministic 2D sightline check between `observer` [x, z] and `target` [x, z].
 * Walls and tall opaque objects block sightlines; open doorways do not.
 *
 * @param {object} params
 * @param {object} [params.house]
 * @param {[number, number]} params.observer
 * @param {[number, number]} params.target
 * @param {Array<object>} [params.blockingSegments]
 * @param {number} [params.minBlockingHeight=1.05]
 * @param {string[]} [params.excludeIds]
 */
export function checkSightline({
  house,
  observer,
  target,
  blockingSegments,
  minBlockingHeight = 1.05,
  excludeIds = [],
}) {
  if (!isFinitePoint2D(observer) || !isFinitePoint2D(target)) {
    return {
      visible: false,
      occluded: true,
      distanceMeters: 0,
      blockingObjectIds: [],
    };
  }

  const distanceMeters = Math.hypot(
    target[0] - observer[0],
    target[1] - observer[1],
  );
  if (distanceMeters < 1e-4) {
    return {
      visible: true,
      occluded: false,
      distanceMeters: 0,
      blockingObjectIds: [],
    };
  }

  const segments =
    blockingSegments ??
    extractBlockingSegments(house, { minBlockingHeight, excludeIds });

  // Ignore wall grazing within 2.5 cm of endpoints (e.g. wall-mounted TV or doorway observer)
  const endpointMarginT = Math.min(0.04, 0.025 / distanceMeters);
  const hits = [];

  for (const seg of segments) {
    const hit = raySegmentIntersection(observer, target, seg.start, seg.end);
    if (!hit) continue;
    if (
      seg.kind === "wall" &&
      (hit.t < endpointMarginT || hit.t > 1 - endpointMarginT)
    ) {
      continue;
    }
    hits.push({ t: hit.t, objectId: seg.objectId });
  }

  hits.sort((a, b) => a.t - b.t);
  const blockingObjectIds = [];
  for (const h of hits) {
    if (!blockingObjectIds.includes(h.objectId)) {
      blockingObjectIds.push(h.objectId);
    }
  }

  return {
    visible: blockingObjectIds.length === 0,
    occluded: blockingObjectIds.length > 0,
    distanceMeters: round3(distanceMeters),
    blockingObjectIds,
  };
}

/**
 * Count distinct walls and open doorways crossed along `start -> end`
 * for simplified acoustic attenuation.
 */
export function countPartitionsCrossed(house, start, end) {
  const dist = Math.hypot(end[0] - start[0], end[1] - start[1]);
  if (dist < 1e-4) return { wallsCrossed: 0, openDoorwaysCrossed: 0 };

  const solidSegments = buildOpaqueWallSegments(house);
  const endpointMarginT = Math.min(0.03, 0.02 / dist);

  const hitWallIds = new Set();
  for (const seg of solidSegments) {
    const hit = raySegmentIntersection(start, end, seg.start, seg.end);
    if (!hit) continue;
    if (hit.t < endpointMarginT || hit.t > 1 - endpointMarginT) continue;
    hitWallIds.add(seg.objectId);
  }

  // Also check if ray passed cleanly through an open doorway threshold
  let openDoorwaysCrossed = 0;
  for (const door of Array.isArray(house?.doors) ? house.doors : []) {
    if (!door || door.closed === true || door.blocked === true) continue;
    if (!isFinitePoint2D(door.position)) continue;
    const d = pointToSegmentDistance(door.position, start, end);
    const halfW = (Number(door.width) || 0.85) / 2;
    if (d <= halfW && (!door.wallId || !hitWallIds.has(door.wallId))) {
      openDoorwaysCrossed += 1;
    }
  }

  return {
    wallsCrossed: hitWallIds.size,
    openDoorwaysCrossed,
  };
}
