/**
 * Shared UI & Engine Contract for Household Life Simulation Controls and Results.
 *
 * Architectural boundary (AGENTS.md §5):
 * - This module defines data shapes and pure normalization for UI display only.
 * - It performs ZERO spatial simulation, pathfinding, or score calculation.
 */

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
 * Normalize an external simulation state payload for safe UI rendering.
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
    ? raw.findings.filter(Boolean).map((f, idx) => ({
        id: String(f.id || `finding-${idx + 1}`),
        type: String(f.type || "INFO"),
        severity: Number.isFinite(Number(f.severity)) ? Number(f.severity) : null,
        level: resolveFindingLevel(f),
        title: String(f.title || f.type || "Simulation finding"),
        summary: String(f.summary || f.description || ""),
        location: f.location ? String(f.location) : null,
      }))
    : [];

  const beforeScores = normalizeScoreMap(raw?.beforeScores);
  const afterScores = normalizeScoreMap(raw?.afterScores);
  const scores = normalizeScoreMap(raw?.scores) ?? beforeScores;

  const redesignActions = Array.isArray(raw?.redesignActions)
    ? raw.redesignActions
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim())
    : [];

  const errorMessage =
    typeof raw?.errorMessage === "string" && raw.errorMessage.trim()
      ? raw.errorMessage.trim()
      : null;

  return {
    status,
    scenarioId,
    speed,
    currentTime,
    findings,
    scores,
    beforeScores,
    afterScores,
    redesignActions,
    errorMessage,
    isMockData: Boolean(raw?.isMockData),
  };
}
