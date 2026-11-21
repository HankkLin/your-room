import { createShopifyPreview } from "../../model.js";
import { canAdoptCandidate, productCandidateId } from "../contracts/product.js";

export function createCandidatePlacement(candidate, kind, placement) {
  if (!canAdoptCandidate(candidate)) return null;
  const shopify = { sellerDomain: candidate.sellerDomain, variantId: candidate.variantId };
  const preview = createShopifyPreview(kind, shopify, placement);
  if (!preview) return null;
  return {
    ...preview, productId: candidate.productId ?? null, name: candidate.title,
    ...(candidate.dimensionsSource === "merchant" && candidate.dimensions ?
      { ...candidate.dimensions, dimensionsSource: "merchant" } : {}),
  };
}

// Kevin's ScenePatch resolves productId against a candidate array. Use a seller-scoped
// key there while keeping the merchant's product and variant IDs on the adopted object.
export function toRedesignCandidate(candidate, kind) {
  const item = createCandidatePlacement(candidate, kind, {});
  if (!item || candidate.currency !== "USD") return null;
  const id = productCandidateId(candidate);
  return {
    ...item, id, productId: id, variantId: candidate.variantId, variant: candidate.variantTitle,
    merchant: candidate.merchant || candidate.sellerDomain, price: candidate.priceMinor / 100,
    url: candidate.productUrl, photo: candidate.imageUrl,
    dimensions: { width: item.width, height: item.height, depth: item.depth },
    product: { productId: candidate.productId, variantId: candidate.variantId, sellerDomain: candidate.sellerDomain },
  };
}
