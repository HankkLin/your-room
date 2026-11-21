const modelsEndpoint = "https://generativelanguage.googleapis.com/v1beta/models";
const modelPreferences = ["gemini-4-hydrogen", "gemini-4-neon", "gemini-3.8-flash", "gemini-2.5-flash"];

export class GeminiJsonError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function checkResponse(response) {
  if (response.status === 429) throw new GeminiJsonError(429, "quota");
  if (!response.ok) throw new GeminiJsonError(502, "upstream");
}

export function createGeminiJsonGenerator({ apiKey, fetchImpl = fetch, timeoutMs = 25_000 } = {}) {
  const key = apiKey?.trim();
  return async ({ input, systemInstruction, schema, image }) => {
    if (!key) throw new GeminiJsonError(503, "unconfigured");
    const headers = { "x-goog-api-key": key };
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const catalog = await fetchImpl(modelsEndpoint + "?pageSize=1000", { headers, redirect: "error", signal });
      checkResponse(catalog);
      const { models = [] } = await catalog.json();
      const available = new Set(models
        .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
        .map((model) => model.name));
      const model = modelPreferences.find((name) => available.has("models/" + name));
      if (!model) throw new GeminiJsonError(503, "unavailable");

      const response = await fetchImpl(modelsEndpoint + "/" + model + ":generateContent", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        redirect: "error",
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }, ...(image ? [{ inlineData: image }] : [])] }],
          generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema },
        }),
      });
      checkResponse(response);
      const data = await response.json();
      const candidate = data?.candidates?.[0];
      if (candidate?.finishReason !== "STOP" || !Array.isArray(candidate.content?.parts)) {
        throw new GeminiJsonError(502, "incomplete");
      }
      const text = candidate.content.parts
        .filter((part) => !part?.thought && typeof part?.text === "string")
        .map((part) => part.text)
        .join("");
      return { payload: JSON.parse(text), model };
    } catch (error) {
      if (signal.aborted) throw new GeminiJsonError(504, "timeout");
      if (error instanceof GeminiJsonError) throw error;
      throw new GeminiJsonError(502, "unreadable");
    }
  };
}
