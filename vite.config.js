import { defineConfig, loadEnv } from "vite";
import { createFloorplanApiMiddleware } from "./src/spatial/floorplan-vite-middleware.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      {
        name: "stillroom-floorplan-api",
        configureServer(server) {
          server.middlewares.use(
            "/api/floorplan/analyze",
            createFloorplanApiMiddleware(env),
          );
        },
        configurePreviewServer(server) {
          server.middlewares.use(
            "/api/floorplan/analyze",
            createFloorplanApiMiddleware(env),
          );
        },
      },
    ],
  };
});
