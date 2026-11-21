import { defineConfig, loadEnv } from "vite";
import { createPersonaApiMiddleware, createPersonaGenerator } from "./src/agents/persona-api.js";
import { createShopifyApiMiddleware } from "./src/shopify/shopify-api.js";

export default defineConfig(({ command, mode }) => {
  if (command !== "serve") return {};

  const env = loadEnv(mode, process.cwd(), "GEMINI_");
  const generatePersonas = createPersonaGenerator({ apiKey: env.GEMINI_API_KEY });
  const personaMiddleware = createPersonaApiMiddleware(generatePersonas);
  const shopifyMiddleware = createShopifyApiMiddleware();
  const configure = (server) => {
    server.middlewares.use(personaMiddleware);
    server.middlewares.use(shopifyMiddleware);
  };

  return {
    plugins: [{
      name: "stillroom-api",
      configureServer: configure,
      configurePreviewServer: configure,
    }],
  };
});
