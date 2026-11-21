#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "usage: $0 <x64|arm64> <baseline.dmg> <candidate.dmg> <work-directory> <smoke-driver>" >&2
  exit 2
fi

ARCH="$1"
BASELINE_DMG="$2"
CANDIDATE_DMG="$3"
WORK="$4"
DRIVER="$5"
case "$(uname -m):$ARCH" in
  x86_64:x64 | arm64:arm64) ;;
  *) echo "runner architecture $(uname -m) cannot execute macOS $ARCH package" >&2; exit 1 ;;
esac

verify_checksum() {
  package="$1"
  sidecar="$package.sha256"
  expected_name="$(basename "$package")"
  line="$(cat "$sidecar")"
  expected_hash="$(printf '%s\n' "$line" | awk 'NR==1 {print $1}')"
  expected_file="$(printf '%s\n' "$line" | awk 'NR==1 {print $2}')"
  actual_hash="$(shasum -a 256 "$package" | awk '{print $1}')"
  [ "$expected_file" = "$expected_name" ] || { echo "wrong sidecar filename: $sidecar" >&2; exit 1; }
  [ "$expected_hash" = "$actual_hash" ] || { echo "SHA-256 mismatch: $expected_name" >&2; exit 1; }
}

version_from_name() {
  name="$(basename "$1")"
  if [[ "$name" =~ ^ResumeForge-([0-9]+\.[0-9]+\.[0-9]+)-$ARCH\.dmg$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  else
    echo "unexpected macOS package name: $name" >&2
    exit 1
  fi
}

attach_app() {
  dmg="$1"
  mount="$2"
  mkdir -p "$mount"
  hdiutil attach -readonly -nobrowse -quiet -mountpoint "$mount" "$dmg"
  find "$mount" -type d -name 'ResumeForge.app' -prune -print -quit
}

WORK="$(mkdir -p "$WORK" && cd "$WORK" && pwd)"
BASELINE_VERSION="$(version_from_name "$BASELINE_DMG")"
CANDIDATE_VERSION="$(version_from_name "$CANDIDATE_DMG")"
[ "$BASELINE_VERSION" != "$CANDIDATE_VERSION" ] || { echo "baseline and candidate versions are equal" >&2; exit 1; }
verify_checksum "$BASELINE_DMG"
verify_checksum "$CANDIDATE_DMG"
PROFILE="$WORK/profile"
INSTALL="$WORK/Applications/ResumeForge.app"
mkdir -p "$WORK/Applications"
BASELINE_MOUNT="$WORK/mount-baseline"
CANDIDATE_MOUNT="$WORK/mount-candidate"
cleanup() {
  hdiutil detach "$CANDIDATE_MOUNT" -quiet >/dev/null 2>&1 || true
  hdiutil detach "$BASELINE_MOUNT" -quiet >/dev/null 2>&1 || true
}
trap cleanup EXIT

BASELINE_APP="$(attach_app "$BASELINE_DMG" "$BASELINE_MOUNT")"
[ -n "$BASELINE_APP" ] || { echo "baseline DMG contains no ResumeForge.app" >&2; exit 1; }
ditto "$BASELINE_APP" "$INSTALL"
xattr -dr com.apple.quarantine "$INSTALL" 2>/dev/null || true
node "$DRIVER" "$INSTALL/Contents/MacOS/ResumeForge" macos "$BASELINE_VERSION" "$PROFILE" write macos-package-upgrade

CANDIDATE_APP="$(attach_app "$CANDIDATE_DMG" "$CANDIDATE_MOUNT")"
[ -n "$CANDIDATE_APP" ] || { echo "candidate DMG contains no ResumeForge.app" >&2; exit 1; }
mv "$INSTALL" "$WORK/Applications/ResumeForge.previous.app"
ditto "$CANDIDATE_APP" "$INSTALL"
xattr -dr com.apple.quarantine "$INSTALL" 2>/dev/null || true
node "$DRIVER" "$INSTALL/Contents/MacOS/ResumeForge" macos "$CANDIDATE_VERSION" "$PROFILE" verify macos-package-upgrade
echo "PASS: macOS $ARCH DMG $BASELINE_VERSION -> $CANDIDATE_VERSION, user data preserved"
