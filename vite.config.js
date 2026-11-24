import { defineConfig, loadEnv } from "vite";
import { createEnvironmentMiddleware } from "./src/environment/environment-api.js";
import { createPersonaApiMiddleware, createPersonaGenerator } from "./src/agents/persona-api.js";
import { createReplaySuggestionApiMiddleware, createReplaySuggestionGenerator } from "./src/agents/replay-suggestion-api.js";
import { createGeminiJsonGenerator } from "./src/agents/gemini-json.js";
import { createFurnishingMiddleware } from "./src/agents/furnishing-api.js";
import { createRedesignApiMiddleware } from "./src/agents/redesign-agent.js";
import { createShopifyApiMiddleware } from "./src/shopify/shopify-api.js";
import { createFloorplanApiMiddleware } from "./src/spatial/floorplan-vite-middleware.js";

export default defineConfig(({ command, mode }) => {
  if (mode === "portfolio") return {
    base: "/your-room/",
    build: { outDir: "dist/portfolio", emptyOutDir: true },
  };
  if (command !== "serve") return {};

  const env = loadEnv(mode, process.cwd(), "");
  const generatePersonas = createPersonaGenerator({
    apiKey: env.GEMINI_API_KEY,
  });
  const personaMiddleware = createPersonaApiMiddleware(generatePersonas);
  const replayMiddleware = createReplaySuggestionApiMiddleware(
    createReplaySuggestionGenerator({ apiKey: env.GEMINI_API_KEY }),
  );
  const shopifyMiddleware = createShopifyApiMiddleware({
    generateRecommendation: createGeminiJsonGenerator({ apiKey: env.GEMINI_API_KEY }),
  });
  const floorplanMiddleware = createFloorplanApiMiddleware(env);
  const redesignMiddleware = createRedesignApiMiddleware(env);

  function configure(server) {
    server.middlewares.use(createEnvironmentMiddleware());
    server.middlewares.use(personaMiddleware);
    server.middlewares.use(createFurnishingMiddleware({ apiKey: env.GEMINI_API_KEY }));
    server.middlewares.use(replayMiddleware);
    server.middlewares.use("/api/floorplan/analyze", floorplanMiddleware);
    server.middlewares.use(redesignMiddleware);
    server.middlewares.use(shopifyMiddleware);
  }

  return {
    plugins: [{
      name: "living-blueprint-api",
      configureServer: configure,
      configurePreviewServer: configure,
    }],
  };
});
