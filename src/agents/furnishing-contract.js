import { validatePersonas } from "../contracts/persona.js";

export const furnishingPath = "/api/furnishing/propose";
export const furnishingNeeds = ["quiet", "privacy", "daylight", "social", "accessibility"];
const text = (value, max) => typeof value === "string" && value.trim() && value.length <= max;
const money = (amount) => Number.isSafeInteger(amount) && amount >= 0;

export function validateFurnishingInput(input) {
  if (!input?.personas?.length || validatePersonas(input.personas, input.rooms)) {
    throw new Error("Save a valid household before requesting a furnishing proposal.");
  }
  if (!text(input.style, 80) || typeof input.brief !== "string" || input.brief.length > 1200 ||
      !money(input.budgetMinor) || input.budgetMinor > 10000000 || !money(input.retainedMinor)) {
    throw new Error("Check the design brief and furniture budget.");
  }
  if (!Array.isArray(input.candidates) || !input.candidates.length || input.candidates.length > 100 ||
      input.candidates.some((item) => !text(item?.id, 512) || !text(item.name, 500) || !money(item.priceMinor)) ||
      new Set(input.candidates.map(({ id }) => id)).size !== input.candidates.length) {
    throw new Error("Choose from the available furnishing candidates.");
  }
  if (input.reference != null && (typeof input.reference !== "string" ||
      input.reference.length > 1024 * 1024 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(input.reference))) {
    throw new Error("Choose a new inspiration photo.");
  }
}

const fields = ["type", "candidateId", "roomId", "personaId", "need", "reason"];
export const furnishingSchema = {
  type: "object", additionalProperties: false, required: ["operations"],
  properties: { operations: { type: "array", minItems: 1, maxItems: 8, items: {
    type: "object", additionalProperties: false, required: fields,
    properties: {
      type: { type: "string", enum: ["add"] }, candidateId: { type: "string" },
      roomId: { type: "string" }, personaId: { type: "string" },
      need: { type: "string", enum: furnishingNeeds }, reason: { type: "string" },
    },
  } } },
};

export function validateFurnishingProposal(proposal, input) {
  const operations = proposal?.operations;
  if (!Array.isArray(operations) || !operations.length || operations.length > 8 ||
      Object.keys(proposal).some((key) => key !== "operations")) {
    throw new Error("Gemini returned an invalid furnishing proposal.");
  }
  let totalMinor = input.retainedMinor;
  for (const operation of operations) {
    const candidate = input.candidates.find(({ id }) => id === operation?.candidateId);
    if (!candidate || operation.type !== "add" || Object.keys(operation).some((key) => !fields.includes(key)) ||
        !input.rooms.some(({ id }) => id === operation.roomId) ||
        !input.personas.some(({ id }) => id === operation.personaId) ||
        !furnishingNeeds.includes(operation.need) || !text(operation.reason, 400)) {
      throw new Error("The proposal includes an unsupported change or an unknown piece, room, or household need.");
    }
    totalMinor += candidate.priceMinor;
  }
  if (totalMinor > input.budgetMinor) throw new Error("This proposal exceeds the furniture budget.");
  return totalMinor;
}
