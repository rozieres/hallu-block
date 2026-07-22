"use strict";

// Hallu Block — popup wiring + DNR config tests (deterministic, run everywhere).
//
// Loads the REAL popup.html + popup.js into real Chromium with a stubbed
// window.browser (storage + i18n + messaging) that records every write, exactly
// the way engine.spec stubs the WebExtension APIs. This proves the switches
// read/write storage.local.toggles and that the radical button drives the udm14
// ruleset — without packaging the extension (newer Chrome blocks CLI loading).
//
// The udm=14 redirect itself is network-level (declarativeNetRequest) and can't
// be exercised by DOM injection; we validate the ruleset's SHAPE here and verify
// the live redirect manually in a real profile (see PR notes).

const { test, expect, chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const FR = JSON.parse(read("_locales/fr/messages.json"));
const MESSAGES = Object.fromEntries(Object.entries(FR).map(([k, v]) => [k, v.message]));
const POPUP_HTML = read("src/popup/popup.html");
const POPUP_JS = read("src/popup/popup.js");
const POPUP_CSS = read("src/popup/popup.css");

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

// Mount popup.html (minus its real <script>/<link> tags), stub the WebExtension
// APIs, then inject popup.js so init() runs against the stub.
async function mountPopup({ toggles, vendor } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const html = POPUP_HTML
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*>/gi, "");
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: POPUP_CSS });

  await page.evaluate(
    ({ messages, toggles, vendor }) => {
      window.__sets = [];
      window.__msgs = [];
      // popup.js reads navigator.vendor at load to single out Safari; override it
      // here (before the script tag is injected) so we can exercise that path.
      if (vendor != null) Object.defineProperty(navigator, "vendor", { value: vendor, configurable: true });
      const store = {};
      if (toggles) store.toggles = toggles;
      window.browser = {
        i18n: {
          getMessage: (k, subs) => {
            let m = messages[k] || "";
            if (subs != null) {
              const a = Array.isArray(subs) ? subs : [subs];
              m = m.replace(/\$count\$/gi, a[0] ?? "").replace(/\$1/g, a[0] ?? "");
            }
            return m;
          },
          getUILanguage: () => "fr-FR",
        },
        storage: {
          local: {
            get: async (key) => {
              if (typeof key === "string") return { [key]: store[key] };
              if (Array.isArray(key)) return Object.fromEntries(key.map((k) => [k, store[k]]));
              return { ...store };
            },
            set: async (obj) => {
              // Deep-snapshot: popup.js writes the SAME toggles object each time,
              // so we must capture its value at write time, not the live ref.
              window.__sets.push(JSON.parse(JSON.stringify(obj)));
              Object.assign(store, obj);
            },
          },
        },
        runtime: {
          sendMessage: async (m) => {
            window.__msgs.push(m);
            return { ok: true };
          },
        },
      };
    },
    { messages: MESSAGES, toggles, vendor }
  );

  await page.addScriptTag({ content: POPUP_JS });
  return { errors };
}

// wireToggles() sets cursor:pointer on every switch row; once that lands, init()
// has finished and all click handlers (rows + radical button) are attached.
const ON = /\bon\b/;
const ready = () =>
  expect(page.locator('li[data-feature="google-ai-overview"]')).toHaveCSS("cursor", "pointer");
const sets = () => page.evaluate(() => window.__sets);
const msgs = () => page.evaluate(() => window.__msgs);

test("switches reflect stored toggles on open", async () => {
  const { errors } = await mountPopup({
    toggles: { "google-ai-overview": false, "bing-copilot": true },
  });

  const overview = page.locator('li[data-feature="google-ai-overview"]');
  await expect(overview).not.toHaveClass(ON);
  await expect(overview.locator(".check")).toHaveText("[ ]");
  // Accessibility: each row is a real switch carrying its state in ARIA.
  await expect(overview).toHaveAttribute("role", "switch");
  await expect(overview).toHaveAttribute("aria-checked", "false");

  const bing = page.locator('li[data-feature="bing-copilot"]');
  await expect(bing).toHaveClass(ON);
  await expect(bing.locator(".check")).toHaveText("[█]");
  await expect(bing).toHaveAttribute("aria-checked", "true");

  expect(errors).toEqual([]);
});

test("switches are keyboard-operable (Space flips role=switch state)", async () => {
  await mountPopup();
  await ready();

  const overview = page.locator('li[data-feature="google-ai-overview"]');
  await expect(overview).toHaveAttribute("aria-checked", "true");

  await overview.focus();
  await page.keyboard.press("Space");

  await expect(overview).toHaveAttribute("aria-checked", "false");
  await expect(overview).not.toHaveClass(ON);
  const written = await sets();
  expect(written[written.length - 1].toggles["google-ai-overview"]).toBe(false);
});

test("clicking a switch flips it visually and persists to storage", async () => {
  await mountPopup(); // empty storage → service-worker defaults (overview on)
  await ready();

  const overview = page.locator('li[data-feature="google-ai-overview"]');
  await expect(overview).toHaveClass(ON);

  await overview.click();

  await expect(overview).not.toHaveClass(ON);
  await expect(overview.locator(".check")).toHaveText("[ ]");

  const written = await sets();
  expect(written.length).toBeGreaterThanOrEqual(1);
  expect(written[written.length - 1].toggles["google-ai-overview"]).toBe(false);
});

test("clicking the community-list link does NOT flip the anti-slop switch", async () => {
  await mountPopup();
  await ready();

  const slop = page.locator('li[data-feature="anti-slop"]');
  await expect(slop).toHaveClass(ON);

  // Neutralize the external navigation, then click the embedded link.
  await page.evaluate(() => {
    document
      .querySelector('li[data-feature="anti-slop"] a')
      .addEventListener("click", (e) => e.preventDefault());
  });
  await slop.locator("a").click();

  await expect(slop).toHaveClass(ON); // unchanged
  expect(await sets()).toEqual([]); // nothing persisted
});

test("keyboard: activating the community-list link does NOT flip the anti-slop switch", async () => {
  await mountPopup();
  await ready();

  const slop = page.locator('li[data-feature="anti-slop"]');
  await expect(slop).toHaveAttribute("aria-checked", "true");

  // Neutralize the external navigation, focus the embedded link, and press Enter
  // exactly as a keyboard user following it would. The keydown must NOT bubble up
  // and flip the switch — the row's exception has to hold at the keyboard too.
  await page.evaluate(() => {
    document
      .querySelector('li[data-feature="anti-slop"] a')
      .addEventListener("click", (e) => e.preventDefault());
  });
  await page.locator('li[data-feature="anti-slop"] a').focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");

  await expect(slop).toHaveAttribute("aria-checked", "true"); // unchanged
  await expect(slop).toHaveClass(ON);
  expect(await sets()).toEqual([]); // nothing persisted
});

test("radical button toggles udm=14, persists it, and messages the worker", async () => {
  await mountPopup();
  await ready();

  const btn = page.locator('button[data-feature="udm14"]');
  await expect(btn).not.toHaveClass(ON);
  await expect(btn).toHaveAttribute("aria-pressed", "false");

  await btn.click();

  await expect(btn).toHaveClass(ON);
  await expect(btn).toHaveAttribute("aria-pressed", "true");

  const written = await sets();
  expect(written[written.length - 1].toggles.udm14).toBe(true);
  expect(await msgs()).toContainEqual({ type: "hb-set-dnr", feature: "udm14", value: true });
});

test("DuckDuckGo switch persists AND drives its DNR ruleset via the worker", async () => {
  await mountPopup(); // defaults: ddg-assist on
  await ready();

  const ddg = page.locator('li[data-feature="ddg-assist"]');
  await expect(ddg).toHaveClass(ON);

  await ddg.click(); // turn it off

  await expect(ddg).not.toHaveClass(ON);
  const written = await sets();
  expect(written[written.length - 1].toggles["ddg-assist"]).toBe(false);
  // A list switch that is DNR-backed must also flip the ruleset.
  expect(await msgs()).toContainEqual({ type: "hb-set-dnr", feature: "ddg-assist", value: false });
});

test("a non-DNR switch does NOT message the worker", async () => {
  await mountPopup();
  await ready();

  await page.locator('li[data-feature="youtube-ask"]').click();
  expect(await msgs()).toEqual([]); // only storage was written, no ruleset call
});

// Safari can't run the DNR-redirect features reliably (see docs/safari.md), so the
// popup hides them there — but nowhere else.
test("Safari: the two DNR-redirect controls (udm=14 + DuckDuckGo) are hidden", async () => {
  const { errors } = await mountPopup({ vendor: "Apple Computer, Inc." });
  await ready();

  await expect(page.locator(".radical")).toBeHidden(); // udm=14 block
  await expect(page.locator('li[data-feature="ddg-assist"]')).toBeHidden();

  // DOM-masking features are unaffected and stay visible.
  await expect(page.locator('li[data-feature="google-ai-overview"]')).toBeVisible();
  await expect(page.locator('li[data-feature="bing-copilot"]')).toBeVisible();
  await expect(page.locator('li[data-feature="youtube-ask"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("non-Safari (Chrome vendor): those DNR controls remain visible", async () => {
  await mountPopup({ vendor: "Google Inc." });
  await ready();

  await expect(page.locator(".radical")).toBeVisible();
  await expect(page.locator('li[data-feature="ddg-assist"]')).toBeVisible();
});

// Both family-A rulesets: valid, loop-safe shape + correctly registered.
const REDIRECT_RULESETS = [
  { file: "src/rules/dnr/udm14.json", id: "udm14", param: { key: "udm", value: "14" }, enabled: false },
  { file: "src/rules/dnr/ddg.json", id: "ddg", param: { key: "noai", value: "1" }, enabled: true },
];

for (const rs of REDIRECT_RULESETS) {
  test(`DNR ruleset ${rs.id} has a valid, loop-safe shape and is registered`, () => {
    const dnr = JSON.parse(read(rs.file));
    expect(Array.isArray(dnr)).toBe(true);
    expect(dnr).toHaveLength(1);

    const rule = dnr[0];
    expect(Number.isInteger(rule.id)).toBe(true);
    expect(rule.action.type).toBe("redirect");
    expect(rule.action.redirect.transform.queryTransform.addOrReplaceParams).toEqual([rs.param]);
    expect(rule.condition.resourceTypes).toContain("main_frame");
    expect(typeof rule.condition.regexFilter).toBe("string");
    // DNR's regex engine is RE2 — no lookarounds. Guard against an accidental (?=…).
    expect(rule.condition.regexFilter).not.toMatch(/\(\?/);

    // The manifest must register the ruleset with the expected default state.
    const mf = JSON.parse(read("manifest.json"));
    expect(mf.permissions).toContain("declarativeNetRequest");
    const reg = (mf.declarative_net_request.rule_resources || []).find((r) => r.id === rs.id);
    expect(reg).toBeTruthy();
    expect(reg.enabled).toBe(rs.enabled);
    expect(reg.path).toBe(rs.file);
  });
}

// ---- Privacy invariant: strictly local, no remote fetch ----------------------
test("manifest requests no network permission and no remote host", () => {
  const mf = JSON.parse(read("manifest.json"));
  // 100%-local promise: no alarms (only used for the old daily remote refresh),
  // and every host permission is a target SITE — never a rules-hosting origin.
  expect(mf.permissions).not.toContain("alarms");
  expect(mf.host_permissions.some((h) => /github|githubusercontent/i.test(h))).toBe(false);
});

test("no authored script uses a raw network primitive; every fetch is runtime.getURL", () => {
  const files = [
    "src/background/service-worker.js",
    "src/content/engine.js",
    "src/popup/popup.js",
  ];
  for (const f of files) {
    const src = read(f);
    expect(src, `${f} uses a raw network primitive`).not.toMatch(
      /\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/
    );
    expect(src, `${f} references the old remote rules host`).not.toContain("rozieres.github.io");
    // The only fetch() calls may read packaged files via runtime.getURL().
    for (const call of src.matchAll(/fetch\s*\(\s*([^)]*)/g)) {
      expect(call[1].trim(), `${f} fetch() must use runtime.getURL()`).toMatch(
        /^(?:browser|chrome|globalThis|self)?\.?runtime\.getURL\b/
      );
    }
  }
});

test("manifest CSP pins connect-src to 'self' (platform-level local guarantee)", () => {
  const mf = JSON.parse(read("manifest.json"));
  const csp = mf.content_security_policy?.extension_pages || "";
  expect(csp).toMatch(/connect-src\s+'self'/);
});
