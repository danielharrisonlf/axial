import { defineConfig } from "@playwright/test";

// API-mode Workspace against a local stack seeded with the Vetor Labs scenario.
// Start it first: `node tests/stack/stack.mjs up` (see tests/stack/stack.mjs), then
// `pnpm --filter @axial/web test:stack`; stop with `node tests/stack/stack.mjs down`.
export default defineConfig({
  testDir: "./tests/stack",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "../../output/validation/stack/report", open: "never" }]],
  outputDir: "../../output/validation/stack/artifacts",
  use: {
    baseURL: process.env.STACK_WEB_URL ?? "http://localhost:4273",
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
