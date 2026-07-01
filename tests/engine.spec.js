"use strict";

// Hallu Block — engine-level E2E (deterministic, runs everywhere).
//
// Exercises the REAL masking pipeline in real Chromium against the fixtures:
//   engine.js + baseline-google.css + annotate.css + rules.json + the FR locale.
// The page is served at a matching google.fr/search URL (so the engine's host
// filter applies); the WebExtension APIs (runtime messaging, i18n) are stubbed
// in-page exactly as the service worker would answer them. This validates the
// detection/hide/annotate/reveal logic without needing to load the packaged
// extension (which newer Chrome blocks from the command line — see e2e.spec.js).

const { test, expect, chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const RULES = JSON.parse(read("src/rules/rules.json"));
const FR = JSON.parse(read("_locales/fr/messages.json"));
const MESSAGES = Object.fromEntries(Object.entries(FR).map(([k, v]) => [k, v.message]));
const ENGINE_SRC = read("src/content/engine.js");
const BASELINE_CSS = read("src/content/baseline-google.css");
const ANNOTATE_CSS = read("src/content/annotate.css");
const fixture = (n) => read(path.join("tests/fixtures", n));

const DEFAULT_TOGGLES = {
  "google-ai-overview": true,
  "google-ai-mode": true,
  "show-blocks": true,
};

const AI_MODE_TAB = '[role="listitem"]:has(a[href*="udm=50"])';

let browser, context, page;

test.beforeAll(async () => {
  browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
});
test.afterAll(async () => {
  await browser?.close();
});
test.beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
});
test.afterEach(async () => {
  await context?.close();
});

async function mount({ file, url, toggles = DEFAULT_TOGGLES, slopDomains = [] }) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Serve the fixture as the top document for whatever URL we navigate to
  // (Google /search, DDG /?q=, YouTube /watch, Amazon /dp/…); abort everything
  // else so no real network is touched (fixtures inline all their assets).
  await page.route("**/*", (route) =>
    route.request().resourceType() === "document"
      ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixture(file) })
      : route.abort()
  );
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: BASELINE_CSS });
  await page.addStyleTag({ content: ANNOTATE_CSS });
  await page.evaluate(
    ({ rules, messages, toggles, slopDomains }) => {
      window.__hbBumps = 0;
      window.__hbBumpFeatures = [];
      window.browser = {
        runtime: {
          sendMessage: async (msg) => {
            if (msg && msg.type === "hb-get-state") return { rules, toggles };
            if (msg && msg.type === "hb-get-slop") return { domains: slopDomains };
            if (msg && msg.type === "hb-bump") {
              window.__hbBumps++;
              window.__hbBumpFeatures.push(msg.feature);
              return { ok: true };
            }
          },
          getURL: (p) => p,
        },
        i18n: {
          getMessage: (k) => messages[k] || "",
          getUILanguage: () => "fr-FR",
        },
      };
    },
    { rules: RULES, messages: MESSAGES, toggles, slopDomains }
  );
  await page.addScriptTag({ content: ENGINE_SRC });
  return { errors };
}

test("AI Overview is hidden, annotated, counted; results untouched", async () => {
  const { errors } = await mount({
    file: "google-ai-overview-fr.html",
    url: "https://www.google.fr/search?q=intelligence+artificielle+danger&hl=fr",
  });

  await expect(page.locator('div[data-async-type="folsrch"]')).toBeHidden();
  await expect(page.locator("div[data-mcpr]")).toBeHidden();

  const annot = page.locator(".hb-annot");
  await expect(annot).toBeVisible();
  await expect(annot).toContainText(MESSAGES.annot_google_overview);
  await expect(annot.locator(".hb-annot-link")).toHaveText(MESSAGES.annot_show);
  await expect(annot.locator(".hb-annot-blk")).toHaveText("▌");

  await expect(page.locator("#rso .g")).toHaveCount(2);
  await expect(page.locator("#rso .g").first()).toBeVisible();

  await expect.poll(() => page.evaluate(() => window.__hbBumps)).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('"afficher" reveals the hidden block and flips to "masquer"', async () => {
  await mount({ file: "google-ai-overview-fr.html", url: "https://www.google.fr/search?q=ia&hl=fr" });

  const annot = page.locator(".hb-annot");
  await expect(annot).toBeVisible();
  await expect(page.locator("div[data-mcpr]")).toBeHidden();

  await annot.locator(".hb-annot-link").click();

  await expect(page.locator("div[data-mcpr]")).toBeVisible();
  await expect(annot.locator(".hb-annot-link")).toHaveText(MESSAGES.annot_hide);
});

test("toggle OFF → nothing hidden, no annotation", async () => {
  await mount({
    file: "google-ai-overview-fr.html",
    url: "https://www.google.fr/search?q=ia&hl=fr",
    toggles: { ...DEFAULT_TOGGLES, "google-ai-overview": false },
  });

  await expect(page.locator("div[data-mcpr]")).toBeVisible();
  await expect(page.locator('div[data-async-type="folsrch"]')).toBeVisible();
  await expect(page.locator(".hb-annot")).toHaveCount(0);
});

test("show-blocks OFF → block hidden but no annotation bar", async () => {
  await mount({
    file: "google-ai-overview-fr.html",
    url: "https://www.google.fr/search?q=ia&hl=fr",
    toggles: { ...DEFAULT_TOGGLES, "show-blocks": false },
  });

  await expect(page.locator("div[data-mcpr]")).toBeHidden();
  await expect(page.locator(".hb-annot")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__hbBumps)).toBeGreaterThanOrEqual(1);
});

test("page without AI → engine does nothing, no errors, no count", async () => {
  const { errors } = await mount({
    file: "google-no-ai-fr.html",
    url: "https://www.google.fr/search?q=meteo+paris&hl=fr",
  });

  await expect(page.locator("#rso .g")).toHaveCount(2);
  await expect(page.locator(".hb-annot")).toHaveCount(0);
  await expect(page.locator(".hb-hidden")).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__hbBumps)).toBe(0);
  expect(errors).toEqual([]);
});

test("AI Mode tab is hidden, annotated, counted; siblings & results untouched", async () => {
  const { errors } = await mount({
    file: "google-ai-mode-fr.html",
    url: "https://www.google.fr/search?q=intelligence+artificielle&hl=fr",
  });

  // Only the udm=50 tab is hidden…
  await expect(page.locator(AI_MODE_TAB)).toBeHidden();

  // …with the localized AI-Mode annotation (not the AI-Overview one).
  const annot = page.locator(".hb-annot");
  await expect(annot).toBeVisible();
  await expect(annot).toContainText(MESSAGES.annot_google_aimode);
  await expect(annot.locator(".hb-annot-blk")).toHaveText("▌");

  // Sibling tabs (Images = udm=2) and all five listitems remain in the DOM.
  await expect(page.locator('[role="listitem"]:has(a[href*="udm=2"])')).toBeVisible();
  await expect(page.locator('[role="listitem"]')).toHaveCount(5);

  // Organic results untouched.
  await expect(page.locator("#rso .g")).toHaveCount(2);
  await expect(page.locator("#rso .g").first()).toBeVisible();

  await expect.poll(() => page.evaluate(() => window.__hbBumps)).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("AI Mode toggle OFF → tab stays visible, no annotation", async () => {
  await mount({
    file: "google-ai-mode-fr.html",
    url: "https://www.google.fr/search?q=ia&hl=fr",
    toggles: { ...DEFAULT_TOGGLES, "google-ai-mode": false },
  });

  await expect(page.locator(AI_MODE_TAB)).toBeVisible();
  await expect(page.locator(".hb-annot")).toHaveCount(0);
});

const SLOP = ["slopfarm.ai"]; // stub blocklist — deterministic, not the real file

test("anti-slop: blocklisted results (incl. subdomain) hidden, clean ones kept", async () => {
  const { errors } = await mount({
    file: "google-slop-fr.html",
    url: "https://www.google.fr/search?q=meilleurs+outils&hl=fr",
    toggles: { ...DEFAULT_TOGGLES, "anti-slop": true },
    slopDomains: SLOP,
  });

  // slopfarm.ai and blog.slopfarm.ai (parent-domain match) are removed…
  const blocked = page.locator('#rso .g:has(a[href*="slopfarm.ai"])');
  await expect(blocked).toHaveCount(2);
  await expect(blocked.first()).toBeHidden();
  await expect(blocked.last()).toBeHidden();

  // …legitimate results survive.
  await expect(page.locator('#rso .g:has(a[href*="cnil.fr"])')).toBeVisible();
  await expect(page.locator('#rso .g:has(a[href*="lemonde.fr"])')).toBeVisible();

  // Each removed result gets the community-list annotation, and is counted.
  const annot = page.locator(".hb-annot");
  await expect(annot).toHaveCount(2);
  await expect(annot.first()).toContainText(MESSAGES.annot_slop);

  await expect.poll(() => page.evaluate(() => window.__hbBumps)).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.__hbBumpFeatures)).toContain("anti-slop");
  expect(errors).toEqual([]);
});

test("anti-slop toggle OFF → no result is filtered", async () => {
  await mount({
    file: "google-slop-fr.html",
    url: "https://www.google.fr/search?q=meilleurs+outils&hl=fr",
    toggles: { ...DEFAULT_TOGGLES, "anti-slop": false },
    slopDomains: SLOP,
  });

  await expect(page.locator("#rso .g")).toHaveCount(4);
  for (let i = 0; i < 4; i++) await expect(page.locator("#rso .g").nth(i)).toBeVisible();
  await expect(page.locator(".hb-annot")).toHaveCount(0);
});

test("anti-slop on DuckDuckGo: unwraps /l/?uddg= redirect to catch the slop result", async () => {
  const { errors } = await mount({
    file: "ddg-slop.html",
    url: "https://duckduckgo.com/?q=meilleurs+outils",
    toggles: { ...DEFAULT_TOGGLES, "anti-slop": true },
    slopDomains: SLOP,
  });

  // The slop link's raw host is duckduckgo.com; only after unwrapping uddg= does
  // it resolve to slopfarm.ai and get filtered.
  const blocked = page.locator('article[data-testid="result"]:has(a[href*="uddg="])');
  await expect(blocked).toHaveCount(1);
  await expect(blocked).toBeHidden();

  await expect(page.locator('article[data-testid="result"]:has(a[href*="cnil.fr"])')).toBeVisible();

  const annot = page.locator(".hb-annot");
  await expect(annot).toHaveCount(1);
  await expect(annot).toContainText(MESSAGES.annot_slop);
  expect(errors).toEqual([]);
});

test("Bing Copilot answer + follow-up chat hidden; organic results survive", async () => {
  const { errors } = await mount({
    file: "bing-copilot-en.html",
    url: "https://www.bing.com/search?q=best+productivity+apps",
    toggles: { ...DEFAULT_TOGGLES, "bing-copilot": true },
  });

  // The Copilot answer (li.b_ans wrapping #copans_container) and the follow-up
  // chat container are both removed.
  await expect(page.locator("#b_results > li.b_ans")).toBeHidden();
  await expect(page.locator("#b_copilot_search_container")).toBeHidden();

  // Two blocks hidden → two annotations.
  const annot = page.locator(".hb-annot");
  await expect(annot).toHaveCount(2);
  await expect(annot.first()).toContainText(MESSAGES.annot_generic);

  // Organic results untouched.
  await expect(page.locator("li.b_algo")).toHaveCount(2);
  await expect(page.locator("li.b_algo").first()).toBeVisible();

  await expect.poll(() => page.evaluate(() => window.__hbBumps)).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test("Bing Copilot toggle OFF → answer stays visible, no annotation", async () => {
  await mount({
    file: "bing-copilot-en.html",
    url: "https://www.bing.com/search?q=x",
    toggles: { ...DEFAULT_TOGGLES, "bing-copilot": false },
  });

  await expect(page.locator("#b_results > li.b_ans")).toBeVisible();
  await expect(page.locator("#b_copilot_search_container")).toBeVisible();
  await expect(page.locator(".hb-annot")).toHaveCount(0);
});

test("YouTube 'Ask' button + AI summary hidden; title & description survive", async () => {
  const { errors } = await mount({
    file: "youtube-ask.html",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    toggles: { ...DEFAULT_TOGGLES, "youtube-ask": true },
  });

  await expect(page.locator("yt-button-view-model")).toBeHidden();
  await expect(page.locator("ytd-expandable-metadata-renderer[has-video-summary]")).toBeHidden();

  await expect(page.locator("#video-title")).toBeVisible();
  await expect(page.locator("#description")).toBeVisible();

  await expect(page.locator(".hb-annot")).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.__hbBumps)).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test("YouTube toggle OFF → Ask button stays visible", async () => {
  await mount({
    file: "youtube-ask.html",
    url: "https://www.youtube.com/watch?v=x",
    toggles: { ...DEFAULT_TOGGLES, "youtube-ask": false },
  });

  await expect(page.locator("yt-button-view-model")).toBeVisible();
  await expect(page.locator(".hb-annot")).toHaveCount(0);
});

test("bundled anti-slop blocklist is well-formed hosts data", () => {
  const raw = read("src/rules/slop/noai_hosts.txt");
  const hostLines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  // Every data line is hosts-file format: `0.0.0.0 <token>`.
  for (const l of hostLines) expect(l).toMatch(/^0\.0\.0\.0\s+\S+$/);

  // The SW keeps only tokens that look like real domains (contain a dot); a few
  // dotless entries (e.g. "0.0.0.0 artbreeder") exist and are correctly dropped.
  const domains = hostLines.map((l) => l.split(/\s+/)[1]).filter((d) => d.includes("."));
  expect(domains.length).toBeGreaterThan(2000);
});
