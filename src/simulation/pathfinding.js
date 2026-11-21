import { isFinitePoint2D } from "../spatial/floorplan-geometry.js";

const SQRT2 = Math.SQRT2;
const round3 = (n) => Math.round(n * 1000) / 1000;

const NEIGHBORS_8 = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

class MinHeap {
  constructor(fScore, hScore) {
    this.data = [];
    this.fScore = fScore;
    this.hScore = hScore;
  }

  get size() {
    return this.data.length;
  }

  less(a, b) {
    const df = this.fScore[a] - this.fScore[b];
    if (Math.abs(df) > 1e-7) return df < 0;
    const dh = this.hScore[a] - this.hScore[b];
    if (Math.abs(dh) > 1e-7) return dh < 0;
    return a < b;
  }

  push(node) {
    const arr = this.data;
    arr.push(node);
    let i = arr.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(arr[i], arr[parent])) break;
      const tmp = arr[parent];
      arr[parent] = arr[i];
      arr[i] = tmp;
      i = parent;
    }
  }

  pop() {
    const arr = this.data;
    const top = arr[0];
    const last = arr.pop();
    if (arr.length > 0) {
      arr[0] = last;
      let i = 0;
      const n = arr.length;
      while (true) {
        let best = i;
        const left = i * 2 + 1;
        const right = left + 1;
        if (left < n && this.less(arr[left], bestNode(arr, best))) best = left;
        if (right < n && this.less(arr[right], bestNode(arr, best))) best = right;
        if (best === i) break;
        const tmp = arr[i];
        arr[i] = arr[best];
        arr[best] = tmp;
        i = best;
      }
    }
    return top;
  }
}

function bestNode(arr, idx) {
  return arr[idx];
}

function octileDistance(c1, r1, c2, r2, cellSize) {
  const dx = Math.abs(c1 - c2);
  const dz = Math.abs(r1 - r2);
  return cellSize * (Math.abs(dx - dz) + SQRT2 * Math.min(dx, dz));
}

/**
 * Deterministic line-of-sight check across the occupancy grid.
 */
export function hasWalkableLineOfSight(navigation, a, b, radius) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return navigation.isPointWalkable(a[0], a[1], radius);

  const step = Math.max(0.02, navigation.cellSize * 0.35);
  const steps = Math.ceil(dist / step);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = a[0] + dx * t;
    const z = a[1] + dz * t;
    if (!navigation.isPointWalkable(x, z, radius)) return false;
  }
  return true;
}

function smoothGridPath(navigation, rawPoints, radius) {
  if (rawPoints.length <= 2) return rawPoints;
  const smoothed = [rawPoints[0]];
  let anchor = 0;

  while (anchor < rawPoints.length - 1) {
    let next = anchor + 1;
    for (let candidate = rawPoints.length - 1; candidate > anchor + 1; candidate -= 1) {
      if (
        hasWalkableLineOfSight(
          navigation,
          rawPoints[anchor],
          rawPoints[candidate],
          radius,
        )
      ) {
        next = candidate;
        break;
      }
    }
    smoothed.push(rawPoints[next]);
    anchor = next;
  }
  return smoothed;
}

function collectPathMetadata(navigation, path) {
  let distanceMeters = 0;
  const doorsTraversed = [];
  const seenDoors = new Set();
  const roomsTraversed = [];

  const recordSample = (x, z) => {
    const door = navigation.getDoorAt(x, z);
    if (door && !seenDoors.has(door.id)) {
      seenDoors.add(door.id);
      doorsTraversed.push(door.id);
    }
    const roomId = navigation.getRoomIdAt(x, z);
    if (roomId && roomsTraversed.at(-1) !== roomId) {
      roomsTraversed.push(roomId);
    }
  };

  if (path.length === 1) {
    recordSample(path[0][0], path[0][1]);
    return { distanceMeters: 0, doorsTraversed, roomsTraversed };
  }

  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    distanceMeters += segLen;

    const samples = Math.max(1, Math.ceil(segLen / (navigation.cellSize * 0.5)));
    for (let s = 0; s <= samples; s += 1) {
      const t = s / samples;
      recordSample(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    }
  }

  return {
    distanceMeters: round3(distanceMeters),
    doorsTraversed,
    roomsTraversed,
  };
}

/**
 * Deterministic 8-connected A* pathfinding on the 2D floor-plane navigation grid
 * with obstacle clearance and safe line-of-sight path smoothing.
 *
 * @param {object} params
 * @param {object} params.navigation
 * @param {[number, number]} params.start
 * @param {[number, number]} params.goal
 * @param {number} [params.agentRadius]
 * @param {boolean} [params.smooth=true]
 */
export function findPath({
  navigation,
  start,
  goal,
  agentRadius,
  smooth = true,
}) {
  if (!navigation || !isFinitePoint2D(start) || !isFinitePoint2D(goal)) {
    return { success: false, reason: "NO_PATH" };
  }

  const radius = Math.max(
    0,
    Number(agentRadius ?? navigation.agentRadius ?? 0.24),
  );

  const [startCol, startRow] = navigation.worldToCell(start[0], start[1]);
  const [goalCol, goalRow] = navigation.worldToCell(goal[0], goal[1]);

  if (
    !navigation.isCellWalkable(startCol, startRow, radius) ||
    !navigation.isCellWalkable(goalCol, goalRow, radius)
  ) {
    return { success: false, reason: "NO_PATH" };
  }

  const cleanStart = [round3(start[0]), round3(start[1])];
  const cleanGoal = [round3(goal[0]), round3(goal[1])];

  if (Math.hypot(cleanGoal[0] - cleanStart[0], cleanGoal[1] - cleanStart[1]) < 1e-3) {
    const meta = collectPathMetadata(navigation, [cleanStart]);
    return {
      success: true,
      path: [cleanStart],
      ...meta,
    };
  }

  // Fast direct line-of-sight shortcut when start and goal have unobstructed clearance
  if (smooth && hasWalkableLineOfSight(navigation, cleanStart, cleanGoal, radius)) {
    const directPath = [cleanStart, cleanGoal];
    const meta = collectPathMetadata(navigation, directPath);
    return {
      success: true,
      path: directPath,
      ...meta,
    };
  }

  const { width, height, cellSize } = navigation;
  const total = width * height;
  const startIdx = startRow * width + startCol;
  const goalIdx = goalRow * width + goalCol;

  const gScore = new Float64Array(total).fill(Infinity);
  const fScore = new Float64Array(total).fill(Infinity);
  const hScore = new Float64Array(total);
  const parent = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);

  gScore[startIdx] = 0;
  hScore[startIdx] = octileDistance(startCol, startRow, goalCol, goalRow, cellSize);
  fScore[startIdx] = hScore[startIdx];

  const open = new MinHeap(fScore, hScore);
  open.push(startIdx);

  let found = false;
  while (open.size > 0) {
    const current = open.pop();
    if (closed[current]) continue;
    if (current === goalIdx) {
      found = true;
      break;
    }
    closed[current] = 1;

    const col = current % width;
    const row = (current - col) / width;
    const currentG = gScore[current];

    for (const [dc, dr, stepMult] of NEIGHBORS_8) {
      const nCol = col + dc;
      const nRow = row + dr;
      if (!navigation.isCellWalkable(nCol, nRow, radius)) continue;

      // Prevent squeezing diagonally across blocked corners
      if (
        dc !== 0 &&
        dr !== 0 &&
        (!navigation.isCellWalkable(col + dc, row, radius) ||
          !navigation.isCellWalkable(col, row + dr, radius))
      ) {
        continue;
      }

      const nIdx = nRow * width + nCol;
      if (closed[nIdx]) continue;

      const tentativeG = currentG + stepMult * cellSize;
      if (tentativeG + 1e-9 < gScore[nIdx]) {
        parent[nIdx] = current;
        gScore[nIdx] = tentativeG;
        const h = octileDistance(nCol, nRow, goalCol, goalRow, cellSize);
        hScore[nIdx] = h;
        fScore[nIdx] = tentativeG + h;
        open.push(nIdx);
      }
    }
  }

  if (!found) {
    return { success: false, reason: "NO_PATH" };
  }

  const gridIndices = [];
  let cursor = goalIdx;
  while (cursor !== -1) {
    gridIndices.push(cursor);
    if (cursor === startIdx) break;
    cursor = parent[cursor];
  }
  gridIndices.reverse();

  const rawPoints = gridIndices.map((idx) => {
    const c = idx % width;
    const r = (idx - c) / width;
    return navigation.cellToWorld(c, r);
  });
  rawPoints[0] = cleanStart;
  rawPoints[rawPoints.length - 1] = cleanGoal;

  const finalPath = (smooth ? smoothGridPath(navigation, rawPoints, radius) : rawPoints).map(
    ([x, z]) => [round3(x), round3(z)],
  );

  const meta = collectPathMetadata(navigation, finalPath);
  return {
    success: true,
    path: finalPath,
    ...meta,
  };
}

/**
 * Sample `[x, z]` and heading `yaw` (radians) at distance `traveledMeters`
 * along a waypoint polyline.
 */
export function samplePointAlongPath(path, traveledMeters) {
  if (!Array.isArray(path) || path.length === 0) {
    return { position: [0, 0], yaw: 0, completed: true };
  }
  if (path.length === 1 || traveledMeters <= 0) {
    const yaw =
      path.length > 1
        ? Math.atan2(path[1][0] - path[0][0], path[1][1] - path[0][1])
        : 0;
    return {
      position: [path[0][0], path[0][1]],
      yaw: round3(yaw),
      completed: path.length === 1,
    };
  }

  let remaining = traveledMeters;
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const segLen = Math.hypot(dx, dz);
    if (segLen < 1e-6) continue;
    if (remaining <= segLen) {
      const t = remaining / segLen;
      return {
        position: [round3(a[0] + dx * t), round3(a[1] + dz * t)],
        yaw: round3(Math.atan2(dx, dz)),
        completed: false,
      };
    }
    remaining -= segLen;
  }

  const last = path.at(-1);
  const prev = path.at(-2);
  return {
    position: [last[0], last[1]],
    yaw: round3(Math.atan2(last[0] - prev[0], last[1] - prev[1])),
    completed: true,
  };
}
