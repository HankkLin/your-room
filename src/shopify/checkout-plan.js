import { canAdoptCandidate, productCandidateId } from "../contracts/product.js";

/** Group selected saved rows. quotes.get(ref) supplies the current exact merchant variant. */
export function buildCheckoutPlan({ selectedRows, quotes }) {
  const merchants = new Map();
  for (const row of selectedRows) {
    const key = productCandidateId(row.shopify);
    if (!key) continue;
    const domain = row.shopify.sellerDomain.toLowerCase();
    if (!merchants.has(domain)) merchants.set(domain, { sellerDomain: domain, variants: new Map(), reason: null });
    const group = merchants.get(domain);
    const product = quotes.get(row.shopify);
    const quantity = row.quantity ?? 1;
    if (productCandidateId(product) !== key || !canAdoptCandidate(product)) group.reason = "Refresh the price and availability of each included variant.";
    let line = group.variants.get(key);
    if (!line) {
      line = { ref: row.shopify, quantity: 0, priceMinor: product?.priceMinor, currency: product?.currency };
      group.variants.set(key, line);
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(line.quantity + quantity)) {
      group.reason = "Review the selected quantities.";
    } else line.quantity += quantity;
  }
  return { groups: [...merchants.values()].map(({ sellerDomain, variants, reason }) => {
    const lines = [...variants.values()];
    if (new Set(lines.map(line => line.currency)).size > 1) reason = "Select variants in one currency for this merchant.";
    if (lines.length > 50) reason = "Select up to 50 distinct variants for this merchant.";
    return { sellerDomain, lines, ready: !reason, reason };
  }) };
}
