import { prepareHouseholdReplay, validatePersonas } from "./src/contracts/persona.js";
import { FINDING_TYPES } from "./src/contracts/simulation.js";
import { listPersonaRooms } from "./src/persona/rooms.js";
import {
  MORNING_ROUTINE_SCENARIO,
  createDemoHousehold,
} from "./src/simulation/demo-household.js";
import {
  getSimulationSnapshotAt,
  simulateHouse,
} from "./src/simulation/simulation-engine.js";
import {
  captureStudioLayout,
  runStudioReplay,
} from "./src/simulation/studio-replay.js";
import {
  createMockPlaybackDataset,
  getMockSimulationSnapshotAt,
} from "./demo-playback-mock.js";

export { captureStudioLayout, runStudioReplay };

/**
 * Resolve valid household agents for simulation:
 * - If `personas` passes `validatePersonas(personas, rooms)` and has at least one
 *   scheduled activity, returns `prepareHouseholdReplay(personas, rooms)` (preserving
 *   user-edited or generated schedules).
 * - Otherwise falls back cleanly to `createDemoHousehold(house)` with valid room IDs.
 */
export function resolveHouseholdForSimulation(house, personas = [], rooms = null) {
  const effectiveRooms =
    Array.isArray(rooms) && rooms.length > 0
      ? rooms
      : listPersonaRooms({ house, roomName: house?.name || "Home" });

  if (Array.isArray(personas) && personas.length > 0) {
    const validationError = validatePersonas(personas, effectiveRooms);
    if (!validationError) {
      const resolved = prepareHouseholdReplay(personas, effectiveRooms);
      if (resolved.length > 0) {
        return {
          household: resolved,
          usedFallback: false,
        };
      }
    }
  }

  return {
    household: createDemoHousehold(house),
    usedFallback: true,
  };
}

/**
 * Derive an honest movement score from real `SimulationResult` when desktop's full
 * `evaluateHouseholdExperience` validator suite (`feat/spatial-validators`) is not yet connected.
 * Leaves `privacy`, `noise`, `visibility`, `safety` as `null` (`—` in UI) rather than inventing scores.
 */
export function deriveMovementOnlyScores(simulation) {
  if (!simulation?.summary) return null;
  let deduction = 0;
  for (const f of simulation.findings || []) {
    const sev = Number(f.severity) || 0.5;
    if (f.type === FINDING_TYPES.NO_PATH) deduction += 45 * sev;
    else if (f.type === FINDING_TYPES.CONGESTION) deduction += 30 * sev;
    else if (f.type === FINDING_TYPES.LONG_PATH) deduction += 15 * sev;
  }
  const collisions = Number(simulation.summary.collisions) || 0;
  if (collisions > 0) deduction += Math.min(20, collisions * 4);
  return {
    movement: Math.max(0, Math.min(100, Math.round(100 - deduction))),
    privacy: null,
    noise: null,
    visibility: null,
    safety: null,
  };
}

/**
 * Execute a scenario against the current Studio layout (`captureStudioLayout(house, items)`).
 *
 * - `morning-routine` and `normal-day`: ALWAYS run REAL deterministic `simulateHouse(...)`
 *   with `getSimulationSnapshotAt` (`isMockData: false`).
 * - `dinner-party-8-guests` and `fire-emergency`: use injected desktop `runStressScenario`
 *   when provided, otherwise fall back to clearly labeled `createMockPlaybackDataset` (`isMockData: true`).
 */
export function runScenarioPlaybackDataset(
  scenarioId,
  {
    house,
    items = [],
    personas = [],
    rooms = null,
    externalHooks = {},
  } = {},
) {
  const capturedHouse = captureStudioLayout(house, items);
  if (!capturedHouse) {
    throw new Error("A valid whole-home layout is required to run household simulation.");
  }

  const { household, usedFallback } = resolveHouseholdForSimulation(
    capturedHouse,
    personas,
    rooms,
  );

  // Stress scenarios: route to desktop `runStressScenario` if connected, else honest mock fallback
  if (scenarioId === "dinner-party-8-guests" || scenarioId === "fire-emergency") {
    if (typeof externalHooks.runStressScenario === "function") {
      const stressType =
        scenarioId === "fire-emergency" ? "fire-evacuation" : "dinner-party";
      const stress = externalHooks.runStressScenario(
        capturedHouse,
        household,
        stressType,
      );
      const sim = stress?.simulation ?? stress;
      return {
        isMockData: false,
        usedFallbackHousehold: usedFallback,
        capturedHouse,
        simulation: sim,
        getSnapshotAt: getSimulationSnapshotAt,
        agentRoutes: stress?.agentRoutes ?? [],
        isEvacuation: scenarioId === "fire-emergency",
        clockMode: scenarioId === "fire-emergency" ? "elapsed" : "clock",
        simSecondsPerRealSecond: scenarioId === "fire-emergency" ? 12 : 400,
        findings: stress?.findings ?? sim?.findings ?? [],
        scores: stress?.scores ?? deriveMovementOnlyScores(sim),
        beforeScores: stress?.scores ?? deriveMovementOnlyScores(sim),
        afterScores: null,
        redesignActions: [],
        redesignStatus:
          (stress?.findings ?? sim?.findings ?? []).length > 0
            ? "Ready for redesign"
            : null,
      };
    }

    return createMockPlaybackDataset(scenarioId, {
      house: capturedHouse,
      items,
      personas,
    });
  }

  // Real deterministic simulation for `morning-routine` and `normal-day`
  const isMorning = scenarioId === "morning-routine";
  const simOptions = isMorning
    ? {
        startMinute: MORNING_ROUTINE_SCENARIO.startMinute,
        endMinute: MORNING_ROUTINE_SCENARIO.endMinute,
        stepSeconds: 1,
        timelineSampleSeconds: 5,
      }
    : {
        stepSeconds: 2,
        timelineSampleSeconds: 15,
      };

  const simulation = simulateHouse(capturedHouse, household, simOptions);

  let findings = [...(simulation.findings || [])];
  let scores = deriveMovementOnlyScores(simulation);

  if (typeof externalHooks.evaluateHouseholdExperience === "function") {
    const evaluation = externalHooks.evaluateHouseholdExperience({
      house: capturedHouse,
      household,
      simulation,
    });
    if (Array.isArray(evaluation?.findings)) {
      findings = evaluation.findings;
    }
    if (evaluation?.categories) {
      scores = evaluation.categories;
    }
  }

  const spanSeconds = Math.max(
    60,
    (simulation.endSecond ?? 540 * 60) - (simulation.startSecond ?? 420 * 60),
  );
  // ~3.6 real seconds at 1x speed (~0.18s at 20x) for responsive playback & pause/resume
  const simSecondsPerRealSecond = Math.round(spanSeconds / 3.6);

  const actionableFindings = findings.filter(
    (f) => f && f.type !== "CLEAR" && f.type !== "PASS" && Number(f.severity) > 0,
  );

  return {
    isMockData: false,
    usedFallbackHousehold: usedFallback,
    capturedHouse,
    simulation,
    getSnapshotAt: getSimulationSnapshotAt,
    agentRoutes: [],
    isEvacuation: false,
    clockMode: "clock",
    simSecondsPerRealSecond,
    findings,
    scores,
    beforeScores: scores,
    afterScores: null,
    redesignActions: [],
    redesignStatus: actionableFindings.length > 0 ? "Ready for redesign" : null,
    canProposeRedesign:
      actionableFindings.length > 0 &&
      typeof externalHooks.onProposeRedesign === "function",
    getMockFallbackSnapshot: getMockSimulationSnapshotAt,
  };
}
