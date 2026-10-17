#!/usr/bin/env bash
# Build the ResumeForge macOS desktop app (.dmg + .app directory).
#
# macOS counterpart of scripts/Build-Desktop.ps1. The PowerShell script is
# Windows-only by construction ($env:SystemRoot, backslash paths, pwsh), so this
# script mirrors its contract with POSIX tools instead:
#   1. assemble desktop/payload from the working tree's HEAD via `git archive`
#      (backend + launchers + scripts + branding), plus the built frontend;
#   2. let electron-builder produce the .dmg (and the unpacked .app directory).
#
# Usage (from anywhere):
#   bash scripts/build-desktop-mac.sh            # dmg + dir (default)
#   bash scripts/build-desktop-mac.sh --dir      # dir only (fast smoke build)
#   bash scripts/build-desktop-mac.sh --help
#
# Prerequisites:
#   - macOS with Xcode Command Line Tools:  xcode-select --install
#   - Node.js 20.19+ and npm
#   - frontend deps installed once:  (cd frontend && npm ci)
#   - desktop deps installed once:   (cd desktop && ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install)
#
# Notes:
#   - The macOS payload intentionally carries NO python-runtime.zip. The shell
#     falls back to the shipped launcher (start.command), which provisions the
#     Python environment on first launch — by design, matching Build-Desktop.ps1.
#   - The build is UNSIGNED: without an Apple Developer certificate, Gatekeeper
#     warns on first open (right-click > Open). Signing/notarization needs a real
#     certificate and is out of scope here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/desktop"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
PAYLOAD_DIR="$DESKTOP_DIR/payload"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

TARGET="dmg"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) TARGET="dir" ;;
    -h | --help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1 (use --help)" >&2
      exit 2
      ;;
  esac
  shift
done

# --- preflight ---------------------------------------------------------
[ "$(uname -s)" = "Darwin" ] || fail "This script must run on macOS (dmg creation needs hdiutil)."
command -v git >/dev/null 2>&1 || fail "git not found (install the Xcode Command Line Tools: xcode-select --install)."
command -v node >/dev/null 2>&1 || fail "Node.js 20.19+ not found."
command -v npm >/dev/null 2>&1 || fail "npm not found."

[ -f "$FRONTEND_DIR/dist/index.html" ] ||
  fail "frontend/dist/index.html is missing - build it first: (cd frontend && npm ci && npm run build)"
[ -d "$DESKTOP_DIR/node_modules/electron" ] ||
  fail "desktop/node_modules is missing - install it first: (cd desktop && ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install)"

# electron-builder downloads its own helper binaries on first use; the mirror
# keeps that from stalling on slow international links. Override by exporting
# ELECTRON_MIRROR yourself before running the script.
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"

# The payload is assembled from HEAD via git archive, so uncommitted changes do
# NOT ship. Warn loudly instead of failing: local smoke builds are legitimate.
if [ -n "$(git -C "$PROJECT_ROOT" status --porcelain)" ]; then
  echo "WARNING: working tree has uncommitted changes; the payload will only contain HEAD (git archive)." >&2
fi

VERSION="$(node -p "require('$DESKTOP_DIR/package.json').version")"

# The frontend assets must come from the same version as the shell, otherwise the
# app serves stale UI. version.json is written by the frontend build (RF-09).
DIST_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$FRONTEND_DIR/dist/version.json" 2>/dev/null || true)"
if [ -n "$DIST_VERSION" ] && [ "$DIST_VERSION" != "$VERSION" ]; then
  fail "frontend/dist reports version '$DIST_VERSION' but desktop/package.json is '$VERSION' - rebuild the frontend at this commit."
fi

echo "=== Assembling desktop/payload from HEAD (version $VERSION) ==="
if [ -d "$PAYLOAD_DIR" ]; then
  rm -rf "$PAYLOAD_DIR"
fi
mkdir -p "$PAYLOAD_DIR"

ARCHIVE_TAR="$PROJECT_ROOT/runtime/tmp-desktop-payload.tar"
mkdir -p "$(dirname "$ARCHIVE_TAR")"
# Tracked sources only, exactly like Build-Desktop.ps1: git archive keeps the
# payload free of venv/node_modules/caches.
for spec in backend scripts start.cmd start.command stop.cmd stop.command branding; do
  git -C "$PROJECT_ROOT" archive -o "$ARCHIVE_TAR" HEAD -- "$spec" || fail "git archive $spec failed"
  tar -xf "$ARCHIVE_TAR" -C "$PAYLOAD_DIR" || fail "tar extract $spec failed"
done
rm -f "$ARCHIVE_TAR"

mkdir -p "$PAYLOAD_DIR/frontend"
cp -R "$FRONTEND_DIR/dist" "$PAYLOAD_DIR/frontend/dist"
mkdir -p "$PAYLOAD_DIR/runtime/logs"

PAYLOAD_FILES="$(find "$PAYLOAD_DIR" -type f | wc -l | tr -d ' ')"
echo "Payload assembled: $PAYLOAD_FILES files"

# --- package -----------------------------------------------------------
BUILDER="$DESKTOP_DIR/node_modules/.bin/electron-builder"
[ -x "$BUILDER" ] || fail "electron-builder not found at $BUILDER - run npm install in desktop/ first."

echo "=== electron-builder --mac (target=$TARGET) ==="
pushd "$DESKTOP_DIR" >/dev/null
if [ "$TARGET" = "dir" ]; then
  "$BUILDER" --mac --dir --config electron-builder.yml
else
  "$BUILDER" --mac --config electron-builder.yml
fi
popd >/dev/null

echo "=== Build output ==="
ls -lh "$DESKTOP_DIR/out" 2>/dev/null || true

DMG="$(ls "$DESKTOP_DIR/out"/ResumeForge-"$VERSION"-*.dmg 2>/dev/null | head -1 || true)"
if [ -n "$DMG" ] && [ -f "$DMG" ]; then
  # sha256 sidecar in the same "<hex>  <name>" format the Windows installer
  # sidecar uses (ASCII, two spaces, no "*" prefix).
  (
    cd "$(dirname "$DMG")"
    shasum -a 256 "$(basename "$DMG")" >"$(basename "$DMG").sha256"
  )
  echo "dmg: $DMG"
  echo "sha256: $(cat "$DMG.sha256")"
  echo ""
  echo "Next: hdiutil attach \"$DMG\" to inspect, then launch ResumeForge.app."
  echo "The build is unsigned - first launch needs right-click > Open (Gatekeeper)."
else
  echo "WARNING: no .dmg artifact found under $DESKTOP_DIR/out" >&2
fi
