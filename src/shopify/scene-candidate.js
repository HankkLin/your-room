import { createShopifyPreview } from "../../model.js";
import { canAdoptCandidate, offerSignature, productCandidateId, validCandidateRow } from "../contracts/product.js";
import { shopifyRequest } from "./shopify-client.js";
import { catalogCheckoutRow } from "./catalog-checkout.js";

export function createCandidatePlacement(candidate, kind, placement) {
  if (!validCandidateRow(candidate) || !canAdoptCandidate(candidate)) return null;
  const ref = { sellerDomain: candidate.sellerDomain, variantId: candidate.variantId };
  const item = createShopifyPreview(kind, ref, placement, candidate);
  if (!item) return null;
  return {
    ...item, variantId: ref.variantId, variant: candidate.variantTitle, merchant: candidate.merchant || ref.sellerDomain,
    url: candidate.productUrl ?? null, photo: candidate.imageUrl ?? null, deliveryEstimate: candidate.deliveryEstimate ?? null,
    savedPrice: { priceMinor: candidate.priceMinor, currency: candidate.currency },
  };
}

// ScenePatch productId selects one merchant variant. The persisted productId identifies the merchant product.
export function toRedesignCandidate(candidate, kind) {
  const item = createCandidatePlacement(candidate, kind, {});
  if (!item || candidate.currency !== "USD") return null;
  const id = productCandidateId(candidate);
  return {
    ...item, id, productId: id, price: candidate.priceMinor / 100, offerSignature: offerSignature(candidate),
    dimensions: { width: item.width, height: item.height, depth: item.depth },
    product: { productId: candidate.productId ?? null, variantId: item.variantId, sellerDomain: item.shopify.sellerDomain },
  };
}

export async function refreshPatchCandidates(patch, candidateProducts, request = shopifyRequest) {
  const ids = new Set((patch?.operations ?? []).filter(op => op.type === "add" || op.type === "replace")
    .map(op => op.productId ?? op.object?.productId));
  return Promise.all(candidateProducts.map(async candidate => {
    if (!candidate.offerSignature || !ids.has(candidate.id)) return candidate;
    const { product } = await request("variant", { ref: candidate.shopify });
    const fresh = toRedesignCandidate(product, candidate.kind);
    if (!fresh || fresh.id !== candidate.id || fresh.offerSignature !== candidate.offerSignature) {
      throw new Error("This Shopify offer changed or is unavailable. Refresh the alternatives and request a new preview.");
    }
    return fresh;
  }));
}

export function savedShopifyRow(item, previous, quote) {
  const id = productCandidateId(item.shopify);
  if (!id) throw new Error("This piece has no valid Shopify merchant and variant.");
  const existing = productCandidateId(previous?.shopify) === id ? previous : null;
  const exactQuote = productCandidateId(quote) === id ? quote : null;
  const row = { ...existing, id: item.id, name: item.name || existing?.name || exactQuote?.title, shopify: { ...item.shopify } };
  if (item.suggestedReason) row.suggestedReason = item.suggestedReason;
  const prices = [row.savedPrice, item.savedPrice, exactQuote];
  const price = prices.find(price => Number.isSafeInteger(price?.priceMinor) && price.priceMinor >= 0 &&
    typeof price.currency === "string" && /^[A-Z]{3}$/.test(price.currency));
  if (price) row.savedPrice = { priceMinor: price.priceMinor, currency: price.currency };
  return row;
}

/** Save one selected placement with the room and rationale displayed by the planner. */
export function savedProductForPlacement(item, { previous, quote, roomLabel, suggestedReason = item.suggestedReason } = {}) {
  let row;
  if (productCandidateId(item.shopify)) {
    row = savedShopifyRow(item, previous, quote);
  } else if (item.productId || item.url || item.merchant || item.store) {
    const merchant = item.merchant || item.store;
    row = catalogCheckoutRow({
      id: item.id, ...(item.name ? { name: item.name } : {}),
      ...(item.productId ? { productId: item.productId } : {}),
      ...(item.variantId ? { variantId: item.variantId } : {}),
      ...(item.variant ? { variant: item.variant } : {}),
      ...(merchant ? { merchant, store: item.store || merchant } : {}),
      ...(item.price != null && Number.isFinite(Number(item.price)) ? { price: Number(item.price) } : {}),
      ...(item.url ? { url: item.url } : {}),
      ...(item.photo ? { photo: item.photo } : {}),
    }, previous);
    // An old unlinked offer can retain its saved snapshot only for the same placement and offer.
    const previousMerchant = previous?.merchant || previous?.store;
    if (!row.shopify && previous?.id === item.id && !previous.shopify &&
        (row.url || row.productId) && row.url === previous.url && row.productId === previous.productId &&
        (row.variantId ?? null) === (previous.variantId ?? null) &&
        (!row.variant || !previous.variant || row.variant === previous.variant) &&
        (!merchant || !previousMerchant || merchant === previousMerchant)) {
      row = { ...previous, ...row };
    }
  } else {
    return null;
  }
  if (roomLabel) row.roomLabel = roomLabel;
  if (suggestedReason) row.suggestedReason = suggestedReason;
  return row;
}

export function savedProductsForPatch(savedProducts, patch, afterItems) {
  const saved = new Map((savedProducts ?? []).map(row => [row.id, row]));
  const placed = new Map(afterItems.map(item => [item.id, item]));
  for (const op of patch.operations) {
    if (!["add", "replace", "remove"].includes(op.type)) continue;
    const previous = saved.get(op.objectId);
    saved.delete(op.objectId);
    if (op.type === "remove") continue;
    const item = placed.get(op.objectId);
    if (item?.shopify) saved.set(item.id, savedShopifyRow(item, previous));
  }
  return [...saved.values()];
}
