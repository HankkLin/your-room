import test from "node:test";
import assert from "node:assert/strict";
import { generateStyleBrief, validateStyleBrief } from "../agents/style-brief.js";
import { searchProductsForDesign } from "./design-search.js";
import { buildCheckoutPlan } from "./checkout-plan.js";
import { createCandidateSession } from "./candidate-session.js";
import { refreshFurnishingOffers } from "../persona/furnishing-offers.js";
import { furnishingCandidatesFromSession } from "../persona/furnishing.js";
import { createProductCandidate, productCandidateId } from "../contracts/product.js";

const room = { id: "living", name: "Living room" };
const brief = { styles: ["Japandi", "Scandinavian"], colors: ["warm white"], materials: ["oak"], priorities: ["child friendly"],
  budget: { amount: 12000, currency: "USD" }, roomIntents: { living: [{ kind: "table", query: "warm oak coffee table" }] } };
const request = { prompt: "A Japandi house under $12,000 with a warm oak coffee table under $400.", rooms: [room] };
function row(n, price, changes = {}) {
  return { variantId: "gid://shopify/ProductVariant/" + n, sellerDomain: "oak.myshopify.com", productId: "oak-" + n,
    title: "Round coffee table", variantTitle: "Oak", available: true, currency: "USD", priceMinor: price, ...changes };
}
const ref = ({ sellerDomain, variantId }) => ({ sellerDomain, variantId });

test("StyleBrief validates empty-house design intent and keeps explicit item and household limits", async () => {
  const generate = async ({ input, schema }) => {
    assert.deepEqual(input, request);
    assert.ok(schema.properties.roomIntents.properties.living);
    return { payload: structuredClone(brief) };
  };
  const parsed = await generateStyleBrief(request, generate);
  assert.equal(parsed.budget.amount, 12000);
  assert.equal(parsed.roomIntents.living[0].maxPriceMinor, 39999);
  assert.equal((await generateStyleBrief({ ...request, budgetOverride: 1000 }, generate)).budget.amount, 1000);
  for (const invalid of [{ ...brief, position: [1, 0, 1] }, { ...brief, roomIntents: { wrongRoom: [] } },
    { ...brief, budget: { amount: -1, currency: "USD" } }, { ...brief, roomIntents: { living: [{ kind: "lamp", query: "oak lamp", price: 0 }] } }]) {
    assert.throws(() => validateStyleBrief(invalid, [room]));
  }
});

test("placed and unplaced search preserves exact refs, remaining budget, selected finish and unknown facts", async () => {
  const current = row(1, 10000);
  const candidates = [row(2, 29000), row(3, 12000, { available: null, deliveryEstimate: null }), current,
    row(4, 29000, { variantTitle: "Walnut" }), row(5, 40000), row(6, 2000, { currency: "CAD" }), row(7, null),
    row(8, 29900, { variantTitle: "Chestnut" })];
  const input = { query: "warm oak coffee table under $400", existingPieces: [
    { roomId: room.id, kind: "table", shopify: ref(current) }, { roomId: room.id, owned: true, kind: "chair", price: 999 },
  ] };
  const offered = await searchProductsForDesign({ styleBrief: { ...brief, budget: { amount: 400, currency: "USD" } }, room, constraints: input }, {
    request: async (operation, body) => {
      if (operation === "lookup") {
        assert.deepEqual(body.refs, [ref(current)]);
        return { products: [current] };
      }
      assert.equal(operation, "search");
      assert.equal(body.maxPriceMinor, 30000);
      return { products: candidates };
    },
  });
  assert.deepEqual(offered.products.map(item => [item.productId, item.placed]), [["oak-1", true], ["oak-2", false], ["oak-3", false]]);
  assert.equal(offered.products[2].available, null);
  assert.equal(offered.products[2].deliveryEstimate, null);
});

test("owned furniture guides automatic room searches and each type survives an offer refresh", async () => {
  const intents = [{ kind: "chair", query: "oak chair" }, { kind: "table", query: "oak table" }, { kind: "lamp", query: "warm lamp" }];
  const queries = [];
  const search = await searchProductsForDesign({ styleBrief: { ...brief, roomIntents: { living: intents } }, room,
    constraints: { existingPieces: [{ kind: "chair", roomId: room.id, owned: true }] } },
  { request: async (_, body) => { queries.push(body.query); return { products: [row(body.query.includes("table") ? 1 : 2, 10900)] }; } });
  assert.equal(queries.length, 2);
  const session = createCandidateSession();
  session.remember({ source: "design", kind: "table", products: search.products, warnings: [] });
  const lamp = search.products.find(product => product.kind === "lamp");
  await refreshFurnishingOffers([{ shopify: ref(lamp) }], session, { remember() {} },
    async () => ({ product: row(2, 10900) }), new AbortController().signal);
  assert.deepEqual(furnishingCandidatesFromSession(session.read()).map(product => product.kind), ["table", "lamp"]);
  assert.equal(session.read().source, "design");
});

test("checkout plans consolidate selected quantities and isolate incompatible or missing merchant quotes", () => {
  const a = row(1, 100), b = row(2, 150), c = row(1, 500, { sellerDomain: "other.myshopify.com" });
  const inventory = [a, b, c];
  const quotes = { get: reference => inventory.find(product => productCandidateId(reference) === productCandidateId(product)) };
  const selectedRows = [a, a, b, c].map((p, i) => ({ id: String(i), shopify: ref(p), quantity: i === 1 ? 2 : 1 }));
  const plan = () => buildCheckoutPlan({ selectedRows, quotes }).groups;
  assert.deepEqual(plan().map(group => group.lines.map(line => line.quantity)), [[3, 1], [1]]);
  assert.ok(plan().every(group => group.ready));
  b.currency = "CAD";
  assert.match(plan()[0].reason, /currency/);
  assert.ok(plan()[1].ready);
  b.currency = "USD";
  b.available = null;
  assert.equal(plan()[0].ready, false);
});

test("candidate media and estimates remain absent when the variant supplies no facts", () => {
  const raw = { id: row(1).variantId, seller: { domain: row(1).sellerDomain }, seller_product_id: "123" };
  const product = createProductCandidate({ title: "Chair" }, raw);
  for (const field of ["availableForSale", "price", "modelUrl", "checkoutUrl", "productUrl", "dimensionSource", "deliveryEstimate"]) {
    assert.equal(product[field], null, field);
  }
  assert.deepEqual(product.imageUrls, []);
  assert.equal(product.productId, "123");
  assert.equal(product.source, "shopify");
});
