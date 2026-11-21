import { defineConfig, loadEnv } from "vite";
import {
  createPersonaApiMiddleware,
  createPersonaGenerator,
} from "./src/agents/persona-api.js";
import { createRedesignApiMiddleware } from "./src/agents/redesign-agent.js";
import { createShopifyApiMiddleware } from "./src/shopify/shopify-api.js";
import { createFloorplanApiMiddleware } from "./src/spatial/floorplan-vite-middleware.js";

export default defineConfig(({ command, mode }) => {
  if (command !== "serve") return {};

  const env = loadEnv(mode, process.cwd(), "");
  const generatePersonas = createPersonaGenerator({
    apiKey: env.GEMINI_API_KEY,
  });
  const personaMiddleware = createPersonaApiMiddleware(generatePersonas);
  const shopifyMiddleware = createShopifyApiMiddleware();
  const floorplanMiddleware = createFloorplanApiMiddleware(env);
  const redesignMiddleware = createRedesignApiMiddleware(env);

  function configure(server) {
    server.middlewares.use(personaMiddleware);
    server.middlewares.use("/api/floorplan/analyze", floorplanMiddleware);
    server.middlewares.use(redesignMiddleware);
    server.middlewares.use(shopifyMiddleware);
  }

  return {
    plugins: [
      {
        name: "stillroom-api",
        configureServer: configure,
        configurePreviewServer: configure,
      },
    ],
  };
});
