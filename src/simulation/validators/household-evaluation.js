import { FINDING_TYPES } from "../../contracts/simulation.js";
import { createDemoHousehold, MORNING_ROUTINE_SCENARIO } from "../demo-household.js";
import { simulateHouse } from "../simulation-engine.js";
import { validateAccessibility } from "./accessibility.js";
import { validateEvacuation } from "./evacuation.js";
import { validateNoiseConflicts } from "./noise.js";
import { validatePrivacySightlines } from "./privacy.js";
import { validateSunlight } from "./sunlight.js";
import { validateTvVisibility } from "./visibility.js";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round1 = (n) => Math.round(n * 10) / 10;

const DEDUCTION_WEIGHTS = {
  // Movement & Accessibility
  [FINDING_TYPES.NO_PATH]: 45,
  [FINDING_TYPES.CONGESTION]: 30,
  [FINDING_TYPES.LONG_PATH]: 15,
  [FINDING_TYPES.ACCESSIBILITY_ROUTE_BLOCKED]: 42,
  [FINDING_TYPES.ACCESSIBILITY_CLEARANCE_FAIL]: 28,
  [FINDING_TYPES.ACCESSIBILITY_TURN_RADIUS_FAIL]: 24,

  // Privacy
  [FINDING_TYPES.PRIVACY_SIGHTLINE]: 32,

  // Noise
  [FINDING_TYPES.NOISE_CONFLICT]: 35,

  // Visibility
  [FINDING_TYPES.TV_OCCLUDED]: 40,
  [FINDING_TYPES.TV_BAD_ANGLE]: 25,
  [FINDING_TYPES.TV_TOO_FAR]: 18,
  [FINDING_TYPES.SUN_GLARE]: 20,

  // Safety
  [FINDING_TYPES.NO_EVACUATION_PATH]: 60,
  [FINDING_TYPES.EVACUATION_BOTTLENECK]: 28,
  [FINDING_TYPES.LONG_EVACUATION_ROUTE]: 22,
};

function scoreCategory(categoryFindings, extraPenalty = null) {
  const deductions = [];
  let total = 0;

  for (const finding of categoryFindings) {
    const baseWeight = DEDUCTION_WEIGHTS[finding.type] ?? 20;
    const pointsDeducted = round1(baseWeight * (Number(finding.severity) || 0.5));
    total += pointsDeducted;
    deductions.push({
      findingType: finding.type,
      roomId: finding.roomId ?? finding.location?.roomId ?? null,
      severity: finding.severity,
      pointsDeducted,
    });
  }

  if (extraPenalty && extraPenalty.pointsDeducted > 0) {
    total += extraPenalty.pointsDeducted;
    deductions.push(extraPenalty);
  }

  return {
    score: Math.round(clamp(100 - total, 0, 100)),
    deductions,
    findings: categoryFindings,
  };
}

/**
 * Unified Deterministic Household Experience Evaluator (Task 3A §20–22).
 *
 * Runs movement simulation (or reuses a supplied `simulation`), privacy sightline,
 * TV visibility, WFH schedule-overlap noise, emergency evacuation safety, and
 * optional sunlight glare checks, producing structured `findings` and explainable
 * 0–100 category scores (`movement`, `privacy`, `noise`, `visibility`, `safety`).
 *
 * Pure and repeatable for before/after comparisons:
 * ```js
 * const before = evaluateHouseholdExperience({ house: beforeHouse, household });
 * const after = evaluateHouseholdExperience({ house: afterHouse, household });
 * ```
 *
 * @param {object} params
 * @param {object} params.house
 * @param {Array<object>} [params.household]
 * @param {object} [params.simulation]
 * @param {object} [params.scenario]
 * @param {{ azimuthDegrees: number, elevationDegrees: number }} [params.sun]
 * @param {boolean} [params.includeEvacuation=true]
 */
export function evaluateHouseholdExperience({
  house,
  household,
  simulation: providedSimulation = null,
  scenario = null,
  sun = null,
  includeEvacuation = true,
  forceAccessibilityCheck = false,
} = {}) {
  if (!house || typeof house !== "object") {
    throw new Error("A valid House JSON object is required for household evaluation.");
  }

  const effectiveHousehold =
    Array.isArray(household) && household.length > 0
      ? household
      : providedSimulation
        ? []
        : createDemoHousehold(house);

  const hasScheduledEntries = effectiveHousehold.some(
    (a) => Array.isArray(a?.schedule) && a.schedule.length > 0,
  );

  const simulation =
    providedSimulation ??
    (hasScheduledEntries
      ? simulateHouse(
          house,
          effectiveHousehold,
          scenario ?? (household ? {} : MORNING_ROUTINE_SCENARIO),
        )
      : null);

  const accessibilityResult = validateAccessibility({
    house,
    household: effectiveHousehold,
    forceCheck: forceAccessibilityCheck,
  });

  const movementFindings = [
    ...(simulation ? simulation.findings : []),
    ...accessibilityResult.findings,
  ];
  const privacyResult = validatePrivacySightlines({ house });
  const visibilityResult = validateTvVisibility({ house });
  const noiseResult = validateNoiseConflicts({
    house,
    household: effectiveHousehold,
  });
  const sunlightResult = sun
    ? validateSunlight({ house, sun })
    : { findings: [], hits: [] };
  const evacuationResult = includeEvacuation
    ? validateEvacuation({
        house,
        household: effectiveHousehold.length ? effectiveHousehold : undefined,
      })
    : { findings: [], agentRoutes: [], summary: null };

  const visibilityFindings = [
    ...visibilityResult.findings,
    ...sunlightResult.findings,
  ];
  const safetyFindings = evacuationResult.findings;

  const collisionCount = simulation?.summary?.collisions ?? 0;
  const collisionPenalty =
    collisionCount > 0
      ? {
          findingType: "AGENT_COLLISION",
          count: collisionCount,
          pointsDeducted: Math.min(20, collisionCount * 4),
        }
      : null;

  const categories = {
    movement: scoreCategory(movementFindings, collisionPenalty),
    privacy: scoreCategory(privacyResult.findings),
    noise: scoreCategory(noiseResult.findings),
    visibility: scoreCategory(visibilityFindings),
    safety: scoreCategory(safetyFindings),
  };

  const overallScore = Math.round(
    0.25 * categories.movement.score +
      0.2 * categories.privacy.score +
      0.2 * categories.noise.score +
      0.15 * categories.visibility.score +
      0.2 * categories.safety.score,
  );

  const findings = [
    ...movementFindings,
    ...privacyResult.findings,
    ...visibilityFindings,
    ...noiseResult.findings,
    ...safetyFindings,
  ];

  return {
    overallScore,
    findings,
    categories,
    simulation,
    details: {
      accessibilityChecks: accessibilityResult.checks,
      privacyChecks: privacyResult.checks,
      tvEvaluations: visibilityResult.evaluations,
      noiseEvaluations: noiseResult.evaluations,
      sunlightHits: sunlightResult.hits,
      evacuation: {
        agentRoutes: evacuationResult.agentRoutes,
        summary: evacuationResult.summary,
      },
    },
  };
}

/**
 * Convenience validator returning the flat `SimulationFinding[]` array directly
 * (`Task 3A §2`).
 */
export function validateHouseholdExperience(params) {
  return evaluateHouseholdExperience(params).findings;
}
