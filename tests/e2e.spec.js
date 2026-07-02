"use strict";

// Hallu Block — E2E suite. Loads the REAL unpacked extension into real Chrome
// and asserts behavior against deterministic fixtures served at a matching
// google.fr/search URL (via route fulfillment). Each test gets a fresh browser
// context so storage (toggles, counter) never bleeds between cases.

const { test, expect, chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

const EXT_ROOT = path.resolve(__dirname, "..");
const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

let context = null;
let sw = null;

// Returns true if the unpacked extension actually loaded (its service worker
// appeared). Newer Chrome builds disable command-line unpacked loading; there
// the worker never shows up and the caller skips these tests.
async function launch() {
  try {
    context = await chromium.launchPersistentContext("", {
      channel: "chrome",
      headless: false, // MV3 extensions require a headful (or --headless=new) browser
      ignoreDefaultArgs: ["--disable-extensions"], // Playwright adds this; it kills the load
      args: [
        `--disable-extensions-except=${EXT_ROOT}`,
        `--load-extension=${EXT_ROOT}`,
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        "--lang=fr-FR",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
    });
  } catch (_) {
    // No usable Chrome at all (not installed, sandbox, headless-only env): treat
    // like the blocked-load case so beforeEach skips instead of the suite erroring.
    context = null;
    return false;
  }

  sw = context.serviceWorkers()[0] || null;
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 8000 }).catch(() => null);
  return !!sw;
}

const swMsg = (key) => sw.evaluate((k) => chrome.i18n.getMessage(k), key);
const getCounter = () =>
  sw.evaluate(() => chrome.storage.local.get("counter").then((r) => r.counter || null));
const setToggles = (t) =>
  sw.evaluate((tt) => chrome.storage.local.set({ toggles: tt }), t);

async function openSerp({ file, url }) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/search*", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixture(file) })
  );
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return { page, errors };
}

test.beforeEach(async () => {
  const loaded = await launch();
  test.skip(
    !loaded,
    "Command-line unpacked-extension loading is disabled in this Chrome build. " +
      "Run on a Chrome that permits --load-extension, or load via chrome://extensions → Load unpacked. " +
      "The engine.spec.js suite verifies the masking logic without packaging."
  );
});
test.afterEach(async () => {
  if (context) await context.close();
  context = sw = null;
});

test("AI Overview is hidden, annotated, and counted (fixture google.fr)", async () => {
  const { page, errors } = await openSerp({
    file: "google-ai-overview-fr.html",
    url: "https://www.google.fr/search?q=intelligence+artificielle+danger&hl=fr",
  });

  // The AI Overview block must be hidden…
  await expect(page.locator('div[data-async-type="folsrch"]')).toBeHidden();
  await expect(page.locator("div[data-mcpr]")).toBeHidden();

  // …with the discreet annotation bar carrying the localized label + "afficher".
  const annot = page.locator(".hb-annot");
  await expect(annot).toBeVisible();
  await expect(annot).toContainText(await swMsg("annot_google_overview"));
  await expect(annot.locator(".hb-annot-link")).toHaveText(await swMsg("annot_show"));
  await expect(annot.locator(".hb-annot-blk")).toHaveText("▌");

  // Organic results are untouched.
  await expect(page.locator("#rso .g")).toHaveCount(2);
  await expect(page.locator("#rso .g").first()).toBeVisible();

  // Counter incremented locally.
  await expect.poll(async () => (await getCounter())?.total ?? 0).toBeGreaterThanOrEqual(1);

  expect(errors, "no uncaught page errors").toEqual([]);
});

test('"afficher" reveals the hidden block', async () => {
  const { page } = await openSerp({
    file: "google-ai-overview-fr.html",
    url: "https://www.google.fr/search?q=ia&hl=fr",
  });
  const annot = page.locator(".hb-annot");
  await expect(annot).toBeVisible();
  await expect(page.locator("div[data-mcpr]")).toBeHidden();

  await annot.locator(".hb-annot-link").click();

  await expect(page.locator("div[data-mcpr]")).toBeVisible();
  await expect(annot.locator(".hb-annot-link")).toHaveText(await swMsg("annot_hide"));
});

test("toggle OFF → nothing is hidden, no annotation", async () => {
  await setToggles({ "google-ai-overview": false });
  const { page } = await openSerp({
    file: "google-ai-overview-fr.html",
    url: "https://www.google.fr/search?q=ia&hl=fr",
  });

  await expect(page.locator("div[data-mcpr]")).toBeVisible();
  await expect(page.locator('div[data-async-type="folsrch"]')).toBeVisible();
  await expect(page.locator(".hb-annot")).toHaveCount(0);
});

test("page without AI → engine does nothing, no errors", async () => {
  const { page, errors } = await openSerp({
    file: "google-no-ai-fr.html",
    url: "https://www.google.fr/search?q=meteo+paris&hl=fr",
  });

  await expect(page.locator("#rso .g")).toHaveCount(2);
  await expect(page.locator(".hb-annot")).toHaveCount(0);
  await expect(page.locator(".hb-hidden")).toHaveCount(0);

  // counter must NOT increment on a page with no AI block
  await page.waitForTimeout(1500);
  expect((await getCounter())?.total ?? 0).toBe(0);
  expect(errors).toEqual([]);
});

test("popup renders with i18n + live counter", async () => {
  const extId = new URL(sw.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/src/popup/popup.html`);

  await expect(page.locator(".pop-wordmark")).toContainText("Hallu Block");
  await expect(page.locator(".pop-tagline")).toHaveText(await swMsg("tagline"));
  await expect(page.locator(".counter .num-val")).toHaveText("0");
  await expect(page.locator(".num-sub")).toContainText("0"); // "0 depuis l'installation"
  // All toggle groups present
  await expect(page.locator(".tg-group")).toHaveCount(3);
});
