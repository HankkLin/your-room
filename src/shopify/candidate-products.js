import { catalog } from "../../model.js";
import { toRedesignCandidate } from "./scene-candidate.js";
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
 * @returns {Array<object>}
 */
export function getCandidateProducts({ candidateSnapshot } = {}) {
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

  if (!candidateSnapshot || !(candidateSnapshot.expiresAt > Date.now()) || !Array.isArray(candidateSnapshot.products)) return candidates;
  const live = candidateSnapshot.products.map(product => toRedesignCandidate(product, candidateSnapshot.kind)).filter(Boolean);
  // The Gemini prompt takes a bounded prefix, so put requested live alternatives first.
  return [...live, ...candidates];
}
