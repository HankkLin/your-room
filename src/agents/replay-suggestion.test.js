import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { mergeHouseFixturesIntoItems } from "../../house-model.js";
import { prepareHouseholdReplay } from "../contracts/persona.js";
import { SIMULATION_EVENT_TYPES } from "../contracts/simulation.js";
import { captureStudioLayout, simulateStudioLayout } from "../simulation/studio-replay.js";
import { createBlockedRouteDemo } from "../simulation/studio-replay-demo.js";
import { importSampleFloorplan } from "../spatial/floorplan-importer.js";
import { createReplaySuggestionApiMiddleware, createReplaySuggestionGenerator } from "./replay-suggestion-api.js";
import { parseReplayProposal, replaySuggestionApiPath } from "./replay-suggestion-contract.js";
import { buildReplaySuggestionInput, previewReplaySuggestion } from "./replay-suggestion.js";

const house = importSampleFloorplan().house;
const demo = createBlockedRouteDemo();
const items = mergeHouseFixturesIntoItems(house, demo.items);
const sofa = demo.items[0];
const blockedFinding = {
  type: "NO_PATH", fromRoomId: "bedroom", toRoomId: "kitchen", activity: "cook",
  location: { position: [3.35, 7.05] }, evidence: { timestampSeconds: 29100, reason: "NO_PATH" },
};
const input = buildReplaySuggestionInput(blockedFinding, house, items);
const proposal = (overrides = {}) => ({
  explanation: "The sofa may be narrowing the bedroom doorway.",
  scenePatch: { operations: [{ type: "move", objectId: sofa.id, position: [3.4, 0, 7], ...overrides }] },
});

test("replay proposals reject malformed patches or targets outside the movable context", () => {
  for (const draft of [
    null, { ...proposal(), explanation: "" }, { ...proposal(), scenePatch: { operations: [] } },
    { ...proposal(), scenePatch: { operations: [proposal().scenePatch.operations[0], {}] } },
    proposal({ type: "replace" }), proposal({ rotation: 90 }), proposal({ objectId: "missing" }),
    proposal({ position: [3.4, 0] }), proposal({ position: [3.4, 0, Infinity] }),
    proposal({ position: [3.4, 0, "7"] }), proposal({ position: [3.4, , 7] }),
    proposal({ position: [3.4, 1, 7] }), proposal({ position: [3.2, 0, 6] }),
    proposal({ objectId: "fixture-bedroom-closet" }),
  ]) {
    assert.throws(() => parseReplayProposal(draft, input.objects));
  }
  assert.deepEqual(parseReplayProposal(proposal(), input.objects), proposal());
});

test("preview keeps the original layout intact and rejects locked and invalid furniture moves", () => {
  const original = structuredClone(items);
  const preview = previewReplaySuggestion(proposal(), house, items);
  assert.deepEqual(preview.before.position, [3.2, 0, 6]);
  assert.deepEqual(preview.after.position, [3.4, 0, 7]);
  assert.deepEqual(preview.items.filter(({ locked }) => locked), items.filter(({ locked }) => locked));
  assert.throws(
    () => previewReplaySuggestion(proposal(), house, items.map((item) => item.id === sofa.id ? { ...item, locked: true } : item)),
    /locked/,
  );
  for (const position of [[-4, 0, 7], [3.3, 0, 6], [6.2, 0, 7]]) {
    assert.throws(() => previewReplaySuggestion(proposal({ position }), house, items), /placement/);
  }
  assert.throws(
    () => previewReplaySuggestion(proposal({ position: [5.1, 0, 6] }), house, demo.items),
    /placement/,
  );
  const canonical = [{ ...sofa, position: [3.2, 0, 6] }];
  const updated = previewReplaySuggestion(proposal(), house, canonical).items;
  assert.equal(updated.length, 1);
  assert.deepEqual(updated[0].position, [3.4, 0, 7]);
  assert.deepEqual(items, original);
});

test("both real demo replays use the same resolved activities and the selected trip arrives after approval", async () => {
  const resolved = prepareHouseholdReplay(demo.householdDraft, house.rooms);
  const before = await simulateStudioLayout(captureStudioLayout(house, items), resolved);
  const finding = before.findings.find(({ type }) => type === "NO_PATH");
  const preview = previewReplaySuggestion(proposal(), house, items);
  const after = await simulateStudioLayout(captureStudioLayout(house, preview.items), resolved);
  const scheduleStarts = ({ events }) => events.filter(({ type }) => type === SIMULATION_EVENT_TYPES.SCHEDULE_START);
  assert.deepEqual(scheduleStarts(before), scheduleStarts(after));
  assert.deepEqual(scheduleStarts(after).map(({ minute }) => minute), [470, 485]);
  assert.equal(finding.evidence.timestampSeconds, 29100);
  assert.equal(before.summary.pathFailures, 1);
  assert.equal(after.summary.pathFailures, 0);
  assert.ok(after.routes.some(({ agentId, fromRoomId, toRoomId, startTimestamp, endTimestamp }) =>
    agentId === finding.agentId && fromRoomId === "bedroom" && toRoomId === "kitchen" &&
    startTimestamp === finding.evidence.timestampSeconds && Number.isFinite(endTimestamp)));
});

async function callMiddleware(generate, body = input) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(request, {
    method: "POST", url: replaySuggestionApiPath, socket: {},
    headers: { host: "127.0.0.1:5173", "content-type": "application/json" },
  });
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(text) { this.body = JSON.parse(text); },
  };
  await createReplaySuggestionApiMiddleware(generate)(request, response, () => assert.fail("Expected the replay endpoint"));
  return response;
}

test("replay endpoint sends only the bounded route context to Gemini and validates the returned move", async () => {
  let calls = 0;
  const generate = createReplaySuggestionGenerator({
    apiKey: "test-key",
    fetchImpl(url, options) {
      calls++;
      assert.equal(options.headers["x-goog-api-key"], "test-key");
      if (url.endsWith("?pageSize=1000")) {
        return Response.json({ models: [{ name: "models/gemini-4-neon", supportedGenerationMethods: ["generateContent"] }] });
      }
      assert.match(url, /\/gemini-4-neon:generateContent$/);
      const request = JSON.parse(options.body);
      assert.equal(request.generationConfig.responseJsonSchema.properties.scenePatch.properties.operations.maxItems, 1);
      assert.deepEqual(JSON.parse(request.contents[0].parts[0].text), input);
      assert.ok(!options.body.includes("test-key"));
      return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(proposal()) }] } }] });
    },
  });
  const response = await callMiddleware(generate, { ...input, household: ["private"], address: "private" });
  assert.equal(calls, 2);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["X-Living-Blueprint-Gemini-Model"], "gemini-4-neon");
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.deepEqual(response.body, proposal());
  assert.deepEqual(input.objects.find(({ id }) => id === sofa.id).relocationHint, [3.4, 0, 7]);
  assert.equal(input.objects.find(({ id }) => id === "fixture-bedroom-closet").locked, true);
});

test("replay endpoint handles missing credentials and rejects invalid findings or model proposals", async () => {
  const unexpected = () => assert.fail("Gemini should not be called");
  const unconfigured = await callMiddleware(createReplaySuggestionGenerator({ fetchImpl: unexpected }));
  assert.equal(unconfigured.statusCode, 503);
  assert.match(unconfigured.body.error, /GEMINI_API_KEY/);
  const invalid = await callMiddleware(unexpected, { ...input, finding: { ...input.finding, type: "LONG_PATH" } });
  assert.equal(invalid.statusCode, 400);
  const rejected = await callMiddleware(async () => ({ payload: proposal({ objectId: "fixture-bedroom-closet" }) }));
  assert.equal(rejected.statusCode, 502);
  assert.match(rejected.body.error, /locked/);
});
