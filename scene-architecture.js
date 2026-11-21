import * as THREE from 'three';
import { box, mesh } from './scene-furniture.js';

import { footprintCorners, roomWalls, wallOpenings } from './room-layout.js';
export { constrainToRoom, defaultRoom, footprintCorners, isInsideRoom, normalizeArchitecture, openingConflict, roomOpeningPose, roomWalls, wallOpenings } from './room-layout.js';

const wallThickness = 0.12;
const outdoorPhoto = `${import.meta.env?.BASE_URL ?? '/'}assets/studio-garden.jpg`;

const finish = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.84, ...extra });
function footprintShape(room) {
  const corners = footprintCorners(room);
  const shape = new THREE.Shape();
  shape.moveTo(corners[0][0], -corners[0][1]);
  for (const [px, pz] of corners.slice(1)) shape.lineTo(px, -pz);
  shape.closePath();
  return shape;
}

function paintTexture(w, h, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function stoneTexture() {
  return paintTexture(512, 512, (ctx) => {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const drift = Math.floor(14 * (Math.sin(col * 23.46 + row * 49.9) + 1));
        ctx.fillStyle = `rgb(${192 + drift}, ${188 + drift}, ${181 + drift})`;
        ctx.fillRect(col * 64, row * 64, 64, 64);
        ctx.strokeStyle = '#c0bab1';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(col * 64, row * 64, 64, 64);
        for (let fiber = 0; fiber < 7; fiber++) {
          const n = Math.sin(col * 67.3 + row * 93.7 + fiber * 33.63);
          ctx.strokeStyle = `rgba(252, 247, 239, ${0.07 + Math.abs(n) * 0.11})`;
          ctx.beginPath();
          ctx.moveTo(col * 64, row * 64 + (fiber + 1) * 7);
          ctx.bezierCurveTo(col * 64 + 20, row * 64 + fiber * 7, col * 64 + 43, row * 64 + (fiber + 1) * 8, (col + 1) * 64, row * 64 + fiber * 8);
          ctx.stroke();
        }
      }
    }
  });
}

function artTexture(variant) {
  return paintTexture(120, 148, (ctx) => {
    const colors = variant ? ['#bfa98a', '#6c7869', '#bd8c6c'] : ['#d3ac81', '#9f6249', '#736c59'];
    ctx.fillStyle = '#f2e4d2';
    ctx.fillRect(0, 0, 120, 148);
    ctx.fillStyle = colors[0];
    ctx.beginPath();
    ctx.ellipse(61, 54, 26, 26, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors[1];
    ctx.beginPath();
    ctx.moveTo(9, 98);
    ctx.bezierCurveTo(63, 46, 65, 95, 111, 73);
    ctx.lineTo(111, 137);
    ctx.lineTo(9, 137);
    ctx.fill();
    ctx.fillStyle = colors[2];
    ctx.beginPath();
    ctx.moveTo(111, 105);
    ctx.bezierCurveTo(69, 93, 52, 132, 9, 112);
    ctx.lineTo(9, 137);
    ctx.lineTo(111, 137);
    ctx.fill();
  });
}

function surface(root, shape, room, material) {
  const geometry = new THREE.ShapeGeometry(shape);
  const vertices = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, vertices.getX(i) / room.width + 0.5, vertices.getY(i) / room.depth + 0.5);
  const floor = mesh(root, geometry, material);
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;
}

function slab(root, shape, y, depth, material) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  const solid = mesh(root, geometry, material, 0, y, 0);
  solid.rotation.x = -Math.PI / 2;
  solid.castShadow = false;
  return solid;
}

function wallBox(parent, material, left, right, bottom, top) {
  if (right - left < 0.005 || top - bottom < 0.005) return;
  box(parent, material, right - left, top - bottom, wallThickness, (left + right) / 2, (top + bottom) / 2, -wallThickness / 2).castShadow = false;
}

function trimStrip(parent, material, left, right) {
  if (right - left > 0.005) box(parent, material, right - left, 0.102, 0.035, (left + right) / 2, 0.051, 0.017).castShadow = false;
}

function buildWindow(root, hole, materials, mats) {
  const w = hole.right - hole.left;
  const h = hole.top - hole.bottom;
  const x = (hole.right + hole.left) / 2;
  const y = (hole.top + hole.bottom) / 2;
  const trim = materials.trim;
  const glass = mesh(root, new THREE.PlaneGeometry(w * 1.14, h * 1.14), materials.glass, x, y, -0.14);
  glass.castShadow = false;
  glass.receiveShadow = false;

  for (const side of [-1, 1]) {
    box(root, trim, 0.046, h + 0.046, 0.13, x + side * (w - 0.025) / 2, y, -0.025);
    box(root, trim, w - 0.02, 0.046, 0.13, x, y + side * (h - 0.025) / 2, -0.025);
  }
  box(root, trim, 0.032, h, 0.055, x, y, 0.009);
  box(root, trim, w, 0.03, 0.065, x, y + h * 0.09, 0.012);
  box(root, trim, w + 0.13, 0.047, 0.18, x, hole.bottom - 0.024, 0.023, 0.008);

  const curtainWidth = Math.min(w * 0.22, 0.37);
  const curtainHeight = h + 0.52;
  const rodY = hole.top + 0.13;
  const rod = mesh(root, new THREE.CylinderGeometry(0.011, 0.011, w + curtainWidth, 16), mats.brass, x, rodY, 0.12);
  rod.rotation.z = Math.PI / 2;
  for (const side of [-1, 1]) {
    const cloth = new THREE.PlaneGeometry(curtainWidth, curtainHeight, 36, 18);
    const vertices = cloth.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      const px = vertices.getX(i);
      const py = vertices.getY(i);
      const taper = 1 + (curtainHeight / 2 - py) / curtainHeight * 0.2;
      vertices.setXYZ(i, px * taper, py + 0.01 * Math.sin(px * 64) * taper, 0.024 * taper * Math.sin(px * 95 + py * 0.23));
    }
    cloth.computeVertexNormals();
    mesh(root, cloth, materials.linen, x + side * (w / 2 - curtainWidth * 0.19), rodY - curtainHeight / 2, 0.14);
  }
}

function buildDoor(root, hole, materials, mats) {
  const width = hole.right - hole.left;
  const height = hole.top;
  const x = (hole.left + hole.right) / 2;
  const trim = materials.trim;
  for (const edge of [hole.left, hole.right]) box(root, trim, 0.057, height, 0.135, edge, height / 2, -0.034);
  box(root, trim, width + 0.057, 0.06, 0.135, x, height - 0.016, -0.034);
  box(root, mats.brass, width, 0.016, 0.09, x, 0.008, -0.017);
  box(root, materials.hallway, width + 0.12, height + 0.04, 0.026, x, height * 0.5, -0.26).castShadow = false;

  const pivot = new THREE.Group();
  pivot.position.set(hole.left + 0.042, 0.025, -0.024);
  pivot.rotation.y = -0.38;
  root.add(pivot);
  const leafWidth = width - 0.085;
  const leafHeight = height - 0.065;
  box(pivot, materials.door, leafWidth, leafHeight, 0.041, leafWidth / 2, leafHeight / 2, 0, 0.007).castShadow = false;
  for (const centerY of [leafHeight * 0.28, leafHeight * 0.72]) {
    box(pivot, materials.doorPanel, leafWidth * 0.71, leafHeight * 0.34, 0.017, leafWidth / 2, centerY, 0.023, 0.004).castShadow = false;
  }
  box(pivot, mats.black, 0.11, 0.019, 0.037, leafWidth - 0.12, 0.92, 0.037, 0.006).castShadow = false;
}

function addPlanOpening(parent, hole, materials) {
  const width = hole.right - hole.left;
  const x = (hole.right + hole.left) / 2;
  if (hole.kind === 'window') {
    const window = box(parent, materials.planGlass, width, 0.04, 0.063, x, 0.026, -0.047);
    window.castShadow = false;
    return;
  }
  box(parent, materials.threshold, width, 0.021, 0.058, x, 0.022, -0.022).castShadow = false;
  const widthInside = width * 0.92;
  box(parent, materials.threshold, 0.021, 0.018, widthInside, hole.left + 0.032, 0.02, widthInside / 2).castShadow = false;
  const arc = new THREE.EllipseCurve(hole.left + 0.032, 0, widthInside, widthInside, 0, Math.PI / 2);
  const points = arc.getPoints(26).map(({ x, y }) => new THREE.Vector3(x, 0.025, y));
  parent.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), materials.planLine));
}

function buildWall(shell, side, room, materials, mats) {
  const anchor = new THREE.Group();
  anchor.position.set(side.x, 0, side.z);
  anchor.rotation.y = side.angle;
  shell.add(anchor);
  const tall = new THREE.Group();
  const low = new THREE.Group();
  anchor.add(tall, low);
  const color = side.id === 'back' ? materials.back : materials.side;
  const edge = side.length / 2;
  const holes = wallOpenings(room, side);
  let left = -edge;
  for (const hole of holes) {
    if (hole.left < left) continue;
    wallBox(tall, color, left, hole.left, 0, room.height);
    trimStrip(tall, materials.trim, left, hole.left);
    wallBox(low, materials.boundary, left, hole.left, 0, 0.095);
    wallBox(tall, color, hole.left, hole.right, hole.top, room.height);
    wallBox(tall, color, hole.left, hole.right, 0, hole.bottom);
    if (hole.kind === 'window') {
      trimStrip(tall, materials.trim, hole.left, hole.right);
      buildWindow(tall, hole, materials, mats);
    } else buildDoor(tall, hole, materials, mats);
    addPlanOpening(low, hole, materials);
    left = hole.right;
  }
  wallBox(tall, color, left, edge, 0, room.height);
  trimStrip(tall, materials.trim, left, edge);
  wallBox(low, materials.boundary, left, edge, 0, 0.095);
  box(tall, materials.trim, side.length, 0.047, 0.035, 0, room.height - 0.024, 0.018).castShadow = false;

  // Use two prints on the long side wall if neither overlaps an opening.
  if (side.id === 'left') {
    for (const [index, px] of [side.length * 0.205, side.length * 0.05].entries()) {
      const width = index === 0 ? 0.54 : 0.4;
      if (holes.some(({ left: a, right: b }) => px + width / 2 > a && px - width / 2 < b)) continue;
      const y = Math.min(room.height * 0.62, 1.65);
      box(tall, mats.walnut, width, width * 1.24, 0.035, px, y, 0.029, 0.007).castShadow = false;
      mesh(tall, new THREE.PlaneGeometry(width - 0.038, width * 1.24 - 0.038), materials.art[index], px, y, 0.048).castShadow = false;
    }
  }
  return { tall, low, far: side.far };
}

export function createArchitecture(scene, mats, invalidate) {
  const stone = stoneTexture();
  const art = [0, 1].map((index) => new THREE.MeshBasicMaterial({ map: artTexture(index), color: '#fffcf2' }));
  const materials = {
    floor: finish('#fff', { map: mats.floorMap, roughness: 0.77 }),
    base: finish('#b39a80'),
    back: finish('#eee0cb'),
    side: finish('#e8d6bf'),
    trim: finish('#f4e8d7'),
    boundary: finish('#d4c1a8'),
    ceiling: finish('#f2eae0'),
    glass: new THREE.MeshBasicMaterial({ color: '#d4dfdf', toneMapped: false }),
    linen: finish('#e5d6c2', { side: THREE.DoubleSide, bumpMap: mats.fabricBump, bumpScale: 0.018 }),
    door: finish('#d8c4a9', { map: mats.woodMap, roughness: 0.72 }),
    doorPanel: finish('#e5d4bd', { map: mats.woodMap, roughness: 0.75 }),
    hallway: finish('#6e6151'),
    planGlass: finish('#8caaac'),
    threshold: finish('#a18859'),
    planLine: new THREE.LineBasicMaterial({ color: '#b4a388' }),
    art,
  };
  let shell;
  let roof;
  let walls = [];
  let currentView = '3d';
  let signature;
  let disposed = false;

  new THREE.TextureLoader().load(outdoorPhoto, (texture) => {
    if (disposed) {
      texture.dispose();
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.repeat.set(1, 0.78);
    texture.offset.set(0, 0.22);
    materials.glass.color.set('#fff9f2');
    materials.glass.map = texture;
    materials.glass.needsUpdate = true;
    invalidate();
  });

  function clearShell() {
    if (!shell) return;
    shell.removeFromParent();
    shell.traverse((child) => child.geometry?.dispose());
  }

  function setView(view) {
    currentView = view;
    materials.boundary.color.set(view === 'plan' ? '#958674' : '#d4c1a8');
    if (roof) roof.visible = view === 'interior';
    for (const wall of walls) {
      wall.tall.visible = view === 'interior' || (view === '3d' && wall.far);
      wall.low.visible = !wall.tall.visible;
    }
  }

  return {
    setView,
    update(room, palette) {
      const nextSignature = JSON.stringify([room.width, room.depth, room.height, room.shape, room.openings]);
      if (signature !== nextSignature) {
        signature = nextSignature;
        clearShell();
        shell = new THREE.Group();
        scene.add(shell);
        const shape = footprintShape(room);
        slab(shell, shape, -0.13, 0.125, materials.base);
        surface(shell, shape, room, materials.floor);
        roof = slab(shell, shape, room.height, 0.06, materials.ceiling);
        walls = roomWalls(room).map((side) => buildWall(shell, side, room, materials, mats));
        setView(currentView);
      }
      const isStone = room.floorFinish === 'stone';
      const nextMap = isStone ? stone : mats.floorMap;
      if (materials.floor.map !== nextMap) {
        materials.floor.map = nextMap;
        materials.floor.needsUpdate = true;
      }
      materials.floor.color.set(room.floorFinish === 'walnut' ? '#8c5d44' : isStone ? '#ffffff' : palette.floor);
      materials.floor.roughness = isStone ? 0.55 : 0.77;
      materials.back.color.set(room.wallColor ?? palette.wall);
      materials.side.color.set(room.wallColor ?? palette.side);
      materials.trim.color.set(palette.trim);
    },
    dispose() {
      disposed = true;
      clearShell();
      materials.glass.map?.dispose();
      stone.dispose();
      for (const item of art) {
        item.map.dispose();
        item.dispose();
      }
      for (const item of Object.values(materials)) if (item.isMaterial) item.dispose();
    },
  };
}
