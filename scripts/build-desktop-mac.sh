#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
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
#   bash scripts/build-desktop-mac.sh                  # dmg + dir (host arch)
#   bash scripts/build-desktop-mac.sh --dir            # dir only (fast smoke build)
#   bash scripts/build-desktop-mac.sh --arch both      # x64 + arm64 dmgs
#   bash scripts/build-desktop-mac.sh --arch universal # one dmg, both arches
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
#   - The build is UNSIGNED unless RF_MAC_SIGN_IDENTITY / RF_APPLE_ID /
#     RF_APPLE_TEAM_ID / RF_APPLE_APP_PASSWORD are all set: scripts/sign-macos.sh
#     then signs, notarizes and staples the .app (and asserts the Gatekeeper
#     verdict). Without those four variables it prints "未配置签名" and exits 0,
#     so an unsigned build still succeeds and still needs right-click > Open.
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
ARCH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) TARGET="dir" ;;
    --arch)
      [ $# -ge 2 ] || {
        echo "--arch needs a value: x64 | arm64 | universal | both" >&2
        exit 2
      }
      ARCH="$2"
      shift
      ;;
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

# R11: double-click update entry at the install root (next to ResumeForge.app).
# macOS has no NSIS installer protocol, so this never pretends to auto-update:
# when the app is not running it starts it with --check-update (the app shows
# either "up to date" or the release page); when it is already running the
# release page opens directly, because `open -a` does not forward --args to a
# running instance.
cat > "$PAYLOAD_DIR/update.command" <<'UPDATE_EOF'
#!/bin/bash
# ResumeForge updater. Double-click this file in Finder.
#
# macOS 版没有 NSIS 安装器，更新是「下载新的 .dmg 覆盖安装」。这个入口只负责把
# 你带到正确的地方，不会静默改动应用文件。
RELEASES_PAGE="https://github.com/magicapple123/ResumeForge/releases/latest"

if pgrep -x "ResumeForge" >/dev/null 2>&1; then
    open "$RELEASES_PAGE"
else
    open -a "ResumeForge" --args --check-update
fi
UPDATE_EOF
chmod +x "$PAYLOAD_DIR/update.command"

# 运行时清单（报告任务 10）：mac 的 payload 按设计**不带** python-runtime.zip
# （见文件头），所以这一步在当前形态下什么也不做。留着它的理由是让两个构建脚本
# 对 payload 的形状保持对称：一旦 mac 也开始带 zip，清单会跟着出现，而不是等到
# 已安装的壳报"清单缺失、只能比 zip 摘要"才发现。清单从 zip 里取，不重新计算，
# 两处指纹才永远同源。
RUNTIME_MANIFEST_ENTRY="python-runtime.manifest.json"
RUNTIME_MANIFEST_OUT="$PAYLOAD_DIR/runtime-manifest.json"
rm -f "$RUNTIME_MANIFEST_OUT"
if [ ! -f "$PAYLOAD_DIR/python-runtime.zip" ]; then
  echo "runtime manifest: skipped (the macOS payload ships no python-runtime.zip by design)"
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

# Architecture selection. Default (empty) keeps electron-builder's host-arch
# behaviour; CI uses "both" so one run ships native dmgs for Intel and Apple
# Silicon alike. bash 3.2 (macOS /bin/bash) is the compatibility floor, so the
# empty-array expansion below must stay behind the "+" guard under set -u.
ARCH_ARGS=()
ARCH_SPLIT="$(echo "$ARCH" | tr ',' ' ')"
case "$ARCH_SPLIT" in
  "") ;;
  x64) ARCH_ARGS=(--x64) ;;
  arm64) ARCH_ARGS=(--arm64) ;;
  universal) ARCH_ARGS=(--universal) ;;
  "x64 arm64" | "arm64 x64" | both) ARCH_ARGS=(--x64 --arm64) ;;
  *)
    fail "Unknown --arch value '$ARCH' (expected x64 | arm64 | universal | both)"
    ;;
esac

echo "=== electron-builder --mac (target=$TARGET${ARCH:+, arch=$ARCH}) ==="
pushd "$DESKTOP_DIR" >/dev/null
if [ "$TARGET" = "dir" ]; then
  "$BUILDER" --mac --dir ${ARCH_ARGS[@]+"${ARCH_ARGS[@]}"} --config electron-builder.yml
else
  "$BUILDER" --mac ${ARCH_ARGS[@]+"${ARCH_ARGS[@]}"} --config electron-builder.yml
fi
popd >/dev/null

echo "=== Build output ==="
ls -lh "$DESKTOP_DIR/out" 2>/dev/null || true

# One sidecar per dmg: --arch both can produce more than one artifact per run.
DMG_COUNT=0
for DMG in "$DESKTOP_DIR/out"/ResumeForge-"$VERSION"-*.dmg; do
  [ -f "$DMG" ] || continue
  DMG_COUNT=$((DMG_COUNT + 1))
  # sha256 sidecar in the same "<hex>  <name>" format the Windows installer
  # sidecar uses (ASCII, two spaces, no "*" prefix).
  (
    cd "$(dirname "$DMG")"
    shasum -a 256 "$(basename "$DMG")" >"$(basename "$DMG").sha256"
  )
  echo "dmg: $DMG"
  echo "sha256: $(cat "$DMG.sha256")"
done
if [ "$DMG_COUNT" -eq 0 ]; then
  echo "WARNING: no .dmg artifact found under $DESKTOP_DIR/out" >&2
else
  echo ""
  echo "Next: hdiutil attach \"<dmg>\" to inspect, then launch ResumeForge.app."
  echo "The build is unsigned - first launch needs right-click > Open (Gatekeeper)."
fi

# --- signing / notarization (report task 13/14, scaffolding) -------------------
# 证书缺失时这一步是**成功且无动作**的（scripts/sign-macos.sh 缺任一变量就以 0
# 退出），所以本机与 CI 在没有 Apple 开发者证书的情况下照常构建成功。
# 配了证书却签失败则让构建失败：一个"以为签好了"的未签名 dmg 比明确的未签名危险。
#
# 注意顺序：electron-builder 已经先生成 .app 再打 dmg，所以这里签的是 .app，
# 已经产出的 dmg 里装的仍是签名前的副本。正式的发布流水线应当把签名放到打包
# 之前（electron-builder 的 afterSign 钩子或 mac.identity）后再生成 dmg；本脚本
# 只负责把流程与判据钉在仓库里，避免"签名这一步从来没人写过"。
SIGN_SCRIPT="$SCRIPT_DIR/sign-macos.sh"
if [ -f "$SIGN_SCRIPT" ]; then
  for APP_BUNDLE in "$DESKTOP_DIR"/out/mac*/ResumeForge.app; do
    [ -d "$APP_BUNDLE" ] || continue
    if ! bash "$SIGN_SCRIPT" --app "$APP_BUNDLE"; then
      fail "sign-macos.sh failed for $APP_BUNDLE"
    fi
  done
fi
