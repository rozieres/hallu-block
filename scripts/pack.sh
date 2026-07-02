#!/usr/bin/env bash
#
# Package the Hallu Block extension — clean by construction.
#
#   scripts/pack.sh build   (default) → produce a store-ready zip
#   scripts/pack.sh lint              → run web-ext lint on exactly what ships
#                                       (npm run lint:webext — INFORMATIONAL:
#                                       web-ext is a Firefox validator and rejects
#                                       our MV3 service_worker by design, so this
#                                       exits 1. The green gate is `npm run lint`
#                                       → scripts/check.mjs.)
#
# ALLOWLIST: only the three things that actually ship — manifest.json,
# _locales/, src/ — are copied into a staging dir, and we package/lint THAT.
# Anything else in the repo (tests/, _reflexion/, docs/, scripts/, node_modules/,
# editor junk…) simply never enters the artifact, so no future dev file can leak.
# A denylist (--ignore-files) failed before: web-ext still emitted an empty
# _reflexion/ dir entry, and Chrome rejects any "_"-prefixed name except the
# reserved _locales / _metadata.
set -euo pipefail

MODE="${1:-build}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$ROOT/dist/pkg"          # dist/ is gitignored
OUT="$ROOT/web-ext-artifacts"   # gitignored

rm -rf "$STAGE"
mkdir -p "$STAGE"
trap 'rm -rf "$STAGE"' EXIT

# The complete shippable set. _locales is a Chrome-reserved name that IS allowed;
# every other "_"-prefixed entry (e.g. _reflexion) is intentionally excluded.
cp "$ROOT/manifest.json" "$STAGE/"
cp -r "$ROOT/_locales" "$STAGE/"
cp -r "$ROOT/src" "$STAGE/"

# Defensive prune of anything non-shippable that could sit under src/.
find "$STAGE" \( -name '*.map' -o -name '.DS_Store' -o -name 'Thumbs.db' \) -delete

if [ "$MODE" = "lint" ]; then
  # Informational only (npm run lint:webext). web-ext is the Firefox validator and
  # exits 1 on the known MV3 background.service_worker error — expected for a
  # Chrome-first build. The green release gate is `npm run lint` (check.mjs).
  npx web-ext lint --source-dir="$STAGE" --no-config-discovery
else
  mkdir -p "$OUT"
  npx web-ext build --source-dir="$STAGE" --artifacts-dir="$OUT" --overwrite-dest --no-config-discovery
  echo "✓ Clean package written to $OUT"
fi
