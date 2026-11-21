/**
 * Canonical Shared Household Life Simulation & UI Presentation Contracts (AGENTS.md §3–4).
 *
 * Unifies:
 * 1. Deterministic spatial simulation & validator constants (`CELL_*`, `FINDING_TYPES`,
 *    `STRESS_SCENARIO_TYPES`, `EXPERIENCE_CATEGORIES`, `SIMULATION_EVENT_TYPES`, `isValidSimulationFinding`)
 * 2. Demo Controls / Playback UI view-state normalization (`DEMO_SCENARIOS`, `SIMULATION_SPEEDS`,
 *    `SIMULATION_STATUSES`, `SCORE_CATEGORIES`, `FINDING_LEVELS`, `resolveFindingLevel`, `normalizeSimulationViewState`)
 */

// --- 1. Deterministic Simulation & Validator Constants ---

export const CELL_OUTSIDE = 0;
export const CELL_WALKABLE = 1;
export const CELL_DOOR = 2;
export const CELL_BLOCKED = 3;

export const DEFAULT_GRID_CELL_SIZE = 0.1; // 10 cm grid cells on X/Z floor plane
export const DEFAULT_AGENT_RADIUS = 0.24; // meters (approx 48 cm shoulder/body clearance circle)
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

  // Optional Environmental Glare
  SUN_GLARE: "SUN_GLARE",
});

export const STRESS_SCENARIO_TYPES = Object.freeze({
  FIRE_EVACUATION: "fire-evacuation",
  DINNER_PARTY: "dinner-party",
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

// --- 2. Demo Controls & Playback UI View-State Helpers ---

export const DEMO_SCENARIOS = Object.freeze([
  {
    id: "morning-routine",
    name: "Morning Routine",
    description: "Household members move through their normal morning schedule.",
  },
  {
    id: "normal-day",
    name: "Normal Day",
    description: "Full-day routine across work, meals, leisure, and rest.",
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

function normalizeScoreMap(scores) {
  if (!scores || typeof scores !== "object") return null;
  const out = {};
  let hasAny = false;
  for (const { key } of SCORE_CATEGORIES) {
    const entry = scores[key] ?? scores[key[0].toUpperCase() + key.slice(1)];
    const raw =
      entry !== null && typeof entry === "object" && Object.hasOwn(entry, "score")
        ? entry.score
        : entry;
    if (raw !== undefined && raw !== null && Number.isFinite(Number(raw))) {
      out[key] = Math.round(Number(raw));
      hasAny = true;
    } else {
      out[key] = null;
    }
  }
  return hasAny ? out : null;
}

function formatRoomName(roomId) {
  if (typeof roomId !== "string" || !roomId.trim()) return null;
  return roomId
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatLocationLabel(loc, fallbackRoomId = null) {
  if (typeof loc === "string" && loc.trim()) return loc.trim();
  if (loc && typeof loc === "object") {
    if (typeof loc.label === "string" && loc.label.trim()) return loc.label.trim();
    if (typeof loc.roomId === "string" && loc.roomId.trim()) {
      return formatRoomName(loc.roomId);
    }
  }
  return formatRoomName(fallbackRoomId);
}

function deriveFindingTitle(f, locLabel) {
  if (typeof f.title === "string" && f.title.trim()) return f.title.trim();
  const type = String(f.type || "INFO").toUpperCase();
  const prefix = locLabel ? `${locLabel} ` : "";
  if (type === "CONGESTION") return `${prefix}congestion`.replace(/^./, (c) => c.toUpperCase());
  if (type === "NO_PATH") return "Blocked scheduled route";
  if (type === "LONG_PATH") return "Extended walking route";
  if (type === "PRIVACY_SIGHTLINE") return "Bathroom privacy sightline";
  if (type === "TV_OCCLUDED") return "TV sightline blocked";
  if (type === "TV_BAD_ANGLE") return "Off-axis TV viewing angle";
  if (type === "TV_TOO_FAR") return "TV viewing distance too far";
  if (type === "NOISE_CONFLICT") return "WFH noise conflict";
  if (type === "EVACUATION_BOTTLENECK") return "Exit doorway bottleneck";
  if (type === "NO_EVACUATION_PATH") return "Blocked emergency exit route";
  if (type === "SUN_GLARE") return "Workspace sunlight glare";
  return String(f.type || "Simulation finding");
}

function deriveFindingSummary(f, locLabel) {
  const explicit = f.summary || f.description;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const type = String(f.type || "").toUpperCase();
  const ev = f.evidence || {};
  if (type === "CONGESTION") {
    const count = ev.agentCount ?? ev.agents;
    const secs = Number(ev.durationSeconds);
    const durText = Number.isFinite(secs)
      ? secs >= 60
        ? `for ${(secs / 60).toFixed(1)} min`
        : `for ${Math.round(secs)} s`
      : "";
    return `${count || "Multiple"} household members overlapped in ${locLabel || "shared walkway"} ${durText}`.trim() + ".";
  }
  if (type === "NO_PATH") {
    const from = formatRoomName(f.fromRoomId) || "origin";
    const to = formatRoomName(f.toRoomId) || "destination";
    return `No clear walking path from ${from} to ${to}.`;
  }
  if (type === "LONG_PATH" && Number.isFinite(Number(ev.distanceMeters))) {
    return `Route requires ${Number(ev.distanceMeters).toFixed(1)} m travel across rooms.`;
  }
  return "";
}

/**
 * Normalize an external simulation state payload for safe UI rendering,
 * preserving structured `evidence` and `rawLocation` for 3D overlay mapping.
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
  const currentTime =
    typeof raw?.currentTime === "string" && raw.currentTime.trim()
      ? raw.currentTime.trim()
      : null;

  const findings = Array.isArray(raw?.findings)
    ? raw.findings.filter(Boolean).map((f, idx) => {
        const locLabel = formatLocationLabel(f.location, f.roomId);
        return {
          id: String(f.id || `finding-${idx + 1}`),
          type: String(f.type || "INFO"),
          severity: Number.isFinite(Number(f.severity)) ? Number(f.severity) : null,
          level: resolveFindingLevel(f),
          title: deriveFindingTitle(f, locLabel),
          summary: deriveFindingSummary(f, locLabel),
          location: locLabel,
          rawLocation:
            f.rawLocation ?? (typeof f.location === "object" ? f.location : null),
          roomId:
            f.roomId ||
            (typeof f.location === "object" ? f.location?.roomId : null) ||
            null,
          fromRoomId: f.fromRoomId ?? null,
          toRoomId: f.toRoomId ?? null,
          agentId: f.agentId || null,
          evidence:
            f.evidence && typeof f.evidence === "object" ? { ...f.evidence } : null,
        };
      })
    : [];

  const beforeScores = normalizeScoreMap(raw?.beforeScores);
  const afterScores = normalizeScoreMap(raw?.afterScores);
  const scores = normalizeScoreMap(raw?.scores) ?? beforeScores;

  const redesignActions = Array.isArray(raw?.redesignActions)
    ? raw.redesignActions
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim())
    : [];

  const redesignStatus =
    typeof raw?.redesignStatus === "string" && raw.redesignStatus.trim()
      ? raw.redesignStatus.trim()
      : null;

  const errorMessage =
    typeof raw?.errorMessage === "string" && raw.errorMessage.trim()
      ? raw.errorMessage.trim()
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

  return {
    status,
    scenarioId,
    speed,
    currentTime,
    hasTimeline: Boolean(raw?.hasTimeline && endSecond > startSecond),
    startSecond,
    endSecond,
    currentSecond,
    showAllRoutes: Boolean(raw?.showAllRoutes),
    selectedFindingId:
      typeof raw?.selectedFindingId === "string" ? raw.selectedFindingId : null,
    hasLayoutToggle: Boolean(raw?.hasLayoutToggle),
    activeLayoutView: raw?.activeLayoutView === "after" ? "after" : "before",
    canProposeRedesign: Boolean(raw?.canProposeRedesign),
    canApplyRedesign: Boolean(raw?.canApplyRedesign),
    redesignStatus,
    findings,
    scores,
    beforeScores,
    afterScores,
    redesignActions,
    errorMessage,
    isMockData: Boolean(raw?.isMockData),
  };
}
