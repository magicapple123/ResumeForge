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
# 驱动的硬超时。为什么需要：2026-11-22 的 run 45014630409 里四个 linux 矩阵在
# 10:57:57 就打出了判据错误，之后 28 分钟零输出，只能整体取消 —— 判据早有结论，
# 挂着的是 node 进程本身（见 desktop/scripts/verify-packaged-startup.js 文件头），
# 而 bash 的 `node ...` 会一直等它。没有这道闸门，唯一的止损点就是作业的
# timeout-minutes（90 分钟）。600s 的依据：单次调用正常 30–140s，最慢的**合法**路径
# （驱动里几个 120s/180s/45s 超时全部走满）约 520s，所以它只切断"有结论却不退出"，
# 不会切断一个走得慢但会通过的调用。
DRIVER_TIMEOUT_SECONDS=600

# 跑一次驱动；超时以 124 收场（与 GNU timeout(1) 同一约定）并打印能定位的说明。
#
# 不用 `timeout(1)`：macOS 默认没有它（coreutils 才带），而本仓库的 Linux/macOS
# 升级脚本是**镜像实现**——这一份要与 Test-MacOSPackageUpgrade.sh 保持一致。
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

# 启动：跑的是 AppImage 的 **extract-and-run 解包**路径，不是 FUSE 挂载 ——
# desktop/scripts/verify-packaged-startup.js 对 linux 设了 APPIMAGE_EXTRACT_AND_RUN=1。
# 原因见 scripts/build-desktop-linux.sh:33-35：没有 libfuse2 的发行版（Ubuntu 22.04+
# 只带 libfuse3；本工作流的 "Check Linux AppImage runner dependencies" 步骤也只装
# xvfb）必须走 --appimage-extract-and-run。代价是每次启动都要把整个 AppImage 载荷
# 解包到 $TMPDIR（上百 MB，比 macOS 慢），收益是不依赖 FUSE；要改回真实挂载得先在
# runner 上装 libfuse2t64 并去掉那个环境变量，那是运行方式的变更，不在本次范围内。
# 共享的 XDG profile 让旧包与候选包复用第一次运行解出来的 Python runtime/venv。
run_driver "baseline $BASELINE_VERSION" "$INSTALL" linux "$BASELINE_VERSION" "$PROFILE" write linux-package-upgrade

mv "$INSTALL" "$WORK/Applications/ResumeForge.previous.AppImage"
cp "$CANDIDATE_APPIMAGE" "$INSTALL"
chmod +x "$INSTALL"
run_driver "candidate $CANDIDATE_VERSION" "$INSTALL" linux "$CANDIDATE_VERSION" "$PROFILE" verify linux-package-upgrade
echo "PASS: Linux $ARCH AppImage $BASELINE_VERSION -> $CANDIDATE_VERSION, user data preserved"
