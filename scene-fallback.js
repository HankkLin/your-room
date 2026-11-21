import { ROOM, styles } from './model.js';
import { constrainToRoom, footprintCorners, normalizeArchitecture, roomWalls, wallOpenings } from './scene-architecture.js';

// Keep editing available on devices where the browser cannot create a WebGL context.
export function createPlanScene(host, { onSelect, onMove }) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Room floor plan. Select furniture here or use the furniture inventory.');
  host.replaceChildren(canvas);
  const ctx = canvas.getContext('2d');
  let room = normalizeArchitecture(ROOM);
  let items = [];
  let selectedId = null;
  let style = styles['Warm minimal'];
  let scale = 1;
  let zoom = 1;
  let drag = null;
  let width = 0;
  let height = 0;

  function furniture(item) {
    const w = item.width;
    const d = item.depth;
    ctx.save();
    const position = drag?.id === item.id ? drag : item;
    ctx.translate(position.x, position.z);
    ctx.rotate(-item.rotation * Math.PI / 180);
    ctx.lineWidth = .012;
    ctx.strokeStyle = '#665a49';
    ctx.fillStyle = item.color;
    const box = (x, y, ww, dd, r = .05) => {
      ctx.beginPath();
      ctx.roundRect(x, y, ww, dd, r);
      ctx.fill();
      ctx.stroke();
    };
    if (item.kind === 'lamp' || item.kind === 'plant') {
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, d / 2, 0, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      if (item.kind === 'plant') {
        for (let i = 0; i < 7; i++) {
          ctx.rotate(Math.PI * 2 / 7);
          ctx.beginPath();
          ctx.ellipse(0, -d * .18, w * .07, d * .25, .25, 0, Math.PI * 2);
          ctx.fillStyle = i % 2 ? '#6e7f58' : '#576b51';
          ctx.fill();
        }
      }
    } else {
      box(-w / 2, -d / 2, w, d, item.kind === 'rug' ? .02 : .05);
      ctx.fillStyle = '#fff6e136';
      if (item.kind === 'sofa' || item.kind === 'chair') {
        box(-w / 2 + .05, -d / 2 + .02, w - .1, d * .16);
        const seats = item.kind === 'sofa' ? 3 : 1;
        const cushionWidth = (w - .20) / seats;
        for (let i = 0; i < seats; i++) box(-w / 2 + .10 + i * cushionWidth, -d * .28, cushionWidth - .012, d * .71);
      } else if (item.kind === 'rug') {
        ctx.strokeStyle = '#fff1d48c';
        ctx.strokeRect(-w / 2 + .08, -d / 2 + .08, w - .16, d - .16);
      } else if (item.kind === 'bed') {
        box(-w * .45, -d * .44, w * .9, d * .20);
      }
    }
    if (item.id === selectedId) {
      ctx.lineWidth = .028;
      ctx.strokeStyle = '#993b22';
      ctx.setLineDash([.09, .035]);
      ctx.strokeRect(-w / 2 - .04, -d / 2 - .04, w + .08, d + .08);
    }
    ctx.restore();
  }

  function draw() {
    width = host.clientWidth;
    height = host.clientHeight;
    if (!width || !height) return;
    const dpi = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(width * dpi);
    const ph = Math.round(height * dpi);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    ctx.setTransform(dpi, 0, 0, dpi, 0, 0);
    ctx.fillStyle = '#ece9de';
    ctx.fillRect(0, 0, width, height);
    scale = Math.min((width - 46) / room.width, (height - 60) / room.depth) * zoom;
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    drawFloor();
    for (const wall of roomWalls(room)) drawWall(wall);
    items.forEach(furniture);
    ctx.restore();
  }

  function drawFloor() {
    const [[firstX, firstZ], ...corners] = footprintCorners(room);
    const path = new Path2D();
    path.moveTo(firstX, firstZ);
    for (const [x, z] of corners) path.lineTo(x, z);
    path.closePath();
    const stone = room.floorFinish === 'stone';
    ctx.fillStyle = stone ? '#c3beb5' : room.floorFinish === 'walnut' ? '#967255' : style.floor;
    ctx.fill(path);
    ctx.save();
    ctx.clip(path);
    ctx.lineWidth = .008;
    ctx.strokeStyle = '#65533a60';
    const rowHeight = stone ? 0.59 : 0.2;
    const seamWidth = stone ? 0.59 : 1.7;
    for (let row = 0; row < Math.ceil(room.depth / rowHeight); row++) {
      const z = -room.depth / 2 + row * rowHeight;
      ctx.beginPath();
      ctx.moveTo(-room.width / 2, z);
      ctx.lineTo(room.width / 2, z);
      const startX = -room.width / 2 + (stone ? seamWidth : ((row % 3) + 1) * 0.47);
      for (let x = startX; x < room.width / 2; x += seamWidth) {
        ctx.moveTo(x, z);
        ctx.lineTo(x, Math.min(room.depth / 2, z + rowHeight));
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWall(wall) {
    ctx.save();
    ctx.translate(wall.x, wall.z);
    ctx.rotate(-wall.angle);
    ctx.lineWidth = 0.065;
    const wallColor = room.wallColor || '#57574b';
    let left = -wall.length / 2;
    const stroke = (start, end, color) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(start, 0);
      ctx.lineTo(end, 0);
      ctx.stroke();
    };
    for (const hole of wallOpenings(room, wall)) {
      stroke(left, hole.left, wallColor);
      stroke(hole.left, hole.right, hole.kind === 'window' ? '#619298' : '#b49664');
      if (hole.kind === 'door') {
        const radius = (hole.right - hole.left) * 0.92;
        ctx.save();
        ctx.strokeStyle = '#9c8057';
        ctx.lineWidth = 0.019;
        ctx.beginPath();
        ctx.arc(hole.left, 0, radius, 0, Math.PI / 2);
        ctx.lineTo(hole.left, 0);
        ctx.stroke();
        ctx.restore();
      }
      left = hole.right;
    }
    stroke(left, wall.length / 2, wallColor);
    ctx.restore();
  }

  function pointer(event) {
    const rect = canvas.getBoundingClientRect();
    return { x:(event.clientX - rect.left - width / 2) / scale, z:(event.clientY - rect.top - height / 2) / scale };
  }
  function hit(item, point) {
    const theta = item.rotation * Math.PI / 180;
    const dx = point.x - item.x;
    const dz = point.z - item.z;
    const localX = dx * Math.cos(theta) - dz * Math.sin(theta);
    const localZ = dx * Math.sin(theta) + dz * Math.cos(theta);
    return Math.abs(localX) <= item.width / 2 && Math.abs(localZ) <= item.depth / 2;
  }
  canvas.onpointerdown = e => {
    if (e.button !== 0 || drag) return;
    const point = pointer(e);
    const item = items.findLast(i => hit(i, point));
    onSelect(item?.id ?? null);
    if (!item) return;
    const theta = item.rotation * Math.PI / 180;
    const cos = Math.abs(Math.cos(theta));
    const sin = Math.abs(Math.sin(theta));
    drag = {
      id: item.id, pointer: e.pointerId, offsetX: item.x - point.x, offsetZ: item.z - point.z,
      x: item.x, z: item.z, halfX: (cos * item.width + sin * item.depth) / 2 + 0.035,
      halfZ: (sin * item.width + cos * item.depth) / 2 + 0.035,
    };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = e => {
    if (drag?.pointer !== e.pointerId) return;
    const point = pointer(e);
    [drag.x, drag.z] = constrainToRoom(room, point.x + drag.offsetX, point.z + drag.offsetZ, drag.halfX, drag.halfZ);
    draw();
  };
  canvas.onpointerup = e => {
    if (drag?.pointer !== e.pointerId) return;
    const {id, x, z} = drag;
    drag = null;
    onMove(id, x, z);
    draw();
  };
  canvas.onpointercancel = () => { drag = null; draw(); };
  const resize = new ResizeObserver(draw);
  resize.observe(host);
  draw();
  return {
    update(nextItems, id, styleName, nextRoom = ROOM) {
      room = normalizeArchitecture(nextRoom);
      items = [...nextItems].sort((a,b) => Number(b.kind === 'rug') - Number(a.kind === 'rug'));
      selectedId = id;
      style = styles[styleName] || style;
      draw();
    },
    setView() { draw(); },
    zoom(delta) { zoom = Math.max(.65, Math.min(2, zoom + delta * .15)); draw(); },
    reset() { zoom = 1; draw(); },
    dispose() { resize.disconnect(); canvas.remove(); }
  };
}
