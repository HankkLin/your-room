import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { box, createFurniture, createRoomMaterials } from './scene-furniture.js';
import { createFurnitureAssets } from './real-furniture.js';
import { constrainToRoom, createArchitecture, defaultRoom, isInsideRoom, normalizeArchitecture, roomOpeningPose } from './scene-architecture.js';
import { constrainToHouse, getRoomAtPoint, isObjectLocked, isWalkablePoint, normalizeHouse } from './house-model.js';
import { createSimulationSceneLayer } from './src/components/avatar/simulation-scene-layer.js';

const initialCamera = new THREE.Vector3(7.5, 5.1, 8.65);
const initialTarget = new THREE.Vector3(0, 0.92, -0.1);
const eyeClearance = 0.17;
const walkingStep = 0.34;

const palettes = {
  'warm minimal': { wall: '#eee0cb', side: '#e8d6bf', trim: '#f4e8d7', floor: '#ffffff' },
  'soft modern': { wall: '#dedfd9', side: '#d2d5cd', trim: '#eeeae2', floor: '#dbd9ce' },
  'earthy eclectic': { wall: '#dec1a5', side: '#c9a384', trim: '#ecdbcb', floor: '#e2c19f' },
};

function addLighting(scene) {
  const sky = new THREE.HemisphereLight('#fff6e9', '#e1d4bb', 1.65);
  scene.add(sky);

  const sun = new THREE.DirectionalLight('#fff1d9', 2.58);
  sun.position.set(-2.1, 7.65, -4.5);
  sun.target.position.set(0.9, 0, 0.96);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  Object.assign(sun.shadow.camera, { left: -4.2, right: 4.2, top: 4.55, bottom: -4.12, near: 1, far: 28 });
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.023;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight('#f3f6ff', 1.18);
  fill.position.set(4, 3, 5);
  scene.add(fill);
  return sun;
}

const objectSignature = (item) => JSON.stringify([item.kind, item.shopify && item.modelUrl, item.name, item.color, item.width, item.depth, item.height, Boolean(item.locked), Number(item.elevation) || 0]);

function selectionOutline() {
  const outline = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: '#fff0b9', depthTest: false });
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const across = box(outline, material, 1, 1, 1, 0, 0, 0);
      const along = box(outline, material, 1, 1, 1, 0, 0, 0);
      for (const part of [across, along]) {
        part.castShadow = false;
        part.renderOrder = 5;
        part.userData.corner = [x, z];
      }
    }
  }
  outline.visible = false;
  return outline;
}

function setOutline(outline, furniture) {
  outline.visible = Boolean(furniture);
  if (!furniture) return;
  const { w, d } = furniture.userData.dimensions;
  const pad = 0.045;
  const edge = Math.min(w, d, 0.65) * 0.3;
  const stroke = 0.018;
  outline.position.copy(furniture.position).add(new THREE.Vector3(0, 0.036, 0));
  outline.rotation.y = furniture.rotation.y;
  for (let i = 0; i < outline.children.length; i++) {
    const part = outline.children[i];
    const [x, z] = part.userData.corner;
    const alongX = i % 2 === 0;
    const cornerX = x * (w / 2 + pad);
    const cornerZ = z * (d / 2 + pad);
    part.scale.set(alongX ? edge : stroke, 0.001, alongX ? stroke : edge);
    part.position.set(cornerX - (alongX ? x * (edge - stroke) / 2 : 0), 0, cornerZ - (alongX ? 0 : z * (edge - stroke) / 2));
  }
}

function disposeObject(group, preserve = [], disposeTextures = false) {
  const materials = new Set();
  const textures = new Set();
  group.traverse((node) => {
    node.geometry?.dispose();
    if (!node.material) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (preserve.includes(material)) continue;
      materials.add(material);
      if (disposeTextures) {
        for (const value of Object.values(material)) {
          if (value?.isTexture) textures.add(value);
        }
      }
    }
  });
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

export function createScene(container, { onSelect = () => {}, onMove = () => {}, onPose = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  canvas.setAttribute('aria-label', 'Interactive room preview');
  container.append(canvas);

  const scene = new THREE.Scene();
  const furniture = new THREE.Group();
  scene.add(furniture);
  const materials = createRoomMaterials();
  const sharedMaterials = Object.values(materials).filter((material) => material.isMaterial);
  const architecture = createArchitecture(scene, materials, invalidate);
  const sun = addLighting(scene);
  const outline = selectionOutline();
  scene.add(outline);
  const simLayer = createSimulationSceneLayer({ scene, invalidate });

  const oblique = new THREE.PerspectiveCamera(31, 1, 0.1, 90);
  oblique.position.copy(initialCamera);
  const eye = new THREE.PerspectiveCamera(49, 1, 0.039, 45);
  eye.rotation.order = 'YXZ';
  const plan = new THREE.OrthographicCamera(-3.25, 3.25, 2.55, -2.55, 0.01, 40);
  plan.up.set(0, 0, -1);
  plan.position.set(0, 12, 0);
  plan.lookAt(0, 0, 0);

  const controls = new OrbitControls(oblique, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.enablePan = false;
  controls.minDistance = 5.3;
  controls.maxDistance = 18;
  controls.minAzimuthAngle = 0.025;
  controls.maxAzimuthAngle = Math.PI / 2 - 0.065;
  controls.minPolarAngle = 0.28;
  controls.maxPolarAngle = 1.47;
  controls.target.copy(initialTarget);
  controls.update();

  const objects = new Map();
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0));
  const hit = new THREE.Vector3();
  let currentView = '3d';
  let roomLayout = normalizeArchitecture();
  let houseLayout = null;
  let roomGeometry;
  let itemsInScene = [];
  let currentStyle;
  let selected = null;
  let drag = null;
  let lookDrag = null;
  let pendingFrame = 0;
  let disposed = false;
  const camera = () => currentView === 'plan' ? plan : currentView === 'interior' ? eye : oblique;
  const furnitureAssets = createFurnitureAssets((assetKey) => {
    if (disposed) return;
    for (const record of objects.values()) {
      if (record.kind === assetKey || record.modelUrl === assetKey) record.needsAsset = true;
    }
    api.update(itemsInScene, selected, currentStyle, roomLayout, houseLayout);
  });

  function render() {
    pendingFrame = 0;
    if (disposed) return;
    if (controls.enabled) controls.update();
    architecture.syncCamera(oblique.position);
    renderer.render(scene, camera());
  }

  function invalidate() {
    if (disposed || pendingFrame) return;
    pendingFrame = requestAnimationFrame(render);
  }

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    oblique.aspect = aspect;
    oblique.fov = aspect < 1.2 ? 37 : 31;
    oblique.updateProjectionMatrix();
    eye.aspect = aspect;
    eye.fov = aspect < 1.2 ? 58 : 49;
    eye.updateProjectionMatrix();
    const spanW = houseLayout ? houseLayout.bounds.width : roomLayout.width;
    const spanD = houseLayout ? houseLayout.bounds.depth : roomLayout.depth;
    const centerX = houseLayout ? houseLayout.bounds.centerX : 0;
    const centerZ = houseLayout ? houseLayout.bounds.centerZ : 0;
    const halfHeight = Math.max(spanD / 2 + 0.38, (spanW / 2 + 0.42) / aspect);
    plan.position.set(centerX, 14, centerZ);
    plan.lookAt(centerX, 0, centerZ);
    plan.top = halfHeight;
    plan.bottom = -halfHeight;
    plan.left = -halfHeight * aspect;
    plan.right = halfHeight * aspect;
    plan.updateProjectionMatrix();
    invalidate();
  }

  function resetCameras() {
    plan.zoom = 1;
    plan.updateProjectionMatrix();
    if (houseLayout) {
      const { width, depth, centerX, centerZ } = houseLayout.bounds;
      const scale = Math.max(1, width / defaultRoom.width, depth / defaultRoom.depth);
      controls.enablePan = true;
      controls.minAzimuthAngle = -Infinity;
      controls.maxAzimuthAngle = Infinity;
      controls.minDistance = 5.5;
      controls.maxDistance = Math.max(26, 16 * scale);
      controls.target.set(centerX, 0.85, centerZ);
      oblique.position.set(centerX + 6.9 * scale, 5.2 * scale, centerZ + 7.9 * scale);
      controls.update();
    } else {
      const scaleX = roomLayout.width / defaultRoom.width;
      const scaleZ = roomLayout.depth / defaultRoom.depth;
      const scale = Math.max(0.8, scaleX, scaleZ);
      const proportionalSize = new THREE.Vector3(scaleX, 1, scaleZ);
      controls.enablePan = false;
      controls.minAzimuthAngle = 0.025;
      controls.maxAzimuthAngle = Math.PI / 2 - 0.065;
      oblique.position.copy(initialCamera).multiplyScalar(scale);
      controls.target.copy(initialTarget).multiply(proportionalSize);
      controls.minDistance = 5.3 * scale;
      controls.maxDistance = 18 * scale;
      controls.update();
    }
    eye.zoom = 1;
    eye.updateProjectionMatrix();
    goToSpot('entry');
  }

  function sizeRoom(room, house = null) {
    roomLayout = normalizeArchitecture(room);
    houseLayout = house ? (house.bounds ? house : normalizeHouse(house)) : null;
    const geometry = houseLayout
      ? JSON.stringify(['house', houseLayout.id, houseLayout.bounds, houseLayout.ceilingHeight, houseLayout.rooms.length])
      : JSON.stringify(['single', roomLayout.width, roomLayout.depth, roomLayout.height, roomLayout.shape, roomLayout.openings]);
    if (geometry === roomGeometry) return;
    roomGeometry = geometry;
    const spanW = houseLayout ? houseLayout.bounds.width : roomLayout.width;
    const spanD = houseLayout ? houseLayout.bounds.depth : roomLayout.depth;
    const radius = Math.max(4.2, Math.hypot(spanW, spanD) * 0.65);
    Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius });
    sun.shadow.camera.updateProjectionMatrix();
    resetCameras();
    resize();
  }

  function canStand(x, z) {
    if (houseLayout) {
      return isWalkablePoint(houseLayout, x, z, { items: itemsInScene, clearance: eyeClearance });
    }
    if (!isInsideRoom(roomLayout, x, z, eyeClearance)) return false;
    return !itemsInScene.some((item) => {
      if (item.height <= 0.13) return false;
      const rotation = THREE.MathUtils.degToRad(item.rotation || 0);
      const dx = x - item.x;
      const dz = z - item.z;
      const xLocal = dx * Math.cos(rotation) - dz * Math.sin(rotation);
      const zLocal = dx * Math.sin(rotation) + dz * Math.cos(rotation);
      return Math.abs(xLocal) < item.width / 2 + 0.09 && Math.abs(zLocal) < item.depth / 2 + 0.09;
    });
  }

  function nearestSpot(x, z) {
    const point = houseLayout
      ? constrainToHouse(houseLayout, x, z, eyeClearance, eyeClearance)
      : constrainToRoom(roomLayout, x, z, eyeClearance, eyeClearance);
    if (canStand(...point)) return point;
    for (const radius of [0.28, 0.55, 0.83, 1.14, 1.58]) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
        const nearX = point[0] + radius * Math.cos(angle);
        const nearZ = point[1] + radius * Math.sin(angle);
        if (canStand(nearX, nearZ)) return [nearX, nearZ];
      }
    }
    return point;
  }

  function resolveSpot(id) {
    if (houseLayout) {
      const targetRoom =
        id === 'entry'
          ? houseLayout.rooms[0]
          : houseLayout.rooms.find((room) => room.id === id);
      if (!targetRoom) return null;
      const vp = targetRoom.viewpoint;
      const rawX = vp?.x ?? targetRoom.bounds.centerX;
      const rawZ = vp?.z ?? targetRoom.bounds.centerZ;
      const targetX = vp?.targetX ?? houseLayout.bounds.centerX;
      const targetZ = vp?.targetZ ?? houseLayout.bounds.centerZ;
      const [safeX, safeZ] = nearestSpot(rawX, rawZ);
      return { x: safeX, z: safeZ, targetX, targetZ, label: targetRoom.name };
    }

    const { width, depth } = roomLayout;
    const window = roomOpeningPose(roomLayout, 'window');
    const door = roomOpeningPose(roomLayout, 'door');
    let x;
    let z;
    let targetX = window?.x ?? 0;
    let targetZ = window?.z ?? -depth * 0.32;
    if (id === 'entry') {
      x = door ? door.x + door.nx * 0.51 : width * 0.12;
      z = door ? door.z + door.nz * 0.51 : depth * 0.42;
      if (door && Math.hypot(targetX - x, targetZ - z) < depth * 0.42) {
        targetX = 0;
        targetZ = 0;
      }
    } else if (id === 'center') {
      x = -width * 0.07;
      z = depth * 0.13;
    } else if (id === 'window') {
      x = window ? window.x + window.nx * 0.58 : width * 0.19;
      z = window ? window.z + window.nz * 0.58 : -depth * 0.32;
      targetX = 0;
      targetZ = depth * 0.19;
    } else return null;

    const [safeX, safeZ] = nearestSpot(x, z);
    return { x: safeX, z: safeZ, targetX, targetZ };
  }

  function currentPose() {
    const activeRoom = houseLayout ? getRoomAtPoint(houseLayout, eye.position.x, eye.position.z) : null;
    return {
      x: eye.position.x,
      z: eye.position.z,
      yaw: -eye.rotation.y,
      roomId: activeRoom?.id ?? null,
      roomName: activeRoom?.name ?? null,
    };
  }

  function reportPose() {
    onPose(currentPose());
  }

  function goToSpot(id) {
    const spot = resolveSpot(id);
    if (!spot) return false;
    const height = houseLayout ? houseLayout.ceilingHeight : roomLayout.height;
    eye.position.set(spot.x, Math.min(1.59, height - 0.44), spot.z);
    eye.lookAt(spot.targetX, Math.min(1.08, height * 0.47), spot.targetZ);
    reportPose();
    invalidate();
    return true;
  }

  function stepAxis(fromX, fromZ, deltaX, deltaZ) {
    for (const scale of [1, 0.5]) {
      const sx = deltaX * scale;
      const sz = deltaZ * scale;
      if (Math.hypot(sx, sz) < 1e-4) continue;
      if (canStand(fromX + sx * 0.5, fromZ + sz * 0.5) && canStand(fromX + sx, fromZ + sz)) {
        return [fromX + sx, fromZ + sz];
      }
    }
    return [fromX, fromZ];
  }

  function walk(forward, right) {
    if (currentView !== 'interior') return false;
    const heading = eye.rotation.y;
    const stepX = THREE.MathUtils.clamp(Number(right) || 0, -1, 1) * walkingStep;
    const stepZ = THREE.MathUtils.clamp(Number(forward) || 0, -1, 1) * walkingStep;
    const dx = stepX * Math.cos(heading) - stepZ * Math.sin(heading);
    const dz = -stepX * Math.sin(heading) - stepZ * Math.cos(heading);
    const { x, z } = eye.position;
    let [nx, nz] = stepAxis(x, z, dx, 0);
    [nx, nz] = stepAxis(nx, nz, 0, dz);
    eye.position.x = nx;
    eye.position.z = nz;
    if (x === eye.position.x && z === eye.position.z) return false;
    reportPose();
    invalidate();
    return true;
  }

  function cast(event) {
    const bounds = canvas.getBoundingClientRect();
    pointer.set(2 * (event.clientX - bounds.left) / bounds.width - 1, 1 - 2 * (event.clientY - bounds.top) / bounds.height);
    const currentCamera = camera();
    currentCamera.updateMatrixWorld();
    ray.setFromCamera(pointer, currentCamera);
  }

  function furnitureAtPointer() {
    const intersections = ray.intersectObjects(furniture.children, true);
    let object = intersections[0]?.object;
    while (object && object.parent !== furniture) object = object.parent;
    return object;
  }

  function pointerDown(event) {
    if (event.button !== 0 || drag || lookDrag) return;
    cast(event);
    const object = furnitureAtPointer();
    if (!object && currentView !== 'interior') return;
    event.stopImmediatePropagation();
    canvas.setPointerCapture(event.pointerId);
    if (!object) {
      canvas.style.cursor = 'grabbing';
      lookDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      return;
    }
    const itemRecord = itemsInScene.find((i) => i.id === object.userData.itemId);
    const locked = Boolean(object.userData.locked || isObjectLocked(itemRecord));
    canvas.style.cursor = locked ? 'pointer' : 'grabbing';
    const ground = ray.ray.intersectPlane(plane, hit);
    controls.enabled = false;
    drag = {
      id: object.userData.itemId,
      object,
      pointerId: event.pointerId,
      screenX: event.clientX,
      screenY: event.clientY,
      x: object.position.x,
      z: object.position.z,
      dx: ground ? object.position.x - hit.x : 0,
      dz: ground ? object.position.z - hit.z : 0,
      canDrag: Boolean(ground) && !locked,
      locked,
      moved: false,
    };
    selected = drag.id;
    setOutline(outline, object);
    onSelect(drag.id);
    invalidate();
  }

  function pointerMove(event) {
    if (lookDrag?.pointerId === event.pointerId) {
      event.stopImmediatePropagation();
      eye.rotation.y += (event.clientX - lookDrag.x) * 0.0046;
      eye.rotation.x = THREE.MathUtils.clamp(eye.rotation.x + (event.clientY - lookDrag.y) * 0.0043, -1.18, 1.18);
      lookDrag.x = event.clientX;
      lookDrag.y = event.clientY;
      reportPose();
      invalidate();
      return;
    }
    if (drag && drag.pointerId === event.pointerId) {
      event.stopImmediatePropagation();
      if (!drag.canDrag) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.screenX, event.clientY - drag.screenY) < 4) return;
      cast(event);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      const { w, d } = drag.object.userData.dimensions;
      const angle = drag.object.rotation.y;
      const xExtent = (Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * d) / 2;
      const zExtent = (Math.abs(Math.sin(angle)) * w + Math.abs(Math.cos(angle)) * d) / 2;
      const [x, z] = houseLayout
        ? constrainToHouse(houseLayout, hit.x + drag.dx, hit.z + drag.dz, xExtent + 0.035, zExtent + 0.035)
        : constrainToRoom(roomLayout, hit.x + drag.dx, hit.z + drag.dz, xExtent + 0.035, zExtent + 0.035);
      drag.object.position.x = x;
      drag.object.position.z = z;
      drag.moved = true;
      setOutline(outline, drag.object);
      renderer.shadowMap.needsUpdate = true;
      invalidate();
      return;
    }

    if (event.buttons === 0) {
      cast(event);
      const hovered = furnitureAtPointer();
      canvas.style.cursor = hovered
        ? hovered.userData.locked
          ? 'pointer'
          : 'move'
        : currentView === 'plan'
          ? 'default'
          : 'grab';
    }
  }

  function finishDrag(event, canceled = false) {
    if (lookDrag?.pointerId === event.pointerId) {
      event.stopImmediatePropagation();
      lookDrag = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = 'grab';
      return;
    }
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopImmediatePropagation();
    const current = drag;
    drag = null;
    controls.enabled = currentView === '3d';
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = current.locked ? 'pointer' : 'move';
    if (canceled) {
      current.object.position.x = current.x;
      current.object.position.z = current.z;
      setOutline(outline, current.object);
    } else if (current.moved) {
      onMove(current.id, current.object.position.x, current.object.position.z);
    }
    if (objects.get(current.id)?.needsAsset) api.update(itemsInScene, selected, currentStyle, roomLayout, houseLayout);
    renderer.shadowMap.needsUpdate = true;
    invalidate();
  }

  const pointerUp = (event) => finishDrag(event);
  const pointerCancel = (event) => finishDrag(event, true);
  canvas.addEventListener('pointerdown', pointerDown, true);
  canvas.addEventListener('pointermove', pointerMove, true);
  canvas.addEventListener('pointerup', pointerUp, true);
  canvas.addEventListener('pointercancel', pointerCancel, true);
  canvas.addEventListener('lostpointercapture', pointerCancel);
  controls.addEventListener('change', () => {
    architecture.syncCamera(oblique.position);
    invalidate();
  });
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const api = {
    update(items, selectedId, style, room, house = null) {
      itemsInScene = items;
      currentStyle = style;
      sizeRoom(room, house);
      const ids = new Set(items.map((item) => item.id));
      for (const [id, record] of objects) {
        if (ids.has(id)) continue;
        record.object.removeFromParent();
        disposeObject(record.object, sharedMaterials);
        objects.delete(id);
      }
      for (const item of items) {
        let record = objects.get(item.id);
        const signature = objectSignature(item);
        if (record?.signature !== signature || (record?.needsAsset && drag?.id !== item.id)) {
          if (record) {
            record.object.removeFromParent();
            disposeObject(record.object, sharedMaterials);
          }
          const object = furnitureAssets.create(item) ?? createFurniture(item, materials);
          furniture.add(object);
          record = { object, signature, kind: item.kind, modelUrl: item.modelUrl };
          objects.set(item.id, record);
        }
        const y = Number(item.elevation ?? item.y) || 0;
        if (drag?.id !== item.id) record.object.position.set(Number(item.x) || 0, y, Number(item.z) || 0);
        record.object.rotation.y = THREE.MathUtils.degToRad(Number(item.rotation) || 0);
      }
      selected = selectedId;
      setOutline(outline, objects.get(selected)?.object);
      const label = String(style?.name ?? style ?? '').toLowerCase().replace(/-/g, ' ');
      const palette = palettes[label] || palettes['warm minimal'];
      if (houseLayout) architecture.updateHouse(houseLayout, palette, oblique.position);
      else architecture.update(roomLayout, palette);
      renderer.shadowMap.needsUpdate = true;
      invalidate();
    },
    setView(view) {
      if (view !== '3d' && view !== 'plan' && view !== 'interior') return;
      currentView = view;
      architecture.setView(view);
      controls.enabled = view === '3d' && !drag;
      canvas.style.cursor = view === 'plan' ? 'default' : 'grab';
      renderer.shadowMap.needsUpdate = true;
      if (view === 'interior') reportPose();
      invalidate();
    },
    zoom(delta) {
      if (!delta) return;
      if (currentView === 'plan') {
        plan.zoom = THREE.MathUtils.clamp(plan.zoom * (delta > 0 ? 1.15 : 0.87), 0.65, 2.5);
        plan.updateProjectionMatrix();
      } else if (currentView === 'interior') {
        eye.zoom = THREE.MathUtils.clamp(eye.zoom * (delta > 0 ? 1.12 : 0.89), 0.82, 1.75);
        eye.updateProjectionMatrix();
      } else {
        const offset = oblique.position.clone().sub(controls.target);
        const distance = THREE.MathUtils.clamp(offset.length() * (delta > 0 ? 0.87 : 1.15), controls.minDistance, controls.maxDistance);
        oblique.position.copy(controls.target).add(offset.setLength(distance));
        controls.update();
      }
      invalidate();
    },
    goToSpot,
    walk,
    getPose: currentPose,
    setEyePose(x, z, yaw = 0) {
      const height = houseLayout ? houseLayout.ceilingHeight : roomLayout.height;
      eye.position.set(x, Math.min(1.59, height - 0.44), z);
      eye.rotation.set(0, -yaw, 0);
      reportPose();
      invalidate();
    },
    getSpots() {
      if (houseLayout) {
        return Object.fromEntries(houseLayout.rooms.map((room) => {
          const spot = resolveSpot(room.id);
          return [room.id, { x: spot.x, z: spot.z, label: room.name }];
        }));
      }
      return Object.fromEntries(['entry', 'center', 'window'].map((id) => {
        const { x, z } = resolveSpot(id);
        return [id, { x, z }];
      }));
    },
    reset() {
      resetCameras();
      invalidate();
    },
    setPlaybackFrame({ snapshots = [], visibleRoutes = [], agentMeta = new Map() } = {}) {
      simLayer.updateAvatars(snapshots, agentMeta);
      simLayer.updateRoutes(visibleRoutes, agentMeta);
    },
    setPlaybackFindings(findings = [], context = {}) {
      simLayer.setFindings(findings, {
        house: context.house ?? houseLayout,
        items: context.items ?? itemsInScene,
      });
    },
    focusFinding(findingOrNull = null) {
      simLayer.focusFinding(findingOrNull);
    },
    showPatchTransition(changes = []) {
      simLayer.showPatchTransition(changes);
    },
    clearPlayback() {
      simLayer.clear();
    },
    getPlaybackStats() {
      return {
        avatarCount: simLayer.getAvatarCount(),
        avatarStatuses: simLayer.getAvatarStatuses(),
        overlayCount: simLayer.getOverlayCount(),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(pendingFrame);
      observer.disconnect();
      controls.dispose();
      canvas.removeEventListener('pointerdown', pointerDown, true);
      canvas.removeEventListener('pointermove', pointerMove, true);
      canvas.removeEventListener('pointerup', pointerUp, true);
      canvas.removeEventListener('pointercancel', pointerCancel, true);
      canvas.removeEventListener('lostpointercapture', pointerCancel);
      simLayer.dispose();
      architecture.dispose();
      disposeObject(scene, [], true);
      furnitureAssets.dispose();
      for (const material of sharedMaterials) material.dispose();
      for (const texture of [materials.floorMap, materials.woodMap, materials.fabricBump]) texture.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
  return api;
}
