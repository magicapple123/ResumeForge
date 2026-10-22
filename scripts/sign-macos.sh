#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# ResumeForge macOS 签名与公证（报告任务 13/14 的脚手架）。
#
# 用法：
#   bash scripts/sign-macos.sh --app desktop/out/mac/ResumeForge.app
#   bash scripts/sign-macos.sh --help
#
# 为什么是"脚手架"：签名与公证必须用真实的 Apple Developer ID 证书，而维护者
# 与本项目的 CI 都没有证书。所以这个脚本的**默认行为是"什么都不做但成功"**：
# 缺任一环境变量就打印"未配置签名，产物为未签名包"并以 0 退出。构建链因此在
# 无证书环境下依然完整可跑（否则每次本地构建、每次 CI 都会红），而一旦把四个
# 变量配齐，它就走完整流程、并且**任何一步失败都让构建失败**（"以为签好了、
# 其实没签"比"明确未签名"危险得多）。
#
# 需要的环境变量（四者齐全才真的签）：
#   RF_MAC_SIGN_IDENTITY    例：Developer ID Application: Xxx (TEAMID)
#   RF_APPLE_ID             公证用的 Apple ID
#   RF_APPLE_TEAM_ID        Team ID（钥匙串/开发者后台可见）
#   RF_APPLE_APP_PASSWORD   app 专用密码（appleid.apple.com 生成，不是登录密码）
#
# 顺序不是随意的：
#   1. 由内向外签：先 .dylib/.so/.node 与嵌套 helper，再签 .app 本体。反过来做的话，
#      签完父级再改子级内容会让父级签名直接失效（codesign 校验会报
#      "code object is not signed at all" 或资源封印不匹配）。
#   2. .app 本体必须带 --options runtime（hardened runtime）——它是公证的前提，
#      少了它 notarytool 一律拒收。
#   3. ditto 打 zip：notarytool 只收 zip/dmg/pkg，且 ditto 会保留符号链接与扩展
#      属性（用 zip 命令打出来的包常在公证阶段报"不可接受的签名结构"）。
#   4. notarytool submit --wait 必须等到结果，不能异步提交了事。
#   5. stapler staple 把票据钉在 .app 上，用户的离线首次启动也要能过 Gatekeeper。
#   6. spctl 断言输出含 source=Notarized Developer ID。**这一步才是判据**：
#      "提交成功"不等于"用户机器上能打开"，Gatekeeper 的实际判定才算数。

set -euo pipefail

APP_PATH=""

while [ "$#" -gt 0 ]; do
    case "$1" in
        --app)
            [ "$#" -ge 2 ] || {
                echo "--app needs the path to a .app bundle" >&2
                exit 2
            }
            APP_PATH="$2"
            shift
            ;;
        -h | --help)
            sed -n '2,34p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown argument: $1 (use --help)" >&2
            exit 2
            ;;
    esac
    shift
done

# ---------------------------------------------------------------------------
# 证书缺失 = 跳过并成功
# ---------------------------------------------------------------------------
missing_vars=""
if [ -z "${RF_MAC_SIGN_IDENTITY:-}" ]; then
    missing_vars="${missing_vars} RF_MAC_SIGN_IDENTITY"
fi
if [ -z "${RF_APPLE_ID:-}" ]; then
    missing_vars="${missing_vars} RF_APPLE_ID"
fi
if [ -z "${RF_APPLE_TEAM_ID:-}" ]; then
    missing_vars="${missing_vars} RF_APPLE_TEAM_ID"
fi
if [ -z "${RF_APPLE_APP_PASSWORD:-}" ]; then
    missing_vars="${missing_vars} RF_APPLE_APP_PASSWORD"
fi

if [ -n "$missing_vars" ]; then
    echo "未配置签名，产物为未签名包（缺少环境变量：${missing_vars# }）。"
    echo "首次打开时需要右键 > 打开；对外分发前请配置证书后重新构建。"
    # 明确以 0 退出：没有证书是"当前环境的事实"，不是构建失败。
    exit 0
fi

# 到这里说明证书变量齐全，任何问题都必须暴露出来。
if [ ! -d "$APP_PATH" ]; then
    echo "找不到要签名的 .app：${APP_PATH}" >&2
    echo "先构建一次（bash scripts/build-desktop-mac.sh），或用 --app 指定路径。" >&2
    exit 1
fi
if [ "$(uname -s)" != "Darwin" ]; then
    echo "签名与公证只能在 macOS 上执行（当前：$(uname -s)）。" >&2
    exit 1
fi
for tool in codesign ditto xcrun spctl; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "缺少系统工具：${tool}（Xcode Command Line Tools：xcode-select --install）" >&2
        exit 1
    fi
done

echo "=== 代码签名：${APP_PATH} ==="

# 由内向外：按路径层级降序排序，深的（子级的子级）先签。
# 排序用 awk 造一个"深度<TAB>路径"的中间列，避免依赖 GNU sort 的 -V 或 --sort。
sign_target() {
    codesign --force --timestamp --options runtime \
        --sign "$RF_MAC_SIGN_IDENTITY" "$1"
}

nested_binaries=$(
    find "$APP_PATH" -type f \
        \( -name '*.dylib' -o -name '*.so' -o -name '*.node' \) 2>/dev/null |
        awk -F/ '{ printf "%d\t%s\n", NF, $0 }' |
        sort -rn
) || nested_binaries=""
if [ -n "$nested_binaries" ]; then
    while IFS= read -r depth_and_path; do
        [ -n "$depth_and_path" ] || continue
        sign_target "$(printf '%s' "$depth_and_path" | cut -f2-)"
    done <<EOF
$nested_binaries
EOF
fi

# 嵌套 helper（Electron 的 Helper.app 等）。它们是独立的 bundle，必须各自签名，
# 且要在外层 .app 之前完成。
nested_bundles=$(
    find "$APP_PATH" -mindepth 2 -type d -name '*.app' 2>/dev/null |
        awk -F/ '{ printf "%d\t%s\n", NF, $0 }' |
        sort -rn
) || nested_bundles=""
if [ -n "$nested_bundles" ]; then
    while IFS= read -r depth_and_path; do
        [ -n "$depth_and_path" ] || continue
        sign_target "$(printf '%s' "$depth_and_path" | cut -f2-)"
    done <<EOF
$nested_bundles
EOF
fi

# 最后签 .app 本体。
# --deep 是脚手架阶段的务实选择：它会把没被上面规则命中的 Mach-O（例如
# Electron Framework 的无扩展名主二进制）一并签掉。正式发布前应改为逐个显式
# 签名（Apple 已把 --deep 标为不推荐），否则某个仍未签名的嵌套组件会让公证
# 以"签名不完整"失败——那时 --deep 掩盖的问题会以更难读的形式出现。
codesign --force --timestamp --options runtime --deep \
    --sign "$RF_MAC_SIGN_IDENTITY" "$APP_PATH"
codesign --verify --strict --verbose=2 "$APP_PATH"

echo "=== 打包为 zip 并提交公证 ==="
# work_dir 放在系统临时目录：公证产物不留在仓库里（out/ 会被打包/上传，
# 一个几百 MB 的 zip 留在那儿只会让下一次构建的产物目录难以辨认）。
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/resumeforge-notarize-XXXXXX")
zip_path="$work_dir/ResumeForge-notarize.zip"
trap 'rm -rf "$work_dir"' EXIT

ditto -c -k --keepParent "$APP_PATH" "$zip_path"
xcrun notarytool submit "$zip_path" \
    --apple-id "$RF_APPLE_ID" \
    --team-id "$RF_APPLE_TEAM_ID" \
    --password "$RF_APPLE_APP_PASSWORD" \
    --wait

echo "=== 钉上公证票据 ==="
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"

echo "=== Gatekeeper 判定 ==="
# spctl 的结论走 stderr，且"不通过"也以 0/3 之类的码收场，所以判据是输出内容
# 而不是退出码：只有 source=Notarized Developer ID 才说明用户双击能过。
spctl_output=$(spctl -a -t exec -vvv "$APP_PATH" 2>&1) || true
printf '%s\n' "$spctl_output"
case "$spctl_output" in
    *"source=Notarized Developer ID"*)
        echo "签名与公证完成：Gatekeeper 认可（Notarized Developer ID）。"
        ;;
    *)
        echo "Gatekeeper 判定不通过：上面的输出里没有 'source=Notarized Developer ID'。" >&2
        echo "常见原因：证书不是 Developer ID、Team ID 与证书不匹配、或公证票据没钉上。" >&2
        exit 1
        ;;
esac
