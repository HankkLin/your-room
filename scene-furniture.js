import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const random = (seed) => {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

function texture(width, height, paint, color = true) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'));
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.anisotropy = 8;
  return map;
}

export function createRoomMaterials() {
  const fabricBump = texture(128, 128, (ctx) => {
    const rng = random(33);
    const pixels = ctx.createImageData(128, 128);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const x = (i / 4) % 128;
      const y = Math.floor(i / 512);
      const shade = 110 + 28 * (x % 2) + 22 * (y % 2) + rng() * 24;
      pixels.data.set([shade, shade, shade, 255], i);
    }
    ctx.putImageData(pixels, 0, 0);
  }, false);
  fabricBump.wrapS = fabricBump.wrapT = THREE.RepeatWrapping;
  fabricBump.repeat.set(7, 7);

  const woodMap = texture(256, 256, (ctx) => {
    const rng = random(21);
    ctx.fillStyle = '#d8c3a7';
    ctx.fillRect(0, 0, 256, 256);
    for (let line = 0; line < 420; line++) {
      const y = rng() * 256;
      ctx.strokeStyle = rng() > 0.4 ? `rgba(82,44,13,${rng() * 0.17})` : `rgba(255,248,226,${rng() * 0.32})`;
      ctx.lineWidth = 0.3 + rng() * 1.1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(46, y - 1, 184, y + rng() * 4, 256, y);
      ctx.stroke();
    }
  });

  const floorMap = texture(1024, 768, (ctx) => {
    const rng = random(47);
    const colors = ['#c09c76', '#d1ad86', '#c5a480', '#d7ba93', '#bd9c77', '#cfa982', '#d4b08b'];
    ctx.fillStyle = '#9d7957';
    ctx.fillRect(0, 0, 1024, 768);
    for (let row = 0; row < 24; row++) {
      let x = -Math.floor(rng() * 270);
      const y = row * 32;
      while (x < 1024) {
        const length = Math.floor(160 + rng() * 325);
        ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
        ctx.fillRect(x + 1, y + 1, length - 1, 31);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 1, y + 1, length - 2, 31);
        ctx.clip();
        for (let line = 0; line < 20; line++) {
          const yy = y + rng() * 32;
          ctx.strokeStyle = line % 3 === 0 ? 'rgba(106,67,34,.10)' : 'rgba(255,234,196,.12)';
          ctx.lineWidth = 0.4 + rng() * 0.85;
          ctx.beginPath();
          ctx.moveTo(x, yy);
          ctx.bezierCurveTo(x + length / 3, yy + rng() * 3, x + length / 2, yy - rng() * 2, x + length, yy);
          ctx.stroke();
        }
        ctx.restore();
        x += length;
      }
    }
  });

  return {
    fabricBump,
    woodMap,
    floorMap,
    oak: new THREE.MeshStandardMaterial({ color: '#c8a57b', map: woodMap, roughness: 0.68 }),
    walnut: new THREE.MeshStandardMaterial({ color: '#78513a', map: woodMap, roughness: 0.57 }),
    black: new THREE.MeshStandardMaterial({ color: '#302e29', metalness: 0.28, roughness: 0.49 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b98d52', metalness: 0.56, roughness: 0.35 }),
  };
}

export function mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const part = new THREE.Mesh(geometry, material);
  part.position.set(x, y, z);
  part.castShadow = true;
  part.receiveShadow = true;
  parent.add(part);
  return part;
}

export function box(parent, material, w, h, d, x, y, z, radius = 0) {
  const geometry = radius > 0
    ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2))
    : new THREE.BoxGeometry(w, h, d);
  return mesh(parent, geometry, material, x, y, z);
}

const solid = (color, roughness = 0.75) => new THREE.MeshStandardMaterial({ color, roughness });

function upholstery(color, materials, lightness = 0) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).offsetHSL(0, 0, lightness),
    roughness: 0.96,
    bumpMap: materials.fabricBump,
    bumpScale: 0.025,
  });
}

function tube(parent, material, top, bottom, height, x, y, z, sides = 24) {
  return mesh(parent, new THREE.CylinderGeometry(top, bottom, height, sides), material, x, y, z);
}

function feet(group, material, width, depth, height, size = 0.045) {
  for (const x of [-width / 2, width / 2]) {
    for (const z of [-depth / 2, depth / 2]) {
      tube(group, material, size, size * 0.74, height, x, height / 2, z, 12);
    }
  }
}

function sofa(group, w, d, h, color, mats, sections) {
  const frame = upholstery(color, mats, -0.045);
  const cushions = upholstery(color, mats, 0.025);
  const arm = Math.min(w * 0.15, 0.19);
  const seat = h * 0.47;
  const armX = (w - arm) / 2;
  const seatDepth = d * 0.7;
  const cushionWidth = (w - arm * 2) / sections;
  feet(group, mats.walnut, w * 0.82, d * 0.73, h * 0.13);
  box(group, frame, w * 0.99, h * 0.3, d * 0.95, 0, h * 0.26, 0, 0.075);
  box(group, frame, w * 0.94, h * 0.62, d * 0.23, 0, h * 0.68, -d * 0.37, 0.075);
  for (const x of [-armX, armX]) {
    box(group, frame, arm, h * 0.5, d * 0.93, x, h * 0.45, 0, 0.065);
  }
  for (let i = 0; i < sections; i++) {
    const x = (i - (sections - 1) / 2) * cushionWidth;
    box(group, cushions, cushionWidth * 0.99, h * 0.18, seatDepth, x, seat, d * 0.11, 0.07);
    const back = box(group, cushions, cushionWidth * 0.98, h * 0.49, d * 0.24, x, h * 0.73, -d * 0.27, 0.079);
    back.rotation.x = -0.19;
  }
  if (sections >= 2) {
    const pillow = upholstery('#a56a52', mats);
    const ivory = upholstery('#d9cbaa', mats);
    const p1 = box(group, pillow, 0.39, 0.4, 0.15, -w * 0.32, h * 0.7, -d * 0.16, 0.075);
    p1.rotation.set(-0.23, 0.12, -0.23);
    const p2 = box(group, ivory, 0.38, 0.36, 0.13, w * 0.31, h * 0.7, -d * 0.18, 0.067);
    p2.rotation.set(-0.24, -0.14, 0.17);
  }
}

function loungeChair(group, w, d, h, color, mats) {
  const fabric = upholstery(color, mats);
  const seat = h * 0.49;
  const legW = Math.min(0.041, w * 0.08);
  const armY = h * 0.68;
  const timber = mats.oak;
  for (const side of [-1, 1]) {
    const x = side * (w - legW) / 2;
    const foreleg = box(group, timber, legW, armY, legW, x, armY / 2, d * 0.34, 0.007);
    foreleg.rotation.x = -0.11;
    const backleg = box(group, timber, legW, armY * 1.035, legW, x, armY / 2, -d * 0.33, 0.007);
    backleg.rotation.x = 0.15;
    box(group, timber, legW * 1.36, 0.035, d * 0.92, x, armY, 0, 0.012);
    box(group, timber, legW, 0.038, d * 0.79, x, seat * 0.84, 0, 0.007);
  }
  box(group, timber, w * 0.94, 0.062, d * 0.73, 0, seat * 0.82, 0.035, 0.013);
  box(group, fabric, w * 0.87, h * 0.15, d * 0.72, 0, seat, d * 0.10, 0.049);
  const back = box(group, fabric, w * 0.87, h * 0.5, d * 0.20, 0, h * 0.73, -d * 0.31, 0.063);
  back.rotation.x = -0.21;
}

function table(group, w, d, h, color, mats, kind) {
  const top = new THREE.MeshStandardMaterial({ color, map: mats.woodMap, roughness: 0.66 });
  const thin = Math.min(h * 0.15, 0.075);
  const round = /coffee|side|round/.test(kind) || (kind === 'table' && h < 0.55);
  if (round) {
    const surface = tube(group, top, 0.5, 0.5, thin, 0, h - thin / 2, 0, 56);
    surface.scale.set(w, 1, d);
    const base = tube(group, mats.walnut, 0.26, 0.32, h - thin, 0, (h - thin) / 2, 0, 32);
    base.scale.set(w, 1, d);
    for (let i = 0; i < 32; i++) {
      const a = i * Math.PI / 16;
      tube(group, mats.walnut, 0.008, 0.012, h - thin, 0.26 * w * Math.cos(a), (h - thin) / 2, d * Math.sin(a) * 0.26, 8);
    }
  } else {
    box(group, top, w, thin, d, 0, h - thin / 2, 0, 0.025);
    feet(group, mats.walnut, w * 0.82, d * 0.75, h - thin, 0.034);
  }
  if (h < 0.65) {
    const book = solid('#ded5c2');
    const cover = solid('#718075');
    box(group, book, 0.2, 0.022, 0.135, -w * 0.14, h + 0.014, d * 0.06, 0.004).rotation.y = 0.1;
    box(group, cover, 0.205, 0.005, 0.14, -w * 0.14, h + 0.028, d * 0.06, 0.003).rotation.y = 0.1;
    const ceramic = solid('#eee5d5', 0.42);
    tube(group, ceramic, 0.045, 0.041, 0.068, w * 0.18, h + 0.034, -d * 0.04);
    tube(group, solid('#60422d'), 0.038, 0.038, 0.003, w * 0.18, h + 0.069, -d * 0.04);
  }
}

function cabinet(group, w, d, h, color, mats, kind) {
  const finish = new THREE.MeshStandardMaterial({ color, map: mats.woodMap, roughness: 0.69 });
  const fronts = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).offsetHSL(0, 0, 0.09), map: mats.woodMap, roughness: 0.75 });
  const base = Math.min(h * 0.14, 0.15);
  const body = h - base;
  const y = body / 2 + base;
  feet(group, mats.black, w * 0.85, d * 0.75, base, 0.024);
  const shelves = /shelf|bookcase/.test(kind);
  if (shelves) {
    const edge = Math.min(0.04, w * 0.08);
    for (const x of [-w / 2 + edge / 2, w / 2 - edge / 2]) {
      box(group, finish, edge, body, d, x, y, 0);
    }
    for (let i = 0; i < 5; i++) {
      box(group, fronts, w, edge, d, 0, base + edge / 2 + i * (body - edge) / 4, 0);
    }
    const colors = ['#8a4d39', '#c8b99b', '#54706b', '#5a4c3c', '#a88b68'].map((entry) => solid(entry));
    const shelfStep = (body - edge) / 4;
    for (let row = 0; row < 4; row++) {
      for (let book = 0; book < 4; book++) {
        const width = w * (0.042 + 0.012 * (book % 3));
        const height = shelfStep * (0.51 + 0.09 * ((row + book) % 3));
        const x = (row % 2 === 0 ? -0.3 : 0.05) * w + book * w * 0.056;
        const y = base + edge + row * shelfStep + height / 2;
        box(group, colors[(row + book) % colors.length], width, height, d * 0.6, x, y, d * 0.04, 0.003);
      }
    }
    return;
  }
  box(group, finish, w, body, d * 0.97, 0, y, -d * 0.016, 0.023);
  const panels = w > 1 ? 3 : 2;
  const panelWidth = (w - 0.035) / panels;
  for (let i = 0; i < panels; i++) {
    const x = (i - (panels - 1) / 2) * panelWidth;
    box(group, fronts, panelWidth - 0.01, body - 0.07, 0.026, x, y, d / 2, 0.007);
    if (!/closet|wardrobe/.test(kind)) {
      const count = Math.max(3, Math.floor(panelWidth / 0.034));
      for (let j = 0; j < count; j++) {
        const ribX = x + (j - (count - 1) / 2) * (panelWidth - 0.04) / count;
        box(group, fronts, 0.011, body - 0.09, 0.009, ribX, y, d / 2 + 0.017, 0.003);
      }
    }
    const handleY = /closet|wardrobe/.test(kind) ? y : h - Math.min(0.12, body * 0.25);
    box(group, mats.brass, Math.min(0.13, panelWidth / 2), 0.016, 0.022, x, handleY, d / 2 + 0.034, 0.006);
  }
}

function rug(group, w, d, h, color, mats) {
  const mat = upholstery(color, mats);
  const height = Math.max(0.013, Math.min(h, 0.032));
  box(group, mat, w, height, d, 0, height / 2, 0, 0.036);
  const border = upholstery(color, mats, -0.1);
  const inset = Math.min(w, d) * 0.08;
  for (const z of [-d / 2 + inset, d / 2 - inset]) {
    box(group, border, w - inset * 2, 0.002, 0.014, 0, height + 0.002, z);
    box(group, border, w - inset * 2, 0.002, 0.007, 0, height + 0.002, z * 0.94);
  }
  for (const x of [-w / 2 + inset, w / 2 - inset]) {
    box(group, border, 0.014, 0.002, d - inset * 2, x, height + 0.002, 0);
    box(group, border, 0.007, 0.002, d - inset * 2, x * 0.94, height + 0.002, 0);
  }
}

function lamp(group, w, d, h, color, mats, name) {
  const base = Math.min(w, d) * 0.39;
  tube(group, mats.black, base, base * 1.04, 0.035, 0, 0.0175, 0, 36);
  tube(group, mats.brass, 0.012, 0.017, h * 0.83, 0, h * 0.43, 0);
  const shade = new THREE.MeshStandardMaterial({
    color, roughness: 0.92, side: THREE.DoubleSide, emissive: '#edc880', emissiveIntensity: 0.24,
  });
  const radius = Math.min(w, d) / 2;
  if (/opal|glass/i.test(name)) {
    const globe = mesh(group, new THREE.SphereGeometry(radius, 32, 20), shade, 0, h - radius, 0);
    globe.castShadow = false;
    return;
  }
  const part = mesh(group, new THREE.CylinderGeometry(radius * 0.69, radius, h * 0.19, 48, 1, true), shade, 0, h * 0.895, 0);
  part.castShadow = false;
  const bulb = new THREE.MeshBasicMaterial({ color: '#fff0ca' });
  mesh(group, new THREE.SphereGeometry(Math.min(0.04, radius * 0.22), 16, 10), bulb, 0, h * 0.87, 0).castShadow = false;
}

function plant(group, w, d, h, color, mats) {
  const rng = random(917);
  const potHeight = h * 0.27;
  const pot = solid(color, 0.77);
  const size = Math.min(w, d) * 0.31;
  tube(group, pot, size, size * 0.78, potHeight, 0, potHeight / 2, 0, 36);
  tube(group, pot, size * 1.035, size * 1.04, 0.024, 0, potHeight - 0.014, 0, 36);
  tube(group, solid('#4a382b'), size * 0.88, size * 0.88, 0.005, 0, potHeight - 0.013, 0, 36);
  const leafColors = ['#495b32', '#738051', '#35482c', '#64723d'].map((green) => solid(green, 0.63));
  for (let i = 0; i < 27; i++) {
    const a = i * 2.399963;
    const reach = (0.16 + rng() * 0.2) * (i > 18 ? 0.7 : 1);
    const y = Math.min(h * 0.97, potHeight + (i + 2) * h * 0.025);
    const x = Math.cos(a) * w * reach;
    const z = Math.sin(a) * d * reach;
    const start = new THREE.Vector3(0, potHeight - 0.025, 0);
    const end = new THREE.Vector3(x, y, z);
    const direction = end.clone().sub(start);
    const center = start.addScaledVector(direction, 0.5);
    const stem = tube(group, mats.walnut, 0.0034, 0.006, direction.length(), center.x, center.y, center.z, 7);
    stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    const leaf = mesh(group, new THREE.SphereGeometry(1, 12, 8), leafColors[i % leafColors.length], x, y, z);
    leaf.scale.set(Math.min(w * 0.19, 0.18), 0.013, Math.min(d * 0.11, 0.107));
    leaf.rotation.set(Math.sin(a) * 0.3, -a, 0.2 + rng() * 0.6);
  }
}

function bed(group, w, d, h, color, mats) {
  const fabric = upholstery(color, mats);
  const sheets = upholstery('#e4dbcc', mats);
  feet(group, mats.walnut, w * 0.86, d * 0.83, h * 0.15);
  box(group, fabric, w, h * 0.24, d, 0, h * 0.24, 0, 0.04);
  box(group, sheets, w * 0.96, h * 0.19, d * 0.94, 0, h * 0.42, 0, 0.09);
  box(group, fabric, w, h * 0.88, 0.13, 0, h * 0.56, -d / 2 + 0.065, 0.05);
  box(group, upholstery('#978b70', mats), w * 0.98, h * 0.075, d * 0.67, 0, h * 0.54, d * 0.14, 0.039);
  for (const x of [-w * 0.24, w * 0.24]) {
    box(group, sheets, w * 0.41, h * 0.12, d * 0.2, x, h * 0.55, -d * 0.34, 0.057);
  }
}

function toiletFixture(group, w, d, h, color, mats) {
  const porcelain = new THREE.MeshStandardMaterial({ color: color || '#f3f0ea', roughness: 0.28 });
  const tankDepth = d * 0.32;
  const bowlDepth = d * 0.68;
  const bowlHeight = h * 0.52;
  box(group, porcelain, w * 0.72, bowlHeight * 0.78, bowlDepth * 0.74, 0, bowlHeight * 0.39, d * 0.1, 0.06);
  const bowl = tube(group, porcelain, 0.5, 0.42, bowlHeight * 0.46, 0, bowlHeight * 0.77, d * 0.14, 28);
  bowl.scale.set(w * 0.88, 1, bowlDepth * 0.92);
  const lid = tube(group, porcelain, 0.5, 0.5, 0.032, 0, bowlHeight + 0.018, d * 0.14, 28);
  lid.scale.set(w * 0.9, 1, bowlDepth * 0.94);
  box(group, porcelain, w * 0.92, h * 0.56, tankDepth, 0, h * 0.7, -d / 2 + tankDepth / 2, 0.035);
  box(group, porcelain, w * 0.96, 0.036, tankDepth * 1.06, 0, h - 0.018, -d / 2 + tankDepth / 2, 0.012);
  tube(group, mats.brass, 0.026, 0.026, 0.018, 0, h + 0.008, -d / 2 + tankDepth / 2, 16);
}

function sinkFixture(group, w, d, h, color, mats) {
  const cabinetry = new THREE.MeshStandardMaterial({ color: color || '#cbb89d', map: mats.woodMap, roughness: 0.68 });
  const counterMat = solid('#ede8df', 0.38);
  const basinMat = solid('#fbfaf7', 0.24);
  const counterThick = 0.045;
  const toeHeight = 0.09;
  const bodyH = h - counterThick - toeHeight;
  box(group, mats.black, w * 0.92, toeHeight, d * 0.84, 0, toeHeight / 2, -d * 0.04);
  box(group, cabinetry, w * 0.98, bodyH, d * 0.94, 0, toeHeight + bodyH / 2, -d * 0.02, 0.018);
  box(group, counterMat, w, counterThick, d, 0, h - counterThick / 2, 0, 0.012);
  box(group, counterMat, w, 0.075, 0.028, 0, h + 0.035, -d / 2 + 0.014, 0.006);
  box(group, basinMat, Math.min(w * 0.58, 0.54), 0.024, d * 0.56, 0, h + 0.006, d * 0.05, 0.01);
  tube(group, mats.black, 0.014, 0.016, 0.19, 0, h + 0.095, -d * 0.24, 14);
  box(group, mats.black, 0.022, 0.02, 0.13, 0, h + 0.18, -d * 0.18, 0.008);
  const panels = w > 0.85 ? 2 : 1;
  const pw = (w * 0.92) / panels;
  for (let i = 0; i < panels; i++) {
    const px = (i - (panels - 1) / 2) * pw;
    box(group, mats.brass, Math.min(0.14, pw * 0.45), 0.016, 0.024, px, h - 0.16, d * 0.47, 0.006);
  }
}

function counterFixture(group, w, d, h, color, mats) {
  const cabinetry = new THREE.MeshStandardMaterial({ color: color || '#c5ab8b', map: mats.woodMap, roughness: 0.66 });
  const stoneTop = solid('#e8e2d7', 0.4);
  const counterThick = 0.048;
  const toeHeight = 0.095;
  const bodyH = h - counterThick - toeHeight;
  box(group, mats.black, w * 0.96, toeHeight, d * 0.85, 0, toeHeight / 2, -d * 0.04);
  box(group, cabinetry, w * 0.99, bodyH, d * 0.95, 0, toeHeight + bodyH / 2, -d * 0.02, 0.016);
  box(group, stoneTop, w, counterThick, d, 0, h - counterThick / 2, 0, 0.012);
  box(group, stoneTop, w, 0.085, 0.026, 0, h + 0.04, -d / 2 + 0.013, 0.006);
  const bays = Math.max(2, Math.round(w / 0.58));
  const bayW = (w - 0.04) / bays;
  for (let i = 0; i < bays; i++) {
    const px = (i - (bays - 1) / 2) * bayW;
    box(group, mats.brass, Math.min(0.15, bayW * 0.42), 0.015, 0.024, px, h - 0.16, d * 0.47, 0.005);
  }
}

function refrigeratorFixture(group, w, d, h, color, mats) {
  const steel = new THREE.MeshStandardMaterial({ color: color || '#c9cdd1', metalness: 0.42, roughness: 0.36 });
  const seam = mats.black;
  box(group, steel, w, h * 0.98, d * 0.92, 0, h * 0.49, -d * 0.04, 0.024);
  const upperH = h * 0.62;
  const lowerH = h * 0.32;
  for (const side of [-1, 1]) {
    box(group, steel, w * 0.485, upperH, 0.048, side * w * 0.248, h - upperH / 2 - 0.02, d * 0.45, 0.014);
    box(group, seam, 0.016, upperH * 0.55, 0.032, side * w * 0.06, h - upperH / 2 - 0.02, d * 0.49, 0.006);
  }
  box(group, steel, w * 0.98, lowerH, 0.048, 0, lowerH / 2 + 0.02, d * 0.45, 0.014);
  box(group, seam, w * 0.68, 0.018, 0.032, 0, lowerH - 0.06, d * 0.49, 0.006);
}

function stoveFixture(group, w, d, h, color, mats) {
  const body = new THREE.MeshStandardMaterial({ color: color || '#55585c', metalness: 0.38, roughness: 0.42 });
  const glass = new THREE.MeshStandardMaterial({ color: '#222426', metalness: 0.5, roughness: 0.22 });
  box(group, body, w, h, d * 0.95, 0, h / 2, -d * 0.025, 0.018);
  box(group, glass, w * 0.94, 0.018, d * 0.86, 0, h + 0.009, 0.01, 0.006);
  box(group, body, w, 0.11, 0.055, 0, h + 0.055, -d / 2 + 0.028, 0.01);
  box(group, glass, w * 0.78, h * 0.52, 0.026, 0, h * 0.42, d * 0.46, 0.01);
  box(group, mats.brass, w * 0.72, 0.02, 0.038, 0, h * 0.74, d * 0.49, 0.008);
  for (const x of [-w * 0.24, w * 0.24]) {
    for (const z of [-d * 0.18, d * 0.18]) {
      tube(group, mats.black, 0.095, 0.095, 0.008, x, h + 0.02, z, 24);
    }
  }
}

function acFixture(group, w, d, h, color, mats) {
  const shell = solid(color || '#f4f3ee', 0.35);
  box(group, shell, w, h, d, 0, h / 2, 0, 0.038);
  box(group, mats.black, w * 0.86, h * 0.14, 0.018, 0, h * 0.22, d / 2 + 0.004, 0.006);
  box(group, new THREE.MeshBasicMaterial({ color: '#78b88c' }), 0.028, 0.01, 0.01, w * 0.36, h * 0.62, d / 2 + 0.006);
}

export function createFurniture(item, mats) {
  const group = new THREE.Group();
  const w = Math.max(0.07, Number(item.width) || 0.6);
  const d = Math.max(0.07, Number(item.depth) || 0.6);
  const h = Math.max(0.008, Number(item.height) || 0.75);
  const kind = String(item.kind || item.name || '').toLowerCase();
  const defaults = {
    sofa: '#c9b69a', chair: '#78907b', rug: '#d7bd9d', plant: '#b17155', lamp: '#e1cdb0',
  };
  const color = item.color || defaults[kind] || '#b2916e';

  if (/toilet/.test(kind)) toiletFixture(group, w, d, h, color, mats);
  else if (/sink|vanity/.test(kind)) sinkFixture(group, w, d, h, color, mats);
  else if (/counter/.test(kind)) counterFixture(group, w, d, h, color, mats);
  else if (/refrigerator|fridge/.test(kind)) refrigeratorFixture(group, w, d, h, color, mats);
  else if (/stove|range|oven/.test(kind)) stoveFixture(group, w, d, h, color, mats);
  else if (/^ac\b|air.?cond/.test(kind)) acFixture(group, w, d, h, color, mats);
  else if (/sofa|couch|loveseat|sectional/.test(kind)) sofa(group, w, d, h, color, mats, w > 1.95 ? 3 : 2);
  else if (/chair|armchair/.test(kind)) loungeChair(group, w, d, h, color, mats);
  else if (/table|desk/.test(kind)) table(group, w, d, h, color, mats, kind);
  else if (/rug|carpet/.test(kind)) rug(group, w, d, h, color, mats);
  else if (/plant/.test(kind)) plant(group, w, d, h, color, mats);
  else if (/lamp|light/.test(kind)) lamp(group, w, d, h, color, mats, item.name);
  else if (/bed/.test(kind)) bed(group, w, d, h, color, mats);
  else if (/ottoman|bench|stool/.test(kind)) {
    feet(group, mats.walnut, w * 0.77, d * 0.77, h * 0.35, 0.025);
    box(group, upholstery(color, mats), w, h * 0.68, d, 0, h * 0.66, 0, 0.082);
  } else cabinet(group, w, d, h, color, mats, kind);

  group.userData.itemId = item.id;
  group.userData.locked = Boolean(item.locked || item.type === 'fixed');
  group.userData.dimensions = { w, d, h };
  return group;
}
