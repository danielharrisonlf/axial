import { defineConfig } from "@playwright/test";

// Ports are configurable so a second checkout (worktree) can run the suite while another
// dev server holds 5173/5174; reuseExistingServer would otherwise test the other checkout.
const webPort = Number(process.env.WEB_E2E_PORT ?? 5173);
const insightsPort = Number(process.env.INSIGHTS_E2E_PORT ?? 5174);

export default defineConfig({
  testDir: "./tests",
  // demo-mode suite; the API-mode suite against a running stack is playwright.stack.config.ts
  testIgnore: ["stack/**"],
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "../../output/validation/web/report", open: "never" }]],
  outputDir: "../../output/validation/web/artifacts",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `pnpm --filter @axial/insights dev --host 127.0.0.1 --port ${insightsPort}`,
      url: `http://127.0.0.1:${insightsPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `pnpm dev --host 127.0.0.1 --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      // VITE_API_BASE_URL: a recognizable gateway origin, so the MCP page test proves the URL comes from config
      env: {
        INSIGHTS_REMOTE_ENTRY: `http://localhost:${insightsPort}/remoteEntry.js`,
        VITE_API_BASE_URL: "https://api.gateway.example.test",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
