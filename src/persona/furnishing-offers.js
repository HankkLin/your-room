import { canAdoptCandidate, offerSignature, productCandidateId } from "../contracts/product.js";

// A proposal can stay on screen after a merchant changes its offer.
export async function refreshFurnishingOffers(items, session, quotes, request, signal) {
  const refs = new Map(items.filter((item) => item.shopify).map((item) => [productCandidateId(item.shopify), item.shopify]));
  if (!refs.size) return;

  const snapshot = session.read();
  const offered = new Map(snapshot?.products.map((product) => [productCandidateId(product), product]));
  if (!snapshot || [...refs.keys()].some((key) => !offered.has(key))) {
    throw new Error("The Shopify search expired. Search again and request a new proposal.");
  }
  const refreshed = await Promise.all([...refs].map(async ([key, ref]) => {
    const { product, warnings } = await request("variant", { ref }, { signal });
    if (productCandidateId(product) !== key) throw new Error("Shopify could not confirm the selected variant.");
    return { key, product, warnings };
  }));
  signal.throwIfAborted();
  if (session.read() !== snapshot) throw new Error("The Shopify shortlist changed. Request a new proposal.");

  const byId = new Map(refreshed.map(({ key, product }) => [key, product]));
  for (const { product } of refreshed) quotes.remember(product);
  session.remember({
    ...snapshot,
    products: snapshot.products.map(previous => {
      const product = byId.get(productCandidateId(previous));
      return product ? { ...product, ...(previous.kind ? { kind: previous.kind, placed: previous.placed } : {}) } : previous;
    }),
    warnings: refreshed.flatMap(({ warnings }) => warnings ?? []),
  }, snapshot.expiresAt);

  for (const { key, product, warnings } of refreshed) {
    if (!canAdoptCandidate(product)) throw new Error(product.title + " is unavailable. Request a new proposal.");
    if (offerSignature(product) !== offerSignature(offered.get(key))) {
      throw new Error("The merchant changed the offer for " + product.title + ". Review the refreshed alternatives and request a new proposal.");
    }
    if (warnings?.length && warnings.some(({ text }) => !snapshot.warnings.some((prior) => prior.text === text))) {
      throw new Error("Shopify updated the notices for " + product.title + ". Review the alternatives and request a new proposal.");
    }
  }
}
