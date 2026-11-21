import { STRESS_SCENARIO_TYPES } from "../../contracts/simulation.js";
import { createDinnerPartyScenario } from "./dinner-party.js";
import { createFireEvacuationScenario } from "./fire-evacuation.js";
import { createFriendsArrivalScenario } from "./friends-arrival.js";
import { createGrandparentsVisitScenario } from "./grandparents-visit.js";

/**
 * Unified Stress Scenario Runner (Task 3A §19 + Household Believability Upgrade).
 *
 * @param {object} params
 * @param {"fire-evacuation" | "dinner-party" | "grandparents-visit" | "friends-arrival"} params.type
 * @param {object} params.house
 * @param {Array<object>} [params.household]
 */
export function runStressScenario({ type, house, household, ...options } = {}) {
  switch (type) {
    case STRESS_SCENARIO_TYPES.FIRE_EVACUATION:
      return createFireEvacuationScenario({ house, household, ...options });
    case STRESS_SCENARIO_TYPES.DINNER_PARTY:
      return createDinnerPartyScenario({ house, household, ...options });
    case STRESS_SCENARIO_TYPES.GRANDPARENTS_VISIT:
      return createGrandparentsVisitScenario({ house, household, ...options });
    case STRESS_SCENARIO_TYPES.FRIENDS_ARRIVAL:
      return createFriendsArrivalScenario({ house, household, ...options });
    default:
      throw new Error(
        `Unsupported stress scenario type "${String(type)}". Expected "fire-evacuation", "dinner-party", "grandparents-visit", or "friends-arrival".`,
      );
  }
}
