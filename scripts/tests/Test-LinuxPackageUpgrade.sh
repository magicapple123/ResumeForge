#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "usage: $0 <x64|arm64> <baseline.AppImage> <candidate.AppImage> <work-directory> <smoke-driver>" >&2
  exit 2
fi

ARCH="$1"
BASELINE_APPIMAGE="$2"
CANDIDATE_APPIMAGE="$3"
WORK="$4"
DRIVER="$5"
case "$(uname -m):$ARCH" in
  x86_64:x64 | aarch64:arm64) ;;
  *) echo "runner architecture $(uname -m) cannot execute Linux $ARCH package" >&2; exit 1 ;;
esac

verify_checksum() {
  package="$1"
  sidecar="$package.sha256"
  expected_name="$(basename "$package")"
  line="$(cat "$sidecar")"
  expected_hash="$(printf '%s\n' "$line" | awk 'NR==1 {print $1}')"
  expected_file="$(printf '%s\n' "$line" | awk 'NR==1 {print $2}')"
  actual_hash="$(sha256sum "$package" | awk '{print $1}')"
  [ "$expected_file" = "$expected_name" ] || { echo "wrong sidecar filename: $sidecar" >&2; exit 1; }
  [ "$expected_hash" = "$actual_hash" ] || { echo "SHA-256 mismatch: $expected_name" >&2; exit 1; }
}

version_from_name() {
  name="$(basename "$1")"
  package_arch="$ARCH"
  [ "$ARCH" = x64 ] && package_arch=x86_64
  if [[ "$name" =~ ^ResumeForge-([0-9]+\.[0-9]+\.[0-9]+)-$package_arch\.AppImage$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  else
    echo "unexpected Linux package name: $name" >&2
    exit 1
  fi
}

WORK="$(mkdir -p "$WORK" && cd "$WORK" && pwd)"
BASELINE_VERSION="$(version_from_name "$BASELINE_APPIMAGE")"
CANDIDATE_VERSION="$(version_from_name "$CANDIDATE_APPIMAGE")"
[ "$BASELINE_VERSION" != "$CANDIDATE_VERSION" ] || { echo "baseline and candidate versions are equal" >&2; exit 1; }
verify_checksum "$BASELINE_APPIMAGE"
verify_checksum "$CANDIDATE_APPIMAGE"
PROFILE="$WORK/profile"
INSTALL="$WORK/Applications/ResumeForge.AppImage"
mkdir -p "$WORK/Applications"
cp "$BASELINE_APPIMAGE" "$INSTALL"
chmod +x "$INSTALL"
# Run through AppImage's normal FUSE mount, as an installed desktop user does.
# The shared XDG profile then keeps the first-run Python runtime/venv across the
# old-package and candidate-package launches. CI provisions libfuse2 and xvfb.
node "$DRIVER" "$INSTALL" linux "$BASELINE_VERSION" "$PROFILE" write linux-package-upgrade

mv "$INSTALL" "$WORK/Applications/ResumeForge.previous.AppImage"
cp "$CANDIDATE_APPIMAGE" "$INSTALL"
chmod +x "$INSTALL"
node "$DRIVER" "$INSTALL" linux "$CANDIDATE_VERSION" "$PROFILE" verify linux-package-upgrade
echo "PASS: Linux $ARCH AppImage $BASELINE_VERSION -> $CANDIDATE_VERSION, user data preserved"
