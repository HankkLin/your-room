import * as THREE from "three";

const AGENT_PALETTE = Object.freeze([
  "#3d6b82", // slate blue
  "#b55d3f", // terracotta
  "#5a7d5a", // sage green
  "#8a638e", // muted plum
  "#b88736", // warm ochre
  "#3d7a74", // deep teal
  "#9c5268", // rosewood
  "#687347", // olive
  "#57668a", // indigo
  "#9e6b49", // chestnut
]);

function hashString(str) {
  let hash = 2166136261;
  const text = String(str ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Deterministic visual identity for an agent based on `agentId` (reusing explicit color if valid).
 */
export function deriveAgentStyle(agentId, explicitColor = null) {
  if (typeof explicitColor === "string" && /^#[\da-f]{6}$/i.test(explicitColor)) {
    return { color: explicitColor, index: 0 };
  }
  const index = hashString(agentId) % AGENT_PALETTE.length;
  return { color: AGENT_PALETTE[index], index };
}

/**
 * Format simulation minute-of-day (e.g. 462 -> "07:42 AM") or elapsed seconds without inventing schedule semantics.
 */
export function formatSimulationClock({ minute = null, timestampSeconds = null, mode = "clock" } = {}) {
  if (mode === "elapsed" && Number.isFinite(Number(timestampSeconds))) {
    const sec = Math.max(0, Math.round(Number(timestampSeconds)));
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");
    return `${mm}:${ss} elapsed`;
  }
  const resolvedMin =
    Number.isFinite(Number(minute))
      ? Number(minute)
      : Number.isFinite(Number(timestampSeconds))
        ? Number(timestampSeconds) / 60
        : null;
  if (resolvedMin === null) return "";
  const totalMinutes = ((Math.floor(resolvedMin) % 1440) + 1440) % 1440;
  const hours24 = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${String(hours12).padStart(2, "0")}:${String(mins).padStart(2, "0")} ${period}`;
}

/**
 * Format concise, factual evidence chips directly from `finding.evidence` without inventing numbers.
 */
export function formatFindingEvidenceChips(finding) {
  const ev = finding?.evidence;
  if (!ev || typeof ev !== "object") return [];
  const chips = [];
  const type = String(finding?.type || "").toUpperCase();

  if (type === "CONGESTION") {
    const people = ev.agentCount ?? ev.agents;
    if (Number.isFinite(Number(people))) {
      chips.push(`${Number(people)} ${Number(people) === 1 ? "person" : "people"}`);
    }
    if (Number.isFinite(Number(ev.durationSeconds))) {
      const secs = Number(ev.durationSeconds);
      chips.push(
        secs >= 60 ? `${(secs / 60).toFixed(1)} min` : `${Math.round(secs)} s`,
      );
    }
    if (Number.isFinite(Number(ev.minimumClearanceMeters))) {
      chips.push(`${Number(ev.minimumClearanceMeters).toFixed(2)} m min clearance`);
    }
    return chips;
  }

  if (type === "PRIVACY_SIGHTLINE") {
    if (ev.sourceType && ev.targetType) {
      chips.push(`${ev.sourceType} → ${ev.targetType}`);
    }
    if (Number.isFinite(Number(ev.distanceMeters))) {
      chips.push(`${Number(ev.distanceMeters).toFixed(1)} m sightline`);
    }
    return chips;
  }

  if (type === "TV_OCCLUDED" || type === "TV_BAD_ANGLE" || type === "TV_TOO_FAR") {
    if (Number.isFinite(Number(ev.viewingAngleDegrees))) {
      chips.push(`${Math.round(Number(ev.viewingAngleDegrees))}° angle`);
    }
    if (Number.isFinite(Number(ev.distanceMeters))) {
      chips.push(`${Number(ev.distanceMeters).toFixed(1)} m distance`);
    }
    if (ev.occluded) chips.push("Sightline blocked");
    return chips;
  }

  if (
    type === "EVACUATION_BOTTLENECK" ||
    type === "NO_EVACUATION_PATH" ||
    type === "LONG_EVACUATION_ROUTE"
  ) {
    if (Number.isFinite(Number(ev.convergingAgentCount))) {
      chips.push(`${Number(ev.convergingAgentCount)} converging`);
    }
    if (Number.isFinite(Number(ev.exitDoorWidthMeters))) {
      chips.push(`${Number(ev.exitDoorWidthMeters).toFixed(2)} m exit width`);
    }
    if (Number.isFinite(Number(ev.estimatedQueueDelaySeconds))) {
      chips.push(`+${Number(ev.estimatedQueueDelaySeconds).toFixed(1)} s queue`);
    }
    return chips;
  }

  if (type === "ACCESSIBILITY_CLEARANCE_FAIL") {
    if (Number.isFinite(Number(ev.measuredWidthMeters))) {
      chips.push(`${Number(ev.measuredWidthMeters).toFixed(2)} m width`);
    }
    if (Number.isFinite(Number(ev.requiredWidthMeters))) {
      chips.push(`≥ ${Number(ev.requiredWidthMeters).toFixed(2)} m required`);
    }
    return chips;
  }

  if (type === "ACCESSIBILITY_TURN_RADIUS_FAIL") {
    if (Number.isFinite(Number(ev.measuredTurnDiameterMeters))) {
      chips.push(`${Number(ev.measuredTurnDiameterMeters).toFixed(2)} m turn space`);
    }
    if (Number.isFinite(Number(ev.requiredTurnDiameterMeters))) {
      chips.push(`${Number(ev.requiredTurnDiameterMeters).toFixed(2)} m needed`);
    }
    return chips;
  }

  if (type === "ACCESSIBILITY_ROUTE_BLOCKED") {
    chips.push("Wheelchair blocked");
    if (Number.isFinite(Number(ev.wheelchairWidthMeters))) {
      chips.push(`${Number(ev.wheelchairWidthMeters).toFixed(2)} m chair width`);
    }
    return chips;
  }

  if (Number.isFinite(Number(ev.distanceMeters))) {
    chips.push(`${Number(ev.distanceMeters).toFixed(1)} m`);
  }
  return chips;
}

function isPoint2D(pt) {
  return (
    Array.isArray(pt) &&
    pt.length >= 2 &&
    Number.isFinite(Number(pt[0])) &&
    Number.isFinite(Number(pt[1]))
  );
}

function resolvePointFromContext(posCandidate, objectId, roomId, { house, items = [] } = {}) {
  if (isPoint2D(posCandidate)) {
    return [Number(posCandidate[0]), Number(posCandidate[1])];
  }
  if (objectId) {
    const obj = items.find((i) => i.id === objectId);
    if (obj && Number.isFinite(Number(obj.x)) && Number.isFinite(Number(obj.z))) {
      return [Number(obj.x), Number(obj.z)];
    }
    const door = house?.doors?.find((d) => d.id === objectId);
    if (door && isPoint2D(door.position)) {
      return [Number(door.position[0]), Number(door.position[1])];
    }
  }
  if (roomId && Array.isArray(house?.rooms)) {
    const room = house.rooms.find(
      (r) =>
        r.id === roomId ||
        r.name?.toLowerCase() === String(roomId).toLowerCase(),
    );
    if (room?.bounds) {
      return [room.bounds.centerX, room.bounds.centerZ];
    }
  }
  return null;
}

/**
 * Pure finding-to-scene overlay specification mapper (`U5`, `U6`, `U7`).
 * Never throws on unknown or incomplete finding shapes.
 */
export function mapFindingToOverlaySpec(finding, context = {}) {
  if (!finding || typeof finding !== "object") return null;
  const type = String(finding.type || "UNKNOWN").toUpperCase();
  const ev = finding.evidence || {};
  const locObj =
    typeof finding.rawLocation === "object" && finding.rawLocation
      ? finding.rawLocation
      : typeof finding.location === "object"
        ? finding.location
        : null;
  const locPos = locObj?.position ?? null;
  const roomId =
    finding.roomId ||
    locObj?.roomId ||
    (typeof finding.location === "string" ? finding.location : null) ||
    null;

  const relatedAgentIds = Array.isArray(ev.agentIds)
    ? [...ev.agentIds]
    : finding.agentId
      ? [finding.agentId]
      : [];

  if (type === "CONGESTION") {
    const position = resolvePointFromContext(locPos, null, roomId, context);
    if (!position) return null;
    return {
      id: finding.id || `overlay-${type}`,
      kind: "hotspot",
      findingType: type,
      color: "#d4742c",
      radius: 0.78,
      position,
      roomId,
      relatedAgentIds,
    };
  }

  if (type === "PRIVACY_SIGHTLINE") {
    const source = resolvePointFromContext(
      ev.observerPosition ?? ev.sourcePosition,
      ev.sourceId,
      null,
      context,
    );
    const target = resolvePointFromContext(
      ev.targetPosition ?? locPos,
      ev.targetObjectId,
      roomId,
      context,
    );
    if (!source || !target) return null;
    return {
      id: finding.id || `overlay-${type}`,
      kind: "sightline",
      findingType: type,
      color: "#b84a39",
      dashed: true,
      elevation: 1.12,
      from: source,
      to: target,
      position: target,
      roomId,
      relatedAgentIds,
    };
  }

  if (type === "TV_OCCLUDED" || type === "TV_BAD_ANGLE" || type === "TV_TOO_FAR") {
    const viewer = resolvePointFromContext(
      ev.viewerPosition ?? locPos,
      ev.viewerObjectId,
      roomId,
      context,
    );
    const tv = resolvePointFromContext(
      ev.tvPosition,
      ev.tvObjectId,
      roomId,
      context,
    );
    if (viewer && tv) {
      return {
        id: finding.id || `overlay-${type}`,
        kind: "view-ray",
        findingType: type,
        color: type === "TV_OCCLUDED" ? "#c23f32" : "#c7862c",
        dashed: true,
        elevation: 0.96,
        from: viewer,
        to: tv,
        position: viewer,
        roomId,
        relatedAgentIds,
      };
    }
    if (viewer) {
      return {
        id: finding.id || `overlay-${type}`,
        kind: "hotspot",
        findingType: type,
        color: "#c7862c",
        radius: 0.62,
        position: viewer,
        roomId,
        relatedAgentIds,
      };
    }
    return null;
  }

  if (
    type === "EVACUATION_BOTTLENECK" ||
    type === "NO_EVACUATION_PATH" ||
    type === "NO_PATH" ||
    type === "ACCESSIBILITY_ROUTE_BLOCKED" ||
    type === "ACCESSIBILITY_CLEARANCE_FAIL"
  ) {
    const position = resolvePointFromContext(
      locPos,
      ev.exitDoorId || ev.doorId || ev.blockingDoorId,
      roomId,
      context,
    );
    if (!position) return null;
    return {
      id: finding.id || `overlay-${type}`,
      kind: "bottleneck",
      findingType: type,
      color: type.startsWith("ACCESSIBILITY_") ? "#2d6f96" : "#c43828",
      radius: 0.72,
      position,
      doorId: ev.exitDoorId || ev.doorId || null,
      roomId,
      relatedAgentIds,
    };
  }

  if (type === "ACCESSIBILITY_TURN_RADIUS_FAIL") {
    const position = resolvePointFromContext(locPos, null, roomId, context);
    if (!position) return null;
    return {
      id: finding.id || `overlay-${type}`,
      kind: "hotspot",
      findingType: type,
      color: "#2d6f96",
      radius: 0.75, // 1.50 m turning circle diameter visualized at true meter scale!
      position,
      roomId,
      relatedAgentIds,
    };
  }

  // Graceful fallback for NOISE_CONFLICT, SUN_GLARE, LONG_PATH, or unknown future types
  const fallbackPos = resolvePointFromContext(locPos, null, roomId, context);
  if (!fallbackPos) return null;
  return {
    id: finding.id || `overlay-${type}`,
    kind: "hotspot",
    findingType: type,
    color: "#55798c",
    radius: 0.58,
    position: fallbackPos,
    roomId,
    relatedAgentIds,
  };
}

/**
 * Select routes to display at `timestampSeconds`:
 * - When `showAllRoutes` is true, returns all planned/evacuation routes.
 * - Otherwise returns ONLY active route segments for currently moving agents (plus evacuation routes during fire scenarios).
 */
export function selectVisibleRoutes({
  routes = [],
  agentRoutes = [],
  snapshots = [],
  timestampSeconds = 0,
  showAllRoutes = false,
  isEvacuation = false,
} = {}) {
  const out = [];

  if (isEvacuation && Array.isArray(agentRoutes) && agentRoutes.length > 0) {
    for (const r of agentRoutes) {
      if (Array.isArray(r?.path) && r.path.length >= 2) {
        out.push({
          id: `evac-${r.agentId}`,
          agentId: r.agentId,
          path: r.path,
          active: true,
          evacuation: true,
        });
      }
    }
    return out;
  }

  const movingAgents = new Set(
    snapshots.filter((s) => s?.moving).map((s) => s.agentId),
  );

  for (let i = 0; i < routes.length; i += 1) {
    const route = routes[i];
    if (!Array.isArray(route?.path) || route.path.length < 2) continue;
    const started =
      route.startTimestamp == null || timestampSeconds >= route.startTimestamp - 0.5;
    const notEnded =
      route.endTimestamp == null || timestampSeconds <= route.endTimestamp + 0.5;
    const isCurrentForMovingAgent =
      movingAgents.has(route.agentId) && started && notEnded;

    if (showAllRoutes || isCurrentForMovingAgent) {
      out.push({
        id: `route-${route.agentId}-${i}`,
        agentId: route.agentId,
        path: route.path,
        active: isCurrentForMovingAgent,
        evacuation: false,
      });
    }
  }
  return out;
}

function createNameLabelSprite(text, accentColor) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = "rgba(38, 39, 34, 0.86)";
  ctx.beginPath();
  ctx.roundRect(18, 10, 220, 44, 22);
  ctx.fill();

  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(44, 32, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#fffdf8";
  ctx.font = "600 22px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(String(text || "Member").slice(0, 14), 64, 33);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.95, 0.24, 1);
  sprite.position.set(0, 1.88, 0);
  sprite.renderOrder = 8;
  return { sprite, texture, material };
}

/**
 * Lightweight Three.js Avatar, Path, Finding Evidence & Redesign Transition Layer.
 * Reuses geometries and avatar meshes across frames with clean disposal.
 */
export function createSimulationSceneLayer({ scene, invalidate = () => {} }) {
  const root = new THREE.Group();
  root.name = "simulation-playback-layer";
  const avatarsGroup = new THREE.Group();
  const routesGroup = new THREE.Group();
  const findingsGroup = new THREE.Group();
  const patchGroup = new THREE.Group();
  root.add(routesGroup, findingsGroup, patchGroup, avatarsGroup);
  scene.add(root);

  // Shared unit geometries (allocated once, reused for up to 12+ avatars & wheelchairs)
  const sharedGeometries = {
    torso: new THREE.CylinderGeometry(0.16, 0.19, 0.92, 16),
    shoulders: new THREE.CapsuleGeometry(0.15, 0.14, 6, 12),
    head: new THREE.SphereGeometry(0.145, 16, 12),
    headingPip: new THREE.ConeGeometry(0.055, 0.14, 10),
    wheelTire: new THREE.TorusGeometry(0.28, 0.032, 10, 24),
    wheelCaster: new THREE.CylinderGeometry(0.075, 0.075, 0.04, 12),
    chairSeat: new THREE.BoxGeometry(0.46, 0.06, 0.44),
    chairBack: new THREE.BoxGeometry(0.44, 0.42, 0.05),
    shadow: new THREE.CircleGeometry(0.24, 20),
    halo: new THREE.RingGeometry(0.27, 0.35, 24),
    hotspotDisc: new THREE.CircleGeometry(1, 32),
    hotspotRing: new THREE.RingGeometry(0.84, 1.0, 32),
    endpointSphere: new THREE.SphereGeometry(0.075, 12, 10),
    bottleneckPillar: new THREE.CylinderGeometry(0.05, 0.05, 1.45, 12),
  };

  const shadowMat = new THREE.MeshBasicMaterial({
    color: "#2b2923",
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const focusHaloMat = new THREE.MeshBasicMaterial({
    color: "#d96236",
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });

  const avatarRecords = new Map();
  let focusedFindingId = null;
  let focusedAgentIds = new Set();
  let cachedFindings = [];
  let cachedContext = {};
  let disposed = false;

  function clearGroup(group) {
    while (group.children.length > 0) {
      const child = group.children[0];
      child.removeFromParent();
      child.traverse((node) => {
        if (node.geometry && !Object.values(sharedGeometries).includes(node.geometry)) {
          node.geometry.dispose();
        }
        if (node.material) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const m of mats) {
            if (m !== shadowMat && m !== focusHaloMat) {
              m.map?.dispose?.();
              m.dispose?.();
            }
          }
        }
      });
    }
  }

  function removeAvatar(agentId) {
    const rec = avatarRecords.get(agentId);
    if (!rec) return;
    rec.group.removeFromParent();
    rec.bodyMat.dispose();
    rec.headMat.dispose();
    rec.pipMat.dispose();
    rec.chairMat?.dispose?.();
    rec.label?.texture?.dispose();
    rec.label?.material?.dispose();
    avatarRecords.delete(agentId);
  }

  function ensureAvatar(
    agentId,
    { name, color, heightMeters = 1.72, usesWheelchair = false } = {},
  ) {
    const resolvedName = name || agentId;
    const style = deriveAgentStyle(agentId, color);
    const resolvedHeight =
      Number.isFinite(Number(heightMeters)) && Number(heightMeters) > 0.7
        ? Number(heightMeters)
        : usesWheelchair
          ? 1.34
          : 1.72;
    const chairFlag = Boolean(usesWheelchair);

    const existing = avatarRecords.get(agentId);
    if (
      existing &&
      existing.name === resolvedName &&
      existing.color === style.color &&
      existing.usesWheelchair === chairFlag &&
      Math.abs(existing.heightMeters - resolvedHeight) < 0.01
    ) {
      return existing;
    }
    if (existing) removeAvatar(agentId);

    const group = new THREE.Group();
    group.userData.agentId = agentId;
    group.userData.heightMeters = resolvedHeight;
    group.userData.usesWheelchair = chairFlag;

    const shadow = new THREE.Mesh(sharedGeometries.shadow, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    if (chairFlag) {
      shadow.scale.setScalar(1.48);
    }
    group.add(shadow);

    const halo = new THREE.Mesh(sharedGeometries.halo, focusHaloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.022;
    if (chairFlag) {
      halo.scale.setScalar(1.36);
    }
    halo.visible = false;
    group.add(halo);

    const body = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: style.color,
      roughness: 0.62,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: "#efe2cf",
      roughness: 0.58,
    });
    const pipMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    let chairMat = null;

    // Base standing geometry spans ~1.39 m to top of head at scaleY = 1.0 -> normalize to `resolvedHeight`
    const heightScale = chairFlag ? 0.78 : resolvedHeight / 1.72;
    const widthScale = chairFlag ? 0.96 : 0.86 + (heightScale - 0.75) * 0.35;

    const figure = new THREE.Group();
    const torso = new THREE.Mesh(sharedGeometries.torso, bodyMat);
    torso.position.y = 0.52;
    torso.castShadow = true;
    figure.add(torso);

    const shoulders = new THREE.Mesh(sharedGeometries.shoulders, bodyMat);
    shoulders.rotation.z = Math.PI / 2;
    shoulders.position.y = 0.92;
    figure.add(shoulders);

    const head = new THREE.Mesh(sharedGeometries.head, headMat);
    head.position.y = 1.24;
    head.castShadow = true;
    figure.add(head);

    figure.scale.set(widthScale, heightScale, widthScale);
    if (chairFlag) {
      figure.position.y = 0.14;
    }
    body.add(figure);

    if (chairFlag) {
      chairMat = new THREE.MeshStandardMaterial({
        color: "#33393f",
        roughness: 0.45,
        metalness: 0.35,
      });
      const seat = new THREE.Mesh(sharedGeometries.chairSeat, chairMat);
      seat.position.set(0, 0.46, -0.02);
      body.add(seat);

      const backrest = new THREE.Mesh(sharedGeometries.chairBack, chairMat);
      backrest.position.set(0, 0.69, -0.22);
      body.add(backrest);

      for (const side of [-1, 1]) {
        const wheel = new THREE.Mesh(sharedGeometries.wheelTire, chairMat);
        wheel.rotation.y = Math.PI / 2;
        wheel.position.set(side * 0.28, 0.29, -0.06);
        body.add(wheel);

        const caster = new THREE.Mesh(sharedGeometries.wheelCaster, chairMat);
        caster.rotation.z = Math.PI / 2;
        caster.position.set(side * 0.2, 0.08, 0.22);
        body.add(caster);
      }
    }

    // Subtle forward direction indicator along +X/+Z yaw
    const pip = new THREE.Mesh(sharedGeometries.headingPip, pipMat);
    pip.rotation.x = Math.PI / 2;
    pip.position.set(0, chairFlag ? 0.86 : 0.94 * heightScale, chairFlag ? 0.32 : 0.22);
    body.add(pip);

    group.add(body);

    const labelText = chairFlag ? `♿ ${resolvedName}` : resolvedName;
    const label = createNameLabelSprite(labelText, style.color);
    if (label) {
      label.sprite.position.set(
        0,
        chairFlag ? 1.56 : Math.max(1.38, 1.38 * heightScale + 0.44),
        0,
      );
      group.add(label.sprite);
    }

    avatarsGroup.add(group);
    const record = {
      agentId,
      name: resolvedName,
      color: style.color,
      heightMeters: resolvedHeight,
      usesWheelchair: chairFlag,
      group,
      body,
      figure,
      halo,
      bodyMat,
      headMat,
      pipMat,
      chairMat,
      label,
    };
    avatarRecords.set(agentId, record);
    return record;
  }

  function updateAvatars(snapshots = [], agentMeta = new Map()) {
    const activeIds = new Set();
    for (const snap of snapshots) {
      if (!snap?.agentId || !isPoint2D(snap.position)) continue;
      activeIds.add(snap.agentId);
      const meta = agentMeta.get(snap.agentId) || {};
      const rec = ensureAvatar(snap.agentId, {
        name: meta.name || snap.name || snap.agentId,
        color: meta.color || null,
        heightMeters: snap.heightMeters ?? meta.heightMeters ?? 1.72,
        usesWheelchair: Boolean(snap.usesWheelchair ?? meta.usesWheelchair),
      });
      rec.group.position.set(Number(snap.position[0]), 0, Number(snap.position[1]));
      // Subtle natural walking bob when actively walking (skipped for wheelchair users)
      if (snap.moving && !rec.usesWheelchair) {
        const phase = (Number(snap.timestamp) || 0) * 6.8 + (snap.agentId.charCodeAt(0) || 0);
        rec.body.position.y = Math.abs(Math.sin(phase)) * 0.028;
      } else {
        rec.body.position.y = 0;
      }
      if (Number.isFinite(Number(snap.yaw))) {
        // Simulation yaw = atan2(dx, dz) in X/Z plane -> Three.js +Z forward rotates by yaw or PI/2 - yaw:
        // Note: samplePointAlongPath computes Math.atan2(dx, dz), where yaw=0 faces +Z and yaw=PI/2 faces +X!
        // In Three.js, +Z forward rotated around Y by `yaw` faces `[sin(yaw), 0, cos(yaw)] = [dx, 0, dz]`!
        rec.body.rotation.y = Number(snap.yaw);
      }
      rec.halo.visible = focusedAgentIds.has(snap.agentId);
    }

    for (const id of [...avatarRecords.keys()]) {
      if (!activeIds.has(id)) removeAvatar(id);
    }
    invalidate();
  }

  function updateRoutes(visibleRoutes = [], agentMeta = new Map()) {
    clearGroup(routesGroup);
    for (const route of visibleRoutes) {
      if (!Array.isArray(route?.path) || route.path.length < 2) continue;
      const meta = agentMeta.get(route.agentId) || {};
      const style = deriveAgentStyle(route.agentId, meta.color);
      const y = route.evacuation ? 0.055 : 0.042;
      const points = route.path
        .filter(isPoint2D)
        .map(([x, z]) => new THREE.Vector3(Number(x), y, Number(z)));
      if (points.length < 2) continue;

      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: route.evacuation ? "#c9532e" : style.color,
        transparent: true,
        opacity: route.active ? 0.92 : 0.45,
      });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 3;
      routesGroup.add(line);

      const dest = points.at(-1);
      const pinMat = new THREE.MeshBasicMaterial({
        color: route.evacuation ? "#c9532e" : style.color,
      });
      const pin = new THREE.Mesh(sharedGeometries.endpointSphere, pinMat);
      pin.scale.setScalar(0.65);
      pin.position.copy(dest);
      routesGroup.add(pin);
    }
    invalidate();
  }

  function rebuildFindings() {
    clearGroup(findingsGroup);
    for (const finding of cachedFindings) {
      const spec = mapFindingToOverlaySpec(finding, cachedContext);
      if (!spec) continue;
      const isFocused = focusedFindingId != null && spec.id === focusedFindingId;
      const group = new THREE.Group();
      group.userData.findingId = spec.id;
      group.userData.findingType = spec.findingType;

      if (spec.kind === "hotspot" || spec.kind === "bottleneck") {
        const radius = spec.radius * (isFocused ? 1.22 : 1.0);
        const discMat = new THREE.MeshBasicMaterial({
          color: spec.color,
          transparent: true,
          opacity: isFocused ? 0.34 : 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const disc = new THREE.Mesh(sharedGeometries.hotspotDisc, discMat);
        disc.rotation.x = -Math.PI / 2;
        disc.scale.setScalar(radius);
        disc.position.set(spec.position[0], 0.032, spec.position[1]);
        group.add(disc);

        const ringMat = new THREE.MeshBasicMaterial({
          color: spec.color,
          transparent: true,
          opacity: isFocused ? 0.98 : 0.72,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(sharedGeometries.hotspotRing, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.scale.setScalar(radius);
        ring.position.set(spec.position[0], 0.036, spec.position[1]);
        group.add(ring);

        if (spec.kind === "bottleneck" || isFocused) {
          const pillarMat = new THREE.MeshBasicMaterial({
            color: spec.color,
            transparent: true,
            opacity: isFocused ? 0.85 : 0.55,
          });
          const pillar = new THREE.Mesh(sharedGeometries.bottleneckPillar, pillarMat);
          pillar.position.set(spec.position[0], 0.74, spec.position[1]);
          group.add(pillar);
        }
      } else if (spec.kind === "sightline" || spec.kind === "view-ray") {
        const y = spec.elevation ?? 1.1;
        const p1 = new THREE.Vector3(spec.from[0], y, spec.from[1]);
        const p2 = new THREE.Vector3(spec.to[0], y, spec.to[1]);
        const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const lineMat = new THREE.LineDashedMaterial({
          color: spec.color,
          dashSize: 0.22,
          gapSize: 0.14,
          transparent: true,
          opacity: isFocused ? 1.0 : 0.82,
        });
        const line = new THREE.Line(lineGeo, lineMat);
        line.computeLineDistances();
        line.renderOrder = 6;
        group.add(line);

        const endMat = new THREE.MeshBasicMaterial({ color: spec.color });
        for (const pt of [p1, p2]) {
          const marker = new THREE.Mesh(sharedGeometries.endpointSphere, endMat);
          marker.position.copy(pt);
          group.add(marker);
        }

        // Target floor ring
        const ringMat = new THREE.MeshBasicMaterial({
          color: spec.color,
          transparent: true,
          opacity: isFocused ? 0.95 : 0.6,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(sharedGeometries.hotspotRing, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.scale.setScalar(0.48);
        ring.position.set(spec.to[0], 0.036, spec.to[1]);
        group.add(ring);
      }

      findingsGroup.add(group);
    }
    invalidate();
  }

  function setFindings(findings = [], context = {}) {
    cachedFindings = Array.isArray(findings) ? [...findings] : [];
    cachedContext = context;
    rebuildFindings();
  }

  function focusFinding(findingOrNull) {
    if (!findingOrNull) {
      focusedFindingId = null;
      focusedAgentIds = new Set();
    } else {
      const spec = mapFindingToOverlaySpec(findingOrNull, cachedContext);
      focusedFindingId = findingOrNull.id || spec?.id || null;
      focusedAgentIds = new Set(spec?.relatedAgentIds || []);
    }
    for (const [agentId, rec] of avatarRecords.entries()) {
      rec.halo.visible = focusedAgentIds.has(agentId);
    }
    rebuildFindings();
  }

  function showPatchTransition(changes = []) {
    clearGroup(patchGroup);
    if (!Array.isArray(changes) || changes.length === 0) {
      invalidate();
      return;
    }
    for (const change of changes) {
      if (!isPoint2D(change?.from) || !isPoint2D(change?.to)) continue;
      const w = Number(change.width) || 0.8;
      const d = Number(change.depth) || 0.8;

      // Ghost footprint at previous location
      const ghostGeo = new THREE.PlaneGeometry(w, d);
      const ghostMat = new THREE.MeshBasicMaterial({
        color: "#8b8578",
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ghost = new THREE.Mesh(ghostGeo, ghostMat);
      ghost.rotation.x = -Math.PI / 2;
      ghost.position.set(Number(change.from[0]), 0.028, Number(change.from[1]));
      patchGroup.add(ghost);

      // Move line old -> new
      const pFrom = new THREE.Vector3(Number(change.from[0]), 0.06, Number(change.from[1]));
      const pTo = new THREE.Vector3(Number(change.to[0]), 0.06, Number(change.to[1]));
      const arrowGeo = new THREE.BufferGeometry().setFromPoints([pFrom, pTo]);
      const arrowMat = new THREE.LineBasicMaterial({ color: "#4e7a52" });
      patchGroup.add(new THREE.Line(arrowGeo, arrowMat));

      // Glow ring at new location
      const newRingMat = new THREE.MeshBasicMaterial({
        color: "#4e7a52",
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const newRing = new THREE.Mesh(sharedGeometries.hotspotRing, newRingMat);
      newRing.rotation.x = -Math.PI / 2;
      newRing.scale.setScalar(Math.max(w, d) * 0.62);
      newRing.position.set(Number(change.to[0]), 0.035, Number(change.to[1]));
      patchGroup.add(newRing);
    }
    invalidate();
  }

  function clear() {
    focusedFindingId = null;
    focusedAgentIds = new Set();
    cachedFindings = [];
    for (const id of [...avatarRecords.keys()]) removeAvatar(id);
    clearGroup(routesGroup);
    clearGroup(findingsGroup);
    clearGroup(patchGroup);
    invalidate();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clear();
    shadowMat.dispose();
    focusHaloMat.dispose();
    for (const geo of Object.values(sharedGeometries)) geo.dispose();
    root.removeFromParent();
  }

  return {
    root,
    avatarsGroup,
    routesGroup,
    findingsGroup,
    patchGroup,
    updateAvatars,
    updateRoutes,
    setFindings,
    focusFinding,
    showPatchTransition,
    clear,
    dispose,
    getAvatarCount: () => avatarRecords.size,
    getAvatarMesh: (agentId) => avatarRecords.get(agentId)?.group ?? null,
    getOverlayCount: () => findingsGroup.children.length,
  };
}
