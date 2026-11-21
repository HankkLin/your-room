import { generateScenePatch } from "../agents/redesign-agent.js";
import {
  MORNING_ROUTINE_SCENARIO,
  createDemoHousehold,
} from "../simulation/demo-household.js";
import { evaluateHouseholdExperience } from "../simulation/validators/household-evaluation.js";
import { applyScenePatch, describePatchActions } from "./apply-scene-patch.js";
import {
  compareEvaluations,
  extractCategoryScoreMap,
} from "./compare-evaluations.js";
import { buildFallbackScenePatch } from "./fallback-patch.js";
import { validateScenePatch } from "./validate-scene-patch.js";

/**
 * Build the Demo UI payload shape (Task 4 §25) from a completed redesign session.
 */
export function toRedesignUiPayload(replayResult, options = {}) {
  const beforeEval = replayResult.before.evaluation;
  const afterEval = replayResult.after?.evaluation ?? beforeEval;
  const beforeCategoryScores = extractCategoryScoreMap(beforeEval);
  const afterCategoryScores = extractCategoryScoreMap(afterEval);

  const redesignActions = replayResult.selectedPatch
    ? describePatchActions(replayResult.before.house, replayResult.selectedPatch, {
        candidateProducts: options.candidateProducts,
      })
    : [];

  return {
    status: "COMPLETE",
    redesignStatus: replayResult.status,
    findings: afterEval.findings,
    scores: afterCategoryScores,
    beforeScores: beforeCategoryScores,
    afterScores: afterCategoryScores,
    overallBeforeScore: beforeEval.overallScore,
    overallAfterScore: afterEval.overallScore,
    delta: replayResult.delta,
    resolvedFindings: replayResult.comparison?.resolvedFindings ?? [],
    introducedFindings: replayResult.comparison?.introducedFindings ?? [],
    remainingFindings:
      replayResult.comparison?.remainingFindings ?? beforeEval.findings,
    redesignActions,
    patch: replayResult.selectedPatch,
    isFallback: Boolean(replayResult.selectedPatch?.isFallback),
    isMockData: false,
  };
}

/**
 * Evaluate a single candidate `ScenePatch` deterministically by validating it,
 * applying it to `house`, replaying the exact same scenario, and comparing
 * before/after metrics.
 */
export function evaluateCandidatePatch({
  house,
  patch,
  beforeEvaluation,
  household,
  scenario,
  sun = null,
  includeEvacuation = true,
  candidateProducts = [],
}) {
  const validation = validateScenePatch(house, patch, { candidateProducts });
  if (!validation.valid) {
    const rejectedBecause = validation.errors.map((err) =>
      err.objectId ? `${err.code}: ${err.objectId} (${err.message})` : `${err.code}: ${err.message}`,
    );
    return {
      valid: false,
      accepted: false,
      validation,
      afterHouse: null,
      afterEvaluation: null,
      comparison: null,
      rejectedBecause,
    };
  }

  const afterHouse = applyScenePatch(house, patch, { candidateProducts });
  const afterEvaluation = evaluateHouseholdExperience({
    house: afterHouse,
    household,
    scenario,
    sun,
    includeEvacuation,
  });

  const comparison = compareEvaluations(beforeEvaluation, afterEvaluation);
  return {
    valid: true,
    accepted: comparison.accepted,
    validation,
    afterHouse,
    afterEvaluation,
    comparison,
    rejectedBecause: comparison.accepted ? [] : [...comparison.rejectionReasons],
  };
}

/**
 * End-to-End Deterministic Redesign + Self-Correction Replay Loop (Task 4 §19–20).
 *
 * Pipeline:
 * `before = evaluateHouseholdExperience(...)`
 *   → up to `maxAttempts` (default 3 = initial + 2 retries) of:
 *       `generateScenePatch(...)` → `validateScenePatch(...)` → `applyScenePatch(...)`
 *       → replay exact same `household` + `scenario` + `sun` → `compareEvaluations(...)`
 *   → optional deterministic fallback patch if Gemini is unavailable or all attempts fail.
 */
export async function runRedesignReplay({
  house,
  household,
  scenario = null,
  sun = null,
  includeEvacuation = true,
  candidateProducts = [],
  maxAttempts = 3,
  useFallbackOnFailure = true,
  patchGenerator = null,
  apiKey = null,
  model = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!house || typeof house !== "object") {
    throw new Error("runRedesignReplay requires a valid House JSON object.");
  }

  const baseHouse = structuredClone(house);
  const effectiveHousehold =
    Array.isArray(household) && household.length > 0
      ? structuredClone(household)
      : createDemoHousehold(baseHouse);
  const effectiveScenario =
    scenario ?? (household ? null : MORNING_ROUTINE_SCENARIO);

  const beforeEvaluation = evaluateHouseholdExperience({
    house: baseHouse,
    household: effectiveHousehold,
    scenario: effectiveScenario,
    sun,
    includeEvacuation,
  });

  const beforeRecord = {
    house: baseHouse,
    evaluation: beforeEvaluation,
  };

  if (beforeEvaluation.findings.length === 0) {
    const noopComparison = compareEvaluations(
      beforeEvaluation,
      beforeEvaluation,
    );
    const result = {
      status: "NO_IMPROVEMENT",
      attempts: [],
      before: beforeRecord,
      patch: null,
      selectedPatch: null,
      after: beforeRecord,
      delta: noopComparison.delta,
      resolvedFindings: [],
      newFindings: [],
      remainingFindings: [],
      comparison: noopComparison,
    };
    return {
      ...result,
      uiPayload: toRedesignUiPayload(result, { candidateProducts }),
    };
  }

  const attemptsLimit = Math.max(1, Math.min(5, Math.floor(Number(maxAttempts) || 3)));
  const attempts = [];

  for (let attemptNum = 1; attemptNum <= attemptsLimit; attemptNum += 1) {
    let proposedPatch;
    try {
      proposedPatch = await generateScenePatch({
        house: baseHouse,
        household: effectiveHousehold,
        scenario: effectiveScenario,
        evaluation: beforeEvaluation,
        candidateProducts,
        previousAttempts: attempts,
        generator: patchGenerator,
        apiKey,
        model,
        fetchImpl,
      });
    } catch (err) {
      attempts.push({
        attempt: attemptNum,
        patch: null,
        valid: false,
        accepted: false,
        validationErrors: [],
        rejectedBecause: [err?.message || "Gemini proposal request failed."],
      });
      // If network/key is unconfigured (not a schema mistake), break to fallback rather than retrying identical 503
      if (
        !patchGenerator &&
        /not configured|unavailable \(HTTP 503\)/i.test(String(err?.message))
      ) {
        break;
      }
      continue;
    }

    const evaluated = evaluateCandidatePatch({
      house: baseHouse,
      patch: proposedPatch,
      beforeEvaluation,
      household: effectiveHousehold,
      scenario: effectiveScenario,
      sun,
      includeEvacuation,
      candidateProducts,
    });

    const attemptRecord = {
      attempt: attemptNum,
      patch: proposedPatch,
      valid: evaluated.valid,
      accepted: evaluated.accepted,
      validationErrors: evaluated.validation.errors,
      rejectedBecause: evaluated.rejectedBecause,
      afterOverallScore: evaluated.afterEvaluation?.overallScore ?? null,
    };
    attempts.push(attemptRecord);

    if (evaluated.accepted) {
      const afterRecord = {
        house: evaluated.afterHouse,
        evaluation: evaluated.afterEvaluation,
      };
      const result = {
        status: "IMPROVED",
        attempts,
        before: beforeRecord,
        patch: proposedPatch,
        selectedPatch: proposedPatch,
        after: afterRecord,
        delta: evaluated.comparison.delta,
        resolvedFindings: evaluated.comparison.resolvedFindings,
        newFindings: evaluated.comparison.introducedFindings,
        remainingFindings: evaluated.comparison.remainingFindings,
        comparison: evaluated.comparison,
      };
      return {
        ...result,
        uiPayload: toRedesignUiPayload(result, { candidateProducts }),
      };
    }
  }

  // Deterministic fallback when enabled
  if (useFallbackOnFailure) {
    const fallbackPatch = buildFallbackScenePatch({
      house: baseHouse,
      evaluation: beforeEvaluation,
    });
    if (fallbackPatch) {
      const evaluatedFallback = evaluateCandidatePatch({
        house: baseHouse,
        patch: fallbackPatch,
        beforeEvaluation,
        household: effectiveHousehold,
        scenario: effectiveScenario,
        sun,
        includeEvacuation,
        candidateProducts,
      });

      if (evaluatedFallback.accepted) {
        const afterRecord = {
          house: evaluatedFallback.afterHouse,
          evaluation: evaluatedFallback.afterEvaluation,
        };
        const result = {
          status: "IMPROVED",
          attempts,
          before: beforeRecord,
          patch: fallbackPatch,
          selectedPatch: fallbackPatch,
          after: afterRecord,
          delta: evaluatedFallback.comparison.delta,
          resolvedFindings: evaluatedFallback.comparison.resolvedFindings,
          newFindings: evaluatedFallback.comparison.introducedFindings,
          remainingFindings: evaluatedFallback.comparison.remainingFindings,
          comparison: evaluatedFallback.comparison,
        };
        return {
          ...result,
          uiPayload: toRedesignUiPayload(result, { candidateProducts }),
        };
      }
    }
  }

  // All attempts failed and fallback disabled or inapplicable
  const lastComparison = compareEvaluations(beforeEvaluation, beforeEvaluation);
  const failedResult = {
    status: attempts.some((a) => a.valid) ? "NO_IMPROVEMENT" : "FAILED",
    attempts,
    before: beforeRecord,
    patch: null,
    selectedPatch: null,
    after: null,
    delta: lastComparison.delta,
    resolvedFindings: [],
    newFindings: [],
    remainingFindings: beforeEvaluation.findings,
    comparison: null,
  };
  return {
    ...failedResult,
    uiPayload: toRedesignUiPayload(failedResult, { candidateProducts }),
  };
}
