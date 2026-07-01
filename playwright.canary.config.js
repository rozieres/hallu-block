// Canary config — LIVE-site drift detection, run on a daily cron (canary.yml),
// NOT on PRs. Headless Chromium (no extension load needed); tolerant retries.
// Kept separate from playwright.config.js so `npx playwright test` never touches
// the network.
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  testMatch: ["**/canary.spec.js"],
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [["list"]],
  use: { headless: true, viewport: { width: 1280, height: 800 } }, // bundled Chromium
});
