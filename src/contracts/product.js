import { productAssetFields } from "../shopify/product-assets.js";
import { productDestination, shopifyHttpsUrl, variantBuyDestination } from "../shopify/destinations.js";
export { shopifyHttpsUrl };

// Shopify returns money in minor currency units. Scene dimensions are always in meters.
const variantPattern = /^gid:\/\/shopify\/ProductVariant\/[A-Za-z0-9_-]{1,128}$/;
const domainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const textValue = (value) => typeof value === "string" && value.trim() ? value.trim() : null;

export function productCandidateId(ref) {
  if (typeof ref?.variantId !== "string" || !variantPattern.test(ref.variantId) ||
      typeof ref.sellerDomain !== "string" || ref.sellerDomain.length > 253 || !domainPattern.test(ref.sellerDomain)) return null;
  return ref.variantId + "|" + ref.sellerDomain.toLowerCase();
}

function productImages(media) {
  if (!Array.isArray(media)) return [];
  return media.map((item) => shopifyHttpsUrl(item?.type === "image" ? item.url : item?.preview?.url)).filter(Boolean);
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
  const storefrontUrl = shopifyHttpsUrl(variant.seller.url);
  const seller = { ...ref, storefrontUrl };
  const priceMinor = currency && Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
  const available = typeof variant.availability?.available === "boolean" ? variant.availability.available : null;
  const imageUrls = [...new Set([...productImages(variant.media), ...productImages(product.media)])];
  return {
    id, productId: textValue(variant.seller_product_id) ?? textValue(product.id),
    ...ref, title, variantTitle: options.join(" / ") || (variantTitle !== title ? variantTitle : null),
    merchant: textValue(variant.seller.name), merchantId: textValue(variant.seller.id), storefrontUrl,
    priceMinor, currency, available, availableForSale: available,
    price: priceMinor === null ? null : priceMinor / 10 ** new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits,
    productUrl: productDestination(variant.url, seller), checkoutUrl: variantBuyDestination(variant.checkout_url, seller),
    imageUrls, imageUrl: imageUrls[0] ?? null, source: "shopify",
    deliveryEstimate: deliveryEstimate(variant), dimensions: null, dimensionsSource: null,
    dimensionSource: assets.dimensionsSource ?? null, modelUrl: null, ...assets,
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
