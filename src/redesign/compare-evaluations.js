import { EXPERIENCE_CATEGORIES, FINDING_TYPES } from "../contracts/simulation.js";

const CRITICAL_FINDING_TYPES = new Set([
  FINDING_TYPES.NO_PATH,
  FINDING_TYPES.NO_EVACUATION_PATH,
]);

export function findingIdentityKey(finding) {
  if (!finding || typeof finding !== "object") return "UNKNOWN";
  const room = finding.roomId ?? finding.location?.roomId ?? "";
  const ev = finding.evidence || {};

  switch (finding.type) {
    case FINDING_TYPES.NO_PATH:
      return `NO_PATH:${finding.agentId || ""}:${finding.fromRoomId || ""}->${finding.toRoomId || ""}`;
    case FINDING_TYPES.CONGESTION:
      return `CONGESTION:${room}`;
    case FINDING_TYPES.PRIVACY_SIGHTLINE:
      return `PRIVACY_SIGHTLINE:${room}:${ev.targetObjectId || ev.targetType || ""}`;
    case FINDING_TYPES.TV_OCCLUDED:
    case FINDING_TYPES.TV_BAD_ANGLE:
    case FINDING_TYPES.TV_TOO_FAR:
      return `${finding.type}:${ev.viewerObjectId || ""}->${ev.tvObjectId || ""}`;
    case FINDING_TYPES.NOISE_CONFLICT:
      return `NOISE_CONFLICT:${finding.agentId || ""}:${ev.sourceRoomId || ""}->${ev.receiverRoomId || ""}`;
    case FINDING_TYPES.NO_EVACUATION_PATH:
    case FINDING_TYPES.LONG_EVACUATION_ROUTE:
      return `${finding.type}:${finding.agentId || room}`;
    case FINDING_TYPES.EVACUATION_BOTTLENECK:
      return `EVACUATION_BOTTLENECK:${ev.exitDoorId || room}`;
    case FINDING_TYPES.SUN_GLARE:
      return `SUN_GLARE:${ev.targetObjectId || room}`;
    default:
      return `${finding.type}:${room}:${finding.agentId || ""}`;
  }
}

export function extractCategoryScoreMap(evaluation) {
  const scores = {};
  for (const cat of EXPERIENCE_CATEGORIES) {
    scores[cat] = Number(evaluation?.categories?.[cat]?.score ?? 100);
  }
  return scores;
}

/**
 * Deterministically compare `before` and `after` household experience evaluations,
 * detecting improvements, regressions, resolved findings, and newly introduced findings,
 * and applying the documented redesign acceptance policy (Task 4 §16–18).
 *
 * Acceptance policy:
 * `accepted = noCriticalRegression && maxCategoryDropOk && delta.overall >= 0 && hasMeasurableImprovement`
 *
 * @param {object} beforeEval
 * @param {object} afterEval
 * @param {object} [options]
 * @param {number} [options.maxAllowedCategoryDrop=4]
 */
export function compareEvaluations(beforeEval, afterEval, options = {}) {
  const maxAllowedCategoryDrop = Number(options.maxAllowedCategoryDrop ?? 4);

  const beforeScores = extractCategoryScoreMap(beforeEval);
  const afterScores = extractCategoryScoreMap(afterEval);
  const overallBefore = Number(beforeEval?.overallScore ?? 100);
  const overallAfter = Number(afterEval?.overallScore ?? 100);

  const categoryDeltas = {};
  const improvedCategories = [];
  const regressedCategories = [];

  for (const cat of EXPERIENCE_CATEGORIES) {
    const diff = afterScores[cat] - beforeScores[cat];
    categoryDeltas[cat] = diff;
    if (diff > 0) improvedCategories.push(cat);
    else if (diff < 0) regressedCategories.push(cat);
  }

  const delta = {
    overall: overallAfter - overallBefore,
    categories: categoryDeltas,
  };

  const beforeMap = new Map();
  for (const f of beforeEval?.findings || []) {
    const key = findingIdentityKey(f);
    const prev = beforeMap.get(key);
    if (!prev || f.severity > prev.severity) beforeMap.set(key, f);
  }

  const afterMap = new Map();
  for (const f of afterEval?.findings || []) {
    const key = findingIdentityKey(f);
    const prev = afterMap.get(key);
    if (!prev || f.severity > prev.severity) afterMap.set(key, f);
  }

  const resolvedFindings = [];
  const introducedFindings = [];
  const improvedFindings = [];
  const worsenedFindings = [];

  for (const [key, beforeFinding] of beforeMap.entries()) {
    const afterFinding = afterMap.get(key);
    if (!afterFinding) {
      resolvedFindings.push(beforeFinding);
      continue;
    }
    const beforeDur = Number(beforeFinding.evidence?.durationSeconds) || 0;
    const afterDur = Number(afterFinding.evidence?.durationSeconds) || 0;
    const durImproved = beforeDur > 0 && beforeDur - afterDur >= 120;

    if (beforeFinding.severity - afterFinding.severity >= 0.04 || durImproved) {
      improvedFindings.push({
        before: beforeFinding,
        after: afterFinding,
      });
    } else if (afterFinding.severity - beforeFinding.severity >= 0.04) {
      worsenedFindings.push({
        before: beforeFinding,
        after: afterFinding,
      });
    }
  }

  for (const [key, afterFinding] of afterMap.entries()) {
    if (!beforeMap.has(key)) {
      introducedFindings.push(afterFinding);
    }
  }

  const remainingFindings = [...(afterEval?.findings || [])];
  const rejectionReasons = [];

  // 1. Critical newly introduced finding check
  for (const intro of introducedFindings) {
    if (CRITICAL_FINDING_TYPES.has(intro.type) || intro.severity >= 0.72) {
      rejectionReasons.push(
        `Introduced critical finding ${intro.type} in ${intro.roomId || "home"} (severity ${intro.severity}).`,
      );
    }
  }

  // 2. Category regression check
  for (const cat of regressedCategories) {
    const drop = Math.abs(categoryDeltas[cat]);
    const limit = cat === "safety" ? 0 : maxAllowedCategoryDrop;
    if (drop > limit) {
      rejectionReasons.push(
        `${cat[0].toUpperCase() + cat.slice(1)} score decreased ${beforeScores[cat]} → ${afterScores[cat]}.`,
      );
    }
  }

  // 3. Overall score non-regression check
  if (delta.overall < 0) {
    rejectionReasons.push(
      `Overall score decreased ${overallBefore} → ${overallAfter}.`,
    );
  }

  // 4. Require at least one measurable improvement
  const hasMeasurableImprovement =
    resolvedFindings.length > 0 ||
    improvedFindings.length > 0 ||
    improvedCategories.length > 0;

  if (!hasMeasurableImprovement) {
    rejectionReasons.push(
      "ScenePatch produced no measurable improvement in findings or category scores.",
    );
  }

  const accepted = rejectionReasons.length === 0;

  return {
    accepted,
    rejectionReasons,
    beforeScores: { overall: overallBefore, ...beforeScores },
    afterScores: { overall: overallAfter, ...afterScores },
    delta,
    improvedCategories,
    regressedCategories,
    resolvedFindings,
    introducedFindings,
    newFindings: introducedFindings,
    improvedFindings,
    worsenedFindings,
    remainingFindings,
  };
}
