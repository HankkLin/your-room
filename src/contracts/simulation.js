/**
 * Unified Household Life Simulation, Spatial Validator & Demo UI Contracts (AGENTS.md §3–5).
 *
 * Canonical single contract shared across:
 * - Deterministic spatial simulation & validators (`src/simulation/**`)
 * - Gemini explanation & ScenePatch redesign loop (`src/redesign/**`, `src/agents/**`)
 * - Three.js playback & Demo Controls UI (`src/components/simulation/**`, `src/components/avatar/**`)
 */

// ---------------------------------------------------------------------------
// 1. Deterministic Simulation & Validator Constants
// ---------------------------------------------------------------------------

export const CELL_OUTSIDE = 0;
export const CELL_WALKABLE = 1;
export const CELL_DOOR = 2;
export const CELL_BLOCKED = 3;

export const DEFAULT_GRID_CELL_SIZE = 0.1; // 10 cm grid cells on X/Z floor plane
export const DEFAULT_AGENT_RADIUS = 0.24; // meters (~48 cm shoulder/body clearance circle)
export const DEFAULT_PERSONAL_SPACE_RADIUS = 0.32; // meters per person (~0.64 m combined passing threshold)
export const DEFAULT_MOVEMENT_SPEED_MPS = 1.3; // meters / second

export const DEFAULT_CONGESTION_CONFIG = Object.freeze({
  minAgents: 2,
  radiusMeters: 1.6,
  minDurationSeconds: 60,
  includeRestActivities: false,
});

export const DEFAULT_LONG_PATH_METERS = 15.0;

export const FINDING_TYPES = Object.freeze({
  // Movement & Congestion
  NO_PATH: "NO_PATH",
  LONG_PATH: "LONG_PATH",
  CONGESTION: "CONGESTION",

  // Privacy Sightlines
  PRIVACY_SIGHTLINE: "PRIVACY_SIGHTLINE",

  // TV & Seating Visibility
  TV_OCCLUDED: "TV_OCCLUDED",
  TV_BAD_ANGLE: "TV_BAD_ANGLE",
  TV_TOO_FAR: "TV_TOO_FAR",

  // Schedule-Aware WFH Acoustics
  NOISE_CONFLICT: "NOISE_CONFLICT",

  // Fire / Emergency Evacuation
  NO_EVACUATION_PATH: "NO_EVACUATION_PATH",
  LONG_EVACUATION_ROUTE: "LONG_EVACUATION_ROUTE",
  EVACUATION_BOTTLENECK: "EVACUATION_BOTTLENECK",

  // Accessibility & Wheelchair Mobility
  ACCESSIBILITY_CLEARANCE_FAIL: "ACCESSIBILITY_CLEARANCE_FAIL",
  ACCESSIBILITY_TURN_RADIUS_FAIL: "ACCESSIBILITY_TURN_RADIUS_FAIL",
  ACCESSIBILITY_ROUTE_BLOCKED: "ACCESSIBILITY_ROUTE_BLOCKED",

  // Optional Environmental Glare
  SUN_GLARE: "SUN_GLARE",
});

export const STRESS_SCENARIO_TYPES = Object.freeze({
  FIRE_EVACUATION: "fire-evacuation",
  DINNER_PARTY: "dinner-party",
  GRANDPARENTS_VISIT: "grandparents-visit",
  FRIENDS_ARRIVAL: "friends-arrival",
});

export const DEMO_CHECKPOINT_TYPES = Object.freeze({
  MORNING_START: "MORNING_START",
  BATHROOM_CONFLICT: "BATHROOM_CONFLICT",
  BREAKFAST_CONGESTION: "BREAKFAST_CONGESTION",
  TV_NOISE_CONFLICT: "TV_NOISE_CONFLICT",
  GRANDPARENTS_ARRIVE: "GRANDPARENTS_ARRIVE",
  WHEELCHAIR_ACCESS_CHECK: "WHEELCHAIR_ACCESS_CHECK",
  FRIENDS_ARRIVE: "FRIENDS_ARRIVE",
  FIRE_START: "FIRE_START",
  REDESIGN_APPLIED: "REDESIGN_APPLIED",
  REPLAY_START: "REPLAY_START",
});

export const EXPERIENCE_CATEGORIES = Object.freeze([
  "movement",
  "privacy",
  "noise",
  "visibility",
  "safety",
]);

export const SIMULATION_EVENT_TYPES = Object.freeze({
  SCHEDULE_START: "SCHEDULE_START",
  ROUTE_PLANNED: "ROUTE_PLANNED",
  DOOR_TRAVERSED: "DOOR_TRAVERSED",
  ARRIVED: "ARRIVED",
  ROUTE_BLOCKED: "ROUTE_BLOCKED",
  AGENT_COLLISION: "AGENT_COLLISION",
  CONGESTION: "CONGESTION",
});

/**
 * Validate that a SimulationFinding object conforms to the deterministic contract.
 * @param {object} finding
 * @returns {boolean}
 */
export function isValidSimulationFinding(finding) {
  if (!finding || typeof finding !== "object") return false;
  if (!Object.values(FINDING_TYPES).includes(finding.type)) return false;
  if (
    typeof finding.severity !== "number" ||
    !Number.isFinite(finding.severity) ||
    finding.severity < 0 ||
    finding.severity > 1
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 2. Demo Controls & Playback UI Constants + Pure View-State Normalizer
// ---------------------------------------------------------------------------

export const DEMO_SCENARIOS = Object.freeze([
  {
    id: "morning-routine",
    name: "Morning Routine",
    description: "Family of four moves through wake-up, bathroom overlap, breakfast prep, and WFH start.",
  },
  {
    id: "normal-day",
    name: "Normal Day",
    description: "Full-day family rhythm across WFH calls, homework, TV overlap, meals, and bedtime.",
  },
  {
    id: "grandparents-visit",
    name: "Grandparents Visit — Accessibility",
    description: "Grandpa (wheelchair) & Grandma visit the family, testing doorway width, turning circles, and route reachability.",
  },
  {
    id: "friends-arrival",
    name: "Friends Arrive — Staged Crowd",
    description: "Friends arrive in distinct waves at the entry, clustering from hallway into living room and kitchen.",
  },
  {
    id: "saved-routine",
    name: "Saved Household Routine",
    description: "Replay the activities and times approved in your household.",
  },
  {
    id: "dinner-party-8-guests",
    name: "Dinner Party — 8 Guests",
    description: "High-occupancy gathering stressing kitchen and hallway clearance.",
  },
  {
    id: "fire-emergency",
    name: "Fire Emergency",
    description: "Emergency evacuation check from every room to the exterior exit.",
  },
]);

export const SUPPORTED_FRIEND_COUNTS = Object.freeze([4, 6, 8, 12, 16]);
export const SIMULATION_SPEEDS = Object.freeze([1, 5, 20]);

export const SIMULATION_STATUSES = Object.freeze([
  "READY",
  "RUNNING",
  "PAUSED",
  "COMPLETE",
  "ERROR",
]);

export const SCORE_CATEGORIES = Object.freeze([
  { key: "movement", label: "Movement" },
  { key: "privacy", label: "Privacy" },
  { key: "noise", label: "Noise" },
  { key: "visibility", label: "Visibility" },
  { key: "safety", label: "Safety" },
]);

export const FINDING_LEVELS = Object.freeze([
  "info",
  "warning",
  "critical",
  "success",
]);

const FINDING_TITLES = Object.freeze({
  NO_PATH: "Blocked household route",
  LONG_PATH: "Detour route length",
  CONGESTION: "Room congestion",
  PRIVACY_SIGHTLINE: "Privacy sightline exposure",
  TV_OCCLUDED: "TV sightline blocked",
  TV_BAD_ANGLE: "Off-axis TV viewing angle",
  TV_TOO_FAR: "TV viewing distance too far",
  NOISE_CONFLICT: "WFH noise conflict",
  NO_EVACUATION_PATH: "Blocked emergency exit route",
  LONG_EVACUATION_ROUTE: "Long emergency exit route",
  EVACUATION_BOTTLENECK: "Exit doorway bottleneck",
  ACCESSIBILITY_CLEARANCE_FAIL: "Wheelchair doorway / path clearance fail",
  ACCESSIBILITY_TURN_RADIUS_FAIL: "Insufficient wheelchair turning circle",
  ACCESSIBILITY_ROUTE_BLOCKED: "Wheelchair route blocked",
  SUN_GLARE: "Direct window glare",
});

/**
 * Map a SimulationFinding's explicit level or numeric severity (0..1) into a
 * presentation level without altering the underlying measurement.
 * @param {object} finding
 * @returns {"info" | "warning" | "critical" | "success"}
 */
export function resolveFindingLevel(finding) {
  if (FINDING_LEVELS.includes(finding?.level)) {
    return finding.level;
  }
  const type = String(finding?.type || "").toUpperCase();
  const severity = Number(finding?.severity);
  if (type === "CLEAR" || type === "PASS" || severity === 0) {
    return "success";
  }
  if (Number.isFinite(severity)) {
    if (severity >= 0.78) return "critical";
    if (severity >= 0.4) return "warning";
    return "info";
  }
  return "info";
}

function formatLocationLabel(loc, fallbackRoomId = null) {
  if (typeof loc === "string" && loc.trim()) return loc.trim();
  if (loc && typeof loc === "object") {
    if (typeof loc.label === "string" && loc.label.trim()) return loc.label.trim();
    if (typeof loc.roomId === "string" && loc.roomId.trim()) {
      return loc.roomId
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
    }
  }
  if (typeof fallbackRoomId === "string" && fallbackRoomId.trim()) {
    return fallbackRoomId
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return null;
}

export function formatFindingHeadline(finding = {}) {
  if (typeof finding.title === "string" && finding.title.trim()) {
    return finding.title.trim();
  }
  const type = String(finding.type || "INFO").toUpperCase();
  const roomLabel = formatLocationLabel(finding.location, finding.roomId);
  if (type === "TV_TOO_FAR" && Number.isFinite(finding.evidence?.modeledTvWidthMeters)) {
    return "TV appears too small from this seat";
  }
  if (type === "CONGESTION" && roomLabel) {
    return `${roomLabel} congestion`;
  }
  if (type === "PRIVACY_SIGHTLINE" && roomLabel) {
    return `${roomLabel} privacy sightline`;
  }
  if (type === "NO_PATH" && finding.fromRoomId && finding.toRoomId) {
    const from = formatLocationLabel(null, finding.fromRoomId);
    const to = formatLocationLabel(null, finding.toRoomId);
    return `Blocked route: ${from} → ${to}`;
  }
  if (type === "ACCESSIBILITY_CLEARANCE_FAIL" && roomLabel) {
    return `${roomLabel} wheelchair clearance fail`;
  }
  if (type === "ACCESSIBILITY_TURN_RADIUS_FAIL" && roomLabel) {
    return `${roomLabel} turning circle fail`;
  }
  if (type === "ACCESSIBILITY_ROUTE_BLOCKED") {
    const to = formatLocationLabel(null, finding.toRoomId || finding.roomId);
    return to ? `Wheelchair route blocked: ${to}` : "Wheelchair route blocked";
  }
  return FINDING_TITLES[type] || String(finding.type || "Simulation finding");
}

export function formatFindingWhyItMatters(finding = {}) {
  if (typeof finding.whyItMatters === "string" && finding.whyItMatters.trim()) {
    return finding.whyItMatters.trim();
  }
  const type = String(finding.type || "").toUpperCase();
  if (type.startsWith("ACCESSIBILITY_") || finding.evidence?.wheelchair) {
    return "Wheelchair and mobility-aid users need comfortable doorway clearance and a 1.50 m turning circle.";
  }
  switch (type) {
    case "CONGESTION":
      return "Family members squeeze past each other during peak routines, slowing meals and prep.";
    case "NO_PATH":
      return "Furniture or narrow gaps completely block reaching a scheduled room.";
    case "PRIVACY_SIGHTLINE":
      return "Open doors expose private fixtures or beds directly to shared social areas.";
    case "NOISE_CONFLICT":
      return "TV or social sound carries into a quiet work call or study zone.";
    case "TV_OCCLUDED":
    case "TV_BAD_ANGLE":
    case "TV_TOO_FAR":
      return "Seated family members strain to see the screen comfortably.";
    case "EVACUATION_BOTTLENECK":
    case "NO_EVACUATION_PATH":
    case "LONG_EVACUATION_ROUTE":
      return "Delays safe whole-family egress during an emergency drill.";
    case "SUN_GLARE":
      return "Direct sun washes out screens and causes eye strain.";
    default:
      return "Affects daily comfort and circulation.";
  }
}

export function formatFindingSummaryText(finding = {}) {
  if (typeof finding.summary === "string" && finding.summary.trim()) {
    return finding.summary.trim();
  }
  if (typeof finding.description === "string" && finding.description.trim()) {
    return finding.description.trim();
  }
  const type = String(finding.type || "").toUpperCase();
  const ev = finding.evidence || {};
  const roomLabel = formatLocationLabel(finding.location, finding.roomId) || "room";

  switch (type) {
    case "CONGESTION": {
      const count = ev.agentCount ?? ev.agents ?? 2;
      const mins = Number.isFinite(Number(ev.durationSeconds))
        ? `${(Number(ev.durationSeconds) / 60).toFixed(1)} min`
        : "sustained overlap";
      return `${count} occupants share tight standing clearance in ${roomLabel} (${mins}).`;
    }
    case "PRIVACY_SIGHTLINE": {
      const src = ev.sourceType || "entry";
      const tgt = ev.targetType || "fixture";
      return `Unobstructed line of sight from ${src} to ${tgt} in ${roomLabel}.`;
    }
    case "NO_PATH": {
      const from = formatLocationLabel(null, finding.fromRoomId) || "origin";
      const to = formatLocationLabel(null, finding.toRoomId) || "destination";
      return `No walkable clearance path from ${from} to ${to}.`;
    }
    case "NOISE_CONFLICT": {
      const mins = ev.overlapMinutes ? `${ev.overlapMinutes} min` : "scheduled window";
      return `Audible activity overlaps quiet work requirement for ${mins}.`;
    }
    case "TV_OCCLUDED":
      return "Furniture or partition blocks the seated sightline to the TV screen.";
    case "TV_BAD_ANGLE":
      return "Seating faces the TV at an uncomfortable off-axis viewing angle.";
    case "TV_TOO_FAR":
      if (Number.isFinite(ev.modeledTvWidthMeters) && Number.isFinite(ev.apparentScreenAngleDegrees) && Number.isFinite(ev.minScreenAngleDegrees)) {
        return `At ${ev.distanceMeters} m, the modeled TV width of ${ev.modeledTvWidthMeters} m spans approximately ${ev.apparentScreenAngleDegrees}° from this seat. The simulation target is ${ev.minScreenAngleDegrees}°.`;
      }
      return Number.isFinite(ev.distanceMeters) && Number.isFinite(ev.maxDistanceMeters)
        ? `The seat is ${ev.distanceMeters} m from the TV, beyond the ${ev.maxDistanceMeters} m distance check. Screen size is unknown.`
        : "The seat exceeds the simulation’s TV viewing distance check.";
    case "EVACUATION_BOTTLENECK":
      return `Simultaneous occupants converge on ${ev.exitDoorId || "exterior exit"} during evacuation.`;
    case "NO_EVACUATION_PATH":
      return `Occupant in ${roomLabel} has no unobstructed escape route to an exterior exit.`;
    case "LONG_EVACUATION_ROUTE":
      return `Escape path from ${roomLabel} exceeds recommended distance or travel time.`;
    case "ACCESSIBILITY_CLEARANCE_FAIL": {
      const measured = Number.isFinite(Number(ev.measuredWidthMeters))
        ? `${Number(ev.measuredWidthMeters).toFixed(2)} m`
        : "narrow opening";
      const required = Number.isFinite(Number(ev.requiredWidthMeters))
        ? `${Number(ev.requiredWidthMeters).toFixed(2)} m`
        : "0.82 m";
      return `Measured clearance (${measured}) in ${roomLabel} is narrower than wheelchair requirement (${required}).`;
    }
    case "ACCESSIBILITY_TURN_RADIUS_FAIL": {
      const diam = Number.isFinite(Number(ev.measuredTurnDiameterMeters))
        ? `${Number(ev.measuredTurnDiameterMeters).toFixed(2)} m`
        : "tight";
      const req = Number.isFinite(Number(ev.requiredTurnDiameterMeters))
        ? `${Number(ev.requiredTurnDiameterMeters).toFixed(2)} m`
        : "1.50 m";
      return `${roomLabel} provides only ${diam} unobstructed turning space (${req} wheelchair turn diameter needed).`;
    }
    case "ACCESSIBILITY_ROUTE_BLOCKED": {
      const to = formatLocationLabel(null, finding.toRoomId || finding.roomId) || roomLabel;
      return `Wheelchair occupant cannot reach ${to} with safe side clearance.`;
    }
    case "SUN_GLARE":
      return `Direct window sunlight intersects workspace or screen in ${roomLabel}.`;
    default:
      return "";
  }
}

function normalizeScoreMap(scores) {
  if (!scores || typeof scores !== "object") return null;
  const out = {};
  let hasAny = false;
  for (const { key } of SCORE_CATEGORIES) {
    const raw = scores[key] ?? scores[key[0].toUpperCase() + key.slice(1)];
    if (raw !== undefined && raw !== null && Number.isFinite(Number(raw))) {
      out[key] = Math.round(Number(raw));
      hasAny = true;
    } else {
      out[key] = null;
    }
  }
  return hasAny ? out : null;
}

/**
 * Normalize an external simulation state payload for safe UI rendering,
 * preserving structured `evidence`, `rawLocation`, and redesign metadata.
 * @param {object} [raw]
 */
export function normalizeSimulationViewState(raw = {}) {
  const status = SIMULATION_STATUSES.includes(raw?.status)
    ? raw.status
    : "READY";
  const scenarioId = DEMO_SCENARIOS.some((s) => s.id === raw?.scenarioId)
    ? raw.scenarioId
    : DEMO_SCENARIOS[0].id;
  const speed = SIMULATION_SPEEDS.includes(Number(raw?.speed))
    ? Number(raw.speed)
    : 1;
  const friendCount = SUPPORTED_FRIEND_COUNTS.includes(Number(raw?.friendCount))
    ? Number(raw.friendCount)
    : Number.isFinite(Number(raw?.friendCount)) && Number(raw?.friendCount) >= 1
      ? Math.min(24, Math.round(Number(raw.friendCount)))
      : 8;
  const currentTime =
    typeof raw?.currentTime === "string" && raw.currentTime.trim()
      ? raw.currentTime.trim()
      : null;

  const findings = Array.isArray(raw?.findings)
    ? raw.findings.filter(Boolean).map((f, idx) => ({
        id: String(
          f.id ||
            `finding-${String(f.type || "item").toLowerCase()}-${f.roomId || idx + 1}-${idx + 1}`,
        ),
        type: String(f.type || "INFO"),
        severity: Number.isFinite(Number(f.severity)) ? Number(f.severity) : null,
        level: resolveFindingLevel(f),
        title: formatFindingHeadline(f),
        summary: formatFindingSummaryText(f),
        whyItMatters: formatFindingWhyItMatters(f),
        isAccessibility:
          String(f.type || "").toUpperCase().startsWith("ACCESSIBILITY_") ||
          Boolean(f.evidence?.wheelchair),
        location: formatLocationLabel(f.location, f.roomId),
        rawLocation:
          f.rawLocation ?? (typeof f.location === "object" ? f.location : null),
        roomId:
          f.roomId ||
          (typeof f.location === "object" ? f.location?.roomId : null) ||
          null,
        fromRoomId: f.fromRoomId || null,
        toRoomId: f.toRoomId || null,
        agentId: f.agentId || null,
        evidence:
          f.evidence && typeof f.evidence === "object" ? { ...f.evidence } : null,
      }))
    : [];

  const beforeScores = normalizeScoreMap(raw?.beforeScores);
  const afterScores = normalizeScoreMap(raw?.afterScores);
  const scores = normalizeScoreMap(raw?.scores) ?? beforeScores;

  const overallBeforeScore = raw?.overallBeforeScore != null && Number.isFinite(Number(raw.overallBeforeScore))
    ? Math.round(Number(raw.overallBeforeScore))
    : null;
  const overallAfterScore = raw?.overallAfterScore != null && Number.isFinite(Number(raw.overallAfterScore))
    ? Math.round(Number(raw.overallAfterScore))
    : null;

  const redesignActions = Array.isArray(raw?.redesignActions)
    ? raw.redesignActions
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim())
    : [];

  const normalizeSimpleFindingList = (list) =>
    Array.isArray(list)
      ? list.filter(Boolean).map((f) => ({
          type: String(f.type || "INFO"),
          roomId:
            f.roomId ||
            (typeof f.location === "object" ? f.location?.roomId : null) ||
            null,
          title: formatFindingHeadline(f),
          location: formatLocationLabel(f.location, f.roomId),
        }))
      : [];

  const attemptSummaries = Array.isArray(raw?.attemptSummaries)
    ? raw.attemptSummaries
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim())
    : [];

  const errorMessage =
    typeof raw?.errorMessage === "string" && raw.errorMessage.trim()
      ? raw.errorMessage.trim()
      : null;

  const redesignMessage =
    typeof raw?.redesignMessage === "string" && raw.redesignMessage.trim()
      ? raw.redesignMessage.trim()
      : null;

  const startSecond = Number.isFinite(Number(raw?.startSecond))
    ? Number(raw.startSecond)
    : 0;
  const endSecond = Number.isFinite(Number(raw?.endSecond))
    ? Number(raw.endSecond)
    : 0;
  const currentSecond = Number.isFinite(Number(raw?.currentSecond))
    ? Number(raw.currentSecond)
    : startSecond;

  const checkpoints = Array.isArray(raw?.checkpoints)
    ? raw.checkpoints
        .filter((cp) => cp && typeof cp === "object" && (cp.id || cp.type))
        .map((cp, idx) => ({
          id: String(cp.id || `cp-${idx + 1}`),
          type: String(cp.type || cp.id),
          label: String(cp.label || cp.type || `Checkpoint ${idx + 1}`),
          timestampSeconds: Number.isFinite(Number(cp.timestampSeconds))
            ? Number(cp.timestampSeconds)
            : startSecond,
          minute: Number.isFinite(Number(cp.minute))
            ? Number(cp.minute)
            : Math.round((Number(cp.timestampSeconds) || startSecond) / 60),
          roomId: cp.roomId || null,
          description: typeof cp.description === "string" ? cp.description : "",
        }))
    : [];

  return {
    status,
    scenarioId,
    friendCount,
    speed,
    currentTime,
    hasTimeline: Boolean(raw?.hasTimeline && endSecond > startSecond),
    startSecond,
    endSecond,
    currentSecond,
    checkpoints,
    activeCheckpointId:
      typeof raw?.activeCheckpointId === "string" ? raw.activeCheckpointId : null,
    showAllRoutes: Boolean(raw?.showAllRoutes),
    selectedFindingId:
      typeof raw?.selectedFindingId === "string" ? raw.selectedFindingId : null,
    hasLayoutToggle: Boolean(raw?.hasLayoutToggle),
    activeLayoutView: raw?.activeLayoutView === "after" ? "after" : "before",
    canRedesign: Boolean(raw?.canRedesign),
    redesignPending: Boolean(raw?.redesignPending),
    redesignStatus: raw?.redesignStatus || null,
    redesignMessage,
    isFallbackRedesign: Boolean(raw?.isFallbackRedesign),
    findings,
    scores,
    beforeScores,
    afterScores,
    overallBeforeScore,
    overallAfterScore,
    resolvedFindings: normalizeSimpleFindingList(raw?.resolvedFindings),
    remainingFindings: normalizeSimpleFindingList(raw?.remainingFindings),
    introducedFindings: normalizeSimpleFindingList(raw?.introducedFindings),
    attemptSummaries,
    redesignActions,
    errorMessage,
    isMockData: Boolean(raw?.isMockData),
  };
}
