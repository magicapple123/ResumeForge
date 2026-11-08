#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Build the ResumeForge Linux desktop app (AppImage, x86_64 + aarch64).
#
# Linux counterpart of scripts/build-desktop-mac.sh, which is itself the POSIX
# twin of scripts/Build-Desktop.ps1 (the PowerShell one is Windows-only by
# construction: $env:SystemRoot, backslash paths, pwsh). The contract is the
# same on all three platforms:
#   1. assemble desktop/payload from the working tree's HEAD via `git archive`
#      (backend + launchers + scripts + branding), plus the built frontend;
#   2. let electron-builder produce the artifact(s).
#
# Usage (from anywhere):
#   bash scripts/build-desktop-linux.sh                # x64 + arm64 AppImages
#   bash scripts/build-desktop-linux.sh --arch x64     # one arch only
#   bash scripts/build-desktop-linux.sh --arch arm64
#   bash scripts/build-desktop-linux.sh --arch both    # explicit form of default
#   bash scripts/build-desktop-linux.sh --help
#
# Prerequisites:
#   - a Linux host (electron-builder links the AppImage runtime, a Linux binary,
#     so this cannot run on Windows or macOS)
#   - Node.js 20.19+ and npm, plus git and tar
#   - frontend deps installed once:  (cd frontend && npm ci)
#   - desktop deps installed once:   (cd desktop && npm install)
#
# Notes:
#   - The Linux payload intentionally carries NO python-runtime.zip, exactly like
#     the macOS one: the shell falls back to the shipped launcher (start.sh),
#     which provisions the Python environment on first launch.
#   - The build is UNSIGNED, like the Windows installer and the macOS dmg: no
#     signing key is wired in this repository.
#   - AppImage mounts itself through FUSE. On a distribution without libfuse2
#     (Ubuntu 22.04+ ships libfuse3 only) the user runs the file with
#     `--appimage-extract-and-run`, or installs libfuse2. That is a property of
#     the format, not of this build.
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

# Default is "both": one run has to hand out native AppImages for x86_64 and
# aarch64 alike, because a user on an ARM machine cannot run the x64 artifact.
TARGET="AppImage"
ARCH="both"
while [ $# -gt 0 ]; do
  case "$1" in
    --arch)
      [ $# -ge 2 ] || {
        echo "--arch needs a value: x64 | arm64 | both" >&2
        exit 2
      }
      ARCH="$2"
      shift
      ;;
    -h | --help)
      # Print the comment header above `set -euo pipefail`, without the "# ".
      awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
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
#
# Every failure here says what to run next: this script is the only documented
# way to produce a Linux artifact, and a bare "No such file" sends the reader to
# the source instead of the fix.
[ "$(uname -s)" = "Linux" ] ||
  fail "This script must run on a Linux host (electron-builder links the AppImage runtime, a Linux binary). Use a Linux machine, a container, or CI."
command -v git >/dev/null 2>&1 || fail "git not found - install it (apt install git / dnf install git)."
command -v tar >/dev/null 2>&1 || fail "tar not found - install it (apt install tar / dnf install tar)."
command -v node >/dev/null 2>&1 || fail "Node.js 20.19+ not found - install it from https://nodejs.org/ or your distribution."
command -v npm >/dev/null 2>&1 || fail "npm not found - it ships with Node.js 20.19+; reinstall Node.js."

[ -f "$FRONTEND_DIR/dist/index.html" ] ||
  fail "frontend/dist/index.html is missing - build it first: (cd frontend && npm ci && npm run build)"
[ -d "$DESKTOP_DIR/node_modules/electron" ] ||
  fail "desktop/node_modules is missing - install it first: (cd desktop && npm install)"

# electron-builder downloads its own helper binaries (electron, appimage tool) on
# first use; the mirror keeps that from stalling on slow international links.
# Override by exporting ELECTRON_MIRROR yourself before running the script.
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
# Tracked sources only, exactly like Build-Desktop.ps1 and build-desktop-mac.sh:
# git archive keeps the payload free of venv/node_modules/caches.
for spec in backend scripts start.cmd start.command stop.cmd stop.command branding; do
  git -C "$PROJECT_ROOT" archive -o "$ARCHIVE_TAR" HEAD -- "$spec" || fail "git archive $spec failed"
  tar -xf "$ARCHIVE_TAR" -C "$PAYLOAD_DIR" || fail "tar extract $spec failed"
done

# Root-level Linux launchers (start.sh / stop.sh / update.sh). They are part of
# the tracked tree once the Linux launcher lands; `git archive` fails hard on a
# pathspec that matches nothing, so each one is probed first. A missing one is a
# warning, not an error: the AppImage still boots (the shell starts the backend
# itself), it just ships without the double-click launcher.
for spec in start.sh stop.sh update.sh; do
  if git -C "$PROJECT_ROOT" cat-file -e "HEAD:$spec" 2>/dev/null; then
    git -C "$PROJECT_ROOT" archive -o "$ARCHIVE_TAR" HEAD -- "$spec" || fail "git archive $spec failed"
    tar -xf "$ARCHIVE_TAR" -C "$PAYLOAD_DIR" || fail "tar extract $spec failed"
  else
    echo "WARNING: $spec is not tracked at HEAD yet; the payload ships without it." >&2
  fi
done
rm -f "$ARCHIVE_TAR"

mkdir -p "$PAYLOAD_DIR/frontend"
cp -R "$FRONTEND_DIR/dist" "$PAYLOAD_DIR/frontend/dist"
mkdir -p "$PAYLOAD_DIR/runtime/logs"

# The shell's fallback launcher lives under scripts/linux (see
# desktop/backend-manager.js::launcherCommand). Without it the packaged app has
# no way to provision Python on a machine that never had it, so say so loudly
# instead of shipping an AppImage that can only show a startup error.
if [ ! -d "$PAYLOAD_DIR/scripts/linux" ]; then
  echo "WARNING: payload/scripts/linux is missing; the AppImage would ship without the Linux fallback launcher." >&2
fi

# 运行时清单（与 mac 对称）：Linux 的 payload 按设计**不带** python-runtime.zip，
# 所以这一步在当前形态下什么也不做。留着它的理由是让三个构建脚本对 payload 的
# 形状保持对称：一旦 Linux 也开始带 zip，清单会跟着出现，而不是等到已安装的壳
# 报"清单缺失、只能比 zip 摘要"才发现。清单从 zip 里取，不重新计算，两处指纹
# 才永远同源。
RUNTIME_MANIFEST_ENTRY="python-runtime.manifest.json"
RUNTIME_MANIFEST_OUT="$PAYLOAD_DIR/runtime-manifest.json"
rm -f "$RUNTIME_MANIFEST_OUT"
if [ ! -f "$PAYLOAD_DIR/python-runtime.zip" ]; then
  echo "runtime manifest: skipped (the Linux payload ships no python-runtime.zip by design)"
elif ! command -v unzip >/dev/null 2>&1; then
  echo "WARNING: unzip not found; skipping runtime-manifest.json (the shell falls back to the zip digest)." >&2
elif unzip -p "$PAYLOAD_DIR/python-runtime.zip" "$RUNTIME_MANIFEST_ENTRY" >"$RUNTIME_MANIFEST_OUT" 2>/dev/null; then
  echo "runtime manifest: payload/runtime-manifest.json"
else
  # unzip 失败时会留下空文件；删掉它，否则壳会把"空清单"当成损坏并每走一次都白读。
  rm -f "$RUNTIME_MANIFEST_OUT"
  echo "WARNING: python-runtime.zip carries no ${RUNTIME_MANIFEST_ENTRY}; runtime-manifest.json skipped." >&2
fi

PAYLOAD_FILES="$(find "$PAYLOAD_DIR" -type f | wc -l | tr -d ' ')"
echo "Payload assembled: $PAYLOAD_FILES files"

# --- package -----------------------------------------------------------
BUILDER="$DESKTOP_DIR/node_modules/.bin/electron-builder"
[ -x "$BUILDER" ] || fail "electron-builder not found at $BUILDER - run npm install in desktop/ first."

# Architecture selection. "both" is the default (x64 + arm64); the empty-array
# expansion below stays behind the "+" guard so `set -u` does not trip on bash
# versions that treat an empty array as unset.
ARCH_ARGS=()
ARCH_SPLIT="$(echo "$ARCH" | tr ',' ' ')"
case "$ARCH_SPLIT" in
  x64) ARCH_ARGS=(--x64) ;;
  arm64 | aarch64) ARCH_ARGS=(--arm64) ;;
  "x64 arm64" | "arm64 x64" | both) ARCH_ARGS=(--x64 --arm64) ;;
  *)
    fail "Unknown --arch value '$ARCH' (expected x64 | arm64 | both)"
    ;;
esac

echo "=== electron-builder --linux $TARGET (arch=$ARCH) ==="
pushd "$DESKTOP_DIR" >/dev/null
"$BUILDER" --linux "$TARGET" ${ARCH_ARGS[@]+"${ARCH_ARGS[@]}"} --config electron-builder.yml
popd >/dev/null

echo "=== Build output ==="
ls -lh "$DESKTOP_DIR/out" 2>/dev/null || true

# One sidecar per AppImage: --arch both produces more than one artifact per run.
# Same "<hex>  <name>" format as the Windows and macOS sidecars (ASCII, two
# spaces, no "*" prefix) so `sha256sum -c` / `shasum -a 256 -c` both work.
APPIMAGE_COUNT=0
for APPIMAGE in "$DESKTOP_DIR/out"/ResumeForge-"$VERSION"-linux-*.AppImage; do
  [ -f "$APPIMAGE" ] || continue
  APPIMAGE_COUNT=$((APPIMAGE_COUNT + 1))
  (
    cd "$(dirname "$APPIMAGE")"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$(basename "$APPIMAGE")" >"$(basename "$APPIMAGE").sha256"
    else
      shasum -a 256 "$(basename "$APPIMAGE")" >"$(basename "$APPIMAGE").sha256"
    fi
  )
  SIZE_MB="$(du -m "$APPIMAGE" | cut -f1)"
  echo "appimage: $APPIMAGE (${SIZE_MB} MB)"
  echo "sha256: $(cat "$APPIMAGE.sha256")"
done
if [ "$APPIMAGE_COUNT" -eq 0 ]; then
  echo "WARNING: no .AppImage artifact found under $DESKTOP_DIR/out - check the electron-builder output above." >&2
else
  echo ""
  echo "Next: chmod +x <appimage> && ./<appimage>  (add --appimage-extract-and-run on a host without libfuse2)."
  echo "The build is unsigned. There is no system installer: updating means replacing the old AppImage file."
fi
