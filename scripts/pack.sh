#!/usr/bin/env bash
#
# Package the Hallu Block extension — clean by construction, per browser target.
#
#   scripts/pack.sh build  [chrome|firefox]  (default) → store-ready zip
#   scripts/pack.sh lint   [chrome|firefox]           → web-ext lint on what ships
#   scripts/pack.sh stage  [chrome|firefox]           → leave a clean unpacked dir
#
# TARGET defaults to "chrome". The manifest is per-target: Chrome ships the root
# manifest.json verbatim; Firefox (and any future target) is DERIVED from it by
# scripts/manifest.mjs, so host_permissions / content_scripts / DNR / CSP have a
# single source of truth.
#
# ALLOWLIST: only the three things that actually ship — the (target) manifest,
# _locales/, src/ — are copied into a staging dir, and we package/lint/stage THAT.
# Anything else in the repo (tests/, _reflexion/, docs/, scripts/, node_modules/,
# editor junk…) simply never enters the artifact, so no future dev file can leak.
# A denylist (--ignore-files) failed before: web-ext still emitted an empty
# _reflexion/ dir entry, and Chrome rejects any "_"-prefixed name except the
# reserved _locales / _metadata.
#
# Notes per mode/target:
#  - `lint chrome` is INFORMATIONAL and exits 1 by design: web-ext is a Firefox
#    validator and rejects the MV3 background.service_worker. The green release
#    gate is `npm run lint` → scripts/check.mjs.
#  - `lint firefox` validates the DERIVED (service-worker-free) manifest and is
#    expected to pass — that is the Firefox gate.
#  - `stage` leaves the folder in place (it is NOT auto-deleted): use it as the
#    input to the Safari converter, or to load unpacked during development.
set -euo pipefail

MODE="${1:-build}"     # build | lint | stage
TARGET="${2:-chrome}"  # chrome | firefox
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$MODE" in build|lint|stage) ;; *) echo "unknown mode: $MODE (build|lint|stage)" >&2; exit 2 ;; esac
case "$TARGET" in chrome|firefox) ;; *) echo "unknown target: $TARGET (chrome|firefox)" >&2; exit 2 ;; esac

OUT="$ROOT/web-ext-artifacts"   # gitignored

# `stage` must persist (it is a deliverable: converter input / unpacked load).
# build/lint use an ephemeral staging dir we clean up on exit.
if [ "$MODE" = "stage" ]; then
  STAGE="$ROOT/dist/$TARGET"          # dist/ is gitignored
else
  STAGE="$ROOT/dist/pkg-$TARGET"      # dist/ is gitignored
fi

rm -rf "$STAGE"
mkdir -p "$STAGE"
[ "$MODE" != "stage" ] && trap 'rm -rf "$STAGE"' EXIT

# The complete shippable set. _locales is a Chrome-reserved name that IS allowed;
# every other "_"-prefixed entry (e.g. _reflexion) is intentionally excluded.
cp -r "$ROOT/_locales" "$STAGE/"
cp -r "$ROOT/src" "$STAGE/"

# The manifest is the only per-target file. Chrome = canonical verbatim; anything
# else is derived from it (single source of truth — see scripts/manifest.mjs).
if [ "$TARGET" = "chrome" ]; then
  cp "$ROOT/manifest.json" "$STAGE/manifest.json"
else
  node "$ROOT/scripts/manifest.mjs" "$TARGET" "$STAGE/manifest.json"
fi

# Defensive prune of anything non-shippable that could sit under src/.
find "$STAGE" \( -name '*.map' -o -name '.DS_Store' -o -name 'Thumbs.db' \) -delete

case "$MODE" in
  stage)
    echo "✓ Clean $TARGET staging at $STAGE"
    echo "    Chrome/Edge — chrome://extensions → Load unpacked → this folder"
    echo "    Firefox     — about:debugging → Load Temporary Add-on → $STAGE/manifest.json"
    echo "    Safari      — xcrun safari-web-extension-converter \"$STAGE\"  (macOS + Xcode)"
    ;;
  lint)
    # chrome: informational (fails by design on service_worker).
    # firefox: the real Firefox gate (derived manifest has no service_worker).
    npx web-ext lint --source-dir="$STAGE" --no-config-discovery
    ;;
  build)
    mkdir -p "$OUT"
    npx web-ext build --source-dir="$STAGE" --artifacts-dir="$OUT" \
      --overwrite-dest --no-config-discovery \
      --filename="hallu-block-${TARGET}-{version}.zip"
    echo "✓ Clean $TARGET package written to $OUT"
    ;;
esac
