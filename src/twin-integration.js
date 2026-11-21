import { mergeHouseFixturesIntoItems, toSceneObject } from "../house-model.js";
import { prepareHouseholdReplay, validatePersonas } from "./contracts/persona.js";
import { FINDING_TYPES, STRESS_SCENARIO_TYPES } from "./contracts/simulation.js";
import { listPersonaRooms } from "./persona/rooms.js";
import {
  extractCategoryScoreMap,
  runRedesignReplay,
  toRedesignUiPayload,
} from "./redesign/index.js";
import { getCandidateProducts } from "./shopify/candidate-products.js";
import {
  GRANDPARENTS_STAYOVER_SCENARIO,
  MORNING_ROUTINE_SCENARIO,
  buildNavigationModel,
  createDemoHousehold,
  createFamilyStayoverPersonas,
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

const WHEELCHAIR_REQUIRED_WIDTH_M = 0.9;
const WHEELCHAIR_TURNING_DIAMETER_M = 1.5;

/**
 * Deterministic wheelchair & mobility clearance validator:
 * Checks interior doorways (`< 0.90 m` clear width) and primary room turning spaces
 * (`< 1.50 m` free turning circle) when any household member has `wheelchair === true`
 * or `needs.accessibility >= 0.75`.
 */
export function evaluateAccessibilityClearance(house, household = []) {
  const needsWheelchair = (household || []).some(
    (p) => Boolean(p?.wheelchair) || Number(p?.needs?.accessibility) >= 0.75,
  );
  if (!needsWheelchair || !house) return [];

  const nav = buildNavigationModel(house, { agentRadius: 0.24 });
  const findings = [];

  for (const door of house.doors || []) {
    if (!door || door.blocked || door.closed) continue;
    const widthM = Math.round((Number(door.width) || 0.85) * 100) / 100;
    if (widthM < WHEELCHAIR_REQUIRED_WIDTH_M - 0.005) {
      const roomBName =
        house.rooms?.find((r) => r.id === door.roomB)?.name ||
        house.rooms?.find((r) => r.id === door.roomA)?.name ||
        door.roomB ||
        door.roomA ||
        "Doorway";
      const targetRoomId = door.roomB || door.roomA || null;
      findings.push({
        id: `accessibility-door-${door.id}`,
        type: FINDING_TYPES.ACCESSIBILITY_CLEARANCE,
        roomId: targetRoomId,
        location: {
          roomId: targetRoomId,
          label: `${roomBName} doorway`,
          position: Array.isArray(door.position)
            ? [Number(door.position[0]), Number(door.position[1])]
            : undefined,
        },
        severity: widthM < 0.82 ? 0.86 : 0.68,
        title: `${roomBName} wheelchair doorway pinch`,
        summary: `${roomBName} doorway measures ${widthM.toFixed(2)} m wide — narrower than the 0.90 m comfortable wheelchair passage standard.`,
        evidence: {
          wheelchair: true,
          doorId: door.id,
          measuredWidthMeters: widthM,
          requiredWidthMeters: WHEELCHAIR_REQUIRED_WIDTH_M,
        },
      });
    }
  }

  // Check 1.50 m wheelchair turning circle (radius >= 0.75 m free clearance) in Kitchen & Bathroom
  for (const room of house.rooms || []) {
    if (!room || !["kitchen", "bathroom"].includes(room.kind || room.id)) continue;
    const roomIdx = nav.roomIndexById.get(room.id);
    if (roomIdx == null) continue;

    let maxRadius = 0;
    let bestWorld = null;
    for (let row = 0; row < nav.height; row += 1) {
      for (let col = 0; col < nav.width; col += 1) {
        const idx = row * nav.width + col;
        if (nav.roomIndexGrid[idx] !== roomIdx) continue;
        const r = nav.clearanceGrid[idx];
        if (r > maxRadius) {
          maxRadius = r;
          bestWorld = nav.cellToWorld(col, row);
        }
      }
    }

    const turningDiameter = Math.round(maxRadius * 2 * 100) / 100;
    if (turningDiameter > 0 && turningDiameter < WHEELCHAIR_TURNING_DIAMETER_M - 0.04) {
      findings.push({
        id: `accessibility-turn-${room.id}`,
        type: FINDING_TYPES.ACCESSIBILITY_CLEARANCE,
        roomId: room.id,
        location: {
          roomId: room.id,
          label: room.name || room.id,
          position: bestWorld || undefined,
        },
        severity: turningDiameter < 1.25 ? 0.78 : 0.62,
        title: `${room.name || room.id} tight wheelchair turn`,
        summary: `Largest clear turning circle in ${room.name || room.id} is ${turningDiameter.toFixed(2)} m across (1.50 m recommended for 360° wheelchair pivot).`,
        evidence: {
          wheelchair: true,
          roomId: room.id,
          measuredWidthMeters: turningDiameter,
          requiredWidthMeters: WHEELCHAIR_TURNING_DIAMETER_M,
          turningRadiusMeters: Math.round(maxRadius * 100) / 100,
        },
      });
    }
  }

  return findings;
}

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
    lines.push("Verified deterministic fallback patch applied");
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
 * Project a patched `afterHouse` back into Stillroom's flat `state.items` array,
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
 * Build a real, non-mock playback dataset for any of the 4 UI scenarios:
 * - `morning-routine`
 * - `normal-day`
 * - `dinner-party-8-guests`
 * - `fire-emergency`
 */
export function runTwinScenario(scenarioId, { house, items, state }) {
  const capturedHouse = captureStudioLayout(house, items);
  if (!capturedHouse) {
    throw new Error("Load or import a home layout before running simulation.");
  }

  const { displayPersonas, simulationHousehold } = resolveValidHouseholdForHouse(
    state,
    capturedHouse,
  );

  if (scenarioId === "dinner-party-8-guests") {
    const party = runStressScenario({
      type: STRESS_SCENARIO_TYPES.DINNER_PARTY,
      house: capturedHouse,
      household: simulationHousehold,
    });
    const evaluation = evaluateHouseholdExperience({
      house: capturedHouse,
      household: simulationHousehold,
      simulation: party.simulation,
    });
    const scores = extractCategoryScoreMap(evaluation);

    return {
      scenarioId,
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
      canRedesign: evaluation.findings.length > 0,
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
      household: simulationHousehold,
      simulation: evac.simulation,
      includeEvacuation: true,
    });
    const scores = extractCategoryScoreMap(evaluation);
    const maxSec = evac.summary?.maxEvacuationSeconds;

    return {
      scenarioId,
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

  if (scenarioId === "grandparents-stayover") {
    const familyPersonas = createFamilyStayoverPersonas(capturedHouse);
    const simulation = simulateHouse(
      capturedHouse,
      familyPersonas,
      GRANDPARENTS_STAYOVER_SCENARIO,
    );
    const evaluation = evaluateHouseholdExperience({
      house: capturedHouse,
      household: familyPersonas,
      simulation,
      scenario: GRANDPARENTS_STAYOVER_SCENARIO,
    });
    const accessibilityFindings = evaluateAccessibilityClearance(
      capturedHouse,
      familyPersonas,
    );
    const combinedFindings = [...accessibilityFindings, ...evaluation.findings];
    const baseScores = extractCategoryScoreMap(evaluation);
    const accessDeduction = Math.min(35, accessibilityFindings.length * 11);
    const scores = {
      ...baseScores,
      movement: Math.max(0, (baseScores.movement ?? 80) - accessDeduction),
    };
    const overallBeforeScore = Math.max(
      0,
      Math.round(evaluation.overallScore - accessDeduction * 0.25),
    );

    return {
      scenarioId,
      scenarioConfig: GRANDPARENTS_STAYOVER_SCENARIO,
      capturedHouse,
      household: familyPersonas,
      displayPersonas: familyPersonas,
      simulation,
      getSnapshotAt: getSimulationSnapshotAt,
      agentRoutes: [],
      isEvacuation: false,
      clockMode: "clock",
      simSecondsPerRealSecond: 400,
      findings: combinedFindings,
      scores,
      beforeScores: scores,
      afterScores: null,
      overallBeforeScore,
      overallAfterScore: null,
      canRedesign: combinedFindings.length > 0,
      isMockData: false,
      evaluation,
    };
  }

  // `morning-routine` or `normal-day`
  const scenarioConfig =
    scenarioId === "normal-day"
      ? NORMAL_DAY_SCENARIO
      : MORNING_ROUTINE_SCENARIO;

  const householdForRun =
    scenarioId === "normal-day" && displayPersonas.length > 0
      ? displayPersonas
      : simulationHousehold;

  const simulation = simulateHouse(
    capturedHouse,
    householdForRun,
    scenarioConfig,
  );
  const evaluation = evaluateHouseholdExperience({
    house: capturedHouse,
    household: householdForRun,
    simulation,
    scenario: scenarioConfig,
  });
  const scores = extractCategoryScoreMap(evaluation);

  const spanSeconds = Math.max(
    60,
    (simulation.endSecond ?? scenarioConfig.endMinute * 60) -
      (simulation.startSecond ?? scenarioConfig.startMinute * 60),
  );
  // Target ~18s at 1x (~3.6s at 5x, ~0.9s at 20x) regardless of schedule duration
  const simSecondsPerRealSecond = Math.max(
    180,
    Math.round(spanSeconds / 18),
  );

  return {
    scenarioId,
    scenarioConfig,
    capturedHouse,
    household: householdForRun,
    displayPersonas,
    simulation,
    getSnapshotAt: getSimulationSnapshotAt,
    agentRoutes: [],
    isEvacuation: false,
    clockMode: "clock",
    simSecondsPerRealSecond,
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
  maxAttempts = 3,
  useFallbackOnFailure = true,
}) {
  const beforeItems = structuredClone(items || []);
  const beforeHouse = captureStudioLayout(house, beforeItems);
  if (!beforeHouse) {
    throw new Error("No active whole-home layout to redesign.");
  }

  const resolved = resolveValidHouseholdForHouse(state, beforeHouse);
  const isGrandparentsScenario = scenarioId === "grandparents-stayover";
  const displayPersonas = isGrandparentsScenario
    ? createFamilyStayoverPersonas(beforeHouse)
    : resolved.displayPersonas;
  const simulationHousehold = isGrandparentsScenario
    ? displayPersonas
    : resolved.simulationHousehold;

  const scenario =
    scenarioId === "normal-day"
      ? NORMAL_DAY_SCENARIO
      : isGrandparentsScenario
        ? GRANDPARENTS_STAYOVER_SCENARIO
        : MORNING_ROUTINE_SCENARIO;
  const household =
    (scenarioId === "normal-day" || isGrandparentsScenario) && displayPersonas.length > 0
      ? displayPersonas
      : simulationHousehold;

  const candidateProducts = getCandidateProducts({ sceneItems: beforeItems });

  const replayResult = await runRedesignReplay({
    house: beforeHouse,
    household,
    scenario,
    candidateProducts,
    maxAttempts,
    useFallbackOnFailure,
  });

  const uiPayload = toRedesignUiPayload(replayResult, { candidateProducts });
  const attemptSummaries = formatAttemptSummaries(replayResult.attempts, {
    isFallback: uiPayload.isFallback,
  });

  if (replayResult.status !== "IMPROVED" || !replayResult.after?.house) {
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

  // Preserve deterministic wheelchair / mobility clearance checks on before & after layouts
  const beforeAccessFindings = evaluateAccessibilityClearance(beforeHouse, household);
  const afterAccessFindings = evaluateAccessibilityClearance(afterHouse, household);
  if (beforeAccessFindings.length > 0 || afterAccessFindings.length > 0) {
    const afterIds = new Set(afterAccessFindings.map((f) => f.id));
    const beforeIds = new Set(beforeAccessFindings.map((f) => f.id));
    const resolvedAccess = beforeAccessFindings.filter((f) => !afterIds.has(f.id));
    const remainingAccess = afterAccessFindings.filter((f) => beforeIds.has(f.id));
    const introducedAccess = afterAccessFindings.filter((f) => !beforeIds.has(f.id));
    uiPayload.findings = [...afterAccessFindings, ...(uiPayload.findings || [])];
    uiPayload.resolvedFindings = [
      ...resolvedAccess,
      ...(uiPayload.resolvedFindings || []),
    ];
    uiPayload.remainingFindings = [
      ...remainingAccess,
      ...(uiPayload.remainingFindings || []),
    ];
    uiPayload.introducedFindings = [
      ...introducedAccess,
      ...(uiPayload.introducedFindings || []),
    ];
  }

  return {
    accepted: true,
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
    beforeAccessFindings,
    afterSimulation: replayResult.after.evaluation.simulation,
    beforeSimulation: replayResult.before.evaluation.simulation,
    redesignMessage: replayResult.selectedPatch?.reasoning || null,
  };
}
