import { autoStyle, resolveBrief } from "../../model.js";
import { isObjectLocked, mergeHouseFixturesIntoItems, normalizeHouse } from "../../house-model.js";
import { furnishingCandidatesFromSession } from "../persona/furnishing.js";
import { applyScenePatch } from "../redesign/apply-scene-patch.js";
import { getCandidateProducts } from "../shopify/candidate-products.js";
import { resolveValidHouseholdForHouse } from "../twin-integration.js";
import { buildDeterministicFurnishingPlan } from "./spatial-design-engine.js";

function styleActiveState(baseState, overrides, snapshot) {
  const raw = baseState.importedHouse || baseState.house;
  const house = raw && normalizeHouse(raw);
  if (!house) return autoStyle(baseState, overrides);
  const { style, budget } = resolveBrief(baseState, overrides);
  const rawHouse = structuredClone(baseState.importedHouse || baseState.house);
  const ownedAndLockedMovable = baseState.items.filter(
    (i) => !i.fromHouseFixture && i.type !== "fixed" && (i.owned || isObjectLocked(i)),
  );
  rawHouse.objects = ownedAndLockedMovable;
  const effectivePersonas = resolveValidHouseholdForHouse(baseState, house).displayPersonas;
  const hasWheelchairNeed =
    /wheelchair|accessible|accessibility|step-free/i.test(baseState.brief || "") ||
    effectivePersonas.some(
      (p) => Boolean(p?.usesWheelchair || p?.wheelchair) || Number(p?.needs?.accessibility ?? 0) >= 0.75,
    );
  const liveCandidates = furnishingCandidatesFromSession(snapshot);
  const candidateLookupList = getCandidateProducts({ candidateSnapshot: snapshot });
  const planned = buildDeterministicFurnishingPlan({
    house: rawHouse,
    normalizedHouse: house,
    styleBrief: { style, budget, brief: baseState.brief || "" },
    personas: effectivePersonas,
    existingObjects: ownedAndLockedMovable,
    productCandidates: liveCandidates,
    candidateLookupList,
    hasWheelchairNeed,
    onPlanRoom: name => self.postMessage({ progress: `Checking furniture fit in ${name}…` }),
  });
  const designedHouse = applyScenePatch(rawHouse, planned.patch, {
    candidateProducts: candidateLookupList,
  });
  const items = mergeHouseFixturesIntoItems(house, designedHouse.objects || []);
  return { items, style, budget };
}
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ progress: "Matching furniture to your style, budget and available space…" });
    const { items, style, budget } = styleActiveState(data.project, data.overrides, data.snapshot);
    self.postMessage({ next: { items, style, budget } });
  } catch {
    self.postMessage({ error: true });
  }
};
