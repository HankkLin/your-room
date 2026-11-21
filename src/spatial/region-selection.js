import { isObjectLocked, toSceneObject } from "../contracts/scene.js";
import { PATCH_ERROR_CODES } from "../contracts/scene-patch.js";
import { FINDING_TYPES } from "../contracts/simulation.js";
import { generateScenePatch } from "../agents/redesign-agent.js";
import { applyScenePatch, parsePositionTriple } from "../redesign/apply-scene-patch.js";
import { compareEvaluations } from "../redesign/compare-evaluations.js";
import { validateScenePatch } from "../redesign/validate-scene-patch.js";
import { evaluateHouseholdExperience } from "../simulation/validators/household-evaluation.js";
import { validateAccessibility } from "../simulation/validators/accessibility.js";
import {
  isFinitePoint2D,
  pointInPolygon,
  polygonBounds,
  segmentsIntersect2D,
} from "./floorplan-geometry.js";
import { withFurnitureFootprint } from "./furniture-footprint.js";

function polygonsOverlap2D(polyA, polyB) {
  if (!Array.isArray(polyA) || polyA.length < 3 || !Array.isArray(polyB) || polyB.length < 3) {
    return false;
  }
  const boxA = polygonBounds(polyA);
  const boxB = polygonBounds(polyB);
  if (
    boxA.maxX < boxB.minX ||
    boxB.maxX < boxA.minX ||
    boxA.maxZ < boxB.minZ ||
    boxB.maxZ < boxA.minZ
  ) {
    return false;
  }
  for (const pt of polyA) {
    if (pointInPolygon(pt, polyB)) return true;
  }
  for (const pt of polyB) {
    if (pointInPolygon(pt, polyA)) return true;
  }
  for (let i = 0; i < polyA.length; i += 1) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j += 1) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      if (segmentsIntersect2D(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Normalize either a lasso/polygon selection (`polygonXZ: [[x,z], ...]`),
 * a Hank rectangle selection (`region: [minX, minZ, maxX, maxZ]`), or explicit
 * `roomIds` into the unified `RegionSelection` contract:
 *
 * ```js
 * {
 *   polygonXZ: [[x, z], ...],
 *   bounds: [minX, minZ, maxX, maxZ],
 *   roomIds: string[],
 *   selectedObjectIds: string[],
 * }
 * ```
 *
 * @param {object | Array<number>} rawSelection
 * @param {object} house
 */
export function createRegionSelection(rawSelection, house) {
  if (!rawSelection || !house || !Array.isArray(house.rooms)) {
    throw new Error("createRegionSelection requires a selection and a valid House JSON.");
  }

  let polygonXZ = null;

  if (Array.isArray(rawSelection) && rawSelection.length === 4 && rawSelection.every(Number.isFinite)) {
    const [minX, minZ, maxX, maxZ] = rawSelection;
    if (minX >= maxX || minZ >= maxZ) {
      throw new Error("Region rectangle must have minX < maxX and minZ < maxZ.");
    }
    polygonXZ = [
      [minX, minZ],
      [maxX, minZ],
      [maxX, maxZ],
      [minX, maxZ],
    ];
  } else if (Array.isArray(rawSelection?.polygonXZ) && rawSelection.polygonXZ.length >= 3) {
    if (!rawSelection.polygonXZ.every(isFinitePoint2D)) {
      throw new Error("Region polygonXZ vertices must be finite [x, z] meter coordinates.");
    }
    polygonXZ = rawSelection.polygonXZ.map(([x, z]) => [Number(x), Number(z)]);
  } else if (Array.isArray(rawSelection?.bounds) && rawSelection.bounds.length === 4) {
    const [minX, minZ, maxX, maxZ] = rawSelection.bounds;
    polygonXZ = [
      [minX, minZ],
      [maxX, minZ],
      [maxX, maxZ],
      [minX, maxZ],
    ];
  } else if (Array.isArray(rawSelection?.roomIds) && rawSelection.roomIds.length > 0) {
    const matchedRooms = house.rooms.filter((r) => rawSelection.roomIds.includes(r.id));
    if (!matchedRooms.length) {
      throw new Error("Selected roomIds do not exist in House JSON.");
    }
    const rb = polygonBounds(matchedRooms.flatMap((r) => r.polygon || []));
    polygonXZ =
      matchedRooms.length === 1 && Array.isArray(matchedRooms[0].polygon)
        ? matchedRooms[0].polygon.map(([x, z]) => [Number(x), Number(z)])
        : [
            [rb.minX, rb.minZ],
            [rb.maxX, rb.minZ],
            [rb.maxX, rb.maxZ],
            [rb.minX, rb.maxZ],
          ];
  } else {
    throw new Error("Invalid region selection: provide polygonXZ, bounds, or roomIds.");
  }

  const box = polygonBounds(polygonXZ);
  const bounds = [box.minX, box.minZ, box.maxX, box.maxZ];

  // Determine intersecting rooms
  const roomIds =
    Array.isArray(rawSelection?.roomIds) && rawSelection.roomIds.length > 0
      ? [...new Set(rawSelection.roomIds.filter((id) => house.rooms.some((r) => r.id === id)))]
      : house.rooms
          .filter(
            (r) =>
              Array.isArray(r.polygon) &&
              r.polygon.length >= 3 &&
              polygonsOverlap2D(polygonXZ, r.polygon),
          )
          .map((r) => r.id);

  // Determine unlocked movable objects inside or intersecting the selected polygon
  const movableObjects = (house.objects || [])
    .filter((o) => o && !isObjectLocked(o) && o.type !== "fixed")
    .map((o) => withFurnitureFootprint(toSceneObject(o)));

  const explicitIds = Array.isArray(rawSelection?.selectedObjectIds)
    ? new Set(rawSelection.selectedObjectIds)
    : null;

  const selectedObjectIds = movableObjects
    .filter((obj) => {
      if (explicitIds) return explicitIds.has(obj.id);
      const centerIn = pointInPolygon([obj.x, obj.z], polygonXZ);
      return centerIn || polygonsOverlap2D(obj.footprint, polygonXZ);
    })
    .map((obj) => obj.id);

  return {
    polygonXZ,
    bounds,
    roomIds,
    selectedObjectIds,
  };
}

/**
 * Deterministically verify that every operation in `patch`:
 * 1. Does NOT target locked fixtures or objects outside `regionSelection.selectedObjectIds`
 *    (except `add`, whose destination must lie inside `regionSelection.polygonXZ`),
 * 2. Keeps the resulting footprint inside `regionSelection.polygonXZ` (or target `roomIds`),
 * 3. Passes full `validateScenePatch` (walls, doors, fixtures, required routes).
 */
export function validateScopedRegionPatch(
  house,
  patch,
  regionSelection,
  options = {},
) {
  const baseValidation = validateScenePatch(house, patch, options);
  const scopeErrors = [];
  const allowedIds = new Set(regionSelection?.selectedObjectIds || []);
  const allowedRooms = new Set(regionSelection?.roomIds || []);
  const poly = regionSelection?.polygonXZ || [];

  const objectsById = new Map(
    (house?.objects || []).map((o) => [o.id, withFurnitureFootprint(toSceneObject(o))]),
  );

  (patch?.operations || []).forEach((op, idx) => {
    if (!op || typeof op !== "object") return;
    const objectId = op.objectId;

    if (op.type !== "add" && !allowedIds.has(objectId)) {
      scopeErrors.push({
        code: PATCH_ERROR_CODES.INVALID_PATCH,
        operationIndex: idx,
        objectId,
        message: `Object "${objectId}" is outside the selected region scope.`,
      });
      return;
    }

    if (op.type === "move" || op.type === "replace" || op.type === "add") {
      const existing = objectsById.get(objectId);
      const pos = op.position
        ? parsePositionTriple(op.position, existing?.position ?? [0, 0, 0])
        : existing?.position;
      if (pos && poly.length >= 3) {
        const insidePoly = pointInPolygon([pos[0], pos[2]], poly);
        const insideAllowedRoom = house.rooms
          .filter((r) => allowedRooms.has(r.id))
          .some((r) => pointInPolygon([pos[0], pos[2]], r.polygon));

        if (!insidePoly && !insideAllowedRoom) {
          scopeErrors.push({
            code: PATCH_ERROR_CODES.OUTSIDE_ROOM_BOUNDS,
            operationIndex: idx,
            objectId,
            message: `Proposed position [${pos[0]}, ${pos[2]}] for "${objectId}" lies outside the selected region.`,
          });
        }
      }
    }
  });

  const combinedErrors = [...scopeErrors, ...baseValidation.errors];
  return {
    valid: combinedErrors.length === 0,
    errors: combinedErrors,
    warnings: baseValidation.warnings || [],
  };
}

/**
 * Identify immutable architectural accessibility blockers (such as locked narrow doorways)
 * that furniture rearrangement CANNOT fake or resolve, so the system reports them honestly.
 */
export function summarizeArchitecturalAccessibilityLimits(accessibilityFindings = [], house = null) {
  const doorIds = new Set((house?.doors || []).map((d) => d.id));
  const architecturalBlockers = [];

  for (const f of accessibilityFindings) {
    if (
      f.type === FINDING_TYPES.ACCESSIBILITY_CLEARANCE_FAIL &&
      f.evidence?.doorId &&
      doorIds.has(f.evidence.doorId)
    ) {
      architecturalBlockers.push({
        type: f.type,
        doorId: f.evidence.doorId,
        roomId: f.roomId,
        measuredWidthMeters: f.evidence.measuredWidthMeters,
        requiredWidthMeters: f.evidence.requiredWidthMeters,
        explanation: `Doorway "${f.evidence.doorId}" (${f.evidence.measuredWidthMeters} m) is fixed architecture narrower than ${f.evidence.requiredWidthMeters} m; furniture redesign cannot widen locked walls or doors.`,
      });
    } else if (
      f.type === FINDING_TYPES.ACCESSIBILITY_ROUTE_BLOCKED &&
      f.evidence?.blockingDoorId &&
      doorIds.has(f.evidence.blockingDoorId)
    ) {
      const door = (house?.doors || []).find((d) => d.id === f.evidence.blockingDoorId);
      if (door && Number(door.width) < 0.82) {
        architecturalBlockers.push({
          type: f.type,
          doorId: door.id,
          roomId: f.toRoomId || f.roomId,
          measuredWidthMeters: door.width,
          requiredWidthMeters: 0.82,
          explanation: `Route to "${f.toRoomId || f.roomId}" is constrained by fixed doorway "${door.id}" (${door.width} m < 0.82 m). Furniture movement cannot fake architectural door compliance.`,
        });
      }
    }
  }

  return architecturalBlockers;
}

/**
 * End-to-End Scoped Region Redesign Orchestrator (Phase 7 & Phase 9).
 *
 * Pipeline:
 * `RegionSelection + userPrompt + current findings + affected objects (+ accessibility)`
 *   → `Gemini ScenePatch` (or deterministic scoped fallback)
 *   → `validateScopedRegionPatch` (enforcing both region scope & immutable architecture)
 *   → `applyScenePatch` + `evaluateHouseholdExperience` replay
 */
export async function runScopedRegionRedesign({
  house,
  regionSelection: rawRegion,
  userPrompt = "",
  household = [],
  scenario = null,
  candidateProducts = [],
  maxAttempts = 2,
  patchGenerator = null,
  apiKey = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const baseHouse = structuredClone(house);
  const region =
    rawRegion?.polygonXZ && Array.isArray(rawRegion.selectedObjectIds)
      ? rawRegion
      : createRegionSelection(rawRegion, baseHouse);

  const hasWheelchairNeed =
    /wheelchair|accessible|accessibility|turn|clearance/i.test(userPrompt) ||
    household.some(
      (m) => Boolean(m?.usesWheelchair) || Number(m?.needs?.accessibility ?? 0) >= 0.75,
    );

  const beforeEvaluation = evaluateHouseholdExperience({
    house: baseHouse,
    household,
    scenario,
    forceAccessibilityCheck: hasWheelchairNeed,
  });

  const roomSet = new Set(region.roomIds);
  const regionalFindings = beforeEvaluation.findings.filter((f) => {
    const pos = f.location?.position;
    if (pos && isFinitePoint2D(pos) && pointInPolygon(pos, region.polygonXZ)) {
      return true;
    }
    return [f.roomId, f.fromRoomId, f.toRoomId, f.location?.roomId].some((id) =>
      roomSet.has(id),
    );
  });

  const architecturalLimits = hasWheelchairNeed
    ? summarizeArchitecturalAccessibilityLimits(
        beforeEvaluation.findings.filter((f) =>
          String(f.type || "").startsWith("ACCESSIBILITY_"),
        ),
        baseHouse,
      )
    : [];

  // Scope movable objects seen as mutable by Gemini strictly to `region.selectedObjectIds`
  const selectedSet = new Set(region.selectedObjectIds);
  const scopedPromptHouse = {
    ...baseHouse,
    objects: (baseHouse.objects || []).map((obj) =>
      selectedSet.has(obj.id) ? obj : { ...obj, locked: true },
    ),
  };

  const attempts = [];
  let acceptedPatch = null;
  let afterHouse = null;
  let afterEvaluation = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let candidatePatch = null;
    try {
      candidatePatch = await generateScenePatch({
        house: scopedPromptHouse,
        household,
        scenario: {
          ...(scenario || {}),
          name: `Region Redesign: ${String(userPrompt).slice(0, 180)}`,
        },
        evaluation: {
          ...beforeEvaluation,
          findings: regionalFindings,
        },
        candidateProducts,
        previousAttempts: attempts,
        generator: patchGenerator,
        apiKey,
        fetchImpl,
      });
    } catch (err) {
      attempts.push({
        attempt,
        patch: null,
        valid: false,
        accepted: false,
        rejectedBecause: [err?.message || "Region patch generation failed."],
      });
      break;
    }

    const validation = validateScopedRegionPatch(baseHouse, candidatePatch, region, {
      candidateProducts,
    });
    if (!validation.valid) {
      attempts.push({
        attempt,
        patch: candidatePatch,
        valid: false,
        accepted: false,
        validationErrors: validation.errors,
        rejectedBecause: validation.errors.map((e) => `${e.code}: ${e.message}`),
      });
      continue;
    }

    const patchedHouse = applyScenePatch(baseHouse, candidatePatch, {
      candidateProducts,
    });
    const nextEval = evaluateHouseholdExperience({
      house: patchedHouse,
      household,
      scenario,
      forceAccessibilityCheck: hasWheelchairNeed,
    });

    acceptedPatch = candidatePatch;
    afterHouse = patchedHouse;
    afterEvaluation = nextEval;
    attempts.push({
      attempt,
      patch: candidatePatch,
      valid: true,
      accepted: true,
      validationErrors: [],
      rejectedBecause: [],
    });
    break;
  }

  // Deterministic scoped fallback when Gemini is offline/unconfigured and movable items exist in region
  if (!acceptedPatch && region.selectedObjectIds.length > 0) {
    const targetId = region.selectedObjectIds[0];
    const targetObj = (baseHouse.objects || []).find((o) => o.id === targetId);
    const targetRoom = baseHouse.rooms.find(
      (r) => r.id === (targetObj?.roomId || region.roomIds[0]),
    );
    if (targetObj && targetRoom) {
      const rb = polygonBounds(region.polygonXZ);
      const candidates = [];
      for (const fx of [0.22, 0.78, 0.5, 0.3, 0.7]) {
        for (const fz of [0.22, 0.78, 0.5, 0.3, 0.7]) {
          candidates.push([
            Math.round((rb.minX + rb.width * fx) * 100) / 100,
            0,
            Math.round((rb.minZ + rb.depth * fz) * 100) / 100,
          ]);
        }
      }
      for (const pos of candidates) {
        const fallbackPatch = {
          id: "region-fallback-patch",
          isFallback: true,
          source: "deterministic_fallback",
          reasoning: `Scoped regional adjustment for "${userPrompt || "selected area"}" keeping locked architecture untouched.`,
          targetFindings: regionalFindings.map(
            (f) => `${f.type}:${f.roomId || "home"}`,
          ),
          operations: [
            {
              type: "move",
              objectId: targetId,
              position: pos,
              rotation: [0, 0, 0],
            },
          ],
        };
        if (
          validateScopedRegionPatch(baseHouse, fallbackPatch, region, {
            candidateProducts,
          }).valid
        ) {
          const candHouse = applyScenePatch(baseHouse, fallbackPatch, {
            candidateProducts,
          });
          const candEval = evaluateHouseholdExperience({
            house: candHouse,
            household,
            scenario,
            forceAccessibilityCheck: hasWheelchairNeed,
          });
          if (candEval.overallScore >= beforeEvaluation.overallScore) {
            acceptedPatch = fallbackPatch;
            afterHouse = candHouse;
            afterEvaluation = candEval;
            break;
          }
        }
      }
    }
  }

  const comparison = afterEvaluation
    ? compareEvaluations(beforeEvaluation, afterEvaluation)
    : null;

  return {
    accepted: Boolean(acceptedPatch && afterHouse),
    region,
    userPrompt,
    patch: acceptedPatch,
    attempts,
    beforeHouse: baseHouse,
    afterHouse,
    beforeEvaluation,
    afterEvaluation,
    comparison,
    architecturalLimits,
  };
}
