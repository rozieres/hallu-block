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
  if (msg.type === "hb-bump") {
    bump();
    return Promise.resolve({ ok: true });
  }
});

// ---- Install -----------------------------------------------------------------
browser.runtime.onInstalled.addListener(async () => {
  const { toggles } = await browser.storage.local.get("toggles");
  if (!toggles) await browser.storage.local.set({ toggles: DEFAULT_TOGGLES });
});
