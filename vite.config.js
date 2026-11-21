import { defineConfig, loadEnv } from "vite";
import { createPersonaApiMiddleware, createPersonaGenerator } from "./src/agents/persona-api.js";
import { createReplaySuggestionApiMiddleware, createReplaySuggestionGenerator } from "./src/agents/replay-suggestion-api.js";
import { createGeminiJsonGenerator } from "./src/agents/gemini-json.js";
import { createShopifyApiMiddleware } from "./src/shopify/shopify-api.js";
import { createFloorplanApiMiddleware } from "./src/spatial/floorplan-vite-middleware.js";

export default defineConfig(({ command, mode }) => {
  if (command !== "serve") return {};

  const env = loadEnv(mode, process.cwd(), "GEMINI_");
  const generatePersonas = createPersonaGenerator({ apiKey: env.GEMINI_API_KEY });
  const personaMiddleware = createPersonaApiMiddleware(generatePersonas);
  const replayMiddleware = createReplaySuggestionApiMiddleware(
    createReplaySuggestionGenerator({ apiKey: env.GEMINI_API_KEY }),
  );
  const shopifyMiddleware = createShopifyApiMiddleware({
    generateRecommendation: createGeminiJsonGenerator({ apiKey: env.GEMINI_API_KEY }),
  });
  const floorplanMiddleware = createFloorplanApiMiddleware(env);

  function configure(server) {
    server.middlewares.use(personaMiddleware);
    server.middlewares.use(replayMiddleware);
    server.middlewares.use("/api/floorplan/analyze", floorplanMiddleware);
    server.middlewares.use(shopifyMiddleware);
  }

  return {
    plugins: [{
      name: "stillroom-api",
      configureServer: configure,
      configurePreviewServer: configure,
    }],
  };
});
