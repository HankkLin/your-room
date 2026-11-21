import { isObjectLocked, toSceneObject } from "../contracts/scene.js";
import { SCENE_PATCH_GEMINI_SCHEMA } from "../contracts/scene-patch.js";
import { polygonBounds } from "../spatial/floorplan-geometry.js";
import { extractCategoryScoreMap } from "../redesign/compare-evaluations.js";

export const redesignApiPath = "/api/redesign/propose";
export const REDESIGN_MODELS = Object.freeze([
  "gemini-4-carbon",
  "gemini-3.8-flash",
  "gemini-4-hydrogen",
]);

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const SYSTEM_INSTRUCTION = [
  "You are a spatial architecture & interior layout optimizer for a deterministic Household Digital Twin.",
  "Do NOT invent measurements. Base all reasoning strictly on the supplied `evaluation.findings`, room polygons, door positions, locked fixtures, and movable objects.",
  "Respond ONLY with valid JSON matching the ScenePatch schema.",
  "",
  "Design & Validity Rules:",
  "1. Prefer the smallest effective patch in priority order: (1) `move` existing movable furniture, (2) `rotate` movable furniture, (3) `remove` unnecessary movable clutter, (4) `replace` movable furniture using `candidateProducts`, (5) `add` movable furniture only when no movable furniture can solve the finding.",
  "2. NEVER reference any ID in `lockedObjects`, `walls`, `doors`, or `windows`. Mutating locked fixtures is strictly forbidden.",
  "3. Coordinates use meters `[x, y, z]` where `y = 0` is floor level and `[x, z]` is the horizontal floor plane. Every `move` or `add` operation MUST include an explicit 3-number `position: [x, 0, z]` array.",
  "4. Every moved/added object's full `[width, depth]` footprint MUST stay strictly inside its room's `bounds` (keep center at least `width/2 + 0.22` m inside room walls), MUST NOT overlap any `lockedObjects` or other `movableObjects`, and MUST stay at least `0.90` m away from every `doors[].position`.",
  "5. For `CONGESTION` in a `kitchen` during breakfast/cooking: fixed cooking happens near `stove`/`sink`/`kitchen_counter` fixtures (often along the north/east walls), while eating happens at movable `table`/`chair` objects. Moving movable `table`/`chair` objects into a spacious south-central dining spot (e.g. `z` near `bounds.maxZ - 0.75` and `x` near `(bounds.minX + bounds.maxX)/2`, keeping `>= 0.70` m clear of east `kitchen_counter` and `>= 0.90` m clear of all `doors[].position`) separates cooking and eating beyond `1.8` m and resolves congestion.",
  "6. If `previousAttempts` is non-empty, inspect every reason in `rejectedBecause` and choose safe coordinates/operations that eliminate those exact errors.",
].join("\n");

function sanitizeRedesignError(message) {
  return String(message || "Gemini redesign proposal failed.")
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, "[REDACTED]")
    .replace(/AQ\.[0-9A-Za-z\-_]{20,}/g, "[REDACTED]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[REDACTED]");
}

/**
 * Assemble the structured, prose-free evidence context sent to Gemini 4.
 */
export function buildRedesignPromptContext({
  house,
  household = [],
  scenario = null,
  evaluation,
  candidateProducts = [],
  previousAttempts = [],
}) {
  const rooms = (house?.rooms || []).map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    bounds: polygonBounds(r.polygon || []),
  }));

  const doors = (house?.doors || []).map((d) => ({
    id: d.id,
    kind: d.kind,
    roomA: d.roomA,
    roomB: d.roomB,
    position: d.position,
    width: d.width ?? 0.85,
  }));

  const lockedObjects = [
    ...(house?.fixtures || []).map((f) => {
      const s = toSceneObject({ ...f, type: "fixed", locked: true });
      return {
        id: s.id,
        kind: s.kind,
        roomId: s.roomId,
        position: s.position,
        dimensions: s.dimensions,
        locked: true,
      };
    }),
    ...(house?.objects || [])
      .filter((o) => isObjectLocked(o))
      .map((o) => {
        const s = toSceneObject(o);
        return {
          id: s.id,
          kind: s.kind,
          roomId: s.roomId,
          position: s.position,
          dimensions: s.dimensions,
          locked: true,
        };
      }),
  ];

  const movableObjects = (house?.objects || [])
    .filter((o) => !isObjectLocked(o))
    .map((o) => {
      const s = toSceneObject(o);
      return {
        id: s.id,
        kind: s.kind,
        name: s.name,
        roomId: s.roomId,
        position: s.position,
        rotation: s.rotationRadians ?? [0, ((Number(s.rotation) || 0) * Math.PI) / 180, 0],
        dimensions: s.dimensions,
        locked: false,
      };
    });

  const personas = (household || []).map((p) => ({
    id: p.id,
    name: p.name,
    needs: p.needs ?? null,
    schedule: (p.schedule || []).map((e) => ({
      startMinute: e.startMinute ?? e.windowStartMinute,
      endMinute: e.endMinute ?? e.windowEndMinute,
      activity: e.activity,
      roomId: e.roomId ?? e.destination?.roomId ?? null,
    })),
  }));

  return {
    house: {
      id: house?.id,
      ceilingHeight: house?.ceilingHeight ?? 2.7,
      rooms,
      doors,
    },
    lockedObjects,
    movableObjects,
    candidateProducts: (candidateProducts || []).slice(0, 10).map((p) => ({
      productId: p.productId ?? p.id,
      kind: p.kind,
      name: p.name,
      price: p.price,
      dimensions: p.dimensions ?? {
        width: p.width,
        height: p.height,
        depth: p.depth,
      },
    })),
    personas,
    scenario: scenario
      ? {
          name: scenario.name || scenario.id || "Scenario",
          startMinute: scenario.startMinute,
          endMinute: scenario.endMinute,
        }
      : null,
    evaluation: {
      overallScore: evaluation?.overallScore ?? null,
      categoryScores: extractCategoryScoreMap(evaluation),
      findings: (evaluation?.findings || []).map((f) => ({
        type: f.type,
        roomId: f.roomId ?? f.location?.roomId ?? null,
        severity: f.severity,
        evidence: f.evidence,
      })),
    },
    previousAttempts: previousAttempts.map((att) => ({
      attempt: att.attempt,
      proposedOperations: att.patch?.operations ?? null,
      rejectedBecause: att.rejectedBecause ?? [],
    })),
  };
}

export function normalizeGeneratedScenePatch(raw, index = 1) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Gemini returned a non-object ScenePatch.");
  }
  return {
    id: String(raw.id || `gemini-patch-${index}`),
    reasoning: String(raw.reasoning || ""),
    targetFindings: Array.isArray(raw.targetFindings)
      ? raw.targetFindings.map(String)
      : [],
    operations: Array.isArray(raw.operations) ? raw.operations : [],
    isFallback: false,
    source: raw.source || "gemini",
    ...(raw.model ? { model: raw.model } : {}),
  };
}

/**
 * Call Gemini 4 directly on the server / Node environment to propose a structured ScenePatch.
 */
export async function callGeminiRedesignApi({
  context,
  apiKey,
  model,
  fetchImpl = globalThis.fetch,
  timeoutMs = 18_000,
}) {
  const key = apiKey?.trim();
  if (!key) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const candidateModels = model
    ? [model, ...REDESIGN_MODELS.filter((m) => m !== model)]
    : [...REDESIGN_MODELS];

  let lastError = null;

  for (const targetModel of candidateModels) {
    let response;
    try {
      response = await fetchImpl(
        `${GEMINI_API_BASE}/${encodeURIComponent(targetModel)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            contents: [
              {
                role: "user",
                parts: [{ text: JSON.stringify(context) }],
              },
            ],
            generationConfig: {
              temperature: 0.15,
              responseMimeType: "application/json",
              responseSchema: SCENE_PATCH_GEMINI_SCHEMA,
              thinkingConfig: { thinkingLevel: "LOW" },
            },
          }),
        },
      );
    } catch (err) {
      lastError = new Error(
        sanitizeRedesignError(
          `Model ${targetModel} failed: ${err?.message || "request timeout"}`,
        ),
      );
      continue;
    }

    if (
      response.status === 404 ||
      response.status === 429 ||
      response.status === 503 ||
      response.status === 504
    ) {
      lastError = new Error(
        `Model ${targetModel} unavailable (HTTP ${response.status}).`,
      );
      continue;
    }

    if (!response.ok) {
      let detail = `Gemini redesign API failed with HTTP ${response.status}`;
      try {
        const errBody = await response.json();
        if (errBody?.error?.message) {
          detail = `${detail}: ${errBody.error.message}`;
        }
      } catch {
        // Ignore non-JSON error body
      }
      throw new Error(sanitizeRedesignError(detail));
    }

    const payload = await response.json();
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      throw new Error("Gemini returned an empty ScenePatch candidate.");
    }

    const rawText = parts
      .filter((part) => !part?.thought && typeof part?.text === "string")
      .map((part) => part.text)
      .join("");

    if (!rawText) {
      throw new Error("Gemini returned no JSON text for ScenePatch.");
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error("Gemini returned malformed JSON for ScenePatch.");
    }

    return normalizeGeneratedScenePatch({
      ...parsed,
      source: "gemini",
      model: targetModel,
    });
  }

  throw lastError || new Error("No supported Gemini model succeeded.");
}

/**
 * Propose a structured `ScenePatch` for measured household findings behind an
 * isolated adapter boundary (Task 4 §11–12).
 *
 * Supports:
 * - Injectable `options.generator` (for deterministic mock/retry unit tests)
 * - Direct server/Node execution via `options.apiKey` or `process.env.GEMINI_API_KEY`
 * - Browser execution via `POST /api/redesign/propose` (keeps API key strictly server-side)
 */
export async function generateScenePatch({
  house,
  household = [],
  scenario = null,
  evaluation,
  candidateProducts = [],
  previousAttempts = [],
  generator = null,
  apiKey = null,
  model = null,
  fetchImpl = globalThis.fetch,
  endpoint = redesignApiPath,
} = {}) {
  const context = buildRedesignPromptContext({
    house,
    household,
    scenario,
    evaluation,
    candidateProducts,
    previousAttempts,
  });

  const attemptNumber = previousAttempts.length + 1;

  if (typeof generator === "function") {
    const customPatch = await generator({
      context,
      attempt: attemptNumber,
      previousAttempts,
    });
    return normalizeGeneratedScenePatch(customPatch, attemptNumber);
  }

  const nodeKey =
    apiKey ||
    (typeof globalThis.process !== "undefined"
      ? globalThis.process?.env?.GEMINI_API_KEY
      : null);

  if (typeof window === "undefined" && nodeKey) {
    return callGeminiRedesignApi({
      context,
      apiKey: nodeKey,
      model:
        model ||
        (typeof globalThis.process !== "undefined"
          ? globalThis.process?.env?.GEMINI_REDESIGN_MODEL || null
          : null),
      fetchImpl,
    });
  }

  // Browser path: call server-side middleware so GEMINI_API_KEY never enters client code
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
    });
  } catch (err) {
    throw new Error(
      sanitizeRedesignError(
        err?.message || "Network error contacting redesign service.",
      ),
    );
  }

  if (!response.ok) {
    let reason = `Redesign service unavailable (HTTP ${response.status}).`;
    try {
      const body = await response.json();
      if (body?.error) reason = String(body.error);
    } catch {
      // Ignore non-JSON error body
    }
    throw new Error(sanitizeRedesignError(reason));
  }

  const body = await response.json();
  return normalizeGeneratedScenePatch(body.patch ?? body, attemptNumber);
}

/**
 * Vite dev/preview server middleware for `/api/redesign/propose`.
 * Keeps `GEMINI_API_KEY` strictly on the server.
 */
export function createRedesignApiMiddleware(env = {}) {
  const maxBytes = 512 * 1024;

  return async function redesignApiMiddleware(req, res, next) {
    if (req.url?.split("?", 1)[0] !== redesignApiPath) {
      next?.();
      return;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Use POST to propose a ScenePatch." }));
      return;
    }

    const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
    if (!apiKey.trim()) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: "GEMINI_API_KEY is not configured on the server.",
        }),
      );
      return;
    }

    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          res.statusCode = 413;
          res.end(JSON.stringify({ error: "Redesign payload is too large." }));
          return;
        }
        chunks.push(chunk);
      }
      const context = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const patch = await callGeminiRedesignApi({
        context,
        apiKey,
        model: env.GEMINI_REDESIGN_MODEL || process.env.GEMINI_REDESIGN_MODEL,
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ patch }));
    } catch (err) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: sanitizeRedesignError(err?.message),
        }),
      );
    }
  };
}
