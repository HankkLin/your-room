import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createPersonaApiMiddleware, createPersonaGenerator, personaApiPath } from "./persona-api.js";

const key = "local-test-key-never-exposed";
const catalog = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";
const input = {
  description: "Alex works at home from 9 to 5.",
  rooms: [{ id: "room-1", name: "Study" }],
};
const draft = {
  name: "Alex",
  ageGroup: "adult",
  preferences: ["quiet work"],
  dislikes: [],
  needs: { privacy: 0.5, quiet: 0.9, accessibility: 0.2, daylight: 0.5, social: 0.4 },
  schedule: [{ roomId: "room-1", activity: "work", startMinute: 540, endMinute: 1020 }],
};

function geminiResponse(text) {
  return Response.json({
    candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
  });
}

function availableModel(name, supportedGenerationMethods = ["generateContent"]) {
  return { name: `models/${name}`, supportedGenerationMethods };
}

function generator(fetchContent, { models = [availableModel("gemini-4-hydrogen")], ...overrides } = {}) {
  return createPersonaGenerator({
    apiKey: key,
    fetchImpl(url, options) {
      if (url !== catalog) return fetchContent(url, options);
      assert.equal(options.headers["x-goog-api-key"], key);
      assert.equal(options.body, undefined);
      return Response.json({ models });
    },
    ...overrides,
  });
}

async function callMiddleware(generate, {
  body = input,
  rawBody = JSON.stringify(body),
  method = "POST",
  url = personaApiPath,
  headers = {},
} = {}) {
  const request = Readable.from([Buffer.from(rawBody)]);
  Object.assign(request, { method, url, socket: {}, headers: {
    host: "127.0.0.1:5173",
    origin: "http://127.0.0.1:5173",
    "content-type": "application/json",
    ...headers,
  } });
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(text) { this.text = text; },
  };
  await createPersonaApiMiddleware(generate)(request, response, () => { response.calledNext = true; });
  return response;
}

test("persona API sends only household context and returns validated personas with app IDs", async () => {
  const response = await callMiddleware(generator(async (url, options) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["x-goog-api-key"], key);
    const prompt = JSON.parse(options.body);
    assert.equal(prompt.generationConfig.responseMimeType, "application/json");
    assert.ok(prompt.generationConfig.responseJsonSchema.properties.personas);
    assert.deepEqual(JSON.parse(prompt.contents[0].parts[0].text), input);
    assert.ok(!options.body.includes(key));
    return geminiResponse(JSON.stringify({ personas: [{ ...draft, id: "untrusted-id" }] }));
  }, { models: [availableModel("gemini-2.5-flash"), availableModel("gemini-4-hydrogen")] }), {
    body: { ...input, address: "Private address" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.ok(!response.text.includes(key));
  const [{ id, ...persona }] = JSON.parse(response.text).personas;
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(persona, draft);
});

test("persona generation chooses an available structured-output fallback", async () => {
  const response = await callMiddleware(generator((url) => {
    assert.match(url, /\/gemini-4-neon:generateContent$/);
    return geminiResponse(JSON.stringify({ personas: [draft] }));
  }, { models: [
    availableModel("gemini-4-hydrogen", ["countTokens"]),
    availableModel("gemini-4-neon"),
  ] }));
  assert.equal(response.statusCode, 200);
});

test("persona generation handles a catalog without a compatible model", async () => {
  const response = await callMiddleware(generator(() => {
    assert.fail("No incompatible model should receive the household description");
  }, { models: [availableModel("gemini-2.5-flash-image")] }));
  assert.equal(response.statusCode, 503);
  assert.match(JSON.parse(response.text).error, /No supported Gemini model/);
});

test("invalid persona API requests never invoke Gemini", async () => {
  let calls = 0;
  const generate = createPersonaGenerator({ apiKey: key, fetchImpl: () => { calls++; } });
  const attempts = [
    [{ body: { ...input, description: " " } }, 400],
    [{ body: { ...input, rooms: [] } }, 400],
    [{ body: { ...input, rooms: [input.rooms[0], input.rooms[0]] } }, 400],
    [{ rawBody: "{" }, 400],
    [{ rawBody: "a".repeat(32 * 1024 + 1) }, 413],
    [{ method: "GET" }, 405],
    [{ headers: { "content-type": "text/plain" } }, 415],
    [{ headers: { origin: "http://127.0.0.1:5174" } }, 403],
  ];
  for (const [request, expectedStatus] of attempts) {
    const response = await callMiddleware(generate, request);
    assert.equal(response.statusCode, expectedStatus);
    assert.equal(typeof JSON.parse(response.text).error, "string");
  }

  const unrelated = await callMiddleware(generate, { url: "/different-path" });
  assert.equal(unrelated.calledNext, true);
  assert.equal(calls, 0);
});

test("malformed, blocked, empty and invalid Gemini drafts return safe errors", async () => {
  const unknownRoom = { ...draft, schedule: [{ ...draft.schedule[0], roomId: "unavailable" }] };
  const results = [
    () => geminiResponse(`bad response ${key}`),
    () => Response.json({ promptFeedback: { blockReason: "SAFETY" } }),
    () => geminiResponse(JSON.stringify({ personas: [] })),
    () => geminiResponse(JSON.stringify({ personas: [unknownRoom] })),
    () => Response.json({ error: `upstream details ${key}` }, { status: 403 }),
  ];

  for (const result of results) {
    const response = await callMiddleware(generator(result));
    assert.equal(response.statusCode, 502);
    assert.ok(JSON.parse(response.text).error);
    assert.ok(!response.text.includes(key));
  }
});

test("missing configuration, rate limiting and timeouts return distinct errors", async () => {
  const missing = await callMiddleware(generator(() => {
    assert.fail("Gemini should not be called without a key");
  }, { apiKey: "" }));
  assert.equal(missing.statusCode, 503);
  assert.match(JSON.parse(missing.text).error, /not configured/);

  const limited = await callMiddleware(generator(() => new Response(null, { status: 429 })));
  assert.equal(limited.statusCode, 429);
  assert.match(JSON.parse(limited.text).error, /quota/);

  const timedOut = await callMiddleware(generator((_, { signal }) => delay(100, null, { signal }), { timeoutMs: 5 }));
  assert.equal(timedOut.statusCode, 504);
  assert.match(JSON.parse(timedOut.text).error, /too long/);
});
