import { defineConfig, loadEnv } from "vite";
import {
  createPersonaApiMiddleware,
  createPersonaGenerator,
} from "./src/agents/persona-api.js";
import { createRedesignApiMiddleware } from "./src/agents/redesign-agent.js";
import { createFloorplanApiMiddleware } from "./src/spatial/floorplan-vite-middleware.js";

export default defineConfig(({ command, mode }) => {
  if (command !== "serve") return {};

  const env = loadEnv(mode, process.cwd(), "");
  const generatePersonas = createPersonaGenerator({
    apiKey: env.GEMINI_API_KEY,
  });
  const personaMiddleware = createPersonaApiMiddleware(generatePersonas);
  const floorplanMiddleware = createFloorplanApiMiddleware(env);
  const redesignMiddleware = createRedesignApiMiddleware(env);
  const configure = (server) => {
    server.middlewares.use("/api/floorplan/analyze", floorplanMiddleware);
    server.middlewares.use(redesignMiddleware);
    server.middlewares.use(personaMiddleware);
  };

  return {
    plugins: [
      {
        name: "stillroom-dev-api",
        configureServer: configure,
        configurePreviewServer: configure,
      },
    ],
  };
});
