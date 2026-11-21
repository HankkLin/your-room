export const DEFAULT_GEMINI_MODEL = "gemini-4-carbon";
export const FALLBACK_GEMINI_MODEL = "gemini-3.8-flash";

export const ALLOWED_FLOORPLAN_MIME_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/**
 * Structured JSON schema requested from Gemini for floorplan spatial extraction.
 */
export const FLOORPLAN_GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    confidence: { type: "NUMBER" },
    warnings: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    printedDimensions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING" },
          roomId: { type: "STRING", nullable: true },
          startPx: {
            type: "ARRAY",
            items: { type: "NUMBER" },
            nullable: true,
          },
          endPx: {
            type: "ARRAY",
            items: { type: "NUMBER" },
            nullable: true,
          },
          confidence: { type: "NUMBER" },
        },
        required: ["text"],
      },
    },
    scaleBar: {
      type: "OBJECT",
      nullable: true,
      properties: {
        text: { type: "STRING" },
        startPx: { type: "ARRAY", items: { type: "NUMBER" } },
        endPx: { type: "ARRAY", items: { type: "NUMBER" } },
        confidence: { type: "NUMBER" },
      },
    },
    rooms: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          name: { type: "STRING" },
          kind: { type: "STRING" },
          polygonPx: {
            type: "ARRAY",
            items: {
              type: "ARRAY",
              items: { type: "NUMBER" },
            },
          },
          confidence: { type: "NUMBER" },
        },
        required: ["id", "name", "polygonPx"],
      },
    },
    doors: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          kind: {
            type: "STRING",
            enum: ["interior", "exterior", "unknown_opening"],
          },
          roomA: { type: "STRING" },
          roomB: { type: "STRING", nullable: true },
          positionPx: { type: "ARRAY", items: { type: "NUMBER" } },
          widthPx: { type: "NUMBER", nullable: true },
          confidence: { type: "NUMBER" },
        },
        required: ["id", "kind", "roomA", "positionPx"],
      },
    },
    windows: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          roomId: { type: "STRING", nullable: true },
          positionPx: { type: "ARRAY", items: { type: "NUMBER" } },
          widthPx: { type: "NUMBER", nullable: true },
          confidence: { type: "NUMBER" },
        },
        required: ["id", "positionPx"],
      },
    },
    fixtures: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          kind: {
            type: "STRING",
            enum: [
              "toilet",
              "sink",
              "bathtub",
              "shower",
              "kitchen_counter",
              "stove",
              "closet",
            ],
          },
          name: { type: "STRING" },
          roomId: { type: "STRING", nullable: true },
          positionPx: { type: "ARRAY", items: { type: "NUMBER" } },
          widthPx: { type: "NUMBER", nullable: true },
          depthPx: { type: "NUMBER", nullable: true },
          confidence: { type: "NUMBER" },
        },
        required: ["id", "kind", "positionPx"],
      },
    },
  },
  required: ["rooms", "doors", "windows", "fixtures", "warnings", "confidence"],
};

export function buildFloorplanPrompt(imageWidth, imageHeight) {
  return [
    `Analyze this architectural floorplan image (${imageWidth} x ${imageHeight} pixels).`,
    `Return ONLY structured JSON matching the response schema.`,
    `Coordinate rules:`,
    `- Express all pixel coordinates [x, y] in exact image pixel space where [0, 0] is top-left and [${imageWidth}, ${imageHeight}] is bottom-right.`,
    `- Order each room polygonPx clockwise or counter-clockwise around its boundary without self-intersection.`,
    `- Shared walls between adjacent rooms should have matching boundary coordinates.`,
    `Semantic rules:`,
    `- Identify every distinct room, its label/name, and approximate boundary polygon.`,
    `- Do NOT treat an unmarked wall gap as a door unless architectural evidence (door swing arc, door leaf, or labeled entry/opening) supports it; use kind="unknown_opening" when uncertain.`,
    `- Extract exterior and interior doors with connected room ids (roomA, and roomB for interior doors).`,
    `- Extract windows lying on walls.`,
    `- Extract ONLY clearly visible fixed architectural fixtures: toilet, sink, bathtub, shower, kitchen_counter, stove, closet.`,
    `- Extract verbatim printed dimensions (e.g. "12' 6\\" x 10' 2\\"" or "4.20 m") or scale bars ONLY if visibly printed on the plan.`,
    `- Do NOT invent hidden geometry. Do NOT infer or guess real-world dimensions when no scale evidence exists.`,
    `- Record any obscured walls, uncertain windows/doors, or missing scale in warnings.`,
  ].join("\n");
}

function sanitizeErrorMessage(message) {
  return String(message || "Floorplan AI extraction failed.")
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, "[REDACTED]")
    .replace(/AQ\.[0-9A-Za-z\-_]{20,}/g, "[REDACTED]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[REDACTED]");
}

/**
 * Call the Gemini REST endpoint directly (used by server middleware or Node callers).
 */
export async function callGeminiFloorplanApi({
  base64Data,
  mimeType,
  imageWidth,
  imageHeight,
  apiKey,
  model = DEFAULT_GEMINI_MODEL,
  fetchImpl = globalThis.fetch,
}) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("Gemini API key is not configured.");
  }
  if (!ALLOWED_FLOORPLAN_MIME_TYPES.includes(mimeType)) {
    throw new Error(`Unsupported floorplan image MIME type: ${mimeType}`);
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch implementation is unavailable.");
  }

  const invokeModel = async (targetModel) =>
    fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey.trim(),
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: buildFloorplanPrompt(imageWidth, imageHeight) },
                {
                  inlineData: {
                    mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema: FLOORPLAN_GEMINI_SCHEMA,
          },
        }),
      },
    );

  let response = await invokeModel(model);
  if (
    (response.status === 404 || response.status === 429) &&
    model !== FALLBACK_GEMINI_MODEL
  ) {
    response = await invokeModel(FALLBACK_GEMINI_MODEL);
  }

  if (!response.ok) {
    let detail = `Gemini API returned HTTP ${response.status}`;
    try {
      const errBody = await response.json();
      if (errBody?.error?.message) {
        detail = `${detail}: ${errBody.error.message}`;
      }
    } catch {
      // Ignore non-JSON error body
    }
    throw new Error(sanitizeErrorMessage(detail));
  }

  const payload = await response.json();
  const rawText =
    payload?.candidates?.[0]?.content?.parts?.find(
      (part) => typeof part?.text === "string",
    )?.text ?? "";

  if (!rawText) {
    throw new Error("Gemini returned an empty floorplan extraction response.");
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Gemini returned malformed JSON for floorplan extraction.");
  }

  return coerceCandidateShape(parsed, { imageWidth, imageHeight });
}

/**
 * Coerce raw parsed JSON into a consistent pixel-space candidate structure
 * ready for deterministic scale resolution and geometry validation.
 */
export function coerceCandidateShape(parsed, { imageWidth = 1000, imageHeight = 800 } = {}) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rooms)) {
    throw new Error("Floorplan extraction response is missing rooms array.");
  }

  return {
    id: String(parsed.id || "imported-house-001"),
    name: String(parsed.name || "Imported Floorplan Home"),
    coordinateSpace: "image_pixels",
    imageWidth: Number(imageWidth) || 1000,
    imageHeight: Number(imageHeight) || 800,
    confidence:
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? parsed.confidence
        : 0.75,
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map((w) => String(w)).filter(Boolean)
      : [],
    printedDimensions: Array.isArray(parsed.printedDimensions)
      ? parsed.printedDimensions
      : [],
    scaleBar: parsed.scaleBar && typeof parsed.scaleBar === "object" ? parsed.scaleBar : null,
    rooms: parsed.rooms,
    walls: Array.isArray(parsed.walls) ? parsed.walls : [],
    doors: Array.isArray(parsed.doors) ? parsed.doors : [],
    windows: Array.isArray(parsed.windows) ? parsed.windows : [],
    fixtures: Array.isArray(parsed.fixtures) ? parsed.fixtures : [],
  };
}

/**
 * Analyze a preprocessed floorplan image (`{ base64Data, mimeType, width, height }`)
 * behind a clean adapter boundary.
 *
 * @param {{ base64Data: string, mimeType: string, width: number, height: number }} image
 * @param {object} [options]
 * @param {(image: object) => Promise<object> | object} [options.analyzer]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.endpoint]
 * @returns {Promise<object>}
 */
export async function analyzeFloorplan(image, options = {}) {
  if (!image || typeof image !== "object") {
    throw new Error("Floorplan image payload is required.");
  }

  if (typeof options.analyzer === "function") {
    const custom = await options.analyzer(image);
    return coerceCandidateShape(custom, {
      imageWidth: image.width,
      imageHeight: image.height,
    });
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  // In Node environments with GEMINI_API_KEY set and no custom endpoint forced, call Gemini directly
  const nodeEnv =
    typeof globalThis.process !== "undefined" ? globalThis.process?.env : null;
  if (
    !options.endpoint &&
    typeof window === "undefined" &&
    nodeEnv?.GEMINI_API_KEY
  ) {
    return callGeminiFloorplanApi({
      base64Data: image.base64Data,
      mimeType: image.mimeType,
      imageWidth: image.width,
      imageHeight: image.height,
      apiKey: nodeEnv.GEMINI_API_KEY,
      model: nodeEnv.GEMINI_FLOORPLAN_MODEL || nodeEnv.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      fetchImpl,
    });
  }

  // Browser / Vite server middleware endpoint (keeps GEMINI_API_KEY off the client)
  const endpoint = options.endpoint || "/api/floorplan/analyze";
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base64Data: image.base64Data,
        mimeType: image.mimeType,
        imageWidth: image.width,
        imageHeight: image.height,
      }),
    });
  } catch (err) {
    throw new Error(
      sanitizeErrorMessage(err?.message || "Network error contacting floorplan analyzer."),
    );
  }

  if (!response.ok) {
    let reason = `Floorplan analysis unavailable (HTTP ${response.status}).`;
    try {
      const body = await response.json();
      if (body?.error) reason = String(body.error);
    } catch {
      // Ignore non-JSON error body
    }
    throw new Error(sanitizeErrorMessage(reason));
  }

  const candidate = await response.json();
  return coerceCandidateShape(candidate, {
    imageWidth: image.width,
    imageHeight: image.height,
  });
}
