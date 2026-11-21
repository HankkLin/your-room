/**
 * Shared Household Life Simulation Contracts (AGENTS.md §3–4).
 *
 * Pure data structures and constants shared between:
 * - Deterministic spatial simulation (`src/simulation/**`)
 * - Three.js whole-home renderer (`feat/whole-home-scene`)
 * - Gemini explanation & ScenePatch redesign loop (`src/agents/**`, `src/persona/**`)
 */

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
  NO_PATH: "NO_PATH",
  LONG_PATH: "LONG_PATH",
  CONGESTION: "CONGESTION",
});

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
