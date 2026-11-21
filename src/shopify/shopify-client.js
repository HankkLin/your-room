import { productCandidateId, validCandidateRow } from "../contracts/product.js";

const quoteLifetimeMs = 10 * 60 * 1000;

export function shopifyRef(product) {
  return { variantId: product.variantId, sellerDomain: product.sellerDomain };
}

export async function shopifyRequest(operation, body, { signal } = {}) {
  const response = await fetch(`/api/shopify/${operation}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal,
  }).catch((error) => {
    if (signal?.aborted) throw error;
    const failure = new Error(operation === "checkout"
      ? "Shopify could not confirm the checkout. Visit the merchant to continue."
      : "Shopify is temporarily unavailable.");
    failure.uncertain = operation === "checkout";
    throw failure;
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== "object" || Array.isArray(data)) {
    const error = new Error(data?.error || "Shopify is temporarily unavailable.");
    error.status = response.status;
    error.warnings = data?.warnings;
    error.products = data?.products;
    error.retryAfter = data?.retryAfter;
    error.uncertain = data?.uncertain === true || (operation === "checkout" && !data);
    throw error;
  }
  return data;
}

export function createShopifyQuotes(onExpire) {
  const quotes = new Map();
  let expiryTimer;

  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    if (!quotes.size) return;
    const nextExpiry = Math.min(...Array.from(quotes.values(), (quote) => quote.expiresAt));
    expiryTimer = setTimeout(() => {
      const now = Date.now();
      for (const [key, quote] of quotes)
        if (quote.expiresAt <= now) quotes.delete(key);
      scheduleExpiry();
      onExpire();
    }, Math.max(0, nextExpiry - Date.now()));
  }

  function set(product) {
    quotes.set(productCandidateId(product), { product, expiresAt: Date.now() + quoteLifetimeMs });
  }

  async function refreshMerchant(refs, signal) {
    const unique = [...new Map(refs.map((ref) => [productCandidateId(ref), ref])).values()];
    const warnings = [];
    for (let offset = 0; offset < unique.length; offset += 50) {
      const batch = unique.slice(offset, offset + 50);
      const previous = batch.map((ref) => quotes.get(productCandidateId(ref)));
      let products = [];
      try {
        const data = await shopifyRequest("lookup", { refs: batch }, { signal });
        if (!Array.isArray(data.products)) throw new Error("Shopify product details are unavailable.");
        products = data.products.filter(validCandidateRow);
        warnings.push(...(data.warnings ?? []));
      } catch (error) {
        if (signal?.aborted) throw error;
        warnings.push({ text: `${batch[0].sellerDomain} · ${error.message}` }, ...(error.warnings ?? []));
      }
      if (signal?.aborted) return [];
      const byRef = new Map(products.map((product) => [productCandidateId(product), product]));
      batch.forEach((ref, index) => {
        const key = productCandidateId(ref);
        if (quotes.get(key) !== previous[index]) return;
        const product = byRef.get(key);
        if (product) set(product);
        else quotes.delete(key);
      });
      scheduleExpiry();
    }
    return warnings;
  }

  return {
    get(ref) {
      if (!ref) return null;
      const quote = quotes.get(productCandidateId(ref));
      return quote?.expiresAt > Date.now() ? quote.product : null;
    },
    remember(product) {
      if (!validCandidateRow(product)) return;
      set(product);
      scheduleExpiry();
    },
    async refresh(refs, { signal } = {}) {
      const merchants = new Map();
      for (const ref of refs.filter(ref => productCandidateId(ref))) {
        const domain = ref.sellerDomain.toLowerCase();
        if (!merchants.has(domain)) merchants.set(domain, []);
        merchants.get(domain).push(ref);
      }
      const results = await Promise.all([...merchants.values()].map((group) => refreshMerchant(group, signal)));
      return results.flat();
    },
  };
}
