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
  "google-ai-mode": true,
  "anti-slop": true,
  "ddg-assist": true,
  "youtube-ask": true,
  "amazon-rufus": true,
  "bing-copilot": false,
  "show-blocks": true,
  udm14: false,
};

// ---- Rules (bundled now; remote hot-fix override is a later milestone) -------
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
// A community CC0 hosts file (`0.0.0.0 domain` per line, # comments) bundled as a
// snapshot; remote refresh is a later milestone (like rules.json). Parsed once,
// then handed to the content script on demand — the raw ~4k-line file never
// crosses into the page, only the domain array does. Kept out of getState so
// pages with anti-slop off (or non-search pages) don't pay for it.
let slopCache = null;
async function getSlopDomains() {
  if (slopCache) return slopCache;
  const res = await fetch(browser.runtime.getURL("src/rules/slop/noai_hosts.txt"));
  const text = await res.text();
  const domains = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s || s[0] === "#") continue;
    const parts = s.split(/\s+/);
    const d = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase();
    if (d && d.includes(".")) domains.push(d);
  }
  slopCache = domains;
  return domains;
}

// ---- declarativeNetRequest: "Mode Google classique" (udm=14) -----------------
// Family A — a static ruleset (declared disabled in the manifest) that rewrites
// google.*/search URLs to add udm=14. We only flip it on/off; the rule itself
// lives in src/rules/dnr/udm14.json. Enabled state persists across restarts on
// its own, but we reconcile it to the stored toggle defensively (see below).
const DNR_UDM14 = "udm14";

async function setUdm14(enabled) {
  const dnr = browser.declarativeNetRequest;
  if (!dnr || !dnr.updateEnabledRulesets) return; // Firefox/older builds: no-op
  await dnr.updateEnabledRulesets(
    enabled ? { enableRulesetIds: [DNR_UDM14] } : { disableRulesetIds: [DNR_UDM14] }
  );
}

// Bring the live ruleset in line with the persisted toggle. Chrome remembers the
// enabled set across sessions, so this is belt-and-suspenders against a storage/
// DNR desync (e.g. storage cleared, or a toggle written while the SW was asleep).
async function syncUdm14() {
  const { toggles } = await browser.storage.local.get("toggles");
  await setUdm14(!!(toggles && toggles.udm14)).catch(() => {});
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
  // The popup persists the udm14 toggle itself; this only drives the ruleset.
  if (msg.type === "hb-set-udm14") {
    return setUdm14(!!msg.value)
      .then(() => ({ ok: true }))
      .catch((e) => ({ ok: false, error: String(e) }));
  }
});

// ---- Install / startup -------------------------------------------------------
browser.runtime.onInstalled.addListener(async () => {
  const { toggles } = await browser.storage.local.get("toggles");
  if (!toggles) await browser.storage.local.set({ toggles: DEFAULT_TOGGLES });
  await syncUdm14();
});

// Reconcile the DNR ruleset with the stored toggle each time the worker spins up.
browser.runtime.onStartup?.addListener(() => {
  syncUdm14();
});
