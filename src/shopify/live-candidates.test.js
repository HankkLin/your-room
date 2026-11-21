import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createShopifyApiMiddleware } from "./shopify-api.js";
import { createProductCandidate, productCandidateId } from "../contracts/product.js";
import { refreshPatchCandidates, savedProductForPlacement, savedProductsForPatch, toRedesignCandidate } from "./scene-candidate.js";
import { catalogCheckoutRow } from "./catalog-checkout.js";
import { getCandidateProducts } from "./candidate-products.js";
import { applyScenePatch, createRedesignDemoHouse, validateScenePatch } from "../redesign/index.js";

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

test("fresh alternatives become exact scene and shopping rows on approval, with previous commerce metadata cleared", async () => {
  const house = createRedesignDemoHouse();
  const target = house.objects.find(obj => obj.id === "kitchen-table-1");
  Object.assign(target, { shopify: refs[0], modelUrl: "https://old.example/old.glb", modelScope: "variant",
    merchantProduct: "Old offer", deliveryEstimate: "Tomorrow", savedPrice: { priceMinor: 20, currency: "USD" } });
  const fresh = createProductCandidate(product, walnut);
  const snapshot = { kind: "table", products: [fresh], expiresAt: Date.now() + 60000 };
  const candidates = getCandidateProducts({ candidateSnapshot: snapshot });
  assert.equal(candidates[0].id, fresh.id);
  assert.equal(getCandidateProducts({ candidateSnapshot: { ...snapshot, expiresAt: 1 } }).some(c => c.id === fresh.id), false);
  const patch = { id: "switch-table", operations: [
    { type: "replace", objectId: target.id, productId: fresh.id, position: [7.9, 0, 3.35] },
    { type: "remove", objectId: "kitchen-chair-1" },
  ] };
  const fetchVariant = async (operation, { ref }) => {
    assert.equal(operation, "variant");
    assert.deepEqual(ref, refs[1]);
    return { product: fresh };
  };
  const verified = await refreshPatchCandidates(patch, candidates, fetchVariant);
  assert.equal(validateScenePatch(house, patch, { candidateProducts: verified }).valid, true);
  const after = applyScenePatch(house, patch, { candidateProducts: verified });
  const replacement = after.objects.find(obj => obj.id === target.id);
  assert.deepEqual(replacement.shopify, refs[1]);
  assert.equal(replacement.productId, fresh.productId);
  assert.equal(replacement.modelUrl, undefined);
  assert.equal(replacement.modelScope, undefined);
  assert.equal(replacement.merchantProduct, undefined);
  assert.equal(replacement.deliveryEstimate, fresh.deliveryEstimate);
  assert.deepEqual(replacement.dimensions, fresh.dimensions);
  assert.equal(replacement.price, 35);
  const rows = savedProductsForPatch([{ id: target.id, quantity: 3, shopify: refs[0] }, { id: "kitchen-chair-1" }], patch, after.objects);
  assert.deepEqual(rows, [{ id: target.id, name: fresh.title, shopify: refs[1], savedPrice: { priceMinor: 3500, currency: "USD" } }]);
  assert.equal(target.modelUrl, "https://old.example/old.glb");
  for (const changed of [{ priceMinor: 3600 }, { available: false }, { sellerDomain: "other.example" },
    { modelUrl: "https://other.example/new.glb" }, { deliveryEstimate: "8 days" }]) {
    await assert.rejects(refreshPatchCandidates(patch, candidates, async () => ({product: { ...fresh, ...changed }})), /changed|unavailable/);
  }
});

test("live product patches reject provider-supplied identity, facts, dimensions or checkout data", () => {
  const house = createRedesignDemoHouse();
  const candidate = toRedesignCandidate(createProductCandidate(product, walnut), "lamp");
  const options = { candidateProducts: [candidate] };
  for (const type of ["add", "replace"]) {
    const operation = { type, objectId: type === "add" ? "new-lamp" : "kitchen-table-1",
      productId: candidate.id, position: [7.9, 0, 3.35] };
    const base = applyScenePatch(house, { operations: [operation] }, options);
    assert.equal(base.objects.find(obj => obj.id === operation.objectId).productId, walnut.seller_product_id);
    for (const override of [{ object: { width: 0.05 } }, { object: { price: 1 } }, { object: { shopify: refs[0] } },
      { object: { id: "other-id" } }, { available: true }, { object: { modelUrl: "https://fake.example/p.glb" } },
      { productId: refs[0].variantId + "|unregistered.example", object: { kind: "chair" } }]) {
      const patch = { operations: [{ ...operation, ...override }] };
      assert.equal(validateScenePatch(house, patch, options).valid, false);
      assert.throws(() => applyScenePatch(house, patch, options), /Shopify/);
    }
  }
});

test("saved catalog pieces recover exact Shopify references and keep their saved quantities", () => {
  const row = { id: "saved-table", productId: "walnut-table", quantity: 2 };
  const updated = catalogCheckoutRow(row);
  assert.deepEqual(updated.shopify, { sellerDomain: "sundays-company-production.myshopify.com", variantId: "gid://shopify/ProductVariant/41588406419527" });
  assert.equal(updated.quantity, 2);
  const previous = { ...updated, savedPrice: { priceMinor: 67500, currency: "USD" } };
  assert.deepEqual(catalogCheckoutRow({ id: row.id, productId: row.productId }, previous), previous);
  for (const changed of [
    { ...row, url: "https://unrelated.example/products/table?variant=41588406419527" },
    { ...row, url: "https://www.sundays-company.com/pages/help?variant=41588406419527" },
    { ...row, variantId: "gid://shopify/ProductVariant/999" },
  ]) assert.equal(catalogCheckoutRow(changed), changed);
});

test("room review retains matching legacy offer details and isolates incomplete references", () => {
  const previous = { id: "chair", productId: "legacy", url: "https://merchant.example/products/chair",
    price: 40, photo: "https://merchant.example/chair.jpg", quantity: 2, name: "Original chair", suggestedReason: "Reading corner" };
  const item = { id: previous.id, productId: previous.productId, url: previous.url };
  assert.deepEqual(savedProductForPlacement(item, { previous }), previous);
  assert.equal(savedProductForPlacement({ ...item, url: "https://merchant.example/products/bench" }, { previous }).quantity, undefined);
  const invalid = savedProductForPlacement({ ...item, shopify: { variantId: "incomplete" } }, { previous });
  assert.equal(invalid.shopify, undefined);
  assert.equal(invalid.quantity, 2);
  const ref = { variantId: "gid://shopify/ProductVariant/1", sellerDomain: shop };
  assert.equal(savedProductForPlacement({ id: "p", shopify: ref }, { previous: { id: "p", shopify: ref, name: "Saved name" } }).name, "Saved name");
});
