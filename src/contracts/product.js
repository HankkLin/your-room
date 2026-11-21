import { productAssetFields } from "../shopify/product-assets.js";

// Shopify returns money in minor currency units. Scene dimensions are always in meters.
const variantPattern = /^gid:\/\/shopify\/ProductVariant\/[A-Za-z0-9_-]{1,128}$/;
const domainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const textValue = (value) => typeof value === "string" && value.trim() ? value.trim() : null;

export function productCandidateId(ref) {
  if (typeof ref?.variantId !== "string" || !variantPattern.test(ref.variantId) ||
      typeof ref.sellerDomain !== "string" || ref.sellerDomain.length > 253 || !domainPattern.test(ref.sellerDomain)) return null;
  return ref.variantId + "|" + ref.sellerDomain.toLowerCase();
}

export function shopifyHttpsUrl(value) {
  if (typeof value !== "string" || !/^https:\/\//i.test(value) || /[\\\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.hostname && !parsed.username && !parsed.password ? value : null;
  } catch {
    return null;
  }
}

function productImage(media) {
  if (!Array.isArray(media)) return null;
  return media.map((item) => shopifyHttpsUrl(item?.type === "image" ? item.url : item?.preview?.url)).find(Boolean) ?? null;
}

function deliveryEstimate(variant) {
  const given = textValue(variant.delivery_estimate);
  if (given) return given;
  const regions = variant.deliveryOptionEstimates?.regionalEstimates;
  if (!Array.isArray(regions)) return null;
  const estimates = [];
  for (const region of regions) {
    if (!Array.isArray(region?.estimates)) continue;
    const areas = Array.isArray(region.subdivisionCodes) ? region.subdivisionCodes.filter((value) => typeof value === "string").join(", ") : "";
    for (const option of region.estimates) {
      const range = option?.configuredDeliveryDaysRange;
      if (option?.deliveryMethodType !== "SHIPPING" || !Number.isSafeInteger(range?.min) ||
          !Number.isSafeInteger(range.max) || range.min < 0 || range.max < range.min) continue;
      const days = range.min === range.max ? range.min + " days" : range.min + "–" + range.max + " days";
      estimates.push(areas ? days + " (" + areas + ")" : days);
    }
  }
  return [...new Set(estimates)].join(" / ") || null;
}

/** Turn one merchant variant into a ProductCandidate without using inferred descriptions as facts. */
export function createProductCandidate(product, variant) {
  const ref = { variantId: variant?.id, sellerDomain: variant?.seller?.domain };
  const id = productCandidateId(ref);
  const title = textValue(product?.title) ?? textValue(variant?.title);
  if (!id || !title) return null;
  const options = Array.isArray(variant.options) ? variant.options.map((option) => textValue(option?.label)).filter(Boolean) : [];
  const variantTitle = textValue(variant.title);
  const currency = typeof variant.price?.currency === "string" && /^[A-Z]{3}$/.test(variant.price.currency) ? variant.price.currency : null;
  const amount = variant.price?.amount;
  const assets = productAssetFields(product, variant);
  return {
    id, productId: textValue(variant.seller_product_id) ?? textValue(product.id),
    ...ref, title, variantTitle: options.join(" / ") || (variantTitle !== title ? variantTitle : null),
    merchant: textValue(variant.seller.name),
    priceMinor: currency && Number.isSafeInteger(amount) && amount >= 0 ? amount : null,
    currency, available: typeof variant.availability?.available === "boolean" ? variant.availability.available : null,
    productUrl: shopifyHttpsUrl(variant.url), imageUrl: productImage(variant.media) ?? productImage(product.media),
    deliveryEstimate: deliveryEstimate(variant), dimensions: null, dimensionsSource: null, ...assets,
  };
}

export function canAdoptCandidate(candidate) {
  return Boolean(productCandidateId(candidate) && candidate.available === true && Number.isSafeInteger(candidate.priceMinor) &&
    candidate.priceMinor >= 0 && typeof candidate.currency === "string" && /^[A-Z]{3}$/.test(candidate.currency));
}

// Only confirmed facts are compared when approving a refreshed offer.
export function offerSignature(product) {
  const dimensions = product.dimensions;
  return JSON.stringify([
    productCandidateId(product), product.productId ?? null, product.priceMinor, product.currency,
    product.available, dimensions?.width ?? null, dimensions?.height ?? null, dimensions?.depth ?? null,
    product.dimensionsSource ?? null, product.deliveryEstimate ?? null, product.modelUrl ?? null, product.modelScope ?? null,
  ]);
}

export function validCandidateRow(product) {
  return Boolean(productCandidateId(product) && typeof product.title === "string" && product.title.trim() &&
    (product.dimensions == null || ["width", "height", "depth"].every((axis) =>
      Number.isFinite(product.dimensions[axis]) && product.dimensions[axis] > 0)));
}

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
