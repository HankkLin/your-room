import { createGeminiJsonGenerator, GeminiJsonError } from "./gemini-json.js";
import { furnishingPath, furnishingSchema, validateFurnishingInput, validateFurnishingProposal } from "./furnishing-contract.js";

const instruction = "Propose additions to furnish this household. Keep every existing piece. Prefer relevant Shopify offers when the household has searched for live alternatives. Select only supplied candidate IDs and available room IDs. Use the household's needs, preferences and schedule, the selected style, the brief and the inspiration photo if provided. For each addition, identify the person and need it serves and explain the choice in one sentence including its relation to the design. Existing costs and candidate prices are in US cents. Stay within the total budget. The application computes and validates placement. Return only the requested add operations.";

export function createFurnishingMiddleware({ apiKey, fetchImpl } = {}) {
  const generate = createGeminiJsonGenerator({ apiKey, fetchImpl });
  return async (request, response, next) => {
    if (request.url?.split("?")[0] !== furnishingPath) return next();
    const send = (status, body) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(body));
    };
    if (request.method !== "POST") return send(405, { error: "Send a furnishing request with POST." });
    const origin = (request.socket.encrypted ? "https://" : "http://") + request.headers.host;
    if (request.headers.origin && request.headers.origin !== origin) return send(403, { error: "Open Stillroom to request a proposal." });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) return send(415, { error: "Send the design brief as JSON." });
    let input;
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        length += chunk.length;
        if (length > 1400 * 1024) {
          request.resume();
          return send(413, { error: "The furnishing request is too large." });
        }
        chunks.push(chunk);
      }
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      validateFurnishingInput(input);
    } catch {
      return send(400, { error: "Check the household, budget, candidates, and inspiration photo." });
    }
    try {
      const { reference, ...brief } = input;
      const image = reference ? { mimeType: "image/jpeg", data: reference.split(",")[1] } : null;
      const { payload } = await generate({ input: brief, image, systemInstruction: instruction, schema: furnishingSchema });
      validateFurnishingProposal(payload, input);
      return send(200, payload);
    } catch (error) {
      if (error instanceof GeminiJsonError) return send(error.status, { error: "Gemini could not prepare a proposal. Try again or use Auto-style room." });
      return send(422, { error: error.message || "The furnishing proposal could not be validated." });
    }
  };
}
