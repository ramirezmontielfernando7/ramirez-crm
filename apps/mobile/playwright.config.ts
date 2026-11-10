import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "./artifacts/playwright-results",
  reporter: [
    ["list"],
    ["json", { outputFile: "artifacts/browser-results.json" }],
  ],
  workers: 2,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:8081",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "python scripts/serve-web.py",
    url: "http://127.0.0.1:8081",
    reuseExistingServer: true,
  },
});
