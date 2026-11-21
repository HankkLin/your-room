import { defineConfig, loadEnv } from "vite";
import { createPersonaApiMiddleware, createPersonaGenerator } from "./src/agents/persona-api.js";
import { createFloorplanApiMiddleware } from "./src/spatial/floorplan-vite-middleware.js";

export default defineConfig(({ command, mode }) => {
  if (command !== "serve") return {};

  const env = loadEnv(mode, process.cwd(), "GEMINI_");
  const generatePersonas = createPersonaGenerator({ apiKey: env.GEMINI_API_KEY });
  const personaMiddleware = createPersonaApiMiddleware(generatePersonas);
  const floorplanMiddleware = createFloorplanApiMiddleware(env);

  function configure(server) {
    server.middlewares.use(personaMiddleware);
    server.middlewares.use("/api/floorplan/analyze", floorplanMiddleware);
  }

  return {
    plugins: [{
      name: "stillroom-gemini-api",
      configureServer: configure,
      configurePreviewServer: configure,
    }],
  };
});
