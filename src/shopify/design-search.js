import { furniturePreviewKinds, resolveBrief } from "../../model.js";
import { productCandidateId, validCandidateRow } from "../contracts/product.js";
import { catalogCheckoutRow } from "./catalog-checkout.js";
import { shopifyRequest } from "./shopify-client.js";
import { itemLimit } from "./budget.js";

const finishWords = /\b(oak|walnut|pine|maple|cherry|acacia|teak|mahogany|birch|chestnut|beech|ash|elm|mango)\b/gi;
function conflictingFinish(query, variant) {
  const wanted = query.toLowerCase().match(finishWords) ?? [];
  const offered = (variant ?? "").toLowerCase().match(finishWords) ?? [];
  return wanted.length && offered.length && !wanted.some(term => offered.includes(term));
}

/** Search one room. The result is a short-lived shortlist and never mutates the project. */
export async function searchProductsForDesign({ styleBrief, room, constraints = {} }, { request = shopifyRequest, signal } = {}) {
  if (!room?.id) throw new Error("Choose a room to search.");
  const query = (constraints.query ?? "").trim();
  const budget = constraints.budgetOverride ?? styleBrief?.budget ?? constraints.budget;
  if (budget && (budget.currency !== "USD" || !Number.isFinite(budget.amount) || budget.amount < 0)) {
    throw new Error("The catalog currently supports budgets in USD.");
  }
  const pieces = (constraints.existingPieces ?? []).filter(item => item.type !== "fixed");
  const inRoom = item => !item.roomId || item.roomId === room.id;
  const owned = pieces.filter(item => item.owned && inRoom(item));
  const interests = Object.hasOwn(styleBrief?.roomIntents ?? {}, room.id) ? styleBrief.roomIntents[room.id] : [];
  const kindsWanted = resolveBrief({ brief: query }).prioritizeKinds;
  const manualKind = constraints.kind || kindsWanted[0] || interests[0]?.kind;
  let intents = query ? [{ kind: manualKind, query,
    maxPriceMinor: interests.find(intent => intent.kind === manualKind)?.maxPriceMinor }] : interests;
  if (!query) {
    const unowned = intents.filter(intent => !owned.some(item => item.kind === intent.kind));
    if (unowned.length) intents = unowned;
  }
  if (!intents.length || intents.some(intent => !furniturePreviewKinds.includes(intent.kind))) {
    throw new Error("Enter an item to search for and choose its furniture type.");
  }
  const placed = pieces.map(item => ({ item, ref: catalogCheckoutRow(item)?.shopify }));
  const refs = [...new Map(placed.filter(({ ref }) => productCandidateId(ref)).map(({ ref }) => [productCandidateId(ref), ref])).values()];
  const current = new Map();
  const warnings = [];
  for (let i = 0; i < refs.length; i += 50) {
    const batch = refs.slice(i, i + 50);
    let response;
    try {
      response = await request("lookup", { refs: batch }, { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      warnings.push({ text: "Current details for some placed furniture could not be refreshed." });
      continue;
    }
    const requested = new Set(batch.map(productCandidateId));
    for (const row of response.products) {
      if (validCandidateRow(row) && requested.has(productCandidateId(row))) current.set(productCandidateId(row), row);
    }
    warnings.push(...(response.warnings ?? []));
  }
  let remaining = budget ? Math.round(budget.amount * 100) : Infinity;
  for (const { item, ref } of placed) {
    if (item.owned || !budget) continue;
    const fresh = current.get(productCandidateId(ref));
    const cost = ref ? (fresh?.currency === "USD" ? fresh.priceMinor : null) :
      (Number.isFinite(item.price) ? Math.round(item.price * 100) : null);
    if (!Number.isSafeInteger(cost) || cost < 0) {
      remaining = -1;
      warnings.push({ text: "Refresh existing furniture prices to confirm the remaining budget." });
      break;
    }
    remaining -= cost;
  }
  const results = new Map();
  const styleTerms = [...(styleBrief?.materials ?? []), ...(styleBrief?.styles ?? []), ...(styleBrief?.colors ?? [])].join(" ");
  const batches = await Promise.all(intents.map(async intent => {
    const cap = Math.min(itemLimit(intent.query), intent.maxPriceMinor ?? Infinity);
    const max = Math.min(remaining, cap);
    const terms = [intent.query, styleTerms].filter(Boolean).join(" ").slice(0, 200);
    const page = max < 0 ? { products: [], warnings: [] } : await request("search",
      { query: terms, ...(Number.isFinite(max) ? { maxPriceMinor: max } : {}) }, { signal });
    return { intent, cap, max, page };
  }));
  for (const { intent, cap, max, page } of batches) {
    warnings.push(...(page.warnings ?? []));
    const liveIds = new Set(page.products.map(productCandidateId));
    const placedForKind = placed.filter(({ item, ref }) => inRoom(item) && item.kind === intent.kind && current.has(productCandidateId(ref)));
    const placedIds = new Set(placedForKind.map(({ ref }) => productCandidateId(ref)));
    const words = intent.query.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    const matches = placedForKind.map(({ ref }) => current.get(productCandidateId(ref))).filter(product => {
      const title = (product.title + " " + (product.variantTitle ?? "")).toLowerCase();
      return liveIds.has(productCandidateId(product)) || words.some(word => title.includes(word));
    });
    for (const product of [...matches, ...page.products]) {
      if (!validCandidateRow(product) || conflictingFinish(intent.query, product.variantTitle)) continue;
      const id = productCandidateId(product);
      const isPlaced = placedIds.has(id);
      const limit = isPlaced ? cap : max;
      if (Number.isFinite(limit) && (product.currency !== "USD" || !Number.isSafeInteger(product.priceMinor) || product.priceMinor > limit)) continue;
      if (!results.has(id)) results.set(id, { ...product, kind: intent.kind, placed: isPlaced });
    }
  }
  // The shared picker can refresh 50 variants at once. Prefer distinct products before extra finishes.
  const ranked = [...results.values()].sort((a, b) => Number(b.available === true) - Number(a.available === true));
  const seen = new Set();
  const first = [];
  const alternatives = [];
  for (const product of ranked) {
    const key = product.sellerDomain + "|" + (product.productId ?? product.variantId);
    if (seen.has(key)) alternatives.push(product);
    else first.push(product);
    seen.add(key);
  }
  return { products: [...first, ...alternatives].slice(0, 50), warnings };
}
