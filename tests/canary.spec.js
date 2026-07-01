"use strict";

// Hallu Block — CANARY suite (LIVE sites). Detects when a target site changes
// the DOM our rules depend on AFTER a commit — what frozen fixtures can't see.
//
// This is NOT part of the PR suite. It runs on a daily cron
// (playwright.canary.config.js + .github/workflows/canary.yml).
//
// Best-effort by nature: live pages serve consent walls, CAPTCHAs and geo-gated
// content, so each probe SKIPS (not fails) when the page isn't a usable SERP,
// and FAILS only on a definite structural regression. It does NOT load the
// extension (newer Chrome blocks that); instead it asserts that the structural
// landmarks our selectors climb within still exist — a rename of #rso, .b_algo,
// article[data-testid="result"], etc. is exactly the drift we want to catch.

const { test, expect } = require("@playwright/test");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

async function open(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (_) {
    test.skip(true, `unreachable: ${url}`);
  }
  const here = page.url();
  if (/consent|sorry|captcha|batch|ipv[46]-check/i.test(here)) {
    test.skip(true, `consent/CAPTCHA redirect: ${here}`);
  }
  const body = (await page.locator("body").textContent().catch(() => "")) || "";
  if (/unusual traffic|not a robot|before you continue|avant d.accéder/i.test(body)) {
    test.skip(true, "consent/CAPTCHA wall");
  }
}

const count = (page, sel) => page.locator(sel).count();

test.use({ userAgent: UA, locale: "en-US" });

test("Google SERP still exposes #rso + organic result containers", async ({ page }) => {
  await open(page, "https://www.google.com/search?q=best+laptop+2026&hl=en&gl=us");
  // Anti-slop climbs within #rso .g; the AI-Overview rule bounds itself at #rso.
  expect(await count(page, "#rso, #search")).toBeGreaterThan(0);
  expect(await count(page, "#rso div.g, #search div.g")).toBeGreaterThan(0);
});

test("DuckDuckGo SERP still uses article[data-testid=result]", async ({ page }) => {
  await open(page, "https://duckduckgo.com/?q=best+laptop+2026");
  // DDG renders results client-side. Wait for the results list; if it never
  // appears the page didn't produce a SERP (blocked / SPA timing) → skip. If it
  // DID render but our precise article selector finds nothing → real drift → fail.
  try {
    await page.locator("ol.react-results--main").first().waitFor({ state: "attached", timeout: 15000 });
  } catch (_) {
    test.skip(true, "DDG results did not render (blocked or SPA timing)");
  }
  expect(await count(page, 'article[data-testid="result"]')).toBeGreaterThan(0);
});

test("Bing SERP still uses #b_results > li.b_algo", async ({ page }) => {
  await open(page, "https://www.bing.com/search?q=best+laptop+2026&setlang=en");
  expect(await count(page, "#b_results")).toBeGreaterThan(0);
  expect(await count(page, "#b_results li.b_algo")).toBeGreaterThan(0);
});

test("anti-slop upstream blocklist is still alive and hosts-formatted", async ({ request }) => {
  // Spec §16.1: re-verify the community list stays live. Catches it moving/dying.
  let res;
  try {
    res = await request.get(
      "https://codeberg.org/just_a_husk/uBlockOrigin-AI-Blocklist/raw/branch/main/noai_hosts.txt",
      { timeout: 30000 }
    );
  } catch (_) {
    test.skip(true, "blocklist host unreachable");
  }
  expect(res.status()).toBe(200);
  const text = await res.text();
  const hosts = text.split("\n").filter((l) => /^0\.0\.0\.0\s+\S+/.test(l));
  expect(hosts.length).toBeGreaterThan(1000);
});
