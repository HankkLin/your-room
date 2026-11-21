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

export function formatAvatarActivityStatus(snap = {}, meta = {}) {
  const rawName = String(meta.name || snap.name || snap.agentId || "Member").trim();
  const usesWheelchair = Boolean(snap.usesWheelchair ?? meta.usesWheelchair);
  const shortBaseName = rawName.replace(/\s*\((?:Dad|Mom|Brother|Sister|Wheelchair|Wave\s*\d+)\)\s*$/i, "").trim() || rawName;
  const displayName = usesWheelchair && !shortBaseName.includes("♿")
    ? `${shortBaseName} ♿`
    : shortBaseName;

  const isMoving = Boolean(snap.isMoving ?? snap.moving);
  const rawEvent = String(snap.activityLabel || snap.eventLabel || "").trim();
  const rawActivity = String(snap.activity || "").trim();
  const roomName = String(snap.destinationLabel || snap.roomId || "")
    .replace(/[-_]+/g, " ")
    .trim();

  if (isMoving) {
    if (rawEvent && /^(walking|going|heading|evacuating)/i.test(rawEvent)) {
      return {
        personId: snap.personId || snap.agentId,
        name: displayName,
        activityLabel: rawEvent,
        destinationLabel: roomName,
        isMoving: true,
      };
    }
    const target = rawActivity.startsWith("going-to-")
      ? rawActivity.slice("going-to-".length).replace(/[-_]+/g, " ")
      : roomName || "next room";
    const moveText = usesWheelchair ? `Going to the ${target}` : `Walking to ${target}`;
    return {
      personId: snap.personId || snap.agentId,
      name: displayName,
      activityLabel: moveText,
      destinationLabel: target,
      isMoving: true,
    };
  }

  const FRIENDLY_FALLBACKS = {
    sleep: "Sleeping",
    wake: "Waking up",
    bathroom: "Brushing teeth",
    cook: "Making breakfast",
    breakfast: "Eating breakfast",
    eat: "Packing lunch",
    work: "Working from home",
    study: "Studying at desk",
    watchTv: "Watching TV",
    socialize: "Visiting & chatting",
    relax: "Relaxing",
    exercise: "Stretching",
    evacuate: "Evacuating",
    idle: "At home",
    other: "Getting ready",
  };

  const activityLabel =
    rawEvent && !/^going-to-/i.test(rawEvent)
      ? rawEvent
      : FRIENDLY_FALLBACKS[rawActivity] || rawActivity || "At home";

  return {
    personId: snap.personId || snap.agentId,
    name: displayName,
    activityLabel,
    destinationLabel: roomName,
    isMoving: false,
  };
}

function drawNameAndActivityLabel(ctx, canvas, { nameText, activityText, accentColor, isMoving }) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Crisp rounded pill readable against light architectural walls & wood floors
  ctx.fillStyle = "rgba(28, 30, 27, 0.90)";
  ctx.beginPath();
  ctx.roundRect(10, 8, canvas.width - 20, canvas.height - 16, 20);
  ctx.fill();

  ctx.strokeStyle = isMoving ? accentColor : "rgba(255, 253, 248, 0.24)";
  ctx.lineWidth = isMoving ? 3 : 1.5;
  ctx.beginPath();
  ctx.roundRect(10, 8, canvas.width - 20, canvas.height - 16, 20);
  ctx.stroke();

  // Persona color dot
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(36, 40, 10, 0, Math.PI * 2);
  ctx.fill();

  // Line 1: Name
  ctx.fillStyle = "#fffdf8";
  ctx.font = "700 24px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(String(nameText || "Member").slice(0, 22), 56, 36);

  // Line 2: Current activity
  ctx.fillStyle = isMoving ? "#ffdca8" : "#d6dfd8";
  ctx.font = "600 19px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText(String(activityText || "At home").slice(0, 28), 56, 68);
}

function createNameLabelSprite(nameText, accentColor, activityText = "At home") {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 104;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const initialKey = `${nameText}|${activityText}|0`;
  drawNameAndActivityLabel(ctx, canvas, {
    nameText,
    activityText,
    accentColor,
    isMoving: false,
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.38, 0.37, 1);
  sprite.position.set(0, 1.96, 0);
  sprite.renderOrder = 8;
  return { sprite, texture, material, canvas, ctx, lastKey: initialKey };
}

const POPUP_TOTAL_MS = 2800;
const POPUP_FADE_MS = 650;
const POPUP_COOLDOWN_MS = 5200;

export function formatLiveFindingPopupSpec(finding, context = {}) {
  if (!finding || typeof finding !== "object") return null;
  const type = String(finding.type || "").toUpperCase();
  const ev = finding.evidence || {};
  const locObj =
    typeof finding.rawLocation === "object" && finding.rawLocation
      ? finding.rawLocation
      : typeof finding.location === "object"
        ? finding.location
        : null;
  const roomId =
    finding.roomId ||
    locObj?.roomId ||
    (typeof finding.location === "string" ? finding.location : null) ||
    ev.receiverRoomId ||
    null;
  const roomObj =
    roomId && Array.isArray(context?.house?.rooms)
      ? context.house.rooms.find(
          (r) =>
            r.id === roomId ||
            r.name?.toLowerCase() === String(roomId).toLowerCase(),
        )
      : null;
  const roomLabel =
    roomObj?.name ||
    (roomId
      ? String(roomId)
          .replace(/[-_]+/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : "");

  let text = "⚠ Spatial issue";
  let bg = "#a64026";

  if (type === "CONGESTION") {
    text = roomLabel
      ? `⚠ ${roomLabel} congestion`
      : "⚠ Congestion";
    bg = "#c45724";
  } else if (type === "NOISE_CONFLICT") {
    text = "🔊 Noise conflict";
    bg = "#9e4d28";
  } else if (type === "PRIVACY_SIGHTLINE") {
    text = "👁 Privacy issue";
    bg = "#9c3b4c";
  } else if (type.startsWith("ACCESSIBILITY_") || type === "NO_PATH") {
    text =
      type === "ACCESSIBILITY_TURN_RADIUS_FAIL"
        ? "♿ Tight turn space"
        : "♿ Path blocked";
    bg = "#255d83";
  } else if (
    type === "EVACUATION_BOTTLENECK" ||
    type === "NO_EVACUATION_PATH" ||
    type === "LONG_EVACUATION_ROUTE"
  ) {
    text =
      type === "NO_EVACUATION_PATH"
        ? "⚠ Exit blocked"
        : "⚠ Exit bottleneck";
    bg = "#b53324";
  } else if (
    type === "TV_OCCLUDED" ||
    type === "TV_BAD_ANGLE" ||
    type === "TV_TOO_FAR"
  ) {
    text = "📺 Poor TV view";
    bg = "#9e6b24";
  } else if (type === "SUN_GLARE") {
    text = "☀ Glare on desk";
    bg = "#b0741e";
  } else if (type === "LONG_PATH") {
    text = "⚠ Detour route";
    bg = "#8d5c2c";
  } else {
    return null;
  }

  return { text, bg, roomId: roomObj?.id || roomId || null };
}

function createLivePopupSprite(text, bgColor) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 416;
  canvas.height = 88;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = bgColor || "#b84426";
  ctx.beginPath();
  ctx.roundRect(12, 10, canvas.width - 24, canvas.height - 20, 34);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 252, 244, 0.85)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(12, 10, canvas.width - 24, canvas.height - 20, 34);
  ctx.stroke();

  ctx.fillStyle = "#fffefa";
  ctx.font = "700 25px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(text).slice(0, 26), canvas.width / 2, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 1,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.48, 0.31, 1);
  sprite.renderOrder = 12;
  return { sprite, texture, material };
}

function isFindingActiveAtSecond(finding, sec, snapshotsById, context) {
  const type = String(finding?.type || "").toUpperCase();
  const ev = finding?.evidence || {};

  if (
    Number.isFinite(Number(ev.startTimestamp)) &&
    Number.isFinite(Number(ev.endTimestamp))
  ) {
    return sec >= Number(ev.startTimestamp) - 1 && sec <= Number(ev.endTimestamp) + 3;
  }

  if (
    Array.isArray(ev.overlapWindowMinutes) &&
    ev.overlapWindowMinutes.length >= 2
  ) {
    const s = Number(ev.overlapWindowMinutes[0]) * 60;
    const e = Number(ev.overlapWindowMinutes[1]) * 60;
    if (Number.isFinite(s) && Number.isFinite(e)) {
      return sec >= s && sec <= e;
    }
  }

  if (Number.isFinite(Number(ev.timestampSeconds))) {
    const t = Number(ev.timestampSeconds);
    return sec >= t - 1 && sec <= t + 20;
  }

  if (
    type === "EVACUATION_BOTTLENECK" ||
    type === "NO_EVACUATION_PATH" ||
    type === "LONG_EVACUATION_ROUTE"
  ) {
    return sec >= 1.5;
  }

  const overlay = mapFindingToOverlaySpec(finding, context);
  const targetRoomId = finding?.roomId || overlay?.roomId || null;

  if (type.startsWith("ACCESSIBILITY_")) {
    for (const snap of snapshotsById.values()) {
      if (!snap.usesWheelchair && !/grand|wheelchair/i.test(String(snap.name || ""))) continue;
      if (snap.moving || (targetRoomId && snap.roomId === targetRoomId)) {
        return true;
      }
      if (overlay?.position && isPoint2D(snap.position)) {
        if (
          Math.hypot(
            snap.position[0] - overlay.position[0],
            snap.position[1] - overlay.position[1],
          ) < 2.2
        ) {
          return true;
        }
      }
    }
    return false;
  }

  if (targetRoomId) {
    for (const snap of snapshotsById.values()) {
      if (snap.roomId === targetRoomId) return true;
    }
    return false;
  }

  return false;
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
  const popupsGroup = new THREE.Group();
  root.add(routesGroup, findingsGroup, patchGroup, avatarsGroup, popupsGroup);
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
  let liveFindings = [];
  let liveFindingsContext = {};
  const activePopups = new Map();
  const popupDedupe = new Map();
  let popupTickRaf = 0;
  let disposed = false;

  function stopPopupTicker() {
    if (popupTickRaf && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(popupTickRaf);
    }
    popupTickRaf = 0;
  }

  function removePopupEntry(dedupeKey) {
    const entry = activePopups.get(dedupeKey);
    if (!entry) return;
    entry.sprite.removeFromParent();
    entry.texture?.dispose?.();
    entry.material?.dispose?.();
    activePopups.delete(dedupeKey);
  }

  function clearPopups() {
    stopPopupTicker();
    for (const key of [...activePopups.keys()]) removePopupEntry(key);
    popupDedupe.clear();
  }

  function tickPopups(nowMs = performance.now()) {
    let changed = false;
    for (const [key, entry] of [...activePopups.entries()]) {
      const elapsed = nowMs - entry.bornAtMs;
      if (elapsed >= POPUP_TOTAL_MS) {
        removePopupEntry(key);
        changed = true;
        continue;
      }
      if (entry.agentId) {
        const avatarRec = avatarRecords.get(entry.agentId);
        if (avatarRec) {
          const baseY = avatarRec.usesWheelchair
            ? 2.02
            : Math.max(1.92, 1.38 * (avatarRec.heightMeters / 1.72) + 0.9);
          entry.sprite.position.set(
            avatarRec.group.position.x,
            baseY + Math.min(0.08, (elapsed / POPUP_TOTAL_MS) * 0.08),
            avatarRec.group.position.z,
          );
          changed = true;
        }
      }
      const fadeStart = POPUP_TOTAL_MS - POPUP_FADE_MS;
      const nextOpacity =
        elapsed <= fadeStart
          ? 1
          : Math.max(0, 1 - (elapsed - fadeStart) / POPUP_FADE_MS);
      if (Math.abs(entry.material.opacity - nextOpacity) > 0.01) {
        entry.material.opacity = nextOpacity;
        changed = true;
      }
    }
    if (changed) invalidate();
    if (activePopups.size > 0 && !disposed && typeof requestAnimationFrame === "function") {
      if (!popupTickRaf) {
        popupTickRaf = requestAnimationFrame((ts) => {
          popupTickRaf = 0;
          tickPopups(ts);
        });
      }
    } else {
      stopPopupTicker();
    }
  }

  function setLiveFindings(findings = [], context = {}) {
    liveFindings = Array.isArray(findings) ? [...findings] : [];
    liveFindingsContext = context || {};
    clearPopups();
  }

  function updateLivePopups(snapshots = [], timestampSeconds = 0) {
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!liveFindings.length) {
      tickPopups(nowMs);
      return;
    }

    const snapshotsById = new Map();
    for (const snap of snapshots) {
      if (snap?.agentId) snapshotsById.set(snap.agentId, snap);
    }

    for (let i = 0; i < liveFindings.length; i += 1) {
      const finding = liveFindings[i];
      const findingKey = String(finding.id || `${finding.type || "finding"}-${i}`);
      const isActive = isFindingActiveAtSecond(
        finding,
        timestampSeconds,
        snapshotsById,
        liveFindingsContext,
      );

      const ev = finding?.evidence || {};
      const candidateIds = new Set();
      if (Array.isArray(ev.agentIds)) {
        for (const id of ev.agentIds) if (id) candidateIds.add(String(id));
      }
      if (finding?.agentId) candidateIds.add(String(finding.agentId));
      if (ev.workerAgentId) candidateIds.add(String(ev.workerAgentId));
      if (ev.sourceAgentId) candidateIds.add(String(ev.sourceAgentId));

      // Keep only agentIds that are currently present in the room/scene
      const presentAgentIds = [...candidateIds].filter((id) => avatarRecords.has(id));
      const targets =
        presentAgentIds.length > 0
          ? presentAgentIds.slice(0, 2).map((id) => ({ kind: "agent", agentId: id }))
          : [{ kind: "location", agentId: null }];

      for (const target of targets) {
        const dedupeKey = `${findingKey}|${target.agentId || "@hotspot"}`;
        const stateRec = popupDedupe.get(dedupeKey) || {
          wasActive: false,
          lastShownMs: -Infinity,
        };

        if (!isActive) {
          if (stateRec.wasActive) {
            popupDedupe.set(dedupeKey, { ...stateRec, wasActive: false });
          }
          continue;
        }

        const cooldownElapsed = nowMs - stateRec.lastShownMs >= POPUP_COOLDOWN_MS;
        if (!stateRec.wasActive && cooldownElapsed && !activePopups.has(dedupeKey)) {
          const spec = formatLiveFindingPopupSpec(finding, liveFindingsContext);
          if (spec) {
            let worldX = null;
            let worldZ = null;
            let worldY = 1.95;
            if (target.agentId) {
              const av = avatarRecords.get(target.agentId);
              if (av) {
                worldX = av.group.position.x;
                worldZ = av.group.position.z;
                worldY = av.usesWheelchair
                  ? 2.02
                  : Math.max(1.92, 1.38 * (av.heightMeters / 1.72) + 0.9);
              }
            } else {
              const overlay = mapFindingToOverlaySpec(finding, liveFindingsContext);
              if (overlay?.position) {
                worldX = overlay.position[0];
                worldZ = overlay.position[1];
                worldY = 1.75;
              }
            }

            if (worldX !== null && worldZ !== null) {
              const popupObj = createLivePopupSprite(spec.text, spec.bg);
              if (popupObj) {
                popupObj.sprite.position.set(worldX, worldY, worldZ);
                popupsGroup.add(popupObj.sprite);
                activePopups.set(dedupeKey, {
                  ...popupObj,
                  agentId: target.agentId,
                  findingKey,
                  text: spec.text,
                  bornAtMs: nowMs,
                });
                popupDedupe.set(dedupeKey, {
                  wasActive: true,
                  lastShownMs: nowMs,
                });
              }
            }
          }
        } else if (!stateRec.wasActive) {
          popupDedupe.set(dedupeKey, { ...stateRec, wasActive: true });
        }
      }
    }

    tickPopups(nowMs);
  }

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

    const statusInfo = formatAvatarActivityStatus(
      { agentId, name: resolvedName, usesWheelchair: chairFlag },
      { name: resolvedName, usesWheelchair: chairFlag },
    );
    const label = createNameLabelSprite(statusInfo.name, style.color, statusInfo.activityLabel);
    if (label) {
      label.sprite.position.set(
        0,
        chairFlag ? 1.64 : Math.max(1.48, 1.38 * heightScale + 0.52),
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
      renderedYaw: null,
      currentStatus: statusInfo,
    };
    avatarRecords.set(agentId, record);
    return record;
  }

  function shortestAngleDelta(fromRad, toRad) {
    let diff = (Number(toRad) || 0) - (Number(fromRad) || 0);
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return diff;
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

      const statusInfo = formatAvatarActivityStatus(snap, meta);
      rec.currentStatus = statusInfo;
      rec.group.userData.activityStatus = statusInfo;

      // Update floating 2-line Name + Activity sprite only when text or motion state changes
      if (rec.label?.ctx) {
        const nextKey = `${statusInfo.name}|${statusInfo.activityLabel}|${statusInfo.isMoving ? 1 : 0}`;
        if (rec.label.lastKey !== nextKey) {
          rec.label.lastKey = nextKey;
          drawNameAndActivityLabel(rec.label.ctx, rec.label.canvas, {
            nameText: statusInfo.name,
            activityText: statusInfo.activityLabel,
            accentColor: rec.color,
            isMoving: statusInfo.isMoving,
          });
          rec.label.texture.needsUpdate = true;
        }
      }

      // Subtle natural walking bob when actively walking (skipped for wheelchair users)
      if (statusInfo.isMoving && !rec.usesWheelchair) {
        const phase = (Number(snap.timestamp) || 0) * 6.8 + (snap.agentId.charCodeAt(0) || 0);
        rec.body.position.y = Math.abs(Math.sin(phase)) * 0.032;
      } else {
        rec.body.position.y = 0;
      }
      if (Number.isFinite(Number(snap.yaw))) {
        const targetYaw = Number(snap.yaw);
        if (rec.renderedYaw === null || !statusInfo.isMoving) {
          rec.renderedYaw = targetYaw;
        } else {
          rec.renderedYaw += shortestAngleDelta(rec.renderedYaw, targetYaw) * 0.35;
        }
        rec.body.rotation.y = rec.renderedYaw;
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
    liveFindings = [];
    clearPopups();
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
    popupsGroup,
    updateAvatars,
    updateRoutes,
    setFindings,
    setLiveFindings,
    updateLivePopups,
    focusFinding,
    showPatchTransition,
    clear,
    dispose,
    getAvatarCount: () => avatarRecords.size,
    getAvatarMesh: (agentId) => avatarRecords.get(agentId)?.group ?? null,
    getAvatarStatuses: () =>
      [...avatarRecords.values()].map((r) => ({ ...r.currentStatus })),
    getOverlayCount: () => findingsGroup.children.length,
    getActivePopups: () =>
      [...activePopups.values()].map((p) => ({
        agentId: p.agentId,
        findingKey: p.findingKey,
        text: p.text,
        opacity: p.material.opacity,
      })),
  };
}
