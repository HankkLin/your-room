import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "./tests", timeout: 120000, workers: 1,
  outputDir: "../test-results/portfolio",
  use: { baseURL: "http://127.0.0.1:4186/your-room/", channel: "chrome",
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
  webServer: { command: "npm run preview:portfolio", cwd: fileURLToPath(new URL("../", import.meta.url)),
    url: "http://127.0.0.1:4186/your-room/", reuseExistingServer: true },
});

