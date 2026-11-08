#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Linux 启动链的守卫测试。
#
# 为什么需要它：Linux 是**发行版最多、工具集差异最大**的一个平台，而维护者的
# 日常工作机不一定就是目标发行版。这份测试就是那台缺席的 Linux 机器 —— 它在 CI 的
# ubuntu 作业上跑，也在 Windows 的开发者机器（Git Bash）上跑得通，对同一批纯函数
# 做断言，把"只能靠人肉发现"的问题变成红灯：
#
#   * 换行/编码：.sh 出现 CRLF 会在 Linux 上以
#     "bad interpreter: /usr/bin/env: 'bash\r'" 失败，而任何在 Windows 上的编辑都可能带进来；
#   * 语法：bash -n 逐个文件；
#   * 自举常量（版本号、SHA-256、下载源）：钉死在这里，改一处必须同步改另一处；
#   * 平台移植的**残留**：macOS 独有的 xattr / open / Library/Application Support
#     一旦被"照抄"到 Linux 分支，表现是运行期莫名其妙地失败（第 3 个候选源 404、
#     浏览器永远打不开、状态目录跑到不存在的地方）——这些在 Windows 上看不出来，
#     所以直接对源码做反向断言；
#   * 版本窗口判断、架构映射、状态目录解析、进程记录匹配、更新器白名单这些纯逻辑。
#
# 刻意不依赖任何测试框架：它要能在最小化的容器里跑（没有 pytest、没有 bats）。
# 用法：bash scripts/tests/test-linux-launcher.sh

set -uo pipefail

RF_TEST_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
RF_LINUX_DIR="$RF_TEST_ROOT/scripts/linux"

RF_SHELL_SOURCES="start.sh stop.sh update.sh
scripts/linux/start.sh scripts/linux/stop.sh scripts/linux/update.sh
scripts/linux/lib/common.sh scripts/linux/lib/python.sh scripts/linux/lib/node.sh"

# 会被**直接执行**的脚本（bash start.sh、或 bash scripts/linux/*.sh）必须有 shebang；
# lib/*.sh 是被 source 进来的，不带 shebang 是惯例，也不该被要求。
RF_EXECUTABLE_SOURCES="start.sh stop.sh update.sh
scripts/linux/start.sh scripts/linux/stop.sh scripts/linux/update.sh"

# 变量定界检查要多扫一份：守卫脚本自己也会踩同一个坑（它的失败信息里就有中文）。
RF_QUOTING_SOURCES="$RF_SHELL_SOURCES
scripts/tests/test-linux-launcher.sh"

# 可选参数 1：临时目录的父目录。默认用 TMPDIR，只在 TMPDIR 不可写的环境里才需要显式指定。
rf_test_tmp_root=${1:-${TMPDIR:-/tmp}}
rf_test_tmp=$(mktemp -d "$rf_test_tmp_root/resumeforge-linux-test-XXXXXX") || {
    printf '无法在 %s 下创建临时目录。\n' "$rf_test_tmp_root" >&2
    printf '这是一个环境问题，不是被测代码的问题；可以显式指定一个可写目录：\n' >&2
    printf '  bash %s /tmp\n' "$0" >&2
    exit 2
}
if [ ! -d "$rf_test_tmp" ]; then
    printf '临时目录创建失败：%s 不是目录。\n' "$rf_test_tmp" >&2
    exit 2
fi
rf_test_failures=0
rf_test_passes=0

cleanup() {
    rm -rf "$rf_test_tmp"
}
trap cleanup EXIT

rf_check() {
    condition=$1
    message=$2
    if [ "$condition" = "0" ]; then
        printf '  ok   %s\n' "$message"
        rf_test_passes=$((rf_test_passes + 1))
    else
        printf '  FAIL %s\n' "$message"
        rf_test_failures=$((rf_test_failures + 1))
    fi
}

rf_skip() {
    printf '  skip %s\n' "$1"
}

rf_expect_equal() {
    actual=$1
    expected=$2
    message=$3
    if [ "$actual" = "$expected" ]; then
        rf_check 0 "$message"
    else
        rf_check 1 "${message}（实际 '$actual'，期望 '$expected'）"
    fi
}

printf '== 文件形态：换行、编码、可执行位 ==\n'
for relative_path in $RF_SHELL_SOURCES; do
    source_path="$RF_TEST_ROOT/$relative_path"
    if [ ! -s "$source_path" ]; then
        rf_check 1 "$relative_path 不存在或为空"
        continue
    fi
    # CRLF 检查走字节比较而不是 grep 正则：正则里的 \r 在不同工具里解释不同，
    # 而这一项本身就不该有歧义。
    if LC_ALL=C tr -d '\r' <"$source_path" | cmp -s - "$source_path"; then
        rf_check 0 "$relative_path 是纯 LF 换行"
    else
        rf_check 1 "$relative_path 含有 CR：Linux 上会以 bad interpreter 失败"
    fi
    # BOM 会让 #!/bin/bash 变成一段无法识别的字节，报错完全指不到真因。
    first_bytes=$(head -c 3 "$source_path" | od -An -tx1 | tr -d ' \n')
    if [ "$first_bytes" = "efbbbf" ]; then
        rf_check 1 "$relative_path 带 UTF-8 BOM"
    else
        rf_check 0 "$relative_path 没有 BOM"
    fi
done

for relative_path in $RF_EXECUTABLE_SOURCES; do
    source_path="$RF_TEST_ROOT/$relative_path"
    [ -s "$source_path" ] || continue
    rf_expect_equal "$(head -n 1 "$source_path")" '#!/bin/bash' "$relative_path 的 shebang 是 #!/bin/bash"
done

# 入口脚本在 git 里必须带可执行位：文件管理器直接运行、或更新包解压后都靠它。
if command -v git >/dev/null 2>&1 && git -C "$RF_TEST_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    for command_name in start.sh stop.sh update.sh; do
        mode=$(git -C "$RF_TEST_ROOT" ls-files --stage -- "$command_name" 2>/dev/null | awk '{print $1}' | head -n 1)
        if [ -z "$mode" ]; then
            rf_skip "$command_name 还没有被 git 跟踪，无法检查可执行位（提交后才会有 100755）"
        else
            rf_expect_equal "$mode" "100755" "$command_name 在 git 里是可执行文件（100755）"
        fi
    done
fi

printf '\n== 语法 ==\n'
for relative_path in $RF_SHELL_SOURCES; do
    if bash -n "$RF_TEST_ROOT/$relative_path" 2>"$rf_test_tmp/syntax.txt"; then
        rf_check 0 "$relative_path 语法通过"
    else
        rf_check 1 "$relative_path 语法错误：$(cat "$rf_test_tmp/syntax.txt")"
    fi
done

printf '\n== 变量插值定界（变量后紧跟中文必须写成花括号）==\n'
# 判据按字节：C locale 下 [^ -~] 即 >=0x7F（非可打印 ASCII），不依赖 locale 的多字节处理。
# 这一条在 macOS 的 bash 3.2 上是硬故障；Linux 上多数发行版是 bash 5 不会炸，但
# 同一份代码要能在容器里的老 bash、以及 Windows 的 Git Bash 上跑，所以一样钉住。
for relative_path in $RF_QUOTING_SOURCES; do
    if LC_ALL=C grep -nE '\$[A-Za-z_][A-Za-z0-9_]*[^ -~]' "$RF_TEST_ROOT/$relative_path" \
        >"$rf_test_tmp/bare-var.txt" 2>/dev/null; then
        rf_check 1 "$relative_path 变量后紧跟中文，要写成花括号定界：$(head -n 1 "$rf_test_tmp/bare-var.txt")"
    else
        rf_check 0 "$relative_path 变量插值都有定界"
    fi
done

printf '\n== 移植残留：macOS 独有的写法不许出现在 Linux 分支 ==\n'
# 这三条都是"照抄 macOS 那份"时会留下的指纹，而且每一条的故障形态都很隐蔽：
#   * xattr：Linux 没有这个命令，会往 stderr 吐一行 command not found（被 || true 吞掉，
#     所以谁也不会注意，直到有人去读日志）；
#   * open "URL"：Linux 上没有 open，浏览器永远打不开；
#   * ~/Library/Application Support：目录不存在 → 状态目录被创建在一个没人会看的地方。
# 只看**代码行**：注释里为了解释"为什么不这么做"而提到这些名字是允许的（也正该写）。
rf_strip_comments() {
    grep -vE '^[[:space:]]*#' "$1" 2>/dev/null
}
for relative_path in $RF_SHELL_SOURCES; do
    if rf_strip_comments "$RF_TEST_ROOT/$relative_path" | grep -q 'com.apple.quarantine'; then
        rf_check 1 "$relative_path 的代码里有 macOS 的 xattr quarantine 清理"
    else
        rf_check 0 "$relative_path 的代码里没有 macOS 的 xattr quarantine 清理"
    fi
    if rf_strip_comments "$RF_TEST_ROOT/$relative_path" | grep -q 'Library/Application Support'; then
        rf_check 1 "$relative_path 的代码里用了 macOS 的状态目录（Linux 应该用 XDG）"
    else
        rf_check 0 "$relative_path 的代码里没有 macOS 的状态目录"
    fi
done

printf '\n== 自举常量（改版本必须同步改这里）==\n'
# 让 libs 能自己算出默认的工具目录；正常使用时这几个变量由 start.sh / update.sh 定义。
RF_RUNTIME_DIR="$rf_test_tmp/runtime"
mkdir -p "$RF_RUNTIME_DIR"
# shellcheck source=../linux/lib/common.sh
. "$RF_LINUX_DIR/lib/common.sh"
# shellcheck source=../linux/lib/python.sh
. "$RF_LINUX_DIR/lib/python.sh"
# shellcheck source=../linux/lib/node.sh
. "$RF_LINUX_DIR/lib/node.sh"

rf_expect_equal "$RF_PYTHON_MIN_MAJOR.$RF_PYTHON_MIN_MINOR" "3.11" "Python 版本窗口下界是 3.11"
rf_expect_equal "$RF_PYTHON_MAX_MAJOR.$RF_PYTHON_MAX_MINOR" "3.13" "Python 版本窗口上界是 3.13"
rf_expect_equal "$RF_PYTHON_BOOTSTRAP_VERSION" "3.12.14" "便携版 Python 钉在 3.12.14"
rf_expect_equal "$RF_PYTHON_BOOTSTRAP_TAG" "20260901" "便携版 Python 钉在 20260901 这一次发布"
rf_expect_equal "$RF_NODE_BOOTSTRAP_VERSION" "24.19.0" "便携版 Node.js 钉在 24.19.0"
rf_expect_equal "$RF_NODE_MIN_VERSION" "20.19.0" "Node.js 最低版本是 20.19.0"

# 摘要真值：这四个数是 linux 版归档的实测值，写错一个就会变成"所有下载源都失败"。
rf_expect_equal "$RF_PYTHON_X64_SHA256" \
    "72748da13197c1fb161e3afeef20a6a385ff24f2165e6e2758e47008e7faba4c" "Python x64 摘要正确"
rf_expect_equal "$RF_PYTHON_AARCH64_SHA256" \
    "577b4bec0793ad1ff0cbff9adbd0df078eddde38a4c41bf5d83ad381a85ee39d" "Python aarch64 摘要正确"
rf_expect_equal "$RF_NODE_X64_SHA256" \
    "f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4" "Node.js x64 摘要正确"
rf_expect_equal "$RF_NODE_AARCH64_SHA256" \
    "d28c8a5bf0a808f0ed434a1dce8c54ae98f0371c0bd86ac58abc613f73e6643f" "Node.js aarch64 摘要正确"

# 形状断言：任何"看起来像摘要"的笔误（截断、多一位、大写、多了空格）都在这里挡掉。
rf_check_sha256_shape() {
    value=$1
    label=$2
    if printf '%s' "$value" | grep -Eq '^[0-9a-f]{64}$'; then
        rf_check 0 "$label 是 64 位小写十六进制"
    else
        rf_check 1 "$label 不是 64 位小写十六进制（实际长度 ${#value}）"
    fi
}
rf_check_sha256_shape "$RF_PYTHON_X64_SHA256" "Python x64 摘要"
rf_check_sha256_shape "$RF_PYTHON_AARCH64_SHA256" "Python aarch64 摘要"
rf_check_sha256_shape "$RF_NODE_X64_SHA256" "Node.js x64 摘要"
rf_check_sha256_shape "$RF_NODE_AARCH64_SHA256" "Node.js aarch64 摘要"

printf '\n== 架构映射与归档名（两个生态的命名约定不同）==\n'
# python-build-standalone 认 x86_64 / aarch64；Node 官方认 x64 / arm64。
# 这一组守的就是"别把两边统一成一个名字"——统一哪一边都会让另一边 404。
rf_expect_equal "$(rf_python_upstream_arch x64)" "x86_64" "x64 映射到上游的 x86_64"
rf_expect_equal "$(rf_python_upstream_arch arm64)" "aarch64" "arm64 映射到上游的 aarch64"
( rf_python_upstream_arch riscv64 >/dev/null 2>&1 )
rf_expect_equal "$?" "1" "未知架构拿不到上游名（返回失败而不是猜）"

rf_expect_equal "$(rf_python_bootstrap_archive_name x64)" \
    "cpython-3.12.14+20260901-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz" \
    "Python x64 归档名正确，且用的是精简版（install_only_stripped）"
rf_expect_equal "$(rf_python_bootstrap_archive_name arm64)" \
    "cpython-3.12.14+20260901-aarch64-unknown-linux-gnu-install_only_stripped.tar.gz" \
    "Python arm64 归档名正确"

rf_expect_equal "$(rf_node_bootstrap_archive_name x64)" "node-v24.19.0-linux-x64.tar.gz" \
    "Node.js x64 归档名用官方口径（x64，不是 x86_64）"
rf_expect_equal "$(rf_node_bootstrap_archive_name arm64)" "node-v24.19.0-linux-arm64.tar.gz" \
    "Node.js arm64 归档名用官方口径"
( rf_node_bootstrap_archive_name x86_64 >/dev/null 2>&1 )
rf_expect_equal "$?" "1" "Node.js 不接受上游口径的名字（x86_64 在上游不存在）"

printf '\n== 下载候选 ==\n'
python_urls=$(rf_build_python_bootstrap_urls x64)
python_url_count=$(printf '%s\n' "$python_urls" | wc -l | tr -d ' ')
official_python_url="https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14+20260901-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz"
rf_expect_equal "$(printf '%s\n' "$python_urls" | tail -n 1)" "$official_python_url" \
    "便携版 Python 的最后一个候选是 GitHub 官方地址"
rf_expect_equal "$(printf '%s\n' "$python_urls" | head -n 1 | grep -c '^https://ghproxy')" "1" \
    "便携版 Python 先试加速站点"
rf_expect_equal "$(printf '%s\n' "$python_urls" | grep -c 'unknown-linux-gnu')" "$python_url_count" \
    "便携版 Python 的每个候选都指向 linux 包"
rf_expect_equal "$(printf '%s\n' "$python_urls" | grep -c 'apple-darwin')" "0" \
    "便携版 Python 的候选里没有 macOS 包"
rf_expect_equal "$(printf '%s\n' "$python_urls" | grep -c '^https://')" "$python_url_count" \
    "便携版 Python 的每个候选都用 https"

node_urls=$(rf_build_node_bootstrap_urls arm64)
node_url_count=$(printf '%s\n' "$node_urls" | wc -l | tr -d ' ')
rf_expect_equal "$(printf '%s\n' "$node_urls" | tail -n 1)" \
    "https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-arm64.tar.gz" \
    "便携版 Node.js 的最后一个候选是 nodejs.org"
rf_expect_equal "$(printf '%s\n' "$node_urls" | head -n 1 | grep -c 'nodejs\.org')" "0" \
    "便携版 Node.js 先试国内镜像"
rf_expect_equal "$(printf '%s\n' "$node_urls" | grep -c 'node-v24.19.0-linux-arm64.tar.gz$')" "$node_url_count" \
    "便携版 Node.js 的每个候选都指向同一个包"
rf_expect_equal "$(printf '%s\n' "$node_urls" | grep -c 'darwin')" "0" \
    "便携版 Node.js 的候选里没有 macOS 包"

printf '\n== 状态目录：RF_STATE_DIR 注入 > XDG_DATA_HOME > ~/.local/share ==\n'
rf_expect_equal "$(RF_STATE_DIR="$rf_test_tmp/injected" rf_state_home)" "$rf_test_tmp/injected" \
    "RF_STATE_DIR 注入生效（测试与 CI 的注入口）"
rf_expect_equal "$(unset RF_STATE_DIR; XDG_DATA_HOME="$rf_test_tmp/xdg"; HOME=/home/nobody; rf_state_home)" \
    "$rf_test_tmp/xdg/ResumeForge" "XDG_DATA_HOME 被尊重"
rf_expect_equal "$(unset RF_STATE_DIR XDG_DATA_HOME; HOME=/home/nobody; rf_state_home)" \
    "/home/nobody/.local/share/ResumeForge" "没有 XDG_DATA_HOME 时用 XDG 的默认值"
# 注入口优先级最高：即使 XDG 也设了，RF_STATE_DIR 仍然赢（否则 CI 无法隔离）。
rf_expect_equal "$(RF_STATE_DIR="$rf_test_tmp/injected" XDG_DATA_HOME="$rf_test_tmp/xdg" rf_state_home)" \
    "$rf_test_tmp/injected" "RF_STATE_DIR 优先于 XDG_DATA_HOME"

printf '\n== 架构识别 ==\n'
# 用同名函数遮蔽 uname，避免依赖真实的处理器架构。
uname() { echo "x86_64"; }
rf_expect_equal "$(detect_linux_arch)" "x64" "x86_64 映射为 x64"
uname() { echo "amd64"; }
rf_expect_equal "$(detect_linux_arch)" "x64" "amd64（Go/BSD 口径）也映射为 x64"
uname() { echo "aarch64"; }
rf_expect_equal "$(detect_linux_arch)" "arm64" "aarch64 映射为 arm64"
uname() { echo "arm64"; }
rf_expect_equal "$(detect_linux_arch)" "arm64" "arm64 也映射为 arm64"
uname() { echo "riscv64"; }
arch_error=$( ( detect_linux_arch ) 2>&1 )
rf_expect_equal "$?" "1" "未知架构必须明确失败（不静默当成 x64）"
case "$arch_error" in
    *aarch64*x64* | *x64*aarch64*) rf_check 0 "未知架构的报错里列出了支持矩阵" ;;
    *) rf_check 1 "未知架构的报错里没有列出支持矩阵" ;;
esac
unset -f uname

printf '\n== 运行期目录解析（可写根不变、只读根改落状态目录）==\n'
rf_roots_probe="$rf_test_tmp/roots"
rf_state_probe="$rf_test_tmp/state-home"
mkdir -p "$rf_roots_probe/writable"

rf_expect_equal "$(rf_resolve_runtime_dir "$rf_roots_probe/writable" "$rf_state_probe")" \
    "$rf_roots_probe/writable/runtime" "可写根：runtime 落在项目根"
rf_expect_equal "$(rf_resolve_venv_dir "$rf_roots_probe/writable" "$rf_state_probe")" \
    "$rf_roots_probe/writable/backend/.venv" "可写根：venv 落在 backend/.venv"

if rf_dir_writable "$rf_roots_probe/writable"; then
    rf_check 0 "rf_dir_writable：可写目录返回成功"
else
    rf_check 1 "rf_dir_writable：可写目录返回成功"
fi
if rf_dir_writable "$rf_roots_probe/does-not-exist"; then
    rf_check 1 "rf_dir_writable：不存在的目录必须返回失败"
else
    rf_check 0 "rf_dir_writable：不存在的目录必须返回失败"
fi
printf 'x' >"$rf_roots_probe/plain-file"
if rf_dir_writable "$rf_roots_probe/plain-file"; then
    rf_check 1 "rf_dir_writable：文件路径必须返回失败（不是目录）"
else
    rf_check 0 "rf_dir_writable：文件路径必须返回失败（不是目录）"
fi
# 写探测用的临时文件必须自己清掉：判据函数不能变成"每次启动漏一个文件"。
rf_expect_equal "$(find "$rf_roots_probe/writable" -name '.rf-write-probe-*' | wc -l | tr -d ' ')" \
    "0" "rf_dir_writable 不留下写探测的临时文件"

# chmod 能不能真正取消写权限，是环境能力而不是代码性质：Windows 的 Git Bash 上
# chmod 基本是空操作（管理员身份更是如此），所以先探测再决定跑还是跳过。
rf_probe_readonly_capability() {
    probe_dir=$1
    mkdir -p "$probe_dir"
    chmod a-w "$probe_dir" 2>/dev/null || return 1
    if ( : >"$probe_dir/canary" ) 2>/dev/null; then
        rm -f "$probe_dir/canary" 2>/dev/null
        chmod u+w "$probe_dir" 2>/dev/null
        return 1
    fi
    chmod u+w "$probe_dir" 2>/dev/null
    return 0
}

readonly_root="$rf_roots_probe/readonly"
if rf_probe_readonly_capability "$readonly_root"; then
    chmod a-w "$readonly_root"
    rf_expect_equal "$(rf_resolve_runtime_dir "$readonly_root" "$rf_state_probe")" \
        "$rf_state_probe/runtime" "只读根：runtime 改落到状态目录"
    rf_expect_equal "$(rf_resolve_venv_dir "$readonly_root" "$rf_state_probe")" \
        "$rf_state_probe/venv" "只读根：venv 改落到状态目录"
    if rf_dir_writable "$readonly_root"; then
        rf_check 1 "rf_dir_writable：只读目录必须返回失败"
    else
        rf_check 0 "rf_dir_writable：只读目录必须返回失败"
    fi
    chmod u+w "$readonly_root"
else
    rf_skip "本机 chmod 无法真正取消写权限（Windows 的 Git Bash 就是这样），跳过只读根用例；它们在 Linux CI 上会真正执行。"
fi

printf '\n== 运行期目录候选：桌面壳留下的双层目录也要看 ==\n'
rf_cand_state="$rf_test_tmp/cand-state"
rf_cand_root="$rf_test_tmp/cand-proj"
mkdir -p "$rf_cand_root"
rf_cand_primary=$(rf_resolve_runtime_dir "$rf_cand_root" "$rf_cand_state")
rf_cand_legacy="$rf_cand_state/ResumeForge/runtime"
mkdir -p "$rf_cand_legacy"
rf_cand_list=$(rf_runtime_dir_candidates "$rf_cand_root" "$rf_cand_state")
rf_expect_equal "$(printf '%s\n' "$rf_cand_list" | sed -n '1p')" "$rf_cand_primary" \
    "候选列表第一项是当前解析结果（primary 优先）"
rf_expect_equal "$(printf '%s\n' "$rf_cand_list" | sed -n '2p')" "$rf_cand_legacy" \
    "桌面壳的双层目录被列出，且排在 primary 之后"
rf_expect_equal "$(rf_runtime_dir_candidates "$rf_cand_state/ResumeForge" "$rf_cand_state")" "$rf_cand_legacy" \
    "两个来源指向同一目录时只列一次（去重）"
rf_expect_equal "$(rf_runtime_dir_candidates "$rf_cand_root" "$rf_test_tmp/cand-clean-state" | wc -l | tr -d ' ')" \
    "1" "双层目录不存在时不额外列候选"

printf '\n== 服务地址跟随端口（不能提前固化）==\n'
RF_BACKEND_PORT=${RF_BACKEND_PORT:-8005}
RF_FRONTEND_PORT=${RF_FRONTEND_PORT:-5173}
rf_saved_backend_port=$RF_BACKEND_PORT
rf_saved_frontend_port=$RF_FRONTEND_PORT
RF_BACKEND_PORT=18123
RF_FRONTEND_PORT=15173
rf_expect_equal "$(rf_backend_url)" "http://127.0.0.1:18123" "换端口后后端地址跟着变"
rf_expect_equal "$(rf_frontend_url)" "http://127.0.0.1:15173" "换端口后前端地址跟着变"
RF_BACKEND_PORT=$rf_saved_backend_port
RF_FRONTEND_PORT=$rf_saved_frontend_port
rf_expect_equal "$(grep -c 'RF_BACKEND_URL=' "$RF_LINUX_DIR/start.sh")" "0" \
    "start.sh 没有提前固化后端地址"
rf_expect_equal "$(grep -c 'RF_FRONTEND_URL=' "$RF_LINUX_DIR/start.sh")" "0" \
    "start.sh 没有提前固化前端地址"

printf '\n== start.sh：参数解析与前端模式（source 进来只拿到函数）==\n'
# start.sh 有 BASH_SOURCE = $0 的主流程保护；但它带 set -euo pipefail，-e 会泄漏进
# 本测试（后面的用例依赖"失败只记 FAIL 不退出"），所以 source 完立刻关掉。
RF_FRONTEND_DIR="$rf_test_tmp/frontend-mode-fixture"
# shellcheck source=../linux/start.sh
. "$RF_LINUX_DIR/start.sh"
# sourcing start.sh 会装上它自己的 EXIT 收尾钩子（rf_cleanup_on_failure），那在测试
# 进程里毫无意义、还会在末尾多打一段"启动失败 / 已停止"的文案；同时它带 set -e，
# 会泄漏进后面的用例（那些用例依赖"失败只记 FAIL 不退出"）。两个都要立刻清掉/复位。
trap cleanup EXIT
set +e

# 默认值必须在**解析之前**断言：rf_parse_arguments 只会改动它收到的参数，
# 不会在无参调用时把默认值写回去（那是文件加载时的事）。
rf_expect_equal "$RF_BACKEND_PORT" "8005" "默认后端端口是 8005（与其它平台一致）"
rf_expect_equal "$RF_FRONTEND_PORT" "5173" "默认前端端口是 5173（与其它平台一致）"
rf_expect_equal "$RF_OPEN_BROWSER" "1" "默认会尝试打开浏览器"
rf_expect_equal "$RF_FRONTEND_MODE" "auto" "默认前端模式是 auto"

rf_parse_arguments --frontend-mode dev
rf_expect_equal "$RF_FRONTEND_MODE" "dev" "--frontend-mode dev 被解析为 dev"
rf_expect_equal "$RF_FRONTEND_MODE_EXPLICIT" "1" "显式传参要记下 EXPLICIT 标记（参数优先于 .env）"

( rf_parse_arguments --frontend-mode staging >/dev/null 2>&1 )
rf_expect_equal "$?" "2" "无效的 --frontend-mode 取值以 2 退出（用法错误）"
( rf_parse_arguments --backend-port 80 >/dev/null 2>&1 )
rf_expect_equal "$?" "2" "小于 1024 的端口被拒绝（不静默提权）"
( rf_parse_arguments --backend-port abc >/dev/null 2>&1 )
rf_expect_equal "$?" "2" "非数字端口被拒绝"
( rf_parse_arguments --backend-port 8005 --frontend-port 8005 >/dev/null 2>&1 )
rf_expect_equal "$?" "2" "后端与前端端口相同被拒绝"
( rf_parse_arguments --bogus >/dev/null 2>&1 )
rf_expect_equal "$?" "2" "未知参数以 2 退出"
( rf_parse_arguments --backend-port >/dev/null 2>&1 )
rf_expect_equal "$?" "2" "--backend-port 缺参数以 2 退出（而不是被 set -u 打断）"
( rf_parse_arguments --help >/dev/null 2>&1 )
rf_expect_equal "$?" "0" "--help 以 0 退出"
rf_parse_arguments --backend-port 8010 --frontend-port 5180 --no-browser
rf_expect_equal "$RF_BACKEND_PORT" "8010" "--backend-port 生效"
rf_expect_equal "$RF_FRONTEND_PORT" "5180" "--frontend-port 生效"
rf_expect_equal "$RF_OPEN_BROWSER" "0" "--no-browser 生效"
RF_BACKEND_PORT=8005
RF_FRONTEND_PORT=5173
RF_OPEN_BROWSER=1
rf_parse_arguments
rf_expect_equal "$RF_BACKEND_PORT" "8005" "无参调用不改端口（默认值来自文件加载，不是解析）"
rf_expect_equal "$RF_OPEN_BROWSER" "1" "无参调用不改浏览器开关"

dist_fixture="$rf_test_tmp/dist-fixture"
rm -rf "$dist_fixture"
RF_FRONTEND_MODE=auto
if rf_resolve_frontend_mode "$dist_fixture/dist/index.html"; then
    rf_check 1 "auto 模式没有 dist 必须退回 dev"
else
    rf_check 0 "auto 模式没有 dist 必须退回 dev"
fi
mkdir -p "$dist_fixture/dist"
printf '<html></html>' >"$dist_fixture/dist/index.html"
if rf_resolve_frontend_mode "$dist_fixture/dist/index.html"; then
    rf_check 0 "auto 模式有 dist 走同源静态"
else
    rf_check 1 "auto 模式有 dist 走同源静态"
fi
RF_FRONTEND_MODE=dev
if rf_resolve_frontend_mode "$dist_fixture/dist/index.html"; then
    rf_check 1 "dev 模式即使有 dist 也要起 Vite"
else
    rf_check 0 "dev 模式即使有 dist 也要起 Vite"
fi
RF_FRONTEND_MODE=production
if rf_resolve_frontend_mode "$dist_fixture/dist/index.html"; then
    rf_check 0 "production 模式有 dist 走同源静态"
else
    rf_check 1 "production 模式有 dist 走同源静态"
fi
rm -rf "$dist_fixture"
( rf_resolve_frontend_mode "$dist_fixture/dist/index.html" >/dev/null 2>&1 )
rf_expect_equal "$?" "1" "production 模式缺 dist 必须直接报错退出（不降级）"

env_fixture="$rf_test_tmp/backend.env"
RF_FRONTEND_MODE=auto
printf 'DATABASE_URL=sqlite:///x.db\n' >"$env_fixture"
if rf_read_frontend_mode_env "$env_fixture"; then
    rf_check 1 "没有 FRONTEND_MODE 的 .env 不能改动模式"
else
    rf_check 0 "没有 FRONTEND_MODE 的 .env 不能改动模式"
fi
printf 'DATABASE_URL=sqlite:///x.db\nFRONTEND_MODE=production\n' >"$env_fixture"
if rf_read_frontend_mode_env "$env_fixture"; then
    rf_expect_equal "$RF_FRONTEND_MODE" "production" ".env 里的 FRONTEND_MODE 能被读到"
else
    rf_check 1 ".env 里的 FRONTEND_MODE 能被读到"
fi
printf 'FRONTEND_MODE="dev"\r\n' >"$env_fixture"
if rf_read_frontend_mode_env "$env_fixture"; then
    rf_expect_equal "$RF_FRONTEND_MODE" "dev" "FRONTEND_MODE 的引号与 CR 会被剥掉"
else
    rf_check 1 "FRONTEND_MODE 的引号与 CR 会被剥掉"
fi

printf '\n== 打开浏览器：没有图形会话时必须安静成功 ==\n'
# 服务器 / SSH / CI 上没有 DISPLAY 也没有 WAYLAND_DISPLAY。这时"打不开浏览器"是
# 正常状态，不是启动失败——函数必须返回 0，只把地址打出来让用户自己访问。
rf_no_display_output=$( ( unset DISPLAY WAYLAND_DISPLAY; rf_open_browser "http://127.0.0.1:8005/" ) 2>&1 )
rf_no_display_status=$?
rf_expect_equal "$rf_no_display_status" "0" "没有 DISPLAY 时 rf_open_browser 返回 0（不打断启动）"
case "$rf_no_display_output" in
    *"http://127.0.0.1:8005/"*) rf_check 0 "没有图形会话时把手动访问地址打给了用户" ;;
    *) rf_check 1 "没有图形会话时没有输出可手动访问的地址" ;;
esac
rf_with_display_status=$( ( DISPLAY=":0"; unset WAYLAND_DISPLAY; rf_open_browser "http://127.0.0.1:8005/" ) >/dev/null 2>&1; echo $? )
rf_expect_equal "$rf_with_display_status" "0" "有 DISPLAY 但打不开浏览器时同样返回 0"
# 端口探测不许因为缺 ss/lsof 而报错退出；答案只能是"占用"或"没占用"。
( tcp_port_in_use 1 >/dev/null 2>&1 )
rf_port_probe_status=$?
if [ "$rf_port_probe_status" -le 1 ]; then
    rf_check 0 "tcp_port_in_use 在缺 ss/lsof 的环境里也只是返回 0 或 1"
else
    rf_check 1 "tcp_port_in_use 返回了意外的状态码 $rf_port_probe_status"
fi

printf '\n== 版本比较 ==\n'
if rf_version_ge "20.19.0" "20.19.0"; then rf_check 0 "20.19.0 >= 20.19.0"; else rf_check 1 "20.19.0 >= 20.19.0"; fi
if rf_version_ge "22.0.0" "20.19.0"; then rf_check 0 "22.0.0 >= 20.19.0"; else rf_check 1 "22.0.0 >= 20.19.0"; fi
if rf_version_ge "20.18.9" "20.19.0"; then rf_check 1 "20.18.9 < 20.19.0"; else rf_check 0 "20.18.9 < 20.19.0"; fi

printf '\n== 虚拟环境版本窗口 ==\n'
venv_config="$rf_test_tmp/pyvenv.cfg"
printf 'home = /usr/bin\nversion = 3.12.14\n' >"$venv_config"
if rf_venv_version_supported "$venv_config"; then rf_check 0 "3.12 的 venv 可以复用"; else rf_check 1 "3.12 的 venv 可以复用"; fi
printf 'home = /usr/bin\nversion = 3.10.21\n' >"$venv_config"
if rf_venv_version_supported "$venv_config"; then rf_check 1 "3.10 的 venv 已低于窗口下界，必须被拒绝"; else rf_check 0 "3.10 的 venv 已低于窗口下界，必须被拒绝"; fi
printf 'home = /usr/bin\nversion = 3.14.7\n' >"$venv_config"
if rf_venv_version_supported "$venv_config"; then rf_check 1 "3.14 的 venv 必须被拒绝"; else rf_check 0 "3.14 的 venv 必须被拒绝"; fi
printf 'home = /usr/bin\n' >"$venv_config"
if rf_venv_version_supported "$venv_config"; then rf_check 1 "缺少 version 行必须被拒绝"; else rf_check 0 "缺少 version 行必须被拒绝"; fi

printf '\n== Node 运行时判定 ==\n'
mkdir -p "$rf_test_tmp/nodebin"
make_version_stub() {
    stub_path=$1
    stub_output=$2
    {
        printf '#!/bin/sh\n'
        printf 'echo "%s"\n' "$stub_output"
    } >"$stub_path"
    chmod +x "$stub_path"
}
old_node="$rf_test_tmp/nodebin/old-node"
minimum_node="$rf_test_tmp/nodebin/min-node"
stub_npm="$rf_test_tmp/nodebin/npm"
make_version_stub "$old_node" "v20.18.0"
make_version_stub "$minimum_node" "v20.19.0"
make_version_stub "$stub_npm" "11.0.0"
if rf_node_runtime_candidate_ok "$old_node" "$stub_npm"; then
    rf_check 1 "低于 20.19.0 的 Node 必须被拒绝"
else
    rf_check 0 "低于 20.19.0 的 Node 必须被拒绝"
fi
if rf_node_runtime_candidate_ok "$minimum_node" "$stub_npm"; then
    rf_check 0 "20.19.0 且带 npm 必须被接受"
else
    rf_check 1 "20.19.0 且带 npm 必须被接受"
fi
if rf_node_runtime_candidate_ok "$minimum_node" "$rf_test_tmp/nodebin/no-such-npm"; then
    rf_check 1 "缺 npm 必须被拒绝"
else
    rf_check 0 "缺 npm 必须被拒绝"
fi

printf '\n== stop.sh：没有任何运行记录时必须安静成功 ==\n'
rf_stop_proj="$rf_test_tmp/stop-proj"
mkdir -p "$rf_stop_proj"
cp -R "$RF_TEST_ROOT/scripts" "$rf_stop_proj/scripts"
rf_stop_output=$(bash "$rf_stop_proj/scripts/linux/stop.sh" 2>&1)
rf_stop_status=$?
rf_expect_equal "$rf_stop_status" "0" "没有任何运行记录时 stop.sh 以 0 退出"
case "$rf_stop_output" in
    *已完成*) rf_check 0 "没有任何运行记录时 stop.sh 正常收尾" ;;
    *) rf_check 1 "没有任何运行记录时 stop.sh 正常收尾" ;;
esac
# 记录存在但进程已死（升级前留下的）：只提示、以 0 退出，绝不因为"对不上"就报错。
mkdir -p "$rf_stop_proj/runtime"
printf 'process_id=999999999\nstart_signature=Thu Jan  1 00:00:00 1970\n' \
    >"$rf_stop_proj/runtime/frontend.linux.pid"
printf 'process_id=999999999\nstart_signature=Thu Jan  1 00:00:00 1970\n' \
    >"$rf_stop_proj/runtime/backend.linux.pid"
rf_stop_output=$(bash "$rf_stop_proj/scripts/linux/stop.sh" 2>&1)
rf_expect_equal "$?" "0" "记录指向已死进程时 stop.sh 也以 0 退出"
case "$rf_stop_output" in
    *对不上*) rf_check 0 "记录对不上时明确说明并保留记录" ;;
    *) rf_check 1 "记录对不上时没有说明（输出：${rf_stop_output}）" ;;
esac
# 记录文件名必须是 .linux.pid：与 macOS 的 .macos.pid 区分，两个平台的脚本不会互相干扰。
rf_expect_equal "$(grep -c 'backend.linux.pid' "$RF_LINUX_DIR/start.sh")" "1" \
    "start.sh 写的是 backend.linux.pid"
rf_expect_equal "$(grep -c 'frontend.linux.pid' "$RF_LINUX_DIR/stop.sh")" "1" \
    "stop.sh 读的是 frontend.linux.pid"
rf_expect_equal "$(grep -c 'rf_runtime_dir_candidates' "$RF_LINUX_DIR/stop.sh")" "2" \
    "stop.sh 用 rf_runtime_dir_candidates 遍历运行记录可能所在的目录（含说明）"
# 兜底两个服务都要调：只给后端调过兜底的版本，前端残留会一直占着端口。
rf_expect_equal "$(grep -c 'rf_stop_unrecorded "backend"' "$RF_LINUX_DIR/stop.sh")" "1" \
    "stop.sh 对后端调用了端口兜底"
rf_expect_equal "$(grep -c 'rf_stop_unrecorded "frontend"' "$RF_LINUX_DIR/stop.sh")" "1" \
    "stop.sh 对前端调用了端口兜底"

# 这些用例依赖 ps 的 -o args= / -o lstart= 与 pgrep。缺能力时明确跳过，而不是把
# 环境差异报成代码缺陷——否则这个测试在 Windows 上会永久飘红，真正的红灯就被淹没了。
rf_probe_process_capability() {
    command -v pgrep >/dev/null 2>&1 || return 1
    sleep 60 >/dev/null 2>&1 &
    probe_pid=$!
    probe_args=$(process_command_line "$probe_pid")
    probe_signature=$(process_start_signature "$probe_pid")
    kill "$probe_pid" 2>/dev/null
    wait "$probe_pid" 2>/dev/null
    [ -n "$probe_args" ] && [ -n "$probe_signature" ]
}

if rf_probe_process_capability; then
    printf '\n== 进程记录：只认自己启动的那个进程 ==\n'
    sleep 300 >/dev/null 2>&1 &
    test_pid=$!
    record_path="$rf_test_tmp/payload.pid"
    save_process_record "$test_pid" "$record_path"
    rf_expect_equal "$(process_record_field "$record_path" "process_id")" "$test_pid" "记录里的 PID 可以读回"
    if process_record_match "$record_path" "sleep"; then
        rf_check 0 "命令行匹配时记录命中"
    else
        rf_check 1 "命令行匹配时记录命中"
    fi
    if process_record_match "$record_path" "uvicorn"; then
        rf_check 1 "命令行不匹配时记录必须落空"
    else
        rf_check 0 "命令行不匹配时记录必须落空"
    fi
    save_process_record "$test_pid" "$rf_test_tmp/reused.pid"
    sed 's/^start_signature=.*/start_signature=Thu Jan  1 00:00:00 1970/' \
        "$rf_test_tmp/reused.pid" >"$rf_test_tmp/reused-stale.pid"
    if process_record_match "$rf_test_tmp/reused-stale.pid" "sleep"; then
        rf_check 1 "启动时刻对不上时必须拒绝（PID 复用）"
    else
        rf_check 0 "启动时刻对不上时必须拒绝（PID 复用）"
    fi
    stop_recorded_process "test sleep" "$record_path" "sleep"
    if kill -0 "$test_pid" 2>/dev/null; then
        rf_check 1 "stop_recorded_process 应当停掉进程"
    else
        rf_check 0 "stop_recorded_process 应当停掉进程"
    fi
    if [ -f "$record_path" ]; then
        rf_check 1 "stop_recorded_process 应当删掉记录"
    else
        rf_check 0 "stop_recorded_process 应当删掉记录"
    fi

    printf '\n== 进程树停止 ==\n'
    /bin/sh -c 'sleep 300 & sleep 300' >/dev/null 2>&1 &
    tree_pid=$!
    sleep 1
    stop_process_tree "$tree_pid" TERM
    sleep 1
    tree_survivors=0
    for child in $(pgrep -P "$tree_pid" 2>/dev/null); do
        tree_survivors=$((tree_survivors + 1))
    done
    if kill -0 "$tree_pid" 2>/dev/null; then
        tree_survivors=$((tree_survivors + 1))
    fi
    rf_expect_equal "$tree_survivors" "0" "stop_process_tree 停掉了整棵树"
else
    rf_skip "本机的 ps 不支持 -o args=/-o lstart=，或没有 pgrep（Windows 的 Git Bash 就是这样），跳过进程记录与进程树用例；它们在 Linux CI 上会真正执行。"
fi

printf '\n== 日志尾巴 ==\n'
log_path="$rf_test_tmp/backend.stderr.log"
printf '\nINFO started\n\nRuntimeError: incomplete installation\n' >"$log_path"
rf_expect_equal "$(log_tail "$log_path" | wc -l | tr -d ' ')" "2" "log_tail 丢掉空行"
rf_expect_equal "$(log_tail "$log_path" 1)" "RuntimeError: incomplete installation" "log_tail 保留最后一行"
rf_expect_equal "$(log_tail "$rf_test_tmp/no-such.log" | wc -l | tr -d ' ')" "0" "日志不存在时返回空而不是报错"

printf '\n== 下载校验 ==\n'
good_file="$rf_test_tmp/good.bin"
printf 'resumeforge' >"$good_file"
good_sha=$(sha256_of "$good_file")
rf_expect_equal "$(printf '%s' "$good_sha" | wc -c | tr -d ' ')" "64" "sha256_of 输出 64 位十六进制摘要"
if download_file "file://$good_file" "$rf_test_tmp/probe.bin" 2>/dev/null; then
    if download_verified "$rf_test_tmp/target.bin" "$good_sha" "测试包" "0" "file://$good_file"; then
        rf_check 0 "摘要匹配时接受下载结果"
    else
        rf_check 1 "摘要匹配时接受下载结果"
    fi
    if download_verified "$rf_test_tmp/target2.bin" \
        "0000000000000000000000000000000000000000000000000000000000000000" \
        "测试包" "0" "file://$good_file" 2>/dev/null; then
        rf_check 1 "摘要不匹配时必须拒绝下载结果"
    else
        rf_check 0 "摘要不匹配时必须拒绝下载结果"
    fi
else
    rf_skip "当前环境的 curl 不支持 file://，跳过下载校验用例"
fi

printf '\n== 更新器：版本、资产名、白名单 ==\n'
# update.sh 有 BASH_SOURCE = $0 的主流程保护；但它带 set -e，source 完要关掉。
# shellcheck source=../linux/update.sh
. "$RF_LINUX_DIR/update.sh"
set +e

version_fixture="$rf_test_tmp/config.py"
printf 'class Settings:\n    app_version: str = "9.8.7"\n' >"$version_fixture"
rf_expect_equal "$(rf_local_version "$version_fixture")" "9.8.7" "本地版本号从 config.py 的 app_version 读出"
if [ -n "$(rf_local_version "$RF_TEST_ROOT/backend/app/config.py")" ]; then
    rf_check 0 "仓库里真实的 backend/app/config.py 能被解析出版本号"
else
    rf_check 1 "仓库里真实的 backend/app/config.py 解析不出 app_version"
fi
rf_expect_equal "$(rf_release_tag_to_version v2.0.0)" "2.0.0" "tag 的 v 前缀被剥掉"
rf_expect_equal "$(rf_release_tag_to_version 2.0.0)" "2.0.0" "没有 v 前缀的 tag 也认"
( rf_release_tag_to_version nightly >/dev/null 2>&1 )
rf_expect_equal "$?" "1" "无法解析的 tag 返回失败（不猜版本）"
rf_expect_equal "$(rf_linux_asset_name 2.0.0)" "ResumeForge-2.0.0-linux.zip" "linux 资产名符合发布约定"
rf_expect_equal "$(RF_REPOSITORY=owner/repo rf_update_asset_url v2.0.0 ResumeForge-2.0.0-linux.zip)" \
    "https://github.com/owner/repo/releases/download/v2.0.0/ResumeForge-2.0.0-linux.zip" \
    "资产下载地址符合 GitHub Release 的路径约定"
# 远端不比本地新时不更新：用户装的可能是更新的内测版，覆盖等于降级。
if rf_remote_is_newer "2.1.0" "2.0.0"; then rf_check 0 "2.1.0 比 2.0.0 新 → 更新"; else rf_check 1 "2.1.0 比 2.0.0 新 → 更新"; fi
if rf_remote_is_newer "2.0.0" "2.0.0"; then rf_check 1 "版本相同 → 不更新"; else rf_check 0 "版本相同 → 不更新"; fi
if rf_remote_is_newer "1.9.9" "2.0.0"; then rf_check 1 "远端比本地旧 → 不更新（不降级）"; else rf_check 0 "远端比本地旧 → 不更新（不降级）"; fi

rf_check_program_path() {
    relative_path=$1
    expected=$2   # 0 = 应当覆盖，1 = 应当跳过
    if rf_is_program_path "$relative_path"; then
        actual=0
    else
        actual=1
    fi
    if [ "$actual" = "$expected" ]; then
        rf_check 0 "$relative_path 的覆盖判断正确"
    else
        rf_check 1 "$relative_path 的覆盖判断不对（应当覆盖=${expected}）"
    fi
}
# 受跟踪的程序资源：必须覆盖（这正是"新版本加了文件却到不了老用户机器上"的那个 bug）。
rf_check_program_path "backend/app/main.py" 0
# backend/app/data 是**程序资源**（skills.json、ats_keywords.json、career_scenarios），
# preflight 依赖它们，必须覆盖。它和 backend/data（用户数据）只差一层目录，
# 所以这条断言是刻意写在这里的：按"名字叫 data 就跳过"写会让新版本的关键词表
# 永远到不了老用户机器上（macOS/Windows 两侧 2026-10-01 修过同一个 bug）。
rf_check_program_path "backend/app/data/skills.json" 0
rf_check_program_path "backend/app/data/ats_keywords.json" 0
rf_check_program_path "backend/requirements.txt" 0
# 迁移配置 / 开发依赖 / 运维脚本：漏了 alembic.ini 的表现是"新版本的迁移链跑不起来"。
rf_check_program_path "backend/alembic.ini" 0
rf_check_program_path "backend/requirements-dev.txt" 0
rf_check_program_path "backend/scripts/seed_demo.py" 0
rf_check_program_path "frontend/dist/index.html" 0
rf_check_program_path "frontend/dist/assets/app-abc123.js" 0
rf_check_program_path "scripts/linux/start.sh" 0
rf_check_program_path "docs/README.md" 0
rf_check_program_path "CHANGELOG.md" 0
rf_check_program_path "LICENSE" 0
rf_check_program_path "pyproject.toml" 0
# 根目录启动脚本三件套（Linux）+ 另外两套平台的入口：漏了它们，更新完新装的
# 启动逻辑就用不上（用户看到的还是旧 start.sh）。
rf_check_program_path "start.sh" 0
rf_check_program_path "stop.sh" 0
rf_check_program_path "update.sh" 0
rf_check_program_path "start.command" 0
rf_check_program_path "start.cmd" 0
# 白名单之外：一律不动。**默认值必须是"不动"**，这里一次性钉住"没被误加进白名单"。
rf_check_program_path "backend/data/app.db" 1
rf_check_program_path "backend/data/backups/2026.db" 1
rf_check_program_path "backend/data/captures/a.png" 1
rf_check_program_path "backend/.env" 1
rf_check_program_path "backend/backend_config.yaml" 1
rf_check_program_path "backend/.venv/bin/python" 1
rf_check_program_path "runtime/backend.stdout.log" 1
rf_check_program_path "desktop/main.js" 1
rf_check_program_path "frontend/package.json" 1
rf_check_program_path "frontend/node_modules/.bin/vite" 1
rf_check_program_path ".github/workflows/ci.yml" 1
rf_check_program_path ".git/config" 1
rf_check_program_path "AGENTS.md" 0
rf_check_program_path "branding/icon.png" 1
rf_check_program_path "CHANGELOG.md.bak" 1

# 备份清单必须"跟着发布包实际带来什么"走：漏了根目录三件套，回滚之后用户的
# start.sh 还是被覆盖过的新版本，其余文件已回退——得到一个半新半旧的安装目录。
rf_backup_fixture="$rf_test_tmp/backup-paths-fixture"
mkdir -p "$rf_backup_fixture/backend/app" "$rf_backup_fixture/frontend/dist" \
    "$rf_backup_fixture/backend/data" "$rf_backup_fixture/desktop"
: >"$rf_backup_fixture/start.sh"
: >"$rf_backup_fixture/README.md"
: >"$rf_backup_fixture/backend/app/main.py"
: >"$rf_backup_fixture/backend/data/app.db"
: >"$rf_backup_fixture/desktop/main.js"
: >"$rf_backup_fixture/LICENSE"
rf_collect_backup_paths "$rf_backup_fixture"
case " $RF_BACKUP_PATHS " in
    *" start.sh "*) rf_check 0 "备份清单包含根目录启动脚本（回滚能还原它）" ;;
    *) rf_check 1 "备份清单漏了根目录启动脚本（回滚后 start.sh 会是新版本）" ;;
esac
case " $RF_BACKUP_PATHS " in
    *" README.md "*) rf_check 0 "备份清单包含根目录 *.md" ;;
    *) rf_check 1 "备份清单漏了根目录 *.md" ;;
esac
case " $RF_BACKUP_PATHS " in
    *" backend/data "* | *" backend/data"*) rf_check 1 "备份清单里混进了用户数据目录（绝不该发生）" ;;
    *) rf_check 0 "备份清单里没有用户数据目录" ;;
esac
case " $RF_BACKUP_PATHS " in
    *" desktop "* | *" desktop"*) rf_check 1 "备份清单里混进了 desktop/（由它自己的更新路径负责）" ;;
    *) rf_check 0 "备份清单里没有 desktop/" ;;
esac
case " $RF_BACKUP_PATHS " in
    *" frontend/dist "*) rf_check 0 "备份清单包含 frontend/dist" ;;
    *) rf_check 1 "备份清单漏了 frontend/dist" ;;
esac

rf_expect_equal "$(grep -c 'com.apple' "$RF_LINUX_DIR/update.sh")" "0" "update.sh 里没有 macOS 专有命令"

# 真复制一遍：只看判断不够，还要确认递归真的按相对路径走，而且用户数据一个字都不动。
rf_copy_src="$rf_test_tmp/updater-src/ResumeForge"
rf_copy_dst="$rf_test_tmp/updater-dst"
mkdir -p "$rf_copy_src/backend/app/data" "$rf_copy_src/backend/data" "$rf_copy_src/desktop" \
    "$rf_copy_src/frontend/dist" "$rf_copy_dst"
: >"$rf_copy_src/backend/app/data/skills.json"
: >"$rf_copy_src/backend/data/app.db"
: >"$rf_copy_src/backend/.env"
: >"$rf_copy_src/backend/alembic.ini"
: >"$rf_copy_src/desktop/main.js"
: >"$rf_copy_src/frontend/dist/index.html"
: >"$rf_copy_src/start.sh"
RF_COPIED_FILES=0
rf_copy_program_files "$rf_copy_src" "$rf_copy_dst"
if [ -f "$rf_copy_dst/backend/app/data/skills.json" ]; then
    rf_check 0 "backend/app/data 下的程序资源会被覆盖"
else
    rf_check 1 "backend/app/data 下的程序资源没有被覆盖"
fi
if [ -f "$rf_copy_dst/backend/data/app.db" ]; then
    rf_check 1 "backend/data 下的用户数据被复制了（绝不该发生）"
else
    rf_check 0 "backend/data 下的用户数据留在原地"
fi
if [ -f "$rf_copy_dst/backend/.env" ]; then
    rf_check 1 "backend/.env 被复制了（绝不该发生）"
else
    rf_check 0 "backend/.env 留在原地"
fi
if [ -f "$rf_copy_dst/desktop/main.js" ]; then
    rf_check 1 "desktop/ 被覆盖了（桌面壳由它自己更新）"
else
    rf_check 0 "desktop/ 没有被覆盖"
fi
if [ -f "$rf_copy_dst/frontend/dist/index.html" ]; then
    rf_check 0 "frontend/dist 会被覆盖"
else
    rf_check 1 "frontend/dist 没有被覆盖"
fi
if [ -f "$rf_copy_dst/start.sh" ]; then
    rf_check 0 "根目录启动脚本会被覆盖"
else
    rf_check 1 "根目录启动脚本没有被覆盖"
fi
if [ -f "$rf_copy_dst/backend/alembic.ini" ]; then
    rf_check 0 "backend/alembic.ini 会被覆盖（迁移配置必须跟着版本走）"
else
    rf_check 1 "backend/alembic.ini 没有被覆盖（新版本的迁移链会跑不起来）"
fi

printf '\n'
if [ "$rf_test_failures" -eq 0 ]; then
    printf 'Linux 启动链测试全部通过（%d 项）。\n' "$rf_test_passes"
    exit 0
fi
printf 'Linux 启动链测试失败 %d 项（通过 %d 项）。\n' "$rf_test_failures" "$rf_test_passes"
exit 1
