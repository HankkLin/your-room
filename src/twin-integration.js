import { environmentInputs } from "./environment/environment-context.js";
import { mergeHouseFixturesIntoItems, toSceneObject } from "../house-model.js";
import { prepareHouseholdReplay, validatePersonas } from "./contracts/persona.js";
import { STRESS_SCENARIO_TYPES } from "./contracts/simulation.js";
import { listPersonaRooms } from "./persona/rooms.js";
import {
  compareEvaluations,
  evaluateCandidatePatch,
  extractCategoryScoreMap,
  runRedesignReplay,
  toRedesignUiPayload,
} from "./redesign/index.js";
import { getCandidateProducts } from "./shopify/candidate-products.js";
import {
  MORNING_ROUTINE_SCENARIO,
  createDemoHousehold,
  createWholeHomeDemoPersonas,
  evaluateHouseholdExperience,
  getSimulationSnapshotAt,
  runStressScenario,
  simulateHouse,
} from "./simulation/index.js";
import { captureStudioLayout } from "./simulation/studio-replay.js";

export const NORMAL_DAY_SCENARIO = Object.freeze({
  id: "normal-day",
  name: "Normal Day",
  startMinute: 420, // 07:00
  endMinute: 1320, // 22:00
  stepSeconds: 2,
});

function summarizeErrorReason(reason = "") {
  const str = String(reason);
  if (/MOVE_LOCKED_OBJECT|ROTATE_LOCKED_OBJECT|REMOVE_LOCKED_OBJECT|REPLACE_LOCKED_OBJECT/.test(str)) {
    return "locked fixture protection";
  }
  if (/DOOR_BLOCKED/.test(str)) return "doorway clearance violation";
  if (/PATCH_BLOCKS_REQUIRED_ROUTE/.test(str)) return "blocked room route";
  if (/WALL_INTERSECTION|OUTSIDE_ROOM_BOUNDS/.test(str)) return "wall / room boundary collision";
  if (/OBJECT_COLLISION|FIXTURE_COLLISION/.test(str)) return "furniture overlap";
  if (/INVALID_COORDINATES|INVALID_DIMENSIONS|INVALID_ELEVATION|INVALID_ROTATION/.test(str)) {
    return "invalid placement geometry";
  }
  if (/no measurable improvement/i.test(str)) return "no measurable score improvement";
  if (/decreased|critical finding/i.test(str)) return "introduced layout regression";
  if (/not configured|unavailable|timeout/i.test(str)) return "Gemini API unavailable";
  return "invalid placement";
}

/**
 * Build concise, human-readable validator self-correction lines from actual
 * `runRedesignReplay` attempt records without exposing raw internal logs.
 */
export function formatAttemptSummaries(attempts = [], { isFallback = false } = {}) {
  if (!Array.isArray(attempts) || attempts.length === 0) return [];
  const lines = [];
  for (let i = 0; i < attempts.length; i += 1) {
    const att = attempts[i];
    if (att.accepted) {
      if (i > 0) {
        lines.push("Gemini corrected the redesign");
      }
      lines.push(`Attempt ${att.attempt} accepted`);
    } else {
      const reason = summarizeErrorReason(att.rejectedBecause?.[0] || "");
      lines.push(`Attempt ${att.attempt} rejected — ${reason}`);
    }
  }
  if (isFallback && !attempts.some((a) => a.accepted)) {
    lines.push("Deterministic fallback patch validated");
  }
  return lines;
}

/**
 * Compute 3D ghost-footprint → move-line → glow-ring transition descriptors
 * between `beforeItems` and `afterItems`.
 */
export function buildPatchChanges(beforeItems = [], afterItems = [], patch = null) {
  const beforeMap = new Map((beforeItems || []).map((item) => [item.id, item]));
  const afterMap = new Map((afterItems || []).map((item) => [item.id, item]));
  const touchedIds = new Set(
    (patch?.operations || []).map((op) => op?.objectId).filter(Boolean),
  );

  const changes = [];
  for (const [id, afterItem] of afterMap.entries()) {
    const beforeItem = beforeMap.get(id);
    if (!beforeItem) continue;
    const dx = Number(afterItem.x) - Number(beforeItem.x);
    const dz = Number(afterItem.z) - Number(beforeItem.z);
    if (Math.hypot(dx, dz) < 0.02 && !touchedIds.has(id)) continue;
    if (Math.hypot(dx, dz) < 0.02) continue;

    changes.push({
      objectId: id,
      from: [Number(beforeItem.x), Number(beforeItem.z)],
      to: [Number(afterItem.x), Number(afterItem.z)],
      width: Number(afterItem.width) || 0.8,
      depth: Number(afterItem.depth) || 0.8,
    });
  }
  return changes;
}

/**
 * Project a patched `afterHouse` back into Living Blueprint's flat `state.items` array,
 * keeping all canonical `house.fixtures` locked and untouched while preserving
 * movable furniture & Shopify product metadata.
 */
export function projectPatchedHouseToItems(afterHouse) {
  const movableObjects = (afterHouse?.objects || [])
    .filter((obj) => !obj.fromHouseFixture && obj.type !== "fixed")
    .map((obj) => toSceneObject(obj));
  return mergeHouseFixturesIntoItems(afterHouse, movableObjects);
}

/**
 * Resolve valid personas for whole-home simulation:
 * - If user-saved `state.personas` pass `validatePersonas(personas, rooms)` AND
 *   have at least one scheduled activity, resolve and return them (plus display list).
 * - Otherwise fall back to `createWholeHomeDemoPersonas(house)` / `createDemoHousehold(house)`
 *   using actual room IDs of `house` (never invalid `room-1`).
 */
export function resolveValidHouseholdForHouse(state, house) {
  const rooms = house?.rooms?.length
    ? house.rooms.map(({ id, name }) => ({ id, name }))
    : listPersonaRooms(state);

  const userPersonas = Array.isArray(state?.personas) ? state.personas : [];
  const hasScheduled = userPersonas.some(
    (p) => Array.isArray(p?.schedule) && p.schedule.length > 0,
  );

  if (userPersonas.length > 0 && hasScheduled && !validatePersonas(userPersonas, rooms)) {
    const resolved = prepareHouseholdReplay(userPersonas, rooms);
    if (resolved.length > 0) {
      return {
        displayPersonas: userPersonas,
        simulationHousehold: resolved,
        usedFallbackPersonas: false,
      };
    }
  }

  return {
    displayPersonas: createWholeHomeDemoPersonas(house),
    simulationHousehold: createDemoHousehold(house),
    usedFallbackPersonas: true,
  };
}

/**
 * Build a deterministic playback dataset for the selected scenario:
 * - `morning-routine`
 * - `normal-day`
 * - `saved-routine`
 * - `dinner-party-8-guests`
 * - `fire-emergency`
 */
export function runTwinScenario(scenarioId, { house, items, state, comparisonRun }) {
  const capturedHouse = captureStudioLayout(house, items);
  if (!capturedHouse) {
    throw new Error("Load or import a home layout before running simulation.");
  }

  const environment = comparisonRun ? comparisonRun.environment : capturedHouse.environment?.snapshot ?? null;
  const { sun } = environmentInputs(environment);
  capturedHouse.environment = { ...capturedHouse.environment, snapshot: environment };
  const { displayPersonas, simulationHousehold, usedFallbackPersonas } = comparisonRun
    ? { displayPersonas: comparisonRun.displayPersonas, simulationHousehold: comparisonRun.household }
    : resolveValidHouseholdForHouse(state, capturedHouse);

  if (scenarioId === "dinner-party-8-guests") {
    const party = runStressScenario({
      type: STRESS_SCENARIO_TYPES.DINNER_PARTY,
      house: capturedHouse,
      household: simulationHousehold,
    });
    const evaluation = evaluateHouseholdExperience({
      house: capturedHouse,
      sun,
      household: simulationHousehold,
      simulation: party.simulation,
    });
    const scores = extractCategoryScoreMap(evaluation);

    return {
      scenarioId,
      environment,
      capturedHouse,
      household: simulationHousehold,
      displayPersonas,
      simulation: party.simulation,
      getSnapshotAt: getSimulationSnapshotAt,
      agentRoutes: [],
      isEvacuation: false,
      clockMode: "clock",
      simSecondsPerRealSecond: 180,
      findings: evaluation.findings,
      scores,
      beforeScores: scores,
      afterScores: null,
      overallBeforeScore: evaluation.overallScore,
      overallAfterScore: null,
      canRedesign: false,
      isMockData: false,
      evaluation,
    };
  }

  if (scenarioId === "fire-emergency") {
    const evac = runStressScenario({
      type: STRESS_SCENARIO_TYPES.FIRE_EVACUATION,
      house: capturedHouse,
      household: simulationHousehold,
    });
    const evaluation = evaluateHouseholdExperience({
      house: capturedHouse,
      sun,
      household: simulationHousehold,
      simulation: evac.simulation,
      includeEvacuation: true,
    });
    const scores = extractCategoryScoreMap(evaluation);
    const maxSec = evac.summary?.maxEvacuationSeconds;

    return {
      scenarioId,
      environment,
      capturedHouse,
      household: simulationHousehold,
      displayPersonas,
      simulation: evac.simulation,
      getSnapshotAt: getSimulationSnapshotAt,
      agentRoutes: evac.agentRoutes || [],
      isEvacuation: true,
      showFindingsImmediately: true,
      clockMode: "elapsed",
      completedLabel: Number.isFinite(maxSec)
        ? `Evacuated in ${maxSec.toFixed(1)}s`
        : "Evacuation complete",
      simSecondsPerRealSecond: 6,
      findings: evac.findings,
      scores,
      beforeScores: scores,
      afterScores: null,
      overallBeforeScore: evaluation.overallScore,
      overallAfterScore: null,
      canRedesign: false,
      isMockData: false,
      evaluation,
    };
  }

  if (scenarioId === "saved-routine" && usedFallbackPersonas) {
    throw new Error("Save a household with a scheduled activity to replay its routine.");
  }
  const scenarioConfig = comparisonRun?.scenarioConfig ?? {
    "morning-routine": MORNING_ROUTINE_SCENARIO,
    "normal-day": NORMAL_DAY_SCENARIO,
    "saved-routine": { id: "saved-routine", timelineSampleSeconds: 60 },
  }[scenarioId];

  const householdForRun = scenarioId === "normal-day" && usedFallbackPersonas
    ? prepareHouseholdReplay(displayPersonas, capturedHouse.rooms)
    : simulationHousehold;

  const simulation = simulateHouse(
    capturedHouse,
    householdForRun,
    scenarioConfig,
  );
  const evaluation = evaluateHouseholdExperience({
    house: capturedHouse,
    sun,
    household: householdForRun,
    simulation,
    scenario: scenarioConfig,
  });
  const scores = extractCategoryScoreMap(evaluation);

  return {
    scenarioId,
    scenarioConfig,
    environment,
    capturedHouse,
    household: householdForRun,
    displayPersonas,
    simulation,
    getSnapshotAt: getSimulationSnapshotAt,
    agentRoutes: [],
    isEvacuation: false,
    clockMode: "clock",
    simSecondsPerRealSecond: scenarioId === "normal-day" ? 900 : 180,
    findings: evaluation.findings,
    scores,
    beforeScores: scores,
    afterScores: null,
    overallBeforeScore: evaluation.overallScore,
    overallAfterScore: null,
    canRedesign: evaluation.findings.length > 0,
    isMockData: false,
    evaluation,
  };
}

/**
 * Execute the full Gemini Redesign + Deterministic Validation + Identical-Scenario Replay
 * loop on the live Studio layout and build before/after transition artifacts.
 */
export async function executeStudioRedesign({
  scenarioId = "morning-routine",
  house,
  items,
  state,
  baseline = null,
  candidateProducts = getCandidateProducts({ sceneItems: items }),
  maxAttempts = 3,
  useFallbackOnFailure = true,
}) {
  const run = baseline ?? runTwinScenario(scenarioId, { house, items, state });
  if (!run.scenarioConfig || run.scenarioId !== scenarioId) {
    throw new Error("Choose a household routine to compare a redesign.");
  }
  const { capturedHouse: beforeHouse, household, displayPersonas, scenarioConfig: scenario, environment } = run;
  const beforeItems = structuredClone(items);
  const { sun } = environmentInputs(environment);

  const replayResult = await runRedesignReplay({
    house: beforeHouse,
    household,
    scenario,
    sun,
    candidateProducts,
    maxAttempts,
    useFallbackOnFailure,
  });

  return describeStudioOutcome(replayResult, { beforeItems, beforeHouse, household, displayPersonas, scenario, environment, candidateProducts });
}

// Approval uses the exact reviewed operations and the captured conditions. It never asks for a second proposal.
export function recheckStudioRedesign(outcome, candidateProducts) {
  const { beforeItems, beforeHouse, household, displayPersonas, scenario, environment, replayResult } = outcome;
  const { sun } = environmentInputs(environment);
  const evaluated = evaluateCandidatePatch({
    house: beforeHouse, patch: replayResult.selectedPatch, beforeEvaluation: replayResult.before.evaluation,
    household, scenario, sun, candidateProducts,
  });
  if (!evaluated.accepted) throw new Error(evaluated.rejectedBecause.join(" ") || "The approved patch failed validation.");
  const verified = { ...replayResult, comparison: evaluated.comparison, delta: evaluated.comparison.delta,
    after: { house: evaluated.afterHouse, evaluation: evaluated.afterEvaluation } };
  return describeStudioOutcome(verified, { beforeItems, beforeHouse, household, displayPersonas, scenario, environment, candidateProducts });
}

export function describeApprovedHouseholdReplay({ baseline, result, afterHouse, afterItems, displayPersonas, patch }) {
  const comparison = compareEvaluations(baseline.result.evaluation, result.evaluation);
  const movementDeltas = ["pathFailures", "collisions", "congestionEvents"].map(
    key => result.summary[key] - baseline.result.summary[key],
  );
  const better = movementDeltas.some(delta => delta < 0) || comparison.improvedCategories.length ||
    comparison.resolvedFindings.length || comparison.improvedFindings.length;
  const worse = movementDeltas.some(delta => delta > 0) || comparison.regressedCategories.length ||
    comparison.introducedFindings.length || comparison.worsenedFindings.length;
  const status = better && worse ? "MIXED" : worse ? "REGRESSION" : better ? "IMPROVED" : "NO_CHANGE";
  const replayResult = {
    status, attempts: [], selectedPatch: patch, comparison, delta: comparison.delta,
    before: { house: baseline.scene, evaluation: baseline.result.evaluation },
    after: { house: afterHouse, evaluation: result.evaluation },
  };
  const outcome = describeStudioOutcome(replayResult, {
    beforeItems: baseline.items, beforeHouse: baseline.scene, household: baseline.household, displayPersonas,
    scenario: { id: "saved-routine", timelineSampleSeconds: 60 }, environment: baseline.environment, candidateProducts: [],
  });
  return { ...outcome, afterItems };
}

function describeStudioOutcome(replayResult, { beforeItems, beforeHouse, household, displayPersonas, scenario, environment, candidateProducts }) {
  const uiPayload = toRedesignUiPayload(replayResult, { candidateProducts });
  const attemptSummaries = formatAttemptSummaries(replayResult.attempts, {
    isFallback: uiPayload.isFallback,
  });

  if (!replayResult.after?.house) {
    return {
      accepted: false,
      replayResult,
      uiPayload,
      attemptSummaries,
      beforeHouse,
      afterHouse: null,
      beforeItems,
      afterItems: null,
      patchChanges: [],
      redesignMessage:
        replayResult.attempts.at(-1)?.rejectedBecause?.[0] ||
        "Candidate redesign did not pass deterministic validation or improve household scores. Layout kept unchanged.",
    };
  }

  const afterHouse = replayResult.after.house;
  const afterItems = projectPatchedHouseToItems(afterHouse);
  const patchChanges = buildPatchChanges(
    beforeItems,
    afterItems,
    replayResult.selectedPatch,
  );

  return {
    accepted: true,
    candidateProducts,
    environment,
    replayResult,
    uiPayload,
    attemptSummaries,
    scenario,
    household,
    displayPersonas,
    beforeHouse,
    afterHouse,
    beforeItems,
    afterItems,
    patchChanges,
    afterSimulation: replayResult.after.evaluation.simulation,
    beforeSimulation: replayResult.before.evaluation.simulation,
    redesignMessage: replayResult.selectedPatch?.reasoning || null,
  };
}
