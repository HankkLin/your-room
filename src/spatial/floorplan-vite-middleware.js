import { callGeminiFloorplanApi } from "./floorplan-ai-adapter.js";

const MAX_BODY_BYTES = 24 * 1024 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Uploaded floorplan payload exceeds 24 MB limit."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON request payload."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

export function createFloorplanApiMiddleware(env = {}) {
  return async function floorplanApiMiddleware(req, res, next) {
    if (req.method !== "POST") {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }
      next?.();
      return;
    }

    const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
    const model =
      env.GEMINI_FLOORPLAN_MODEL ||
      env.GEMINI_MODEL ||
      process.env.GEMINI_FLOORPLAN_MODEL ||
      process.env.GEMINI_MODEL ||
      undefined;

    if (!apiKey.trim()) {
      sendJson(res, 503, {
        error:
          "GEMINI_API_KEY is not configured in .env.local. Use the sample floorplan or manual calibration.",
      });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const candidate = await callGeminiFloorplanApi({
        base64Data: String(body.base64Data || ""),
        mimeType: String(body.mimeType || "image/png"),
        imageWidth: Number(body.imageWidth) || 1000,
        imageHeight: Number(body.imageHeight) || 800,
        apiKey,
        model,
      });
      sendJson(res, 200, candidate);
    } catch (err) {
      sendJson(res, 502, {
        error: err?.message || "Gemini floorplan analysis failed.",
      });
    }
  };
}
