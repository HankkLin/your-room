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
import { parseRegionInput, parseRegionPatch } from "./region-redesign.js";
import { buildRegionSuggestionInput, buildReplaySuggestionInput, previewRegionPatch, previewReplaySuggestion } from "./replay-suggestion.js";

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
  assert.equal(response.headers["X-Stillroom-Gemini-Model"], "gemini-4-neon");
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

test("regional requests forward the selection, instruction and measured evidence through the Gemini adapter", async () => {
  const household = prepareHouseholdReplay(demo.householdDraft, house.rooms);
  const baseline = await simulateStudioLayout(captureStudioLayout(house, items), household);
  const instruction = "Move the sofa away from the bedroom door.";
  const regional = buildRegionSuggestionInput([1.9, 5.4, 4.8, 7.6], instruction, baseline.findings, house, items);
  const patch = { id: "door-clearance", reasoning: instruction, targetFindings: ["NO_PATH:kitchen"],
    operations: proposal().scenePatch.operations };
  let sent;
  const generate = createReplaySuggestionGenerator({ apiKey: "test-key", fetchImpl(url, options) {
    if (url.endsWith("?pageSize=1000")) {
      return Response.json({ models: [{ name: "models/gemini-4-neon", supportedGenerationMethods: ["generateContent"] }] });
    }
    const body = JSON.parse(options.body);
    sent = JSON.parse(body.contents[0].parts[0].text);
    assert.ok(body.generationConfig.responseJsonSchema.properties.operations);
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(patch) }] } }] });
  } });
  const result = await callMiddleware(generate, { ...regional, address: "private", household: ["private"] });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, patch);
  assert.deepEqual(sent, regional);
  assert.equal(sent.instruction, instruction);
  assert.deepEqual(sent.findings[0].evidence, { timestampSeconds: 29100, reason: baseline.findings[0].evidence.reason });
  const original = structuredClone(items);
  const preview = previewRegionPatch(result.body, regional, house, items);
  assert.deepEqual(items, original);
  assert.deepEqual(preview.moves[0].after.position, [3.4, 0, 7]);
  const after = await simulateStudioLayout(captureStudioLayout(house, preview.items), household);
  assert.equal(baseline.summary.pathFailures, 1);
  assert.equal(after.summary.pathFailures, 0);
  assert.deepEqual(after.events.filter(e => e.type === SIMULATION_EVENT_TYPES.SCHEDULE_START),
    baseline.events.filter(e => e.type === SIMULATION_EVENT_TYPES.SCHEDULE_START));
});

test("region validation checks rotated source and destination footprints, locked edits, evidence and atomicity", async () => {
  const instruction = "Move the sofa into the bedroom.";
  const regional = buildRegionSuggestionInput([1.9, 5.4, 4.8, 7.6], instruction, [], house, items);
  const patch = { id: "regional", reasoning: instruction, targetFindings: [], operations: proposal().scenePatch.operations };
  const op = patch.operations[0];
  const reject = async (draft, context = regional) => {
    const res = await callMiddleware(async () => ({ model: "test", payload: draft }), context);
    assert.equal(res.statusCode, 502, JSON.stringify(res.body));
  };
  await reject({ ...patch, targetFindings: ["CONGESTION:kitchen"] });
  await reject({ ...patch, operations: [{ ...op, objectId: "fixture-bedroom-closet" }] });
  await reject({ ...patch, operations: [{ ...op, position: [4.5, 0, 7] }] });
  await reject({ ...patch, operations: [op, op] });
  const rotated = { ...regional, objects: regional.objects.map(obj => obj.id === sofa.id ? { ...obj, rotation: 90 } : obj) };
  assert.throws(() => parseRegionPatch(patch, rotated), /outside/);
  assert.throws(() => parseRegionInput({ ...regional, region: [0, 0, 0, 2] }));
  assert.throws(() => parseRegionInput({ ...regional, instruction: "  " }));
  const blank = buildRegionSuggestionInput([7.6, 6.5, 8.1, 7.2], instruction, [], house, items);
  assert.equal((await callMiddleware(() => assert.fail("No candidate"), blank)).statusCode, 422);
  const unknown = { ...regional, findings: [{ type: "NO_PATH", evidence: { reason: "fake" } }] };
  assert.equal((await callMiddleware(() => assert.fail("Invalid evidence"), unknown)).statusCode, 400);
  const original = structuredClone(items);
  assert.throws(() => previewRegionPatch(patch, regional, house, items.map(i => i.id === sofa.id ? { ...i, locked: true } : i)), /locked/);
  assert.deepEqual(items, original);
});

test("a regional patch previews multiple moves together and leaves all originals intact on a later failure", () => {
  const footstool = { ...sofa, id: "stool", name: "Footstool", kind: "chair", x: 4.8, z: 7.9, width: .35, depth: .35 };
  const originals = [...items, footstool];
  const snapshot = structuredClone(originals);
  const input = buildRegionSuggestionInput([1.9, 5.4, 5.5, 8.5], "Clear the doorway and move the stool", [], house, originals);
  const patch = { id: "two-moves", reasoning: "Make both changes together", targetFindings: [],
    operations: [...proposal().scenePatch.operations, { type: "move", objectId: "stool", position: [4.9, 0, 8.0] }] };
  const preview = previewRegionPatch(patch, input, house, originals);
  assert.equal(preview.moves.length, 2);
  assert.deepEqual(preview.moves.map(move => move.after.position), [[3.4, 0, 7], [4.9, 0, 8]]);
  const overlapping = { ...patch, operations: [patch.operations[0], { ...patch.operations[1], position: [3.4, 0, 7] }] };
  assert.throws(() => previewRegionPatch(overlapping, input, house, originals), /placement/);
  assert.deepEqual(originals, snapshot);
});

test("Kevin's mixed spatial and route findings pass the regional endpoint with measured fields only", async () => {
  // Recorded from 8a7fa56 evaluateHouseholdExperience on the blocked-route demo.
  const privacy = {
    type: "PRIVACY_SIGHTLINE", severity: 0.86, roomId: "bathroom", location: { roomId: "bathroom", position: [9.15, 5.15] },
    evidence: { sourceType: "entry-door", sourceId: "door-entry", targetType: "toilet", targetObjectId: "fixture-toilet",
      distanceMeters: 9.157, directLineOfSight: true, occluded: false, observerPosition: [0, 4.8],
      targetPosition: [9.15, 5.15], exposedSources: ["entry-door", "hallway"] },
  };
  const evacuation = {
    type: "NO_EVACUATION_PATH", severity: 1, roomId: "bedroom", agentId: "replay-demo-alex",
    location: { roomId: "bedroom", position: [3.35, 7.05] },
    evidence: { fromRoomId: "bedroom", candidateExitDoorIds: ["door-entry"], reason: "NO_PATH" },
  };
  const findings = [{ ...blockedFinding, severity: 1, roomId: "kitchen" },
    { ...privacy, evidence: { ...privacy.evidence, privateNote: "private" } }, evacuation];
  const context = buildRegionSuggestionInput([0, 0, 9.6, 8.6], "Improve the bedroom layout", findings, house, items);
  const patch = { id: "improve-bedroom", reasoning: "Move the sofa", targetFindings: ["NO_EVACUATION_PATH:bedroom"],
    operations: proposal().scenePatch.operations };
  let received;
  const result = await callMiddleware(async payload => { received = payload; return { payload: patch, model: "fixture" }; }, context);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(received.findings.map(f => f.type), ["NO_PATH", "PRIVACY_SIGHTLINE", "NO_EVACUATION_PATH"]);
  assert.deepEqual(received.findings[1].evidence, privacy.evidence);
  assert.deepEqual(received.findings[2].evidence, evacuation.evidence);
  const noPosition = buildRegionSuggestionInput([1.9, 5.4, 4.8, 7.6], "Move the sofa", [
    { ...evacuation, location: { roomId: "bedroom" } }], house, items);
  assert.deepEqual(noPosition.findings[0].location, { roomId: "bedroom" });
});
