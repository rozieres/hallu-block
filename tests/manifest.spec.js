"use strict";

// Hallu Block — cross-browser manifest derivation (deterministic, no browser).
//
// manifest.json is the CHROME canonical. Firefox (and any future target) is
// derived from it by scripts/manifest.mjs. These tests lock in the Firefox shape
// AND the parity of the target-defining keys, so a derivation change can never
// silently drop a covered site or reintroduce a key Firefox rejects. This mirrors
// the same invariant enforced by scripts/check.mjs (the green gate) — kept here
// too so the test suite alone still proves it, the way popup.spec re-proves the
// strictly-local promise.

const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CHROME = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

// scripts/manifest.mjs is ESM; load it with a dynamic import from this CJS test.
const loadFirefox = async () => {
  const { toFirefox } = await import(path.join(ROOT, "scripts", "manifest.mjs"));
  return toFirefox(CHROME);
};

test("Chrome canonical uses an MV3 service worker (nothing regressed it)", () => {
  expect(CHROME.background.service_worker).toBe("src/background/service-worker.js");
  expect(CHROME.background.type).toBe("module");
});

test("derived Firefox manifest drops the service worker for an event-page scripts array", async () => {
  const ff = await loadFirefox();
  expect(ff.background.service_worker).toBeUndefined();
  expect(ff.background.scripts).toEqual(["src/background/service-worker.js"]);
  expect(ff.background.type).toBe("module"); // worker is authored as an ES module
  // The referenced background script must actually exist.
  expect(fs.existsSync(path.join(ROOT, ff.background.scripts[0]))).toBe(true);
});

test("derived Firefox manifest keeps a stable AMO add-on id and drops Chrome-only keys", async () => {
  const ff = await loadFirefox();
  expect(ff.browser_specific_settings.gecko.id).toBe("hallu-block@halluworld.fr");
  expect(ff.minimum_chrome_version).toBeUndefined();
});

test("target-defining keys are carried over verbatim (no site silently dropped)", async () => {
  const ff = await loadFirefox();
  // Everything that decides WHERE the extension acts must match the canonical.
  expect(ff.host_permissions).toEqual(CHROME.host_permissions);
  expect(ff.content_scripts).toEqual(CHROME.content_scripts);
  expect(ff.permissions).toEqual(CHROME.permissions);
  expect(ff.declarative_net_request).toEqual(CHROME.declarative_net_request);
  expect(ff.content_security_policy).toEqual(CHROME.content_security_policy);
});

test("derived Firefox manifest stays strictly local (no rules-hosting origin)", async () => {
  const ff = await loadFirefox();
  expect(ff.permissions).not.toContain("alarms");
  expect((ff.host_permissions || []).some((h) => /github|githubusercontent/i.test(h))).toBe(false);
});
