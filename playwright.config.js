// Playwright config for the deterministic E2E suite (fixtures, runs on PR/push).
// The live "canary" suite (MVP-3) will live separately and run on a cron.
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  testMatch: ["**/engine.spec.js", "**/popup.spec.js", "**/manifest.spec.js", "**/e2e.spec.js"],
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
});
