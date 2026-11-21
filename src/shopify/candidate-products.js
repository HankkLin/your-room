import { catalog } from "../../model.js";

/**
 * Extract a numeric Shopify variant ID from a merchant product URL query string
 * (e.g. `https://www.sundays-company.com/...?variant=41588223803463` -> `gid://shopify/ProductVariant/41588223803463`).
 *
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function extractVariantIdFromProductUrl(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url);
    const rawVariant = parsed.searchParams.get("variant");
    if (rawVariant && /^\d+$/.test(rawVariant)) {
      return `gid://shopify/ProductVariant/${rawVariant}`;
    }
  } catch {
    // Ignore malformed URLs
  }
  return null;
}

/**
 * Build source-backed `ProductCandidate[]` from Stillroom's real `offers.json` +
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
 * @param {Array<object>} [options.sceneItems=[]]
 * @returns {Array<object>}
 */
export function getCandidateProducts({ sceneItems = [] } = {}) {
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

  // Also include any live-picked Shopify items currently in the user's session if not already listed
  const seenIds = new Set(candidates.map((c) => c.productId));
  for (const item of Array.isArray(sceneItems) ? sceneItems : []) {
    if (!item?.shopify?.variantId || seenIds.has(item.shopify.variantId)) {
      continue;
    }
    seenIds.add(item.shopify.variantId);
    candidates.push({
      id: item.shopify.variantId,
      productId: item.shopify.variantId,
      variantId: item.shopify.variantId,
      shopify: { ...item.shopify },
      kind: item.kind || "chair",
      name: item.name || "Shopify piece",
      store: item.shopify.sellerDomain,
      merchant: item.shopify.sellerDomain,
      price: Number(item.price) || 0,
      url: item.url || null,
      photo: item.photo || null,
      color: item.color || "#c5b69e",
      width: item.width,
      height: item.height,
      depth: item.depth,
      dimensions: {
        width: item.width,
        height: item.height,
        depth: item.depth,
      },
      dimensionSource: item.dimensionsSource || "estimated",
      dimensionsSource: item.dimensionsSource || "estimated",
    });
  }

  return candidates;
}
