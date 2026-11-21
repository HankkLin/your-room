import { defineConfig, loadEnv } from "vite";
import { createPersonaApiMiddleware, createPersonaGenerator } from "./src/agents/persona-api.js";

export default defineConfig(({ command, mode }) => {
  if (command !== "serve") return {};

  const env = loadEnv(mode, process.cwd(), "GEMINI_");
  const generatePersonas = createPersonaGenerator({ apiKey: env.GEMINI_API_KEY });
  const middleware = createPersonaApiMiddleware(generatePersonas);
  const configure = (server) => {
    server.middlewares.use(middleware);
  };

  return {
    plugins: [{
      name: "stillroom-persona-api",
      configureServer: configure,
      configurePreviewServer: configure,
    }],
  };
});
