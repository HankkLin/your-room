import { catalog } from "../../model.js";
import { toRedesignCandidate } from "./scene-candidate.js";
import { productCandidateId } from "../contracts/product.js";
import { extractVariantIdFromProductUrl } from "../contracts/product.js";
export { extractVariantIdFromProductUrl };

/**
 * Build source-backed `ProductCandidate[]` from Living Blueprint's real `offers.json` +
 * `catalog` entries (and merge any live Shopify session picks if provided).
 *
 * Preserves:
 * - `productId`
 * - `variantId` (when present in URL or live Shopify ref)
 * - `store` / `merchant`
 * - `price`
 * - `url`
 * - `photo`
 * - `dimensions`
 * - `dimensionSource: "estimated"` (never claims live stock)
 *
 * @param {object} [options]
 * @param {object} [options.candidateSnapshot] Current catalog results, kept separate from placed pieces.
 * @param {Array<object>} [options.sceneItems] Existing pieces whose current quotes may also be used.
 * @param {Function} [options.getQuote] Reads a current exact variant from the existing Shopify quote cache.
 * @returns {Array<object>}
 */
export function getCandidateProducts({ candidateSnapshot, sceneItems = [], getQuote = () => null } = {}) {
  const candidates = catalog.map((entry) => {
    const variantId =
      entry.variantId || extractVariantIdFromProductUrl(entry.url) || null;
    return {
      id: entry.id,
      productId: entry.id,
      ...(variantId ? { variantId } : {}),
      kind: entry.kind,
      name: entry.name,
      merchantProduct: entry.merchantProduct || entry.name,
      store: entry.store || entry.merchant || "Curated merchant",
      merchant: entry.store || entry.merchant || "Curated merchant",
      variant: entry.variant || "Default Title",
      price: Number(entry.price) || 0,
      url: entry.url || null,
      photo: entry.photo || null,
      color: entry.color || "#c5b69e",
      style: entry.style || "Warm minimal",
      width: entry.width,
      height: entry.height,
      depth: entry.depth,
      dimensions: {
        width: entry.width,
        height: entry.height,
        depth: entry.depth,
      },
      dimensionSource: "estimated",
      dimensionsSource: "estimated",
      stockSource: "static_offer_snapshot",
    };
  });

  const live = new Map();
  if (candidateSnapshot?.expiresAt > Date.now() && Array.isArray(candidateSnapshot.products)) {
    for (const row of candidateSnapshot.products) {
      const candidate = toRedesignCandidate(row, row.kind ?? candidateSnapshot.kind);
      if (candidate) live.set(candidate.id, candidate);
    }
  }
  for (const item of sceneItems) {
    const key = productCandidateId(item.shopify);
    if (!key || live.has(key)) continue;
    const quote = getQuote(item.shopify);
    if (productCandidateId(quote) !== key) continue;
    const candidate = toRedesignCandidate(quote, item.kind);
    if (candidate) live.set(key, candidate);
  }
  // The Gemini prompt takes a bounded prefix, so put requested live alternatives first.
  return [...live.values(), ...candidates];
}
