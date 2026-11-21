export {
  CELL_BLOCKED,
  CELL_DOOR,
  CELL_OUTSIDE,
  CELL_WALKABLE,
  DEFAULT_AGENT_RADIUS,
  DEFAULT_CONGESTION_CONFIG,
  DEFAULT_GRID_CELL_SIZE,
  DEFAULT_LONG_PATH_METERS,
  DEFAULT_MOVEMENT_SPEED_MPS,
  DEFAULT_PERSONAL_SPACE_RADIUS,
  EXPERIENCE_CATEGORIES,
  FINDING_TYPES,
  SIMULATION_EVENT_TYPES,
  STRESS_SCENARIO_TYPES,
  isValidSimulationFinding,
} from "../contracts/simulation.js";

export {
  buildNavigationModel,
  resolveExitPosition,
  resolveSafeRoomPosition,
} from "./navigation-grid.js";

export {
  findPath,
  hasWalkableLineOfSight,
  samplePointAlongPath,
} from "./pathfinding.js";

export {
  normalizeSchedule,
  resolveScheduleDestination,
} from "./schedule.js";

export { createHouseholdAgentState } from "./household-agent.js";

export {
  getSimulationSnapshotAt,
  runSimulation,
  simulateHouse,
} from "./simulation-engine.js";

export {
  MORNING_ROUTINE_SCENARIO,
  createDemoHousehold,
  createWholeHomeDemoPersonas,
  runMorningRoutineDemo,
} from "./demo-household.js";

export {
  buildOpaqueWallSegments,
  checkSightline,
  classifySemanticType,
  countPartitionsCrossed,
  extractBlockingSegments,
  listSemanticEntities,
} from "./validators/sightline.js";

export { validatePrivacySightlines } from "./validators/privacy.js";
export { validateTvVisibility } from "./validators/visibility.js";
export { validateNoiseConflicts } from "./validators/noise.js";
export { validateEvacuation } from "./validators/evacuation.js";
export { validateSunlight } from "./validators/sunlight.js";
export {
  evaluateHouseholdExperience,
  validateHouseholdExperience,
} from "./validators/household-evaluation.js";

export { createFireEvacuationScenario } from "./scenarios/fire-evacuation.js";
export {
  createDinnerPartyGuests,
  createDinnerPartyScenario,
} from "./scenarios/dinner-party.js";
export { runStressScenario } from "./scenarios/run-stress-scenario.js";

export {
  formatHouseholdExperienceReport,
  formatSimulationDebugReport,
  renderSimulationDebugSvg,
} from "./debug-visualization.js";
