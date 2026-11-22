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

# 驱动的硬超时。为什么需要：2026-11-22 的 run 45014630409 里 linux 矩阵在判据失败后
# 28 分钟零输出，只能整体取消 —— 判据早有结论，挂着的是 node 进程本身（见
# desktop/scripts/verify-packaged-startup.js 文件头）。macOS 这次全绿，但"驱动不返回"
# 这条风险与平台无关：这里没有闸门的话，唯一的止损点同样是作业的 timeout-minutes
# （90 分钟）。600s 的依据：单次调用正常 30–140s，最慢的**合法**路径（驱动里几个
# 120s/180s/45s 超时全部走满）约 520s，所以它只切断"有结论却不退出"。
DRIVER_TIMEOUT_SECONDS=600

# 跑一次驱动；超时以 124 收场（与 GNU timeout(1) 同一约定）并打印能定位的说明。
#
# 不用 `timeout(1)`：macOS 默认没有它（coreutils 才带），而本仓库的 Linux/macOS
# 升级脚本是**镜像实现**——这一份要与 Test-LinuxPackageUpgrade.sh 保持一致。
run_driver() {
  local label="$1"
  shift
  local flag="$WORK/driver-timeout.flag"
  local status=0
  local driver_pid=0
  local watcher_pid=0
  rm -f "$flag"
  node "$DRIVER" "$@" &
  driver_pid=$!
  # 看门狗自己不动 stdout，所以驱动的日志照常实时流出。
  (
    sleep "$DRIVER_TIMEOUT_SECONDS"
    kill -0 "$driver_pid" 2>/dev/null || exit 0
    : > "$flag"
    kill -TERM "$driver_pid" 2>/dev/null || true
    sleep 15
    kill -KILL "$driver_pid" 2>/dev/null || true
  ) &
  watcher_pid=$!
  wait "$driver_pid" || status=$?
  kill "$watcher_pid" 2>/dev/null || true
  wait "$watcher_pid" 2>/dev/null || true
  if [ -f "$flag" ]; then
    rm -f "$flag"
    echo "驱动在 ${DRIVER_TIMEOUT_SECONDS}s 内没有退出（$label）：判据可能已经打印过结论，但 node 进程没有收场。" >&2
    echo "  → 先看上面最后一条 [platform version] stage 与 Error: 行；收尾逻辑见 desktop/scripts/verify-packaged-startup.js 的 finally 与顶层 exitWithFlush。" >&2
    return 124
  fi
  return "$status"
}

BASELINE_APP="$(attach_app "$BASELINE_DMG" "$BASELINE_MOUNT")"
[ -n "$BASELINE_APP" ] || { echo "baseline DMG contains no ResumeForge.app" >&2; exit 1; }
ditto "$BASELINE_APP" "$INSTALL"
xattr -dr com.apple.quarantine "$INSTALL" 2>/dev/null || true
run_driver "baseline $BASELINE_VERSION" "$INSTALL/Contents/MacOS/ResumeForge" macos "$BASELINE_VERSION" "$PROFILE" write macos-package-upgrade

CANDIDATE_APP="$(attach_app "$CANDIDATE_DMG" "$CANDIDATE_MOUNT")"
[ -n "$CANDIDATE_APP" ] || { echo "candidate DMG contains no ResumeForge.app" >&2; exit 1; }
mv "$INSTALL" "$WORK/Applications/ResumeForge.previous.app"
ditto "$CANDIDATE_APP" "$INSTALL"
xattr -dr com.apple.quarantine "$INSTALL" 2>/dev/null || true
run_driver "candidate $CANDIDATE_VERSION" "$INSTALL/Contents/MacOS/ResumeForge" macos "$CANDIDATE_VERSION" "$PROFILE" verify macos-package-upgrade
echo "PASS: macOS $ARCH DMG $BASELINE_VERSION -> $CANDIDATE_VERSION, user data preserved"
