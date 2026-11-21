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

function dimensionsInMeters(dimensions) {
  const factor = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 }[dimensions?.unit];
  const axes = ["width", "height", "depth"];
  if (!Number.isFinite(factor) || !axes.every((axis) => Number.isFinite(dimensions[axis]) && dimensions[axis] > 0)) return null;
  return Object.fromEntries(axes.map((axis) => [axis, dimensions[axis] * factor]));
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
  const dimensions = dimensionsInMeters(variant.dimensions);
  return {
    id, productId: textValue(variant.seller_product_id) ?? textValue(product.id),
    ...ref, title, variantTitle: options.join(" / ") || (variantTitle !== title ? variantTitle : null),
    merchant: textValue(variant.seller.name),
    priceMinor: currency && Number.isSafeInteger(amount) && amount >= 0 ? amount : null,
    currency, available: typeof variant.availability?.available === "boolean" ? variant.availability.available : null,
    productUrl: shopifyHttpsUrl(variant.url), imageUrl: productImage(variant.media) ?? productImage(product.media),
    deliveryEstimate: deliveryEstimate(variant), dimensions, dimensionsSource: dimensions ? "merchant" : null,
  };
}

export function canAdoptCandidate(candidate) {
  return Boolean(productCandidateId(candidate) && candidate.available === true && Number.isSafeInteger(candidate.priceMinor) &&
    candidate.priceMinor >= 0 && typeof candidate.currency === "string" && /^[A-Z]{3}$/.test(candidate.currency));
}
