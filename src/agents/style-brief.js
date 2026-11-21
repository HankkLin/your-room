import { furniturePreviewKinds } from "../../model.js";
import { statedItemLimits } from "../shopify/budget.js";

export const styleBriefPath = "/api/furnishing/style-brief";
const facets = ["styles", "colors", "materials", "priorities"];
const stringList = { type: "array", maxItems: 12, items: { type: "string", maxLength: 100 } };
const intentList = { type: "array", maxItems: 3, items: {
  type: "object", additionalProperties: false, required: ["kind", "query"],
  properties: { kind: { type: "string", enum: furniturePreviewKinds }, query: { type: "string", maxLength: 140 } },
} };
const validText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const budgetAmount = value => Number.isFinite(value) && value >= 0 && value <= 100000;

export function validateStyleRequest({ prompt, rooms, budgetOverride }) {
  if (!validText(prompt, 1200) || !Array.isArray(rooms) || !rooms.length || rooms.length > 80 ||
      rooms.some(room => !validText(room?.id, 160) || !validText(room?.name, 80)) ||
      new Set(rooms.map(room => room.id)).size !== rooms.length || (budgetOverride != null && !budgetAmount(budgetOverride))) {
    throw new Error("Enter a design brief, a valid room and an optional furniture budget.");
  }
}

export function styleBriefSchema(rooms) {
  return { type: "object", additionalProperties: false, required: [...facets, "budget", "roomIntents"],
    properties: {
      ...Object.fromEntries(facets.map(key => [key, stringList])),
      budget: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["amount", "currency"],
        properties: { amount: { type: "number", minimum: 0, maximum: 100000 }, currency: { type: "string" } } }] },
      roomIntents: { type: "object", additionalProperties: false,
        properties: Object.fromEntries(rooms.map(room => [room.id, intentList])) },
    } };
}

export function validateStyleBrief(brief, rooms) {
  if (!record(brief) || Object.keys(brief).some(key => ![...facets, "budget", "roomIntents"].includes(key)) ||
      facets.some(key => !Array.isArray(brief[key]) || brief[key].length > 12 || brief[key].some(value => !validText(value, 100))) ||
      !record(brief.roomIntents) || brief.budget !== null && (!record(brief.budget) || Object.keys(brief.budget).length !== 2 ||
        !budgetAmount(brief.budget.amount) || typeof brief.budget.currency !== "string" || !/^[A-Z]{3}$/.test(brief.budget.currency))) {
    throw new Error("The style brief contains invalid preferences or budget.");
  }
  for (const [roomId, intents] of Object.entries(brief.roomIntents)) {
    if (!rooms.some(room => room.id === roomId) || !Array.isArray(intents) || intents.length > 3 ||
        intents.some(intent => !record(intent) || Object.keys(intent).some(key => !["kind", "query", "maxPriceMinor"].includes(key)) ||
          (intent.maxPriceMinor !== undefined && (!Number.isSafeInteger(intent.maxPriceMinor) || intent.maxPriceMinor < -1)) ||
          !furniturePreviewKinds.includes(intent.kind) || !validText(intent.query, 140))) {
      throw new Error("The style brief contains an unknown room or invalid shopping request.");
    }
  }
  return brief;
}

export async function generateStyleBrief({ prompt, rooms, budgetOverride }, generate) {
  validateStyleRequest({ prompt, rooms, budgetOverride });
  const { payload } = await generate({ input: { prompt, rooms: rooms.map(({ id, name }) => ({ id, name })) },
    schema: styleBriefSchema(rooms), systemInstruction: "Extract design intent: styles, colors, materials and priorities. Return the whole-home budget when stated ($ means USD), otherwise null. Preserve a per-item spending limit literally in the query for that kind. For each relevant supplied room ID suggest up to three distinct furniture kinds and specific catalog search phrases. Do not supply products, stock, placement, dimensions or fit judgements." });
  const brief = validateStyleBrief(payload, rooms);
  const limits = statedItemLimits(prompt);
  return { ...brief, budget: budgetOverride == null ? brief.budget : { amount: budgetOverride, currency: "USD" },
    roomIntents: Object.fromEntries(Object.entries(brief.roomIntents).map(([id, intents]) => [id,
      intents.map(({ kind, query }) => ({ kind, query, ...(kind in limits ? { maxPriceMinor: limits[kind] } : {}) }))])) };
}

/** Client API shared by the Design panel and consumer planner. */
export async function parseStyleBrief(input, { signal } = {}) {
  validateStyleRequest(input);
  const response = await fetch(styleBriefPath, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input), signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "The style brief could not be read.");
  return validateStyleBrief(body.styleBrief, input.rooms);
}
