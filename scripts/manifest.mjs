#!/usr/bin/env node
// Hallu Block — per-browser manifest derivation.
//
// `manifest.json` at the repo root is the CHROME canonical: Chrome loads it
// directly for unpacked dev, the store build ships it verbatim, and the test
// suite reads it in place. Every other target is DERIVED from it here, so there
// is a single source of truth for host_permissions, content_scripts, the DNR
// rulesets and the CSP — the drift `scripts/check.mjs` exists to prevent.
//
// Usage (CLI):  node scripts/manifest.mjs firefox <out.json>
// Usage (lib):  import { toFirefox } from "./manifest.mjs"
//
// Kept dependency-free (Node built-ins only), like check.mjs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Read + parse the Chrome canonical manifest. */
export function readCanonical() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
}

/**
 * Derive the Firefox manifest from the Chrome canonical.
 *
 * The only substantive change is the background entry point: Firefox does not
 * support MV3 `background.service_worker` (Bugzilla 1573659) and runs an event
 * page from `background.scripts` instead. Because our worker is authored as an
 * ES module (`import "../lib/browser-polyfill.js"`), we keep `type: "module"`,
 * supported for background scripts since Firefox 112 — comfortably below our
 * gecko `strict_min_version` of 128 (chosen for declarativeNetRequest, on by
 * default from Firefox 128). Everything else — host_permissions, content_scripts,
 * the DNR rulesets, the CSP, the gecko block — is carried over untouched.
 */
export function toFirefox(canonical) {
  const m = structuredClone(canonical);

  const swPath = m.background?.service_worker;
  if (!swPath) throw new Error("canonical manifest has no background.service_worker to derive from");
  m.background = {
    scripts: [swPath],
    ...(m.background.type ? { type: m.background.type } : {}),
  };

  // Chrome-only hint; harmless but meaningless to Firefox — drop it so the
  // Firefox manifest carries nothing it doesn't honour.
  delete m.minimum_chrome_version;

  return m;
}

const TARGETS = { firefox: toFirefox };

// ---- CLI ---------------------------------------------------------------------
// Only run when invoked directly (not when imported by check.mjs).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , target, outPath] = process.argv;
  const derive = TARGETS[target];
  if (!derive) {
    console.error(`usage: node scripts/manifest.mjs <${Object.keys(TARGETS).join("|")}> <out.json>`);
    process.exit(2);
  }
  if (!outPath) {
    console.error("missing output path");
    process.exit(2);
  }
  const out = derive(readCanonical());
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`✓ wrote ${target} manifest → ${outPath}`);
}
