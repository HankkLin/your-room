import { canPlaceInHouse, fitItemInHouse, getRoomAtPoint, isObjectLocked, mergeHouseFixturesIntoItems, normalizeHouse } from "../../house-model.js";
import { catalog } from "../../model.js";
import { furnishingPath, validateFurnishingProposal } from "../agents/furnishing-contract.js";
import { toSceneObject } from "../contracts/scene.js";
import { prepareFurnishing, previewFurnishing } from "../persona/furnishing.js";
import { applyScenePatch } from "../redesign/apply-scene-patch.js";
import { validateScenePatch } from "../redesign/validate-scene-patch.js";
import { toRedesignCandidate } from "../shopify/scene-candidate.js";
import { createWholeHomeDemoPersonas } from "../simulation/demo-household.js";
import { validateAccessibility } from "../simulation/validators/accessibility.js";
import { evaluateHouseholdExperience } from "../simulation/validators/household-evaluation.js";
import { polygonBounds } from "./floorplan-geometry.js";
import { ownedCandidateToSceneObject } from "./owned-furniture.js";
import { productCandidateToSceneObject } from "./product-scene-object.js";
import { summarizeArchitecturalAccessibilityLimits } from "./region-selection.js";

const round2 = (n) => Math.round(n * 100) / 100;

// Each pass serves every eligible room before moving on to less essential pieces.
const FURNISHING_PASSES = [
  { bedroom: ["bed"] },
  { kitchen: ["table"], dining: ["table"], office: ["desk"] },
  { kitchen: ["chair"], dining: ["chair"], office: ["chair"] },
  { living: ["sofa", "chair"] },
  { bedroom: ["lamp"], living: ["table"], dining: ["chair"] },
  { living: ["lamp"], bedroom: ["console"], office: ["lamp"], kitchen: ["chair"] },
  { living: ["rug"], bedroom: ["desk"], office: ["bookcase"], closet: ["bookcase"] },
  { living: ["chair"], bedroom: ["chair"] },
];

function* roomPlacements(item, room, house, occupied) {
  const { minX, maxX, minZ, maxZ } = polygonBounds(room.polygon);
  // Try wall and corner positions first to keep through-routes and room centers free.
  for (const rotation of [0, 90]) {
    const halfX = (rotation ? item.depth : item.width) / 2;
    const halfZ = (rotation ? item.width : item.depth) / 2;
    const left = minX + halfX + 0.18, right = maxX - halfX - 0.18;
    const top = minZ + halfZ + 0.18, bottom = maxZ - halfZ - 0.18;
    if (left > right || top > bottom) continue;
    for (const u of [0, 1, 0.5, 0.25, 0.75]) {
      for (const v of [0, 1, 0.5, 0.25, 0.75]) {
        const x = round2(left + u * (right - left));
        const z = round2(top + v * (bottom - top));
        if (getRoomAtPoint(house, x, z)?.id !== room.id) continue;
        const placed = { ...item, x, z, rotation };
        if (canPlaceInHouse(placed, house, occupied, 0.08)) yield placed;
      }
    }
  }
}

export function buildDeterministicFurnishingPlan({
  house,
  normalizedHouse,
  styleBrief,
  personas = [],
  existingObjects = [],
  productCandidates = [],
  candidateLookupList = [],
  hasWheelchairNeed = false,
}) {
  const fitHouse = normalizedHouse || normalizeHouse(house);
  const styleName = styleBrief?.style || "Warm minimal";
  const budgetUsd = Number.isFinite(Number(styleBrief?.budget))
    ? Number(styleBrief.budget)
    : 4800;

  let spentUsd = existingObjects.reduce(
    (sum, obj) => (obj.owned || isObjectLocked(obj) ? sum : sum + (Number(obj.price) || 0)),
    0,
  );

  // Index live ProductCandidates + catalog fallbacks
  const pool = [];
  for (const cand of productCandidates) {
    try {
      const kind = cand.kind || "table";
      const redesignCand = toRedesignCandidate(cand, kind);
      if (redesignCand) {
        pool.push({
          isLive: true,
          redesignId: redesignCand.id,
          candidate: cand,
          kind: redesignCand.kind,
          price: redesignCand.price,
          style: cand.style || styleName,
          productId: redesignCand.id,
        });
        continue;
      }
      const probe = productCandidateToSceneObject(cand, { id: "probe" });
      pool.push({
        isLive: false,
        redesignId: null,
        candidate: cand,
        kind: probe.kind,
        price: probe.price,
        style: cand.style || styleName,
        productId: cand.id || probe.productId,
      });
    } catch {
      // Skip malformed candidate
    }
  }
  for (const item of catalog) {
    pool.push({
      isLive: false,
      redesignId: null,
      candidate: item,
      kind: item.kind,
      price: item.price,
      style: item.style,
      productId: item.id,
    });
  }

  const operations = [];
  let workingHouse = structuredClone(house);
  workingHouse.objects = [...existingObjects];
  let serial = 0;

  const needs = FURNISHING_PASSES.flatMap(pass =>
    (house.rooms || []).filter(room => pass[room.kind]).map(room => ({ room, kinds: pass[room.kind] })),
  );
  const requestedCounts = new Map();
  for (const { room, kinds } of needs) {
    const key = JSON.stringify([room.id, kinds]);
    const count = (requestedCounts.get(key) || 0) + 1;
    requestedCounts.set(key, count);
    const inRoom = workingHouse.objects.filter(o => o.roomId === room.id);
    if (inRoom.filter(o => kinds.includes(o.kind)).length >= count) continue;

    const remaining = budgetUsd - spentUsd;
    const matches = pool.filter(entry => kinds.includes(entry.kind) && entry.price <= remaining);
    matches.sort((a, b) =>
      kinds.indexOf(a.kind) - kinds.indexOf(b.kind) ||
      Number(b.isLive) - Number(a.isLive) ||
      Number(b.style === styleName) - Number(a.style === styleName) || a.price - b.price,
    );

    const occupied = mergeHouseFixturesIntoItems(fitHouse, workingHouse.objects);
    placement: for (const chosen of matches) {
      const kind = chosen.kind;
      let objectId;
      do {
        objectId = `designed-${room.id}-${kind}-${++serial}`;
      } while (workingHouse.objects.some(item => item.id === objectId));
      const baseSceneObj = productCandidateToSceneObject(chosen.candidate, { id: objectId, kind, roomId: room.id });
      for (const fitted of roomPlacements(baseSceneObj, room, fitHouse, occupied)) {
        const pos = [fitted.x, 0, fitted.z];
        const rot = [0, fitted.rotation * Math.PI / 180, 0];

        // Respect Hank's `livePatchError` contract: live Shopify candidates supply placement only,
        // while catalog items reference `productId: item.id` without forged Shopify fields.
        const addOp = chosen.isLive && chosen.redesignId
          ? {
              type: "add",
              objectId,
              productId: chosen.redesignId,
              position: pos,
              rotation: rot,
              object: {
                id: objectId,
                productId: chosen.redesignId,
                roomId: room.id,
                position: pos,
                rotation: rot,
              },
            }
          : {
              type: "add",
              objectId,
              productId: chosen.productId,
              position: pos,
              rotation: rot,
              object: {
                id: objectId,
                kind: baseSceneObj.kind,
                name: baseSceneObj.name,
                roomId: room.id,
                color: baseSceneObj.color,
                price: baseSceneObj.price,
                dimensions: { ...baseSceneObj.dimensions },
              },
            };

        const candidatePatch = {
          id: `step-${serial}`,
          reasoning: `Place ${baseSceneObj.name} in ${room.name} (${styleName}).`,
          targetFindings: [],
          operations: [addOp],
        };

        const validation = validateScenePatch(workingHouse, candidatePatch, {
          candidateProducts: candidateLookupList,
        });
        if (!validation.valid) continue;

        const nextHouse = applyScenePatch(workingHouse, candidatePatch, {
          candidateProducts: candidateLookupList,
        });
        if (hasWheelchairNeed) {
          const beforeAcc = validateAccessibility({
            house: workingHouse,
            forceCheck: true,
          });
          const afterAcc = validateAccessibility({
            house: nextHouse,
            forceCheck: true,
          });
          // Reject any addition that introduces a new wheelchair route block or turning-circle failure
          if (afterAcc.findings.length > beforeAcc.findings.length) {
            continue;
          }
        }

        workingHouse = nextHouse;
        operations.push(addOp);
        spentUsd = round2(spentUsd + baseSceneObj.price);
        break placement;
      }
    }
  }

  return {
    patch: {
      id: "spatial-design-v2-plan",
      source: "deterministic_planner",
      isFallback: true,
      reasoning: `Furnished ${house.name || "home"} in ${styleName} style within $${budgetUsd} budget while preserving walkability, doorway clearance, and locked fixtures.`,
      targetFindings: [],
      operations,
    },
    spentUsd,
  };
}

/**
 * Empty House → Designed House Spatial Orchestrator (Phase 5 & Phase 9).
 *
 * Consumes existing shared contracts (`House`, `StyleBrief`, `Persona[]`,
 * `ExistingFurniture[]`, `ProductCandidate[]`, `ScenePatch`) without creating
 * competing schemas:
 *
 * 1. Places/preserves `existingFurniture` as `owned: true` SceneObjects (excluded from checkout).
 * 2. Feeds accessibility requirements (when household includes a wheelchair user or
 *    `needs.accessibility >= 0.75`) into the design context.
 * 3. Accepts a Gemini `ScenePatch` (via `proposePatchFn`, Hank's `/api/furnishing/propose`,
 *    or deterministic whole-home planner fallback).
 * 4. Deterministically validates every operation via `validateScenePatch` (room bounds,
 *    walls, doorways, locked fixtures, required routes) plus `validateAccessibility`
 *    (honestly reporting immutable architectural limits like narrow locked doorways).
 */
export async function designEmptyHouse({
  house: rawHouse,
  styleBrief = {},
  personas = [],
  existingFurniture = [],
  productCandidates = [],
  proposePatchFn = null,
  fetchImpl = null,
} = {}) {
  if (!rawHouse || !Array.isArray(rawHouse.rooms) || rawHouse.rooms.length === 0) {
    throw new Error("designEmptyHouse requires a valid multi-room House JSON.");
  }

  const normalizedHouse = normalizeHouse(structuredClone(rawHouse));
  const effectivePersonas =
    Array.isArray(personas) && personas.length > 0
      ? personas
      : createWholeHomeDemoPersonas(normalizedHouse);

  const hasWheelchairNeed = effectivePersonas.some(
    (p) => Boolean(p?.usesWheelchair) || Number(p?.needs?.accessibility ?? 0) >= 0.75,
  );

  // 1. Normalize & place existing owned furniture first (`owned: true`, never purchased)
  const placedOwned = [];
  const baseWorking = structuredClone(rawHouse);
  baseWorking.objects = [...(rawHouse.objects || [])];

  for (const rawOwned of existingFurniture) {
    if (!rawOwned) continue;
    const preferredRoomId =
      rawOwned.roomId ||
      normalizedHouse.rooms.find((r) => r.kind === "living")?.id ||
      normalizedHouse.rooms[0].id;
    const ownedSceneObj =
      rawOwned.owned === true && Array.isArray(rawOwned.footprint)
        ? { ...toSceneObject(rawOwned), owned: true, price: 0 }
        : ownedCandidateToSceneObject(rawOwned, { roomId: preferredRoomId });

    const occupied = mergeHouseFixturesIntoItems(baseWorking, [
      ...baseWorking.objects,
      ...placedOwned,
    ]);
    const hasValidExplicitPos =
      Array.isArray(rawOwned.position) ||
      (Number.isFinite(Number(rawOwned.x)) && Number.isFinite(Number(rawOwned.z)));

    let placed = null;
    if (hasValidExplicitPos) {
      const checkPatch = {
        id: "check-owned",
        reasoning: "Verify owned placement",
        targetFindings: [],
        operations: [
          {
            type: "add",
            objectId: ownedSceneObj.id,
            position: ownedSceneObj.position,
            rotation: ownedSceneObj.rotationRadians,
            object: ownedSceneObj,
          },
        ],
      };
      if (
        validateScenePatch(
          { ...baseWorking, objects: [...baseWorking.objects, ...placedOwned] },
          checkPatch,
        ).valid
      ) {
        placed = ownedSceneObj;
      }
    }
    if (!placed) {
      const fitted = fitItemInHouse(
        ownedSceneObj,
        normalizedHouse,
        occupied,
        preferredRoomId,
      );
      if (fitted) {
        placed = ownedCandidateToSceneObject(
          { ...ownedSceneObj, dimensions: { width: fitted.width, height: fitted.height, depth: fitted.depth } },
          {
            id: ownedSceneObj.id,
            roomId: fitted.roomId || preferredRoomId,
            position: [fitted.x, 0, fitted.z],
            rotation: fitted.rotation,
          },
        );
      }
    }
    if (placed) {
      placedOwned.push(placed);
    }
  }

  baseWorking.objects = [...baseWorking.objects, ...placedOwned];

  // Evaluate baseline accessibility before furnishing so architectural constraints are known
  const baselineAccessibility = validateAccessibility({
    house: baseWorking,
    household: effectivePersonas,
    forceCheck: hasWheelchairNeed,
  });
  const architecturalLimits = summarizeArchitecturalAccessibilityLimits(
    baselineAccessibility.findings,
    baseWorking,
  );

  // Normalize live Shopify ProductCandidates for ScenePatch lookup
  const candidateLookupList = [];
  for (const cand of productCandidates) {
    const kind = cand.kind || "table";
    const redesignCand = toRedesignCandidate(cand, kind);
    if (redesignCand) {
      candidateLookupList.push(redesignCand);
    } else {
      try {
        const sceneCand = productCandidateToSceneObject(cand, { id: cand.id || cand.productId });
        candidateLookupList.push({
          ...sceneCand,
          id: cand.id || sceneCand.productId,
          productId: cand.productId || cand.id || sceneCand.productId,
        });
      } catch {
        // Ignore invalid candidate
      }
    }
  }
  for (const c of catalog) {
    if (!candidateLookupList.some((x) => x.id === c.id)) {
      candidateLookupList.push({
        ...c,
        productId: c.id,
        dimensions: { width: c.width, height: c.height, depth: c.depth },
      });
    }
  }

  // 2. Try custom/Gemini `proposePatchFn` or Hank's `/api/furnishing/propose` when supplied
  let acceptedPatch = null;
  let designedHouse = null;
  const rejectedProposals = [];

  if (typeof proposePatchFn === "function") {
    const proposed = await proposePatchFn({
      house: structuredClone(baseWorking),
      styleBrief,
      personas: effectivePersonas,
      existingObjects: baseWorking.objects,
      productCandidates: candidateLookupList,
      accessibilityFindings: baselineAccessibility.findings,
      architecturalLimits,
    });

    const validation = validateScenePatch(baseWorking, proposed, {
      candidateProducts: candidateLookupList,
    });
    if (!validation.valid) {
      rejectedProposals.push({
        patch: proposed,
        errors: validation.errors,
      });
    } else {
      const candidateHouse = applyScenePatch(baseWorking, proposed, {
        candidateProducts: candidateLookupList,
      });
      if (hasWheelchairNeed) {
        const postAcc = validateAccessibility({
          house: candidateHouse,
          household: effectivePersonas,
          forceCheck: true,
        });
        const newNonArchBlocks = postAcc.findings.filter(
          (f) =>
            !baselineAccessibility.findings.some(
              (bf) => bf.type === f.type && bf.roomId === f.roomId,
            ),
        );
        if (newNonArchBlocks.length > 0) {
          rejectedProposals.push({
            patch: proposed,
            errors: [
              {
                code: "ACCESSIBILITY_REGRESSION",
                message: `Proposed placement introduced ${newNonArchBlocks[0].type} in ${newNonArchBlocks[0].roomId}.`,
              },
            ],
          });
        } else {
          acceptedPatch = proposed;
          designedHouse = candidateHouse;
        }
      } else {
        acceptedPatch = proposed;
        designedHouse = candidateHouse;
      }
    }
  } else if (typeof fetchImpl === "function") {
    // Bridge seamlessly to Hank's `/api/furnishing/propose` contract when running against live server
    try {
      const prep = prepareFurnishing({
        project: {
          importedHouse: baseWorking,
          items: baseWorking.objects,
          personas: effectivePersonas,
        },
        style: styleBrief.style || "Warm minimal",
        brief:
          (styleBrief.brief || "") +
          (hasWheelchairNeed
            ? " Preserve 1.50m wheelchair turning circles and clear 0.86m routes."
            : ""),
        budget: Number(styleBrief.budget ?? 4800),
        reference: styleBrief.reference ?? null,
        liveCandidates: productCandidates,
      });
      const res = await fetchImpl(furnishingPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prep.input),
      });
      if (res.ok) {
        const proposal = await res.json();
        validateFurnishingProposal(proposal, prep.input);
        const preview = previewFurnishing(prep, proposal);
        const ops = preview.additions.map(({ item }) => ({
          type: "add",
          objectId: item.id,
          position: [item.x, 0, item.z],
          rotation: [0, ((Number(item.rotation) || 0) * Math.PI) / 180, 0],
          object: toSceneObject(item),
        }));
        const patchFromFurnishing = {
          id: "gemini-furnishing-patch",
          source: "gemini_furnishing",
          isFallback: false,
          reasoning: proposal.operations.map((o) => o.reason).join(" "),
          targetFindings: [],
          operations: ops,
        };
        if (
          validateScenePatch(baseWorking, patchFromFurnishing, {
            candidateProducts: candidateLookupList,
          }).valid
        ) {
          acceptedPatch = patchFromFurnishing;
          designedHouse = applyScenePatch(baseWorking, patchFromFurnishing, {
            candidateProducts: candidateLookupList,
          });
        }
      }
    } catch {
      // Fall through cleanly to deterministic planner when Gemini endpoint is offline or rejects
    }
  }

  // 3. Deterministic whole-home planner fallback if Gemini was not used or proposal was rejected
  if (!designedHouse) {
    const planned = buildDeterministicFurnishingPlan({
      house: baseWorking,
      normalizedHouse,
      styleBrief,
      personas: effectivePersonas,
      existingObjects: baseWorking.objects,
      productCandidates,
      candidateLookupList,
      hasWheelchairNeed,
    });
    acceptedPatch = planned.patch;
    designedHouse = applyScenePatch(baseWorking, planned.patch, {
      candidateProducts: candidateLookupList,
    });
  }

  const evaluation = evaluateHouseholdExperience({
    house: designedHouse,
    household: effectivePersonas,
    forceAccessibilityCheck: hasWheelchairNeed,
  });

  // Partition purchasable Shopify/catalog items vs owned items for checkout safety
  const purchasableObjects = (designedHouse.objects || []).filter(
    (obj) => !obj.owned && !isObjectLocked(obj) && obj.type !== "fixed",
  );
  const ownedObjects = (designedHouse.objects || []).filter(
    (obj) => Boolean(obj.owned) && obj.type !== "fixed",
  );

  return {
    house: designedHouse,
    patch: acceptedPatch,
    rejectedProposals,
    evaluation,
    ownedObjects,
    purchasableObjects,
    architecturalLimits,
  };
}
