import offers from "../../offers.json" with { type: "json" };
import { extractVariantIdFromProductUrl, productCandidateId, shopifyHttpsUrl } from "../contracts/product.js";

// Permanent Shopify shop domains published by the storefronts in offers.json.
const shops = new Map([
  ["sundays-company.com", "sundays-company-production.myshopify.com"],
  ["floydhome.com", "floyd-home.myshopify.com"],
  ["brightech.com", "brightechshop-2.myshopify.com"],
  ["thesill.com", "the-sill.myshopify.com"],
]);

export function catalogCheckoutRow(row, previous) {
  if (!row || row.shopify) return row;
  const offer = Object.hasOwn(offers, row.productId) ? offers[row.productId] : null;
  const url = shopifyHttpsUrl(row.url ?? offer?.url);
  if (!url) return row;
  const page = new URL(url);
  const sellerDomain = shops.get(page.hostname.replace(/^www\./, ""));
  const variantId = extractVariantIdFromProductUrl(url);
  if (!sellerDomain || !variantId || page.port || !/\/products\/[^/]+\/?$/.test(page.pathname)) return row;
  if (row.variantId && row.variantId !== variantId && String(row.variantId) !== page.searchParams.get("variant")) return row;
  const shopify = { sellerDomain, variantId };
  const prior = productCandidateId(previous?.shopify) === productCandidateId(shopify) ? previous : null;
  const price = row.price ?? offer?.price;
  const savedPrice = prior?.savedPrice ?? row.savedPrice ?? (Number.isFinite(price) && price >= 0
    ? { priceMinor: Math.round(price * 100), currency: "USD" } : null);
  return {
    ...prior, ...row, shopify, url,
    ...(savedPrice ? { savedPrice } : {}),
    name: row.name ?? offer?.name,
    merchant: row.merchant ?? row.store ?? offer?.store,
    variant: row.variant ?? offer?.variant,
    photo: row.photo ?? offer?.photo,
  };
}
