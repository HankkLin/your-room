const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const defaultRoom = { width: 5.4, depth: 4.2, height: 2.65, shape: 'rectangle' };
export const doorWidth = 0.9;
const openingEdge = 0.07;
const openingSpacing = 0.10;
const defaultOpenings = [
  { kind: 'window', wall: 'back', offset: 0.535 },
  { kind: 'door', wall: 'front', offset: 0.10 },
];
const measure = (value, reference, min, max) => clamp(Number(value) || reference, min, max);

export function normalizeArchitecture(room = {}) {
  room ??= {};
  const openings = Array.isArray(room.openings) ? room.openings : defaultOpenings;
  return {
    width: measure(room.width, defaultRoom.width, 3, 9),
    depth: measure(room.depth, defaultRoom.depth, 3, 9),
    height: measure(room.height, defaultRoom.height, 2.1, 4.5),
    shape: room.shape === 'alcove' ? 'alcove' : 'rectangle',
    openings: openings.filter((opening) => (
      ['door', 'window'].includes(opening?.kind) && ['back', 'left', 'right', 'front'].includes(opening?.wall)
    )).map(({ kind, wall, offset }) => ({ kind, wall, offset: clamp(Number(offset ?? 0.5) || 0, 0, 1) })),
    wallColor: /^#[\da-f]{6}$/i.test(room.wallColor) ? room.wallColor : null,
    floorFinish: ['oak', 'walnut', 'stone'].includes(room.floorFinish) ? room.floorFinish : 'oak',
  };
}

export function footprintLimits(room) {
  return { halfWidth: room.width / 2, halfDepth: room.depth / 2, notchX: room.width * 0.16, notchZ: room.depth * 0.14 };
}

export function isInsideRoom(room, x, z, halfX = 0, halfZ = halfX) {
  const { halfWidth, halfDepth, notchX, notchZ } = footprintLimits(room);
  return Math.abs(x) + halfX <= halfWidth && Math.abs(z) + halfZ <= halfDepth && (
    room.shape !== 'alcove' || x + halfX <= notchX || z + halfZ <= notchZ
  );
}

export function constrainToRoom(room, x, z, halfX, halfZ) {
  const { halfWidth, halfDepth, notchX, notchZ } = footprintLimits(room);
  const limitX = Math.max(0, halfWidth - halfX);
  const limitZ = Math.max(0, halfDepth - halfZ);
  const inX = clamp(x, -limitX, limitX);
  const inZ = clamp(z, -limitZ, limitZ);
  if (room.shape !== 'alcove' || inX + halfX <= notchX || inZ + halfZ <= notchZ) return [inX, inZ];
  const leftX = notchX - halfX;
  const backZ = notchZ - halfZ;
  if (backZ < -limitZ || (leftX >= -limitX && inX - leftX < inZ - backZ)) return [Math.max(-limitX, leftX), inZ];
  return [inX, backZ];
}

export function roomWalls(room) {
  const { halfWidth: x, halfDepth: z, notchX, notchZ } = footprintLimits(room);
  const alcove = room.shape === 'alcove';
  return [
    { id: 'back', x: 0, z: -z, length: x * 2, angle: 0, far: true },
    { id: 'right', x, z: alcove ? (notchZ - z) / 2 : 0, length: alcove ? z + notchZ : z * 2, angle: -Math.PI / 2 },
    ...(alcove ? [
      { id: 'notchBack', x: (notchX + x) / 2, z: notchZ, length: x - notchX, angle: Math.PI, reversed: true },
      { id: 'notchSide', x: notchX, z: (notchZ + z) / 2, length: z - notchZ, angle: -Math.PI / 2 },
    ] : []),
    { id: 'front', x: alcove ? (notchX - x) / 2 : 0, z, length: alcove ? x + notchX : x * 2, angle: Math.PI, reversed: true },
    { id: 'left', x: -x, z: 0, length: z * 2, angle: Math.PI / 2, reversed: true, far: true },
  ];
}

export function wallOpenings(room, wall) {
  return room.openings.filter(({ wall: id }) => id === wall.id).map(({ kind, offset }) => {
    const width = kind === 'door' ? doorWidth : Math.min(2.37, wall.length * 0.48);
    const position = (wall.reversed ? 1 - offset : offset) * wall.length;
    const start = clamp(position - width / 2, openingEdge, wall.length - openingEdge - width);
    const bottom = kind === 'door' ? 0 : Math.min(1.05, room.height * 0.39);
    const top = kind === 'door' ? Math.min(2.09, room.height - 0.11) : Math.min(bottom + 1.29, room.height - 0.24);
    return { kind, left: start - wall.length / 2, right: start + width - wall.length / 2, bottom, top };
  }).sort((a, b) => a.left - b.left);
}

export function openingConflict(room) {
  const layout = normalizeArchitecture(room);
  for (const wall of roomWalls(layout)) {
    const holes = wallOpenings(layout, wall);
    for (let i = 1; i < holes.length; i++) {
      if (holes[i].left < holes[i - 1].right + openingSpacing) return wall.id;
    }
  }
  return null;
}

export function roomOpeningPose(room, kind) {
  const first = room.openings.find((item) => item.kind === kind);
  const wall = first && roomWalls(room).find((side) => first.wall === side.id);
  const opening = wall && wallOpenings(room, wall).find((hole) => hole.kind === kind);
  if (!opening) return null;
  const position = (opening.left + opening.right) / 2;
  return {
    x: wall.x + position * Math.cos(wall.angle),
    z: wall.z - position * Math.sin(wall.angle),
    nx: Math.sin(wall.angle),
    nz: Math.cos(wall.angle),
  };
}

export function footprintCorners(room) {
  const { halfWidth: x, halfDepth: z, notchX, notchZ } = footprintLimits(room);
  return room.shape === 'alcove'
    ? [[-x, -z], [x, -z], [x, notchZ], [notchX, notchZ], [notchX, z], [-x, z]]
    : [[-x, -z], [x, -z], [x, z], [-x, z]];
}

