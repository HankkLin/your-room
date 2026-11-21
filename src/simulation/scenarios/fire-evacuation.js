import { STRESS_SCENARIO_TYPES } from "../../contracts/simulation.js";
import { validateEvacuation } from "../validators/evacuation.js";

/**
 * Create and run the deterministic Fire Evacuation stress scenario (Task 3A §14).
 */
export function createFireEvacuationScenario({
  house,
  household,
  maxSafeDistanceMeters = 14.0,
  maxSafeSeconds = 12.0,
} = {}) {
  const result = validateEvacuation({
    house,
    household,
    maxSafeDistanceMeters,
    maxSafeSeconds,
  });

  return {
    scenario: {
      type: STRESS_SCENARIO_TYPES.FIRE_EVACUATION,
      name: "Emergency Evacuation",
      maxSafeDistanceMeters,
      maxSafeSeconds,
    },
    simulation: result.simulation,
    agentRoutes: result.agentRoutes,
    findings: result.findings,
    summary: result.summary,
  };
}
