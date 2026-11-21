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
  FINDING_TYPES,
  SIMULATION_EVENT_TYPES,
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
  runMorningRoutineDemo,
} from "./demo-household.js";

export {
  formatSimulationDebugReport,
  renderSimulationDebugSvg,
} from "./debug-visualization.js";
