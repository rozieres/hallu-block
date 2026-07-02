/* Hallu Block — service worker (MV3, ES module).
 *
 * Importing the UMD polyfill for its side-effect sets globalThis.browser (in a
 * module worker there is no CommonJS `exports`, so the polyfill takes its
 * global-assignment branch). We still fall back to `chrome` defensively. */
import "../lib/browser-polyfill.js";
const browser = globalThis.browser ?? globalThis.chrome;

// Default state of every switch (mirrors the validated popup design).
const DEFAULT_TOGGLES = {
  "google-ai-overview": true,
  "anti-slop": true,
  "ddg-assist": true,
  "youtube-ask": true,
  "amazon-rufus": true,
  "bing-copilot": true,
  "show-blocks": true,
  udm14: false,
};

// ---- Rules: bundled snapshot -------------------------------------------------
// The engine's masking rules ship bundled with the extension. There is NO remote
// fetch of any kind: nothing ever leaves the browser (see docs/privacy.md). When
// a target site changes its DOM, we fix the selectors in src/rules/rules.json and
// ship a normal Chrome Web Store update — the deliberate price of a strictly-
// local privacy promise. The only fetch here reads a file packaged INSIDE the
// extension via runtime.getURL(), which never touches the network.
let rulesCache = null;
async function getRules() {
  if (rulesCache) return rulesCache;
  const res = await fetch(browser.runtime.getURL("src/rules/rules.json"));
  rulesCache = await res.json();
  return rulesCache;
}

async function getState() {
  const [{ toggles }, rules] = await Promise.all([
    browser.storage.local.get("toggles"),
    getRules(),
  ]);
  return { rules, toggles: { ...DEFAULT_TOGGLES, ...(toggles || {}) } };
}

// ---- Anti-slop blocklist (family C) ------------------------------------------
// A community CC0 hosts file (`0.0.0.0 domain` per line, # comments) shipped as a
// bundled snapshot — no remote refresh (same strictly-local promise as rules.json
// above; refreshed via Chrome Web Store updates). Parsed once,
// then handed to the content script on demand — the raw ~4k-line file never
// crosses into the page, only the domain array does. Kept out of getState so
// pages with anti-slop off (or non-search pages) don't pay for it.
let slopCache = null;
// A bare-hostname matcher: dot-separated labels + an alpha TLD, nothing else.
// Upstream lines occasionally carry a path ("youtube.com/@Foo"), a port, or junk;
// those can never equal a location.hostname, so we drop them rather than ship
// noise to the content script. (Linear regex — no backtracking on long input.)
const HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
async function getSlopDomains() {
  if (slopCache) return slopCache;
  const res = await fetch(browser.runtime.getURL("src/rules/slop/noai_hosts.txt"));
  const text = await res.text();
  const seen = new Set(); // normalize + dedupe
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s || s[0] === "#") continue;
    const parts = s.split(/\s+/);
    // hosts-file format is "0.0.0.0 <host>"; tolerate a bare host too.
    const host = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase().replace(/^\*\./, "");
    if (HOST_RE.test(host)) seen.add(host);
  }
  slopCache = [...seen];
  return slopCache;
}

// ---- declarativeNetRequest: family-A URL rewrites ----------------------------
// Static rulesets (declared in the manifest) that rewrite a URL rather than
// touch the DOM — incassable when the site changes its markup. Each is driven
// by one toggle: udm14 = "Mode Google classique" (default off, opt-in via the
// radical button); ddg = DuckDuckGo's noai=1 (default on). We only flip them.
const DNR_RULESETS = { udm14: "udm14", "ddg-assist": "ddg" }; // toggle key -> ruleset id

async function setRuleset(rulesetId, enabled) {
  const dnr = browser.declarativeNetRequest;
  if (!dnr || !dnr.updateEnabledRulesets) return; // Firefox/older builds: no-op
  await dnr.updateEnabledRulesets(
    enabled ? { enableRulesetIds: [rulesetId] } : { disableRulesetIds: [rulesetId] }
  );
}

// Bring every DNR ruleset in line with its persisted toggle. Chrome remembers
// the enabled set across sessions, so this is belt-and-suspenders against a
// storage/DNR desync (e.g. storage cleared, or a toggle flipped while asleep).
async function syncDnr() {
  const { toggles } = await browser.storage.local.get("toggles");
  const t = { ...DEFAULT_TOGGLES, ...(toggles || {}) };
  for (const [key, ruleset] of Object.entries(DNR_RULESETS)) {
    await setRuleset(ruleset, !!t[key]).catch(() => {});
  }
}

// ---- Local counter -----------------------------------------------------------
// ISO-8601 week key (e.g. "2026-W27"). Weekly bucket resets automatically when
// the key changes; nothing ever leaves the browser.
function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / 6048e5);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// Serialize writes so concurrent bumps (MutationObserver fires fast) don't race.
let writeChain = Promise.resolve();
function bump() {
  writeChain = writeChain.then(doBump).catch(() => {});
  return writeChain;
}
async function doBump() {
  const { counter } = await browser.storage.local.get("counter");
  const iso = isoWeekKey(new Date());
  const c = counter && counter.week ? counter : { week: { iso, count: 0 }, total: 0 };
  if (c.week.iso !== iso) c.week = { iso, count: 0 };
  c.week.count += 1;
  c.total = (c.total || 0) + 1;
  await browser.storage.local.set({ counter: c });
}

// ---- Messaging ---------------------------------------------------------------
// webextension-polyfill: returning a Promise from the listener sends its
// resolved value back as the response.
browser.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "hb-get-state") return getState();
  if (msg.type === "hb-get-slop") return getSlopDomains().then((domains) => ({ domains }));
  if (msg.type === "hb-bump") {
    bump();
    return Promise.resolve({ ok: true });
  }
  // The popup persists the toggle itself; this only drives the DNR ruleset.
  if (msg.type === "hb-set-dnr") {
    const ruleset = DNR_RULESETS[msg.feature];
    if (!ruleset) return Promise.resolve({ ok: false, error: "unknown ruleset" });
    return setRuleset(ruleset, !!msg.value)
      .then(() => ({ ok: true }))
      .catch((e) => ({ ok: false, error: String(e) }));
  }
});

// ---- Install / startup -------------------------------------------------------
browser.runtime.onInstalled.addListener(async () => {
  const { toggles } = await browser.storage.local.get("toggles");
  if (!toggles) await browser.storage.local.set({ toggles: DEFAULT_TOGGLES });
  await syncDnr();
});

// Reconcile DNR rulesets with their persisted toggles on each worker spin-up.
browser.runtime.onStartup?.addListener(() => {
  syncDnr();
});
