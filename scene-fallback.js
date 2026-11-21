import { ROOM, styles } from './model.js';
import { constrainToRoom, footprintCorners, normalizeArchitecture, roomWalls, wallOpenings } from './scene-architecture.js';
import { constrainToHouse, getWallOpeningsInHouse, isObjectLocked, normalizeHouse } from './house-model.js';
import { deriveAgentStyle, mapFindingToOverlaySpec } from './src/components/avatar/simulation-scene-layer.js';

// Keep editing available on devices where the browser cannot create a WebGL context.
export function createPlanScene(host, { onSelect, onMove }) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Room floor plan. Select furniture here or use the furniture inventory.');
  host.replaceChildren(canvas);
  const ctx = canvas.getContext('2d');
  let room = normalizeArchitecture(ROOM);
  let house = null;
  let items = [];
  let selectedId = null;
  let style = styles['Warm minimal'];
  let scale = 1;
  let zoom = 1;
  let drag = null;
  let width = 0;
  let height = 0;
  let playbackSnapshots = [];
  let playbackRoutes = [];
  let playbackAgentMeta = new Map();
  let playbackFindings = [];
  let playbackFocusedId = null;
  let playbackFocusedAgents = new Set();
  let playbackPatchChanges = [];

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
    const spanW = house ? house.bounds.width : room.width;
    const spanD = house ? house.bounds.depth : room.depth;
    const centerX = house ? house.bounds.centerX : 0;
    const centerZ = house ? house.bounds.centerZ : 0;
    scale = Math.min((width - 46) / spanW, (height - 60) / spanD) * zoom;
    ctx.save();
    ctx.translate(width / 2 - centerX * scale, height / 2 - centerZ * scale);
    ctx.scale(scale, scale);
    if (house) {
      drawHouse();
    } else {
      drawFloor();
      for (const wall of roomWalls(room)) drawWall(wall);
    }
    items.forEach(furniture);
    drawPlaybackOverlays();
    ctx.restore();
  }

  function drawPlaybackOverlays() {
    for (const ch of playbackPatchChanges) {
      if (!Array.isArray(ch?.from) || !Array.isArray(ch?.to)) continue;
      ctx.save();
      ctx.strokeStyle = '#4e7a52';
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.moveTo(ch.from[0], ch.from[1]);
      ctx.lineTo(ch.to[0], ch.to[1]);
      ctx.stroke();
      ctx.restore();
    }

    for (const route of playbackRoutes) {
      if (!Array.isArray(route?.path) || route.path.length < 2) continue;
      const meta = playbackAgentMeta.get(route.agentId) || {};
      const color = route.evacuation ? '#c9532e' : deriveAgentStyle(route.agentId, meta.color).color;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = route.active ? 0.9 : 0.45;
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      route.path.forEach(([px, pz], idx) => {
        if (idx === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      });
      ctx.stroke();
      ctx.restore();
    }

    for (const f of playbackFindings) {
      const spec = mapFindingToOverlaySpec(f, { house, items });
      if (!spec) continue;
      const focused = playbackFocusedId && spec.id === playbackFocusedId;
      ctx.save();
      if (spec.kind === 'sightline' || spec.kind === 'view-ray') {
        ctx.strokeStyle = spec.color;
        ctx.lineWidth = focused ? 0.055 : 0.038;
        ctx.setLineDash([0.14, 0.1]);
        ctx.beginPath();
        ctx.moveTo(spec.from[0], spec.from[1]);
        ctx.lineTo(spec.to[0], spec.to[1]);
        ctx.stroke();
      } else if (spec.position) {
        const r = spec.radius * (focused ? 1.2 : 1.0);
        ctx.fillStyle = spec.color;
        ctx.globalAlpha = focused ? 0.3 : 0.16;
        ctx.beginPath();
        ctx.arc(spec.position[0], spec.position[1], r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = focused ? 0.95 : 0.72;
        ctx.strokeStyle = spec.color;
        ctx.lineWidth = 0.04;
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const snap of playbackSnapshots) {
      if (!snap?.agentId || !Array.isArray(snap.position)) continue;
      const meta = playbackAgentMeta.get(snap.agentId) || {};
      const label = meta.name || snap.name || snap.agentId;
      const { color } = deriveAgentStyle(snap.agentId, meta.color);
      const [ax, az] = snap.position;
      ctx.save();
      if (playbackFocusedAgents.has(snap.agentId)) {
        ctx.strokeStyle = '#d96236';
        ctx.lineWidth = 0.045;
        ctx.beginPath();
        ctx.arc(ax, az, 0.31, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.strokeStyle = '#fffdf8';
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.arc(ax, az, 0.21, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#262722';
      ctx.font = '600 0.2px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(label).slice(0, 12), ax, az - 0.3);
      ctx.restore();
    }
  }

  function drawHouse() {
    for (const r of house.rooms) {
      const [[fx, fz], ...rest] = r.polygon;
      const path = new Path2D();
      path.moveTo(fx, fz);
      for (const [x, z] of rest) path.lineTo(x, z);
      path.closePath();
      ctx.fillStyle = r.floorFinish === 'stone' ? '#c3beb5' : r.floorFinish === 'walnut' ? '#967255' : style.floor;
      ctx.fill(path);
      ctx.save();
      ctx.fillStyle = '#434139b0';
      ctx.font = '600 0.24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(r.name, r.bounds.centerX, r.bounds.centerZ);
      ctx.restore();
    }
    for (const wall of house.walls) {
      ctx.save();
      ctx.translate(wall.cx, wall.cz);
      ctx.rotate(-wall.angle);
      ctx.lineWidth = wall.exterior ? 0.085 : 0.065;
      let left = -wall.length / 2;
      const stroke = (start, end, color) => {
        if (end - start <= 0.005) return;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(start, 0);
        ctx.lineTo(end, 0);
        ctx.stroke();
      };
      for (const hole of getWallOpeningsInHouse(house, wall)) {
        stroke(left, hole.left, '#57574b');
        stroke(hole.left, hole.right, hole.kind === 'window' ? '#619298' : '#b49664');
        left = hole.right;
      }
      stroke(left, wall.length / 2, '#57574b');
      ctx.restore();
    }
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
    const centerX = house ? house.bounds.centerX : 0;
    const centerZ = house ? house.bounds.centerZ : 0;
    return {
      x: (event.clientX - rect.left - width / 2) / scale + centerX,
      z: (event.clientY - rect.top - height / 2) / scale + centerZ,
    };
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
    if (!item || isObjectLocked(item)) return;
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
    [drag.x, drag.z] = house
      ? constrainToHouse(house, point.x + drag.offsetX, point.z + drag.offsetZ, drag.halfX, drag.halfZ)
      : constrainToRoom(room, point.x + drag.offsetX, point.z + drag.offsetZ, drag.halfX, drag.halfZ);
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
    update(nextItems, id, styleName, nextRoom = ROOM, nextHouse = null) {
      room = normalizeArchitecture(nextRoom);
      house = nextHouse ? (nextHouse.bounds ? nextHouse : normalizeHouse(nextHouse)) : null;
      items = [...nextItems].sort((a,b) => Number(b.kind === 'rug') - Number(a.kind === 'rug'));
      selectedId = id;
      style = styles[styleName] || style;
      draw();
    },
    setView() { draw(); },
    zoom(delta) { zoom = Math.max(.65, Math.min(2, zoom + delta * .15)); draw(); },
    reset() { zoom = 1; draw(); },
    projectScreenToFloor(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
      const pt = pointer({ clientX, clientY });
      return [pt.x, pt.z];
    },
    setDragPreview() {},
    setLivePlaybackFindings() {},
    setPlaybackFrame({ snapshots = [], visibleRoutes = [], agentMeta = new Map() } = {}) {
      playbackSnapshots = [...snapshots];
      playbackRoutes = [...visibleRoutes];
      playbackAgentMeta = agentMeta;
      draw();
    },
    setPlaybackFindings(findings = []) {
      playbackFindings = Array.isArray(findings) ? [...findings] : [];
      draw();
    },
    focusFinding(findingOrNull = null) {
      if (!findingOrNull) {
        playbackFocusedId = null;
        playbackFocusedAgents = new Set();
      } else {
        const spec = mapFindingToOverlaySpec(findingOrNull, { house, items });
        playbackFocusedId = findingOrNull.id || spec?.id || null;
        playbackFocusedAgents = new Set(spec?.relatedAgentIds || []);
      }
      draw();
    },
    showPatchTransition(changes = []) {
      playbackPatchChanges = Array.isArray(changes) ? [...changes] : [];
      draw();
    },
    clearPlayback() {
      playbackSnapshots = [];
      playbackRoutes = [];
      playbackFindings = [];
      playbackFocusedId = null;
      playbackFocusedAgents = new Set();
      playbackPatchChanges = [];
      draw();
    },
    getPlaybackStats() {
      return {
        avatarCount: playbackSnapshots.length,
        overlayCount: playbackFindings.filter((f) => Boolean(mapFindingToOverlaySpec(f, { house, items }))).length,
      };
    },
    dispose() { resize.disconnect(); canvas.remove(); }
  };
}
