#!/usr/bin/env node
// Hallu Block — release check (Chrome-first, always green when the tree is sound).
//
// `web-ext lint` is a *Firefox* validator: it rejects our MV3 background.
// service_worker by design, so it can never be a green gate for a Chrome-first
// build (see npm run lint:webext for that informational check). This script is
// the real gate instead — a fast, dependency-free set of invariants:
//   1. every JSON we ship parses;
//   2. every file the manifest references exists;
//   3. the FR and EN locales define the same message keys;
//   4. the popup's DEFAULT_TOGGLES match the service worker's (they must, or a
//      fresh profile shows a different state than the engine applies);
//   5. the "100% local" privacy promise holds: no network permission, no remote
//      host, no raw network primitive (fetch to a non-getURL arg, XHR, WebSocket,
//      EventSource, sendBeacon) in ANY authored script, and a CSP that pins
//      connect-src to 'self';
//   6. the DERIVED Firefox manifest (scripts/manifest.mjs) is sound: no MV3
//      service_worker, a background.scripts entry that exists, a gecko id, and
//      the same strictly-local host_permissions.
//
// Exit 0 = release-safe. Exit 1 = a problem a reviewer or user would hit.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toFirefox } from "./manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const errors = [];
const fail = (msg) => errors.push(msg);

// 1 — JSON validity for everything that ships as data.
const jsonFiles = [
  "manifest.json",
  "src/rules/rules.json",
  "src/rules/dnr/udm14.json",
  "src/rules/dnr/ddg.json",
  ...fs
    .readdirSync(path.join(ROOT, "_locales"))
    .map((loc) => `_locales/${loc}/messages.json`),
];
const parsed = {};
for (const f of jsonFiles) {
  try {
    parsed[f] = JSON.parse(read(f));
  } catch (e) {
    fail(`invalid JSON: ${f} — ${e.message}`);
  }
}

const manifest = parsed["manifest.json"];

// 2 — every file the manifest points at must exist.
if (manifest) {
  const referenced = new Set();
  const add = (p) => p && referenced.add(p);
  Object.values(manifest.icons || {}).forEach(add);
  add(manifest.background?.service_worker);
  add(manifest.action?.default_popup);
  Object.values(manifest.action?.default_icon || {}).forEach(add);
  for (const cs of manifest.content_scripts || []) {
    (cs.css || []).forEach(add);
    (cs.js || []).forEach(add);
  }
  for (const r of manifest.declarative_net_request?.rule_resources || []) add(r.path);
  for (const p of referenced) {
    if (!exists(p)) fail(`manifest references a missing file: ${p}`);
  }
  if (manifest.default_locale && !exists(`_locales/${manifest.default_locale}/messages.json`)) {
    fail(`default_locale "${manifest.default_locale}" has no _locales messages.json`);
  }
}

// 3 — locale key parity (a missing translation ships a blank string to users).
const fr = parsed["_locales/fr/messages.json"];
const en = parsed["_locales/en/messages.json"];
if (fr && en) {
  const frKeys = new Set(Object.keys(fr));
  const enKeys = new Set(Object.keys(en));
  for (const k of frKeys) if (!enKeys.has(k)) fail(`key "${k}" is in fr but missing in en`);
  for (const k of enKeys) if (!frKeys.has(k)) fail(`key "${k}" is in en but missing in fr`);
}

// Pull the DEFAULT_TOGGLES object literal out of a source file as key→bool pairs.
function extractToggles(file) {
  const src = read(file);
  const start = src.indexOf("DEFAULT_TOGGLES");
  const open = src.indexOf("{", start);
  const close = src.indexOf("};", open);
  if (start < 0 || open < 0 || close < 0) return null;
  const body = src.slice(open, close);
  const out = {};
  for (const m of body.matchAll(/["']?([\w-]+)["']?\s*:\s*(true|false)/g)) {
    out[m[1]] = m[2] === "true";
  }
  return out;
}

// 4 — the two DEFAULT_TOGGLES declarations must be byte-for-byte equivalent.
const swToggles = extractToggles("src/background/service-worker.js");
const popupToggles = extractToggles("src/popup/popup.js");
if (!swToggles || !popupToggles) {
  fail("could not locate DEFAULT_TOGGLES in the service worker and/or popup");
} else {
  const a = JSON.stringify(swToggles, Object.keys(swToggles).sort());
  const b = JSON.stringify(popupToggles, Object.keys(popupToggles).sort());
  if (a !== b) {
    fail(
      "DEFAULT_TOGGLES differ between service worker and popup:\n" +
        `  sw:    ${JSON.stringify(swToggles)}\n  popup: ${JSON.stringify(popupToggles)}`
    );
  }
}

// 5 — the "100% local" privacy promise.
if (manifest) {
  if ((manifest.permissions || []).includes("alarms")) {
    fail('permission "alarms" present — only the removed remote-refresh used it');
  }
  for (const h of manifest.host_permissions || []) {
    if (/github|githubusercontent|amazonaws|cloudfront/i.test(h)) {
      fail(`host_permission "${h}" is not a target site — the build must stay strictly local`);
    }
  }
}
// Scan EVERY script we author (not just the SW): a fetch/XHR/WebSocket/beacon in
// the content script or popup leaks just as badly. The vendored polyfill is a
// vetted third-party file and is excluded. Two rules:
//   a. no raw network primitive at all;
//   b. every fetch() must read a packaged file via runtime.getURL() — nothing else.
const scriptFiles = [
  "src/background/service-worker.js",
  "src/content/engine.js",
  "src/popup/popup.js",
];
const NET_PRIMITIVE = /\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/;
for (const f of scriptFiles) {
  const src = read(f);
  const prim = NET_PRIMITIVE.exec(src);
  if (prim) fail(`${f} uses network primitive "${prim[1]}" — the build must stay strictly local`);
  if (src.includes("rozieres.github.io")) fail(`${f} still references the old remote rules host`);
  for (const call of src.matchAll(/fetch\s*\(\s*([^)]*)/g)) {
    const arg = call[1].trim();
    if (!/^(?:browser|chrome|globalThis|self)?\.?runtime\.getURL\b/.test(arg)) {
      fail(`${f} calls fetch() with a non-getURL argument (${arg.slice(0, 40)}…) — strictly local`);
    }
  }
}

// Platform-level backstop: a CSP that pins connect-src to 'self' means the SW and
// popup physically cannot open a remote connection, even if code review misses it.
const csp = manifest?.content_security_policy?.extension_pages || "";
if (!/connect-src\s+'self'/.test(csp)) {
  fail("manifest content_security_policy.extension_pages must pin connect-src to 'self'");
}

// 6 — the DERIVED Firefox manifest must be sound. The Chrome manifest above is
// the single source of truth; `npm run build:firefox` ships whatever toFirefox()
// produces, so validate it here rather than let a broken derivation reach AMO.
if (manifest) {
  let ff;
  try {
    ff = toFirefox(manifest);
  } catch (e) {
    fail(`Firefox manifest derivation threw: ${e.message}`);
  }
  if (ff) {
    // Firefox has no MV3 service worker: the derivation must swap it for an
    // event-page `scripts` array pointing at the (existing) worker file.
    if (ff.background?.service_worker) {
      fail("derived Firefox manifest still has background.service_worker (Firefox rejects it)");
    }
    const scripts = ff.background?.scripts;
    if (!Array.isArray(scripts) || scripts.length === 0) {
      fail("derived Firefox manifest has no background.scripts");
    } else {
      for (const s of scripts) if (!exists(s)) fail(`Firefox background.scripts references a missing file: ${s}`);
    }
    // AMO needs a stable add-on id; the gecko block must survive derivation.
    if (!ff.browser_specific_settings?.gecko?.id) {
      fail("derived Firefox manifest is missing browser_specific_settings.gecko.id");
    }
    // Chrome-only hint must not leak into the Firefox build.
    if (ff.minimum_chrome_version) {
      fail("derived Firefox manifest still carries minimum_chrome_version");
    }
    // The strictly-local promise must hold for Firefox too (host_permissions are
    // carried over verbatim, but assert rather than assume).
    for (const h of ff.host_permissions || []) {
      if (/github|githubusercontent|amazonaws|cloudfront/i.test(h)) {
        fail(`Firefox host_permission "${h}" is not a target site — the build must stay strictly local`);
      }
    }
  }
}

// ---- report ------------------------------------------------------------------
if (errors.length) {
  console.error(`✗ release check failed (${errors.length}):\n`);
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}
console.log("✓ release check passed — JSON valid, files present, locales in sync, 100% local.");
