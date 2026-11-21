import { kindWords } from "../../model.js";

const expression = /\b(under|less than|up to|at most)\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(k\b)?/gi;
function upperLimit(match) {
  const cents = Math.round(Number(match[2].replaceAll(",", "")) * (match[3] ? 100000 : 100));
  return /^(under|less than)$/i.test(match[1]) ? cents - 1 : cents;
}

export function itemLimit(query) {
  return Math.min(Infinity, ...Array.from(query.matchAll(expression), upperLimit));
}

// Keep explicit item caps when Gemini paraphrases a query or extracts a separate whole-home budget.
export function statedItemLimits(prompt) {
  const limits = {};
  for (const match of prompt.matchAll(expression)) {
    const before = prompt.slice(0, match.index).trimEnd();
    for (const [kind, nouns] of Object.entries(kindWords)) {
      if (new RegExp("\\b(?:" + nouns + ")\\s*(?:for|priced)?$", "i").test(before)) {
        limits[kind] = Math.min(limits[kind] ?? Infinity, upperLimit(match));
      }
    }
  }
  return limits;
}
