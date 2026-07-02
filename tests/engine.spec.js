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

// Bing uses CSS-annotation mode (annotMode:"css"): the container itself becomes
// the bandeau via pseudo-elements — no injected DOM node — so Bing's own
// MutationObserver has nothing to strip. Assert the class + hidden content +
// active ::after, NOT a .hb-annot node.
const hasAfter = (loc) => loc.evaluate((el) => getComputedStyle(el, "::after").content !== "none");

test("Bing Copilot hidden via removal-proof CSS bandeau; organic results survive", async () => {
  const { errors } = await mount({
    file: "bing-copilot-en.html",
    url: "https://www.bing.com/search?q=best+productivity+apps",
    toggles: { ...DEFAULT_TOGGLES, "bing-copilot": true },
  });

  const answer = page.locator("#b_results > li.b_ans");
  const followup = page.locator("#b_copilot_search_container");

  // Both containers carry the CSS-annot class; their real content is CSS-hidden.
  await expect(answer).toHaveClass(/hb-css-annot/);
  await expect(followup).toHaveClass(/hb-css-annot/);
  await expect(page.locator("#copans_container")).toBeHidden();
  await expect(followup.locator("textarea")).toBeHidden();

  // The bandeau is a pseudo-element (no DOM node to strip), carrying the label,
  // and VISIBLE despite the fixture's Bing-style clearfix (visibility:hidden).
  expect(await hasAfter(answer)).toBe(true);
  expect(await answer.evaluate((el) => getComputedStyle(el, "::after").visibility)).toBe("visible");
  expect(await answer.evaluate((el) => el.dataset.hbLabel)).toBe(MESSAGES.annot_generic);
  await expect(page.locator(".hb-annot")).toHaveCount(0);

  // Organic results untouched.
  await expect(page.locator("li.b_algo")).toHaveCount(2);
  await expect(page.locator("li.b_algo").first()).toBeVisible();

  await expect.poll(() => page.evaluate(() => window.__hbBumps)).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test("Bing re-renders its Copilot content → CSS bandeau persists, content stays hidden", async () => {
  const { errors } = await mount({
    file: "bing-copilot-reconcile.html",
    url: "https://www.bing.com/search?q=metabolisme",
    toggles: { ...DEFAULT_TOGGLES, "bing-copilot": true },
  });

  const answer = page.locator("#b_results > li.b_ans");
  await expect(answer).toHaveClass(/hb-css-annot/);

  // Let the fixture churn the answer's inner content (streaming re-render) finish.
  await page.waitForTimeout(1800);

  // No DOM node was ever injected (nothing for the host's observer to strip)…
  await expect(page.locator(".hb-annot")).toHaveCount(0);
  // …the class + pseudo-element bandeau survive, and re-rendered content stays hidden.
  await expect(answer).toHaveClass(/hb-css-annot/);
  expect(await hasAfter(answer)).toBe(true);
  await expect(answer.locator(".answer_container")).toBeHidden();
  expect(errors).toEqual([]);
});

test("Bing Copilot toggle OFF → answer stays visible, no annotation", async () => {
  await mount({
    file: "bing-copilot-en.html",
    url: "https://www.bing.com/search?q=x",
    toggles: { ...DEFAULT_TOGGLES, "bing-copilot": false },
  });

  await expect(page.locator("#b_results > li.b_ans")).toBeVisible();
  await expect(page.locator("#b_results > li.b_ans")).not.toHaveClass(/hb-css-annot/);
  await expect(page.locator("#copans_container")).toBeVisible();
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

test("Amazon Rufus launcher + AI review summary hidden; product content survives", async () => {
  const { errors } = await mount({
    file: "amazon-rufus-fr.html",
    url: "https://www.amazon.fr/dp/B08EXAMPLE",
    toggles: { ...DEFAULT_TOGGLES, "amazon-rufus": true },
  });

  await expect(page.locator("#nav-rufus-disco")).toBeHidden();
  await expect(page.locator("#cr-product-insights-cards")).toBeHidden();

  await expect(page.locator("#productTitle")).toBeVisible();
  await expect(page.locator("#reviewsMedley")).toBeVisible();

  await expect(page.locator(".hb-annot")).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.__hbBumps)).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test("Amazon Rufus toggle OFF → launcher stays visible", async () => {
  await mount({
    file: "amazon-rufus-fr.html",
    url: "https://www.amazon.fr/dp/x",
    toggles: { ...DEFAULT_TOGGLES, "amazon-rufus": false },
  });

  await expect(page.locator("#nav-rufus-disco")).toBeVisible();
  await expect(page.locator("#cr-product-insights-cards")).toBeVisible();
  await expect(page.locator(".hb-annot")).toHaveCount(0);
});

test("bundled anti-slop blocklist parses to clean, valid hostnames (via the SW's real HOST_RE)", () => {
  const raw = read("src/rules/slop/noai_hosts.txt");

  // Use the SERVICE WORKER's ACTUAL HOST_RE, extracted from source, rather than a
  // hardcoded copy — so tightening it in getSlopDomains() is exercised here
  // instead of silently drifting past a green test.
  const swSrc = read("src/background/service-worker.js");
  const m = swSrc.match(/const HOST_RE = (\/.*\/);/);
  expect(m, "HOST_RE literal not found in service-worker.js").toBeTruthy();
  // eslint-disable-next-line no-eval -- test-only: reconstruct the literal regex.
  const HOST_RE = eval(m[1]);
  expect(HOST_RE.source).toBe("^[a-z0-9.-]+\\.[a-z]{2,}$");

  const hostLines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  // Every data line is hosts-file format: `0.0.0.0 <token>`.
  for (const l of hostLines) expect(l).toMatch(/^0\.0\.0\.0\s+\S+$/);

  // Replicate getSlopDomains() normalization + dedup, DRIVEN BY the real regex.
  // Dotless entries ("artbreeder"), path/port-bearing ones and junk are dropped.
  const seen = new Set();
  for (const l of hostLines) {
    const parts = l.split(/\s+/);
    const host = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase().replace(/^\*\./, "");
    if (HOST_RE.test(host)) seen.add(host);
  }
  const hosts = [...seen];

  expect(hosts.length).toBeGreaterThan(2000);
  // No path / port survives normalization.
  expect(hosts.some((h) => h.includes("/") || h.includes(":"))).toBe(false);
  // Punycode / IDN hosts must survive the char class (regression guard) — only
  // assert if the upstream list actually carries one.
  const puny = hostLines
    .map((l) => l.split(/\s+/)[1])
    .filter(Boolean)
    .find((h) => h.includes("xn--"));
  if (puny) expect(HOST_RE.test(puny.toLowerCase())).toBe(true);
});
