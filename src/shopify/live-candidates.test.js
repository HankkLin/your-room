import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createShopifyApiMiddleware } from "./shopify-api.js";
import { createProductCandidate, productCandidateId } from "../contracts/product.js";
import { toRedesignCandidate } from "./scene-candidate.js";

const shop = "sandbox-merchant.myshopify.com";
const variant = (n, overrides = {}) => ({
  id: "gid://shopify/ProductVariant/" + n, seller_product_id: "gid://shopify/Product/12",
  seller: { domain: shop, name: "North Shore" }, options: [{ label: n === 31 ? "Linen" : "Walnut" }],
  price: { amount: 3500, currency: "USD" }, availability: { available: true },
  inputs: [{ id: "gid://shopify/ProductVariant/" + n, match: "exact" }], ...overrides,
});
const linen = variant(31);
const walnut = variant(32, {
  deliveryOptionEstimates: { regionalEstimates: [
    { subdivisionCodes: ["NY"], estimates: [{ deliveryMethodType: "SHIPPING", configuredDeliveryDaysRange: { min: 2, max: 4 } }] },
  ] },
  dimensions: { width: 30, depth: 20, height: 50, unit: "cm" },
});
const otherMerchant = variant(32, { seller: { domain: "second.myshopify.com" }, availability: { available: false } });
const product = { id: "gid://shopify/p/cluster", title: "Floor Lamp", metadata: { tech_specs: { width: "2cm" } },
  variants: [linen, walnut, walnut, otherMerchant] };
const refs = [linen, walnut, otherMerchant].map((v) => ({ variantId: v.id, sellerDomain: v.seller.domain }));

async function request(path, input, generateRecommendation) {
  const fetchImpl = async (_, options) => {
    assert.ok(["search_catalog", "lookup_catalog"].includes(JSON.parse(options.body).params.name));
    return Response.json({ jsonrpc: "2.0", id: 1, result: { structuredContent: { products: [product] } } });
  };
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]), {
    method: "POST", url: "/api/shopify/" + path, headers: { host: "localhost", "content-type": "application/json" }, socket: {},
  });
  const res = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
  await createShopifyApiMiddleware({ fetchImpl, generateRecommendation })(req, res, () => assert.fail("Unexpected endpoint"));
  return res;
}

test("one live search yields distinct merchant variants even with duplicate IDs; unknown facts stay unknown", async () => {
  const result = await request("search", { query: "lamp" });
  assert.equal(result.statusCode, 200);
  const [first, second, third] = result.body.products;
  assert.equal(result.body.products.length, 3);
  assert.equal(first.deliveryEstimate, null);
  assert.equal(first.dimensions, null);
  assert.equal(first.productId, linen.seller_product_id);
  assert.equal(second.deliveryEstimate, "2–4 days (NY)");
  assert.deepEqual(second.dimensions, { width: 0.3, height: 0.5, depth: 0.2 });
  assert.equal(second.dimensionsSource, "merchant");
  assert.notEqual(second.id, third.id);
  assert.equal(third.available, false);
});

test("Gemini receives fresh source-backed alternatives for addition and replacement. It can select only a known available ID", async () => {
  for (const mode of ["add", "replace"]) {
    const input = { mode, kind: "lamp", instruction: "warm lamp", refs, ...(mode === "replace" ? { objectId: "placed-lamp" } : {}) };
    const id = productCandidateId(refs[1]);
    const result = await request("recommend", input, async ({ input: modelInput }) => {
      assert.equal(modelInput.mode, mode);
      assert.deepEqual(modelInput.candidates.map((c) => c.id), refs.slice(0, 2).map(productCandidateId));
      assert.equal(modelInput.candidates[1].priceMinor, 3500);
      return { payload: { candidateId: id } };
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.scenePatch.operations, [{ type: mode, productId: id, ...(input.objectId ? { objectId: input.objectId } : {}) }]);
    for (const payload of [{ candidateId: id, priceMinor: 0 }, { candidateId: id, available: true, dimensions: {} }, { candidateId: productCandidateId(refs[2]) }]) {
      const invalid = await request("recommend", input, async () => ({ payload }));
      assert.equal(invalid.statusCode, 502);
      assert.equal(invalid.body.scenePatch, undefined);
    }
  }
});

test("Kevin's candidate list can resolve an unplaced variant by patch productId, with geometry and checkout ref from Shopify", () => {
  const source = createProductCandidate(product, walnut);
  const candidate = toRedesignCandidate(source, "lamp");
  assert.equal(candidate.productId, source.id);
  assert.equal(candidate.product.productId, walnut.seller_product_id);
  assert.equal(candidate.price, 35);
  assert.deepEqual(candidate.shopify, refs[1]);
  assert.deepEqual(candidate.dimensions, source.dimensions);
  assert.equal(toRedesignCandidate({ ...source, available: false }, "lamp"), null);
});
