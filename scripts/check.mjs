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
//      host, no external fetch in the service worker.
//
// Exit 0 = release-safe. Exit 1 = a problem a reviewer or user would hit.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const sw = read("src/background/service-worker.js");
if (/fetch\(\s*["'`]https?:/i.test(sw)) fail("service worker fetches a literal http(s) URL");
if (sw.includes("rozieres.github.io")) fail("service worker still references the old rules host");

// ---- report ------------------------------------------------------------------
if (errors.length) {
  console.error(`✗ release check failed (${errors.length}):\n`);
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}
console.log("✓ release check passed — JSON valid, files present, locales in sync, 100% local.");
