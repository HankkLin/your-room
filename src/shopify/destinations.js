// sellerDomain and storefrontUrl come from the matched variant's seller record.
export function shopifyHttpsUrl(value) {
  if (typeof value !== "string" || !/^https:\/\//i.test(value) || /[\\\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.hostname && !parsed.username && !parsed.password && !parsed.port ? value : null;
  } catch {
    return null;
  }
}

export function merchantLink(value, seller) {
  if (!shopifyHttpsUrl(value) || !seller?.sellerDomain) return null;
  const host = new URL(value).hostname;
  const storefront = shopifyHttpsUrl(seller.storefrontUrl);
  return host === seller.sellerDomain.toLowerCase() || (storefront && host === new URL(storefront).hostname) ? value : null;
}

export function productDestination(value, product) {
  if (!merchantLink(value, product)) return null;
  const url = new URL(value);
  const variants = url.searchParams.getAll("variant");
  const path = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:collections\/[^/]+\/)?products\/([^/]+)\/?$/i;
  const handle = path.exec(url.pathname)?.[1];
  if (!handle || (product.productUrl && path.exec(new URL(product.productUrl).pathname)?.[1] !== handle)) return null;
  return variants.length === 1 &&
    product.variantId === "gid://shopify/ProductVariant/" + variants[0] ? value : null;
}

export function variantBuyDestination(value, product) {
  if (!merchantLink(value, product)) return null;
  const url = new URL(value);
  if (url.searchParams.has("continue_to")) return null;
  const match = url.pathname.match(/^\/buy\/(\d+):1\/?$/);
  return match && product.variantId === "gid://shopify/ProductVariant/" + match[1] ? value : null;
}

export function merchantInfoDestination(value, seller) {
  if (!merchantLink(value, seller)) return null;
  return /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:policies|policy|pages|terms|privacy|prices|shipping|returns|legal|help)(?:\/|$)/i
    .test(new URL(value).pathname) ? value : null;
}

export function checkoutDestination(value, product) {
  if (!shopifyHttpsUrl(value) || !product?.sellerDomain) return null;
  const { hostname, pathname } = new URL(value);
  const hosted = ["shop.app", "pay.shopify.com", "checkout.shopify.com"].includes(hostname);
  if (!hosted && !merchantLink(value, product)) return null;
  return /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:checkouts?\/|cart\/c\/)\S+/i.test(pathname) ||
    (hosted && /^\/pay\/.+/.test(pathname)) ? value : null;
}
