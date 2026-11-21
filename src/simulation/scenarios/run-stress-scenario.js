import { STRESS_SCENARIO_TYPES } from "../../contracts/simulation.js";
import { createDinnerPartyScenario } from "./dinner-party.js";
import { createFireEvacuationScenario } from "./fire-evacuation.js";

/**
 * Unified Stress Scenario Runner (Task 3A §19).
 *
 * @param {object} params
 * @param {"fire-evacuation" | "dinner-party"} params.type
 * @param {object} params.house
 * @param {Array<object>} [params.household]
 */
export function runStressScenario({ type, house, household, ...options } = {}) {
  switch (type) {
    case STRESS_SCENARIO_TYPES.FIRE_EVACUATION:
      return createFireEvacuationScenario({ house, household, ...options });
    case STRESS_SCENARIO_TYPES.DINNER_PARTY:
      return createDinnerPartyScenario({ house, household, ...options });
    default:
      throw new Error(
        `Unsupported stress scenario type "${String(type)}". Expected "fire-evacuation" or "dinner-party".`,
      );
  }
}
