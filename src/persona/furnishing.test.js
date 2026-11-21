import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createWholeHomeDemoState } from "../../house-demo.js";
import { canPlaceInHouse } from "../../house-model.js";
import { canPlaceItem, ROOM } from "../../model.js";
import { createSampleHousehold } from "./sample-household.js";
import { furnishingCandidatesFromSession, prepareFurnishing, previewFurnishing } from "./furnishing.js";
import { createFurnishingMiddleware } from "../agents/furnishing-api.js";
import { furnishingPath } from "../agents/furnishing-contract.js";

const rooms = [{ id: "room-1", name: "Study" }];
const project = { roomName: "Study", room: ROOM, personas: createSampleHousehold(rooms), items: [] };
const options = { project, style: "Warm minimal", brief: "A quiet place to work.", budget: 1200 };
const live = { title: "Oak writing desk", kind: "desk", variantId: "gid://shopify/ProductVariant/72", sellerDomain: "fixtures.myshopify.com",
  currency: "USD", priceMinor: 29999, available: true, dimensionsSource: "merchant", dimensions: { width: 1.1, height: 0.7, depth: 0.45 } };
const add = { type: "add", candidateId: "oak-desk", roomId: "room-1", personaId: "sample-alex", need: "quiet",
  reason: "An oak desk suits Alex’s quiet work routine and the warm minimal palette." };
const proposal = (op = add) => ({ operations: [op] });

test("fresh candidate fixture supplies identity, price and geometry; retained paid and owned furniture are preserved", () => {
  const locked = { id: "locked", price: 100, locked: true, kind: "chair", name: "Locked chair", x: 1.6, z: 0.5, width: 0.6, depth: 0.5, height: 0.8 };
  const owned = { ...locked, id: "family", x: -1.6, owned: true, price: 2000 };
  const existing = [locked, owned];
  const context = prepareFurnishing({ ...options, project: { ...project, items: existing }, liveCandidates: [live] });
  const result = previewFurnishing(context, proposal({ ...add, candidateId: live.variantId + "|" + live.sellerDomain }));
  assert.equal(result.totalMinor, 39999);
  const piece = result.additions[0].item;
  assert.deepEqual(piece.shopify, { variantId: live.variantId, sellerDomain: live.sellerDomain });
  assert.equal(piece.dimensionsSource, "merchant");
  assert.equal(piece.width, 1.1);
  assert.ok(canPlaceItem(piece, ROOM, existing));
  assert.deepEqual(context.items, [locked, owned]);
  assert.equal(existing.length, 2);
});

test("a fresh commerce session supplies the selected kind and retains the exact merchant product and variant", () => {
  const product = { ...live, title: "The Meridian", productId: "gid://shopify/Product/4812", sellerDomain: "Fixture.MyShopify.com" };
  delete product.kind;
  const snapshot = { kind: "desk", products: [product], expiresAt: 5000 };
  assert.deepEqual(furnishingCandidatesFromSession(null), []);
  assert.deepEqual(furnishingCandidatesFromSession(snapshot, 5000), []);
  const liveCandidates = furnishingCandidatesFromSession(snapshot, 4999);
  const context = prepareFurnishing({ ...options, liveCandidates });
  const id = product.variantId + "|fixture.myshopify.com";
  const result = previewFurnishing(context, proposal({ ...add, candidateId: id }));
  const piece = result.additions[0].item;
  assert.equal(piece.productId, product.productId);
  assert.equal(piece.name, "The Meridian");
  assert.equal(piece.kind, "desk");
  assert.deepEqual(piece.shopify, { variantId: product.variantId, sellerDomain: product.sellerDomain });
});

test("the whole-home proposal fits its requested room and keeps every fixture and existing piece", () => {
  const project = createWholeHomeDemoState();
  project.personas = createSampleHousehold(project.house.rooms);
  const before = structuredClone(project);
  const context = prepareFurnishing({ ...options, project, budget: 10000 });
  const preview = previewFurnishing(context, proposal({ ...add, roomId: "bedroom" }));
  const item = preview.additions[0].item;
  assert.equal(item.roomId, "bedroom");
  assert.ok(canPlaceInHouse(item, context.house, context.items));
  assert.deepEqual(project, before);
});

test("unavailable, unaffordable, unplaceable and unauthorized changes fail before adoption", () => {
  const noStock = prepareFurnishing({ ...options, liveCandidates: [{ ...live, available: false }] });
  assert.throws(() => previewFurnishing(noStock, proposal({ ...add, candidateId: live.variantId + "|" + live.sellerDomain })), /unknown/);
  const expensive = prepareFurnishing({ ...options, budget: 10 });
  assert.throws(() => previewFurnishing(expensive, proposal()), /budget/);
  const cramped = prepareFurnishing({ ...options, project: { ...project, room: { ...ROOM, width: 0.5, depth: 0.5 } } });
  assert.throws(() => previewFurnishing(cramped, proposal()), /no valid placement/);
  for (const edit of [{ type: "remove" }, { type: "move" }, { priceMinor: 1 }, { position: [1, 0, 2] }, { roomId: "other" }]) {
    assert.throws(() => previewFurnishing(noStock, proposal({ ...add, ...edit })), /unsupported/);
  }
});

test("middleware passes the approved household, style, and actual reference image to Gemini and validates output", async (t) => {
  let modelResult = proposal();
  let sent;
  const middleware = createFurnishingMiddleware({ apiKey: "test-only", fetchImpl: async (_url, init) => {
    if (!init.method) return Response.json({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] });
    sent = JSON.parse(init.body).contents[0].parts;
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(modelResult) }] } }] });
  } });
  const server = http.createServer((req, res) => middleware(req, res, () => res.end()));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const post = (input) => fetch("http://127.0.0.1:" + server.address().port + furnishingPath, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const input = prepareFurnishing({ ...options, reference: "data:image/jpeg;base64,/9j/2Q==" }).input;
  const response = await post(input);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), modelResult);
  assert.equal(JSON.parse(sent[0].text).personas[0].needs.quiet, 0.9);
  assert.equal(JSON.parse(sent[0].text).style, "Warm minimal");
  assert.deepEqual(sent[1].inlineData, { mimeType: "image/jpeg", data: "/9j/2Q==" });
  modelResult = proposal({ ...add, candidateId: "made-up" });
  assert.equal((await post({ ...input, reference: null })).status, 422);
  assert.equal(sent.length, 1);
  assert.equal((await post({ ...input, personas: [] })).status, 400);
});
