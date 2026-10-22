#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# macOS 启动链的守卫测试。
#
# 为什么需要它：项目的维护者手上没有 Mac，macOS 分支的脚本**没法靠人工跑一遍来验证**。
# 这份测试就是那台缺席的 Mac —— 它在 CI 的 macOS runner 上跑，对同一批纯函数做断言，
# 把"只能靠人肉发现"的问题变成红灯：
#
#   * 换行/编码：.sh 与 .command 出现 CRLF，macOS 上会以
#     "bad interpreter: /bin/bash^M" 失败，而任何在 Windows 上的编辑都可能带进来；
#   * 可执行位：.command 双击要靠它；
#   * 自举常量（版本号、SHA-256、下载源）：钉死在这里，改一处必须同步改另一处；
#   * 版本窗口判断、进程记录匹配、进程树停止这些纯逻辑。
#
# 刻意不依赖任何测试框架：macOS 自带 bash 3.2，装了 pytest/vitest 也没用。
# 用法：bash scripts/tests/test-macos-launcher.sh

set -uo pipefail

RF_TEST_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
RF_START_SCRIPT="$RF_TEST_ROOT/scripts/macos/start.sh"

RF_SHELL_SOURCES="start.command stop.command update.command
scripts/macos/start.sh scripts/macos/stop.sh scripts/macos/update.sh
scripts/macos/lib/common.sh scripts/macos/lib/python.sh scripts/macos/lib/node.sh"

# 会被**直接执行**的脚本（.command 双击、或 bash scripts/macos/*.sh），必须有 shebang；
# lib/*.sh 是被 source 进来的，不带 shebang 是惯例，也不该被要求。
RF_EXECUTABLE_SOURCES="start.command stop.command update.command
scripts/macos/start.sh scripts/macos/stop.sh scripts/macos/update.sh"

# 变量定界检查要多扫两份：守卫脚本**自己**踩过同一个坑（它的失败信息里就有），
# GitHub Actions 的 workflow 里也踩过（同一个坑在 yml 的 run: 段里同样会触发）。
RF_QUOTING_SOURCES="$RF_SHELL_SOURCES
scripts/tests/test-macos-launcher.sh
.github/workflows/ci.yml"

# 可选参数 1：临时目录的父目录。默认用 TMPDIR（macOS 上指向每个用户的私有目录），
# 只在 TMPDIR 不可写的环境里才需要显式指定。
rf_test_tmp_root=${1:-${TMPDIR:-/tmp}}
rf_test_tmp=$(mktemp -d "$rf_test_tmp_root/resumeforge-macos-test-XXXXXX") || {
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

cleanup() {
    rm -rf "$rf_test_tmp"
}
trap cleanup EXIT

rf_check() {
    condition=$1
    message=$2
    if [ "$condition" = "0" ]; then
        printf '  ok   %s\n' "$message"
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
        rf_check 1 "$relative_path 含有 CR：macOS 上会以 'bad interpreter' 失败"
    fi
done

for relative_path in $RF_EXECUTABLE_SOURCES; do
    source_path="$RF_TEST_ROOT/$relative_path"
    [ -s "$source_path" ] || continue
    rf_expect_equal "$(head -n 1 "$source_path")" '#!/bin/bash' "$relative_path 的 shebang 是 #!/bin/bash"
done

# .command 必须在 git 里带可执行位，否则 Finder 双击会被拒绝。
if command -v git >/dev/null 2>&1 && git -C "$RF_TEST_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    for command_name in start.command stop.command update.command; do
        mode=$(git -C "$RF_TEST_ROOT" ls-files --stage -- "$command_name" 2>/dev/null | awk '{print $1}' | head -n 1)
        if [ -z "$mode" ]; then
            rf_skip "$command_name 还没有被 git 跟踪，无法检查可执行位"
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

printf '\n== 变量插值定界（macOS 自带 bash 3.2 的坑）==\n'
# macOS 自带的 /bin/bash 是 **3.2**：它会把变量名后紧跟的**多字节字符首字节**读进变量名。
# 实测 CI 报过 "message<乱码>: unbound variable"——中文文案里插变量必须写成花括号形式。
# 本机的 bash 5 与 PowerShell 都看不见这个问题，只有 CI 的 macOS 作业能暴露，所以钉在这里。
# 判据按字节：C locale 下 [^ -~] 即 >=0x7F（非可打印 ASCII），不依赖 locale 的多字节处理。
for relative_path in $RF_QUOTING_SOURCES; do
    if LC_ALL=C grep -nE '\$[A-Za-z_][A-Za-z0-9_]*[^ -~]' "$RF_TEST_ROOT/$relative_path" \
        >"$rf_test_tmp/bare-var.txt" 2>/dev/null; then
        rf_check 1 "$relative_path 变量后紧跟中文，要写成花括号定界：$(head -n 1 "$rf_test_tmp/bare-var.txt")"
    else
        rf_check 0 "$relative_path 变量插值都有定界"
    fi
done

printf '\n== 自举常量（改版本必须同步改这里）==\n'
# 让 libs 能自己算出默认的工具目录；正常使用时这几个变量由 start.sh 定义。
RF_RUNTIME_DIR="$rf_test_tmp/runtime"
mkdir -p "$RF_RUNTIME_DIR"
# shellcheck source=../macos/lib/common.sh
. "$RF_TEST_ROOT/scripts/macos/lib/common.sh"
# shellcheck source=../macos/lib/python.sh
. "$RF_TEST_ROOT/scripts/macos/lib/python.sh"
# shellcheck source=../macos/lib/node.sh
. "$RF_TEST_ROOT/scripts/macos/lib/node.sh"

rf_expect_equal "$RF_PYTHON_MIN_MAJOR.$RF_PYTHON_MIN_MINOR" "3.11" "Python 版本窗口下界是 3.11"
rf_expect_equal "$RF_PYTHON_MAX_MAJOR.$RF_PYTHON_MAX_MINOR" "3.13" "Python 版本窗口上界是 3.13"
rf_expect_equal "$RF_NODE_MIN_VERSION" "20.19.0" "Node.js 最低版本是 20.19.0"
rf_expect_equal "$RF_NODE_BOOTSTRAP_VERSION" "24.19.0" "便携版 Node.js 钉在 24.19.0"
rf_expect_equal "$RF_PYTHON_BOOTSTRAP_VERSION" "3.12.14" "便携版 Python 钉在 3.12.14"
rf_expect_equal "$RF_PYTHON_BOOTSTRAP_TAG" "20260901" "便携版 Python 钉在 20260901 这一次发布"
rf_expect_equal "$RF_PYTHON_AARCH64_SHA256" "3ee3ee547cedfeb7c2b16b2b7156039f7b470bb8f857e226fd3d2eb11db83c76" "Python aarch64 摘要正确"
rf_expect_equal "$RF_PYTHON_X64_SHA256" "2e31b23f3f1319f707d0e620b48847a0046577541d357276821f9f1b5492e0ba" "Python x64 摘要正确"
rf_expect_equal "$RF_NODE_AARCH64_SHA256" "8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d" "Node.js arm64 摘要正确"
rf_expect_equal "$RF_NODE_X64_SHA256" "d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316" "Node.js x64 摘要正确"

printf '\n== 下载候选 ==\n'
official_python_url="https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14+20260901-aarch64-apple-darwin-install_only.tar.gz"
python_urls=$(rf_build_python_bootstrap_urls arm64)
python_url_count=$(printf '%s\n' "$python_urls" | wc -l | tr -d ' ')
rf_expect_equal "$(printf '%s\n' "$python_urls" | tail -n 1)" "$official_python_url" \
    "便携版 Python 的最后一个候选是 GitHub 官方地址"
if [ "$python_urls" = "$official_python_url" ]; then
    rf_check 1 "便携版 Python 必须先试加速站点（当前只有官方地址一个候选）"
else
    rf_check 0 "便携版 Python 先试加速站点，官方放最后"
fi
# 上游 python-build-standalone 用的是 aarch64（不是 arm64）。这条以前写的是 arm64，
# 等于把"拼出来的资产名在上游不存在"当成了规范——CI 上三个源各 404 一次才发现。
rf_expect_equal "$(printf '%s\n' "$python_urls" | grep -c 'aarch64-apple-darwin')" "$python_url_count" \
    "便携版 Python 的每个候选都指向上游口径的 aarch64 包"
rf_expect_equal "$(printf '%s\n' "$python_urls" | grep -c 'arm64-apple-darwin')" "0" \
    "便携版 Python 的候选里没有上游不存在的 arm64 命名"
rf_expect_equal "$(printf '%s\n' "$python_urls" | grep -c '^https://')" "$python_url_count" \
    "便携版 Python 的每个候选都用 https"

node_urls=$(rf_build_node_bootstrap_urls arm64)
node_url_count=$(printf '%s\n' "$node_urls" | wc -l | tr -d ' ')
rf_expect_equal "$(printf '%s\n' "$node_urls" | tail -n 1)" \
    "https://nodejs.org/dist/v24.19.0/node-v24.19.0-darwin-arm64.tar.gz" \
    "便携版 Node.js 的最后一个候选是 nodejs.org"
rf_expect_equal "$(printf '%s\n' "$node_urls" | head -n 1 | grep -c 'nodejs\.org')" "0" \
    "便携版 Node.js 先试国内镜像"
rf_expect_equal "$(printf '%s\n' "$node_urls" | grep -c 'node-v24.19.0-darwin-arm64.tar.gz$')" "$node_url_count" \
    "便携版 Node.js 的每个候选都指向同一个包"
rf_expect_equal "$(printf '%s\n' "$node_urls" | grep -c '^https://')" "$node_url_count" \
    "便携版 Node.js 的每个候选都用 https"

printf '\n== 服务地址跟随端口（不能提前固化）==\n'
# 现场教训：CI 上传 --backend-port 8123，uvicorn 确实监听 8123，但探针一直敲 8005
# ——因为 URL 是在参数解析之前拼好存进变量的。这里直接验证"改了端口，地址就变"。
# 端口变量定义在 start.sh 里（不在被 source 的 common.sh），守卫里要先补上默认值。
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
# 反向断言：start.sh 里不能再出现"赋值成字面 URL"的写法（那正是这次故障的形状）。
rf_expect_equal "$(grep -c 'RF_BACKEND_URL=' "$RF_TEST_ROOT/scripts/macos/start.sh")" "0" \
    "start.sh 没有提前固化后端地址"
rf_expect_equal "$(grep -c 'RF_FRONTEND_URL=' "$RF_TEST_ROOT/scripts/macos/start.sh")" "0" \
    "start.sh 没有提前固化前端地址"

printf '\n== frontend-mode（RF-09：有 dist 走后端同源，没有退回 dev）==\n'
# start.sh 有 BASH_SOURCE = $0 的主流程保护，source 它只会拿到函数与默认值。
# 但它带 set -euo pipefail，-e 会泄漏进本测试（update.sh 同款坑，见文件末尾
# 同样的处理）：后面的用例依赖"失败只记 FAIL 不退出"，所以 source 完立刻关掉。
RF_FRONTEND_DIR="$rf_test_tmp/frontend-mode-fixture"
# shellcheck source=../macos/start.sh
. "$RF_TEST_ROOT/scripts/macos/start.sh"
set +e

rf_parse_arguments --frontend-mode dev
rf_expect_equal "$RF_FRONTEND_MODE" "dev" "--frontend-mode dev 被解析为 dev"
rf_expect_equal "$RF_FRONTEND_MODE_EXPLICIT" "1" "显式传参要记下 EXPLICIT 标记（参数优先于 .env）"

( rf_parse_arguments --frontend-mode staging >/dev/null 2>&1 )
rf_expect_equal "$?" "2" "无效的 --frontend-mode 取值以 2 退出（用法错误）"

dist_fixture="$RF_TEST_ROOT/scripts/macos/no-such-dist-for-tests"
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
if rf_read_frontend_mode_env "$rf_test_tmp/no-such.env"; then
    rf_check 1 ".env 不存在时返回失败而不报错"
else
    rf_check 0 ".env 不存在时返回失败而不报错"
fi

printf '\n== 停止链面对"没有 node 进程"必须安静成功 ==\n'
# 升级路径的两个方向：旧版起过 vite、新版同源模式不再起 node。stop 都不许报错：
# 记录缺失时安静返回；记录存在但进程已死（升级前留下的）时也只提示、以 0 退出。
rf_stop_proj="$rf_test_tmp/stop-proj"
mkdir -p "$rf_stop_proj"
cp -R "$RF_TEST_ROOT/scripts" "$rf_stop_proj/scripts"
rf_stop_output=$(bash "$rf_stop_proj/scripts/macos/stop.sh" 2>&1)
rf_stop_status=$?
rf_expect_equal "$rf_stop_status" "0" "没有任何运行记录时 stop.sh 以 0 退出"
case "$rf_stop_output" in
    *已完成*) rf_check 0 "没有任何运行记录时 stop.sh 正常收尾" ;;
    *) rf_check 1 "没有任何运行记录时 stop.sh 正常收尾" ;;
esac
mkdir -p "$rf_stop_proj/runtime"
printf 'process_id=999999999\nstart_signature=Thu Jan  1 00:00:00 1970\n' \
    >"$rf_stop_proj/runtime/frontend.macos.pid"
printf 'process_id=999999999\nstart_signature=Thu Jan  1 00:00:00 1970\n' \
    >"$rf_stop_proj/runtime/backend.macos.pid"
rf_stop_output=$(bash "$rf_stop_proj/scripts/macos/stop.sh" 2>&1)
rf_stop_status=$?
rf_expect_equal "$rf_stop_status" "0" "记录指向已死进程（升级前的前端）时 stop.sh 也以 0 退出"

printf '\n== 运行期目录解析（只读安装目录：mac 打包态的落点）==\n'
# 这一组守的是一个**设计级**问题，不是某条路径笔误：mac 的 payload 不带
# python-runtime.zip，于是桌面壳走兜底启动器 start.sh；而 .app 从 dmg 启动时
# 所在的卷是只读的（AppTranslocation 还会把它挂到随机路径），在项目根下建
# runtime/ 与 backend/.venv 必然失败，首次启动因此永远起不来。
# 判据只有两条：
#   1) 项目根可写时必须与以前**完全一致**（CI 的 macos-end-to-end 就是可写工作树）；
#   2) 项目根只读时必须整体挪到状态目录，安装目录里一个字节都不写。
rf_roots_probe="$rf_test_tmp/roots"
rf_state_probe="$rf_test_tmp/state-home"
mkdir -p "$rf_roots_probe/writable"

rf_expect_equal "$(rf_resolve_runtime_dir "$rf_roots_probe/writable" "$rf_state_probe")" \
    "$rf_roots_probe/writable/runtime" "可写根：runtime 落在项目根（现有行为不回归）"
rf_expect_equal "$(rf_resolve_venv_dir "$rf_roots_probe/writable" "$rf_state_probe")" \
    "$rf_roots_probe/writable/backend/.venv" "可写根：venv 落在 backend/.venv（现有行为不回归）"

# rf_dir_writable 的四种输入：可写目录、不存在的路径、文件路径、只读目录（下面）。
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

# 三条脚本必须共用 common.sh 那一套解析，且 stop.sh 必须走"遍历候选目录"这条路径。
#
# 后半句是这一组里最容易退化成空转的一条：rf_runtime_dir_candidates 一旦没有调用点
# 就是死代码，而它的死掉**不会让任何单目录用例变红**——只会在用户双击 stop.command
# 时表现为"没有找到运行记录"，后端却还在跑（1.0.2 及更早的旧壳把记录写在
# <state>/ResumeForge/runtime 里）。所以这里直接钉住"stop.sh 引用了它"。
rf_check_shared_runtime_dir_resolution() {
    if grep -q 'rf_runtime_dir_candidates' "$RF_TEST_ROOT/scripts/macos/stop.sh"; then
        rf_check 0 "stop.sh 用 rf_runtime_dir_candidates 遍历运行记录可能所在的目录"
    else
        rf_check 1 "stop.sh 没有引用 rf_runtime_dir_candidates（只认一个目录，旧壳的记录会被漏掉）"
    fi
    rf_expect_equal "$(grep -c 'rf_resolve_runtime_dir' "$RF_TEST_ROOT/scripts/macos/update.sh")" \
        "1" "update.sh 用 common.sh 的解析函数定位运行期目录"
}

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
    # 判据函数在只读目录里也不能留下残骸（写失败时那次 rm 是空转）。
    rf_expect_equal "$(find "$readonly_root" -name '.rf-write-probe-*' | wc -l | tr -d ' ')" \
        "0" "只读目录里没有写探测的残留"

    # 三条脚本必须共用同一套解析：stop.sh / update.sh 各自写死
    # $RF_PROJECT_ROOT/runtime 的话，只读安装目录下服务就停不掉（记录在
    # 状态目录里，而它们去项目根找）。
    rf_check_shared_runtime_dir_resolution

    # 功能验证：记录放在状态目录里，只读项目根下跑 stop.sh 必须**看到**它。
    # 记录指向一个已死的 PID，所以正确行为是"记录与当前进程对不上，没有停止
    # 任何进程"，而反例（去项目根找）会说"没有找到运行记录"。
    rf_ro_proj="$rf_test_tmp/readonly-proj"
    mkdir -p "$rf_ro_proj"
    cp -R "$RF_TEST_ROOT/scripts" "$rf_ro_proj/scripts"
    mkdir -p "$rf_state_probe/runtime"
    mkdir -p "$rf_ro_proj/runtime"
    printf 'process_id=999999999\nstart_signature=Thu Jan  1 00:00:00 1970\n' \
        >"$rf_state_probe/runtime/backend.macos.pid"
    chmod -R a-w "$rf_ro_proj"
    rf_ro_output=$(RF_STATE_DIR="$rf_state_probe" bash "$rf_ro_proj/scripts/macos/stop.sh" 2>&1)
    rf_ro_status=$?
    chmod -R u+w "$rf_ro_proj"
    rf_expect_equal "$rf_ro_status" "0" "只读项目根下 stop.sh 以 0 退出"
    case "$rf_ro_output" in
        *对不上*) rf_check 0 "只读项目根下 stop.sh 从状态目录读到了运行记录" ;;
        *) rf_check 1 "只读项目根下 stop.sh 没有从状态目录读到运行记录（输出：${rf_ro_output}）" ;;
    esac
    rm -f "$rf_state_probe/runtime/backend.macos.pid"
else
    rf_skip "本机 chmod 无法真正取消写权限（Windows 的 Git Bash 就是这样），跳过只读根用例；它们在 macOS CI 上会真正执行。"
    rf_check_shared_runtime_dir_resolution
fi

printf '\n== 运行期目录候选：旧壳留下的双层目录也要看 ==\n'
# 现场形态：1.0.2 及更早的桌面壳在 Electron userData 之下又拼了一层产品名，记录落在
# <state>/ResumeForge/runtime；而双击 stop.command 时 RF_STATE_DIR 未设、解析出的
# primary 是 <state>/runtime。只认 primary 就会打印"没有找到运行记录"，而后端其实
# 还在跑、端口仍被占着——所以停服务必须遍历候选目录（这是本次修掉的假绿）。
rf_cand_state="$rf_test_tmp/cand-state"
rf_cand_root="$rf_test_tmp/cand-proj"
mkdir -p "$rf_cand_root"
rf_cand_primary=$(rf_resolve_runtime_dir "$rf_cand_root" "$rf_cand_state")
rf_cand_legacy="$rf_cand_state/ResumeForge/runtime"

# 1) 只有旧壳的双层目录存在，而且里面还留着一份记录。
mkdir -p "$rf_cand_legacy"
printf 'process_id=999999999\nstart_signature=Thu Jan  1 00:00:00 1970\n' \
    >"$rf_cand_legacy/backend.macos.pid"
rf_cand_list=$(rf_runtime_dir_candidates "$rf_cand_root" "$rf_cand_state")
rf_expect_equal "$(printf '%s\n' "$rf_cand_list" | sed -n '1p')" "$rf_cand_primary" \
    "候选列表第一项是当前解析结果（primary 优先）"
rf_expect_equal "$(printf '%s\n' "$rf_cand_list" | sed -n '2p')" "$rf_cand_legacy" \
    "旧壳的双层目录被列出，且排在 primary 之后"
rf_expect_equal "$(printf '%s\n' "$rf_cand_list" | wc -l | tr -d ' ')" "2" \
    "只有旧壳目录存在时，候选恰好两行"

# 2) 两个目录都存在：仍然两行、没有重复项、顺序稳定（两次调用同一结果）。
mkdir -p "$rf_cand_root/runtime"
rf_cand_list=$(rf_runtime_dir_candidates "$rf_cand_root" "$rf_cand_state")
rf_expect_equal "$(printf '%s\n' "$rf_cand_list" | wc -l | tr -d ' ')" "2" \
    "两个目录都存在时候选仍是两行"
rf_expect_equal "$(printf '%s\n' "$rf_cand_list" | sort -u | wc -l | tr -d ' ')" "2" \
    "两个目录都存在时候选里没有重复项"
rf_expect_equal "$(rf_runtime_dir_candidates "$rf_cand_root" "$rf_cand_state")" "$rf_cand_list" \
    "候选顺序稳定（同样输入两次调用结果一致）"

# 3) 两个来源指向同一个目录（项目根正好是 <state>/ResumeForge）时只列一次。
rf_cand_overlap="$rf_cand_state/ResumeForge"
rf_expect_equal "$(rf_runtime_dir_candidates "$rf_cand_overlap" "$rf_cand_state")" "$rf_cand_legacy" \
    "两个来源指向同一目录时只列一次（去重）"

# 4) 目录不存在就不列：没有任何旧壳痕迹的状态目录只给出 primary。
rf_cand_clean="$rf_test_tmp/cand-clean-state"
rf_expect_equal "$(rf_runtime_dir_candidates "$rf_cand_root" "$rf_cand_clean" | wc -l | tr -d ' ')" "1" \
    "旧壳目录不存在时不额外列候选"

# 5) 端到端：只有旧壳记录时 stop.sh 必须**看到**它。记录指向一个已死 PID，
#    所以正确行为是"记录与当前进程对不上"（不是"没有找到运行记录"），
#    并且输出里带上那个目录——用户报"停不掉"时第一个要问的就是"你看了哪个目录"。
rf_legacy_proj="$rf_test_tmp/legacy-proj"
mkdir -p "$rf_legacy_proj"
cp -R "$RF_TEST_ROOT/scripts" "$rf_legacy_proj/scripts"
rf_legacy_state="$rf_test_tmp/legacy-state"
mkdir -p "$rf_legacy_state/ResumeForge/runtime"
printf 'process_id=999999999\nstart_signature=Thu Jan  1 00:00:00 1970\n' \
    >"$rf_legacy_state/ResumeForge/runtime/backend.macos.pid"
rf_legacy_output=$(RF_STATE_DIR="$rf_legacy_state" bash "$rf_legacy_proj/scripts/macos/stop.sh" 2>&1)
rf_legacy_status=$?
rf_expect_equal "$rf_legacy_status" "0" "只有旧壳记录时 stop.sh 以 0 退出"
case "$rf_legacy_output" in
    *"backend：没有找到运行记录"*) rf_check 1 "只有旧壳记录时 stop.sh 不得报告「没有找到运行记录」" ;;
    *) rf_check 0 "只有旧壳记录时 stop.sh 不报告「没有找到运行记录」" ;;
esac
case "$rf_legacy_output" in
    *"$rf_legacy_state/ResumeForge/runtime"*) rf_check 0 "stop.sh 从旧壳的双层目录读到了记录，并在输出里带上路径" ;;
    *) rf_check 1 "stop.sh 没有从旧壳的双层目录读到记录（输出：${rf_legacy_output}）" ;;
esac

printf '\n== 架构识别 ==\n'
# 用同名函数遮蔽 uname，避免依赖真实的处理器架构。
uname() { echo "arm64"; }
rf_expect_equal "$(detect_macos_arch)" "arm64" "arm64 映射为 Node 的 arm64"
uname() { echo "x86_64"; }
rf_expect_equal "$(detect_macos_arch)" "x64" "x86_64 映射为 Node 的 x64"

printf '\n== 版本比较 ==\n'
if rf_version_ge "20.19.0" "20.19.0"; then rf_check 0 "20.19.0 >= 20.19.0"; else rf_check 1 "20.19.0 >= 20.19.0"; fi
if rf_version_ge "20.19.1" "20.19.0"; then rf_check 0 "20.19.1 >= 20.19.0"; else rf_check 1 "20.19.1 >= 20.19.0"; fi
if rf_version_ge "22.0.0" "20.19.0"; then rf_check 0 "22.0.0 >= 20.19.0"; else rf_check 1 "22.0.0 >= 20.19.0"; fi
if rf_version_ge "20.18.9" "20.19.0"; then rf_check 1 "20.18.9 < 20.19.0"; else rf_check 0 "20.18.9 < 20.19.0"; fi
if rf_version_ge "19.99.99" "20.19.0"; then rf_check 1 "19.99.99 < 20.19.0"; else rf_check 0 "19.99.99 < 20.19.0"; fi

printf '\n== 虚拟环境版本窗口 ==\n'
venv_config="$rf_test_tmp/pyvenv.cfg"
printf 'home = /opt/tools/python\nversion = 3.12.14\n' >"$venv_config"
if rf_venv_version_supported "$venv_config"; then rf_check 0 "3.12 的 venv 可以复用"; else rf_check 1 "3.12 的 venv 可以复用"; fi
printf 'home = /opt/tools/python\nversion = 3.10.21\n' >"$venv_config"
if rf_venv_version_supported "$venv_config"; then rf_check 1 "3.10 的 venv 已低于窗口下界，必须被拒绝"; else rf_check 0 "3.10 的 venv 已低于窗口下界，必须被拒绝"; fi
printf 'home = /opt/tools/python\nversion = 3.13.15\n' >"$venv_config"
if rf_venv_version_supported "$venv_config"; then rf_check 0 "3.13 的 venv 可以复用"; else rf_check 1 "3.13 的 venv 可以复用"; fi
printf 'home = /opt/tools/python\nversion = 3.14.7\n' >"$venv_config"
if rf_venv_version_supported "$venv_config"; then rf_check 1 "3.14 的 venv 必须被拒绝"; else rf_check 0 "3.14 的 venv 必须被拒绝"; fi
printf 'home = /opt/tools/python\nversion = 3.9.6\n' >"$venv_config"
if rf_venv_version_supported "$venv_config"; then rf_check 1 "3.9 的 venv 必须被拒绝"; else rf_check 0 "3.9 的 venv 必须被拒绝"; fi
printf 'home = /opt/tools/python\n' >"$venv_config"
if rf_venv_version_supported "$venv_config"; then rf_check 1 "缺少 version 行必须被拒绝"; else rf_check 0 "缺少 version 行必须被拒绝"; fi
if rf_venv_version_supported "$rf_test_tmp/no-such-cfg"; then rf_check 1 "配置文件不存在必须被拒绝"; else rf_check 0 "配置文件不存在必须被拒绝"; fi

printf '\n== Node 运行时判定 ==\n'
mkdir -p "$rf_test_tmp/nodebin"
# 版本号写进桩脚本本身，而不是用环境变量：被测函数调用桩时不会再带上我们的环境。
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

# 这些用例依赖 BSD 风格的 ps（-o args= / -o lstart=）与 pgrep。macOS 上都有；
# Windows 的 Git Bash 上都没有。缺能力时明确跳过，而不是把环境差异报成代码缺陷
# ——否则这个测试在本机跑会永久飘红，真正的红灯就被淹没了。
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
    rf_expect_equal "$(process_record_field "$record_path" "start_signature")" "$(process_start_signature "$test_pid")" \
        "记录里的启动签名与进程一致"
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

    # PID 复用：同一个 PID、不同的启动时刻。拒绝这一条正是"绝不误杀无关进程"的保证。
    save_process_record "$test_pid" "$rf_test_tmp/reused.pid"
    sed 's/^start_signature=.*/start_signature=Thu Jan  1 00:00:00 1970/' \
        "$rf_test_tmp/reused.pid" >"$rf_test_tmp/reused-stale.pid"
    if process_record_match "$rf_test_tmp/reused-stale.pid" "sleep"; then
        rf_check 1 "启动时刻对不上时必须拒绝"
    else
        rf_check 0 "启动时刻对不上时必须拒绝"
    fi
    if process_record_match "$rf_test_tmp/no-such-record.pid" "sleep"; then
        rf_check 1 "记录不存在时必须拒绝"
    else
        rf_check 0 "记录不存在时必须拒绝"
    fi
    printf 'process_id=999999999\n' >"$rf_test_tmp/dead.pid"
    if process_record_match "$rf_test_tmp/dead.pid" "sleep"; then
        rf_check 1 "PID 不存在时必须拒绝"
    else
        rf_check 0 "PID 不存在时必须拒绝"
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

    # 记录与进程对不上时必须**不动**它，并保留记录让用户自己判断。
    sleep 300 >/dev/null 2>&1 &
    survivor_pid=$!
    cp "$rf_test_tmp/reused-stale.pid" "$rf_test_tmp/mismatch.pid"
    stop_recorded_process "mismatched" "$rf_test_tmp/mismatch.pid" "sleep" 2>/dev/null
    if kill -0 "$survivor_pid" 2>/dev/null; then
        rf_check 0 "记录不匹配时不得停止进程"
    else
        rf_check 1 "记录不匹配时不得停止进程"
    fi
    if [ -f "$rf_test_tmp/mismatch.pid" ]; then
        rf_check 0 "记录不匹配时保留记录文件"
    else
        rf_check 1 "记录不匹配时保留记录文件"
    fi
    kill "$survivor_pid" 2>/dev/null
    wait "$survivor_pid" 2>/dev/null

    printf '\n== 进程树停止 ==\n'
    # 前端那棵树是 npm -> node -> esbuild，只杀最上面一个会让端口一直占着。
    /bin/sh -c 'sleep 300 & sleep 300' >/dev/null 2>&1 &
    tree_pid=$!
    sleep 1
    tree_children=$(pgrep -P "$tree_pid" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$tree_children" -ge 1 ]; then
        rf_check 0 "测试进程树有 $tree_children 个子进程"
    else
        rf_check 1 "测试进程树没有子进程，这项测试本身失效"
    fi
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
    rf_skip "本机的 ps 不支持 -o args=/-o lstart=，或没有 pgrep（Windows 的 Git Bash 就是这样），跳过进程记录与进程树用例；它们在 macOS CI 上会真正执行。"
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

# 用 file:// 让 curl 走一次完整的下载路径。个别环境下 curl 不支持 file://，
# 那就跳过这两项而不是误报失败。
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

printf '\n'
printf '== 更新器的排除规则 ==\n'

# update.sh 与 Windows 的 Update-ResumeForge.ps1 是镜像实现，两边都曾经按"名字叫 data
# 就跳过"排除，于是受跟踪的 backend/app/data/（preflight 必需）永远更新不到老用户机器上。
# 这张路径表两平台各钉一份（Windows 侧在 Test-Update-ResumeForge.ps1 里）。
# update.sh 有 `BASH_SOURCE = $0` 的主流程保护，source 它只会拿到函数与常量。
. "$RF_TEST_ROOT/scripts/macos/update.sh"
set +e   # update.sh 带 set -e，别让它泄漏到后面的检查里

rf_check_excluded() {
    relative_path=$1
    expected=$2   # 0 = 应当跳过，1 = 应当复制过去
    if rf_is_excluded "$relative_path"; then
        actual=0
    else
        actual=1
    fi
    if [ "$actual" = "$expected" ]; then
        rf_check 0 "$relative_path 的排除判断正确"
    else
        rf_check 1 "$relative_path 的排除判断不对（应当跳过=${expected}）"
    fi
}

# 受跟踪的程序资源：必须复制（这就是修掉的那个 bug）。
rf_check_excluded "backend/app/data/skills.json" 1
rf_check_excluded "backend/app/data/ats_keywords.json" 1
# 前缀陷阱：backend/database.py 不属于 backend/data。
rf_check_excluded "backend/database.py" 1
rf_check_excluded "backend/dataset_registry.py" 1
# .env 是按整段名比的，示例文件照样要复制。
rf_check_excluded ".env.example" 1
rf_check_excluded "frontend/.env.demo" 1
# 用户数据与本地环境：绝不能碰。
rf_check_excluded "backend/data/app.db" 0
rf_check_excluded "backend/data/backups/2026.db" 0
rf_check_excluded "data/legacy.txt" 0
rf_check_excluded "runtime/backend.json" 0
rf_check_excluded ".env" 0
rf_check_excluded "backend/.env" 0
rf_check_excluded "frontend/node_modules/.bin/vite.cmd" 0
rf_check_excluded "backend/.venv/bin/python" 0
rf_check_excluded "backend/app/__pycache__/x.pyc" 0
rf_check_excluded "frontend/dist/index.html" 0

# 真复制一遍：只看判断不够，还要确认复制函数真的按相对路径递归。
rf_copy_src="$rf_test_tmp/updater-src/ResumeForge"
rf_copy_dst="$rf_test_tmp/updater-dst"
mkdir -p "$rf_copy_src/backend/app/data" "$rf_copy_src/backend/data" "$rf_copy_dst"
: >"$rf_copy_src/backend/app/data/skills.json"
: >"$rf_copy_src/backend/data/app.db"
: >"$rf_copy_src/start.command"
rf_copy_program_files "$rf_copy_src" "$rf_copy_dst"

if [ -f "$rf_copy_dst/backend/app/data/skills.json" ]; then
    rf_check 0 "backend/app/data 下的程序资源会被复制"
else
    rf_check 1 "backend/app/data 下的程序资源没有被复制"
fi
if [ -f "$rf_copy_dst/backend/data/app.db" ]; then
    rf_check 1 "backend/data 下的用户数据被复制了（绝不该发生）"
else
    rf_check 0 "backend/data 下的用户数据留在原地"
fi

printf '\n'
if [ "$rf_test_failures" -eq 0 ]; then
    printf 'macOS 启动链测试全部通过。\n'
    exit 0
fi
printf 'macOS 启动链测试失败 %d 项。\n' "$rf_test_failures"
exit 1
