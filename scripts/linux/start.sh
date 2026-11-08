#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# ResumeForge 启动器（Linux）。
#
# 与 macOS 侧的 scripts/macos/start.sh、Windows 侧的 scripts/Start-ResumeForge.ps1
# 一一对应，功能相同：
#   1. 检查/自举 Python 与 Node（不要求用户预先装任何东西）
#   2. 首次运行创建 backend/.venv 并安装后端依赖、安装前端依赖
#   3. 启动后端（uvicorn）与前端（vite），等两边都健康
#   4. 打开浏览器，并把 PID 记录写进 runtime/，供 stop.sh 使用
#
# 直接执行项目根目录的 start.sh 即可；也可以在终端里执行：
#   bash scripts/linux/start.sh --backend-port 8010 --frontend-port 5180 --no-browser
#
# 前端模式（RF-09 方案 A）：发布包自带 frontend/dist 时，页面由后端同源提供，
# 运行期不再需要 Node。--frontend-mode auto（默认）= 有 dist 走同源、没有退回
# dev；dev = 强制 Vite；production = dist 必须在，缺失直接报错。backend/.env
# 里的 FRONTEND_MODE 是可选覆盖，命令行参数优先。
#
# 这个脚本只写两类位置：项目根可写时写 runtime/ 与 backend/.venv；项目根只读
# （系统级安装、只读挂载、容器只读卷，见 lib/common.sh 的说明）时，这两处都改落到
# ${XDG_DATA_HOME:-~/.local/share}/ResumeForge。便携版 Python 与 Node 也不再进
# /usr/local，因此不需要 sudo，也不需要发行版的开发包。

set -euo pipefail

RF_SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RF_PROJECT_ROOT=$(cd "$RF_SCRIPT_DIR/../.." && pwd)

RF_BACKEND_DIR="$RF_PROJECT_ROOT/backend"
RF_FRONTEND_DIR="$RF_PROJECT_ROOT/frontend"
RF_RUNTIME_DIR="$RF_PROJECT_ROOT/runtime"

# 端口与 Windows/macOS 侧保持一致，文档里的示例才能通用。
RF_BACKEND_PORT=8005
RF_FRONTEND_PORT=5173
RF_OPEN_BROWSER=1
# 前端模式：auto / dev / production（语义见文件头注释）。
RF_FRONTEND_MODE=auto
RF_FRONTEND_MODE_EXPLICIT=0
# 静态前端模式在 rf_main 里才会被解析出来（0/1），这里先给一个默认值，
# 这样函数里引用它不会在 set -u 下炸掉。
RF_STATIC_FRONTEND=0

# 首次运行要跑数据库迁移，而且冷机器上杀毒软件/索引服务扫描全新的 .venv 与
# node_modules 会明显拖慢启动，所以超时给得比较宽。
RF_BACKEND_START_TIMEOUT_SECONDS=90
RF_FRONTEND_START_TIMEOUT_SECONDS=120

# 参数错误时打印用法并以 2 退出。用 2 这个专属状态码，是为了让收尾钩子知道
# "这次根本没走到启动阶段"，不要打出"已停止，没有启动任何服务"那套话。
rf_argument_error() {
    local line
    printf '\n%s\n' "$1" >&2
    shift
    for line in "$@"; do
        printf '%s\n' "$line" >&2
    done
    printf '\n' >&2
    rf_usage >&2
    exit 2
}

rf_usage() {
    cat <<'USAGE'
用法：bash start.sh [选项]

选项：
  --backend-port PORT    后端端口（默认 8005）
  --frontend-port PORT   前端端口（默认 5173，仅 dev 模式用到）
  --frontend-mode MODE   auto（默认：有 frontend/dist 走后端同源，没有退回 dev）/
                         dev（强制 Vite）/ production（必须有 dist，缺失报错）
  --no-browser           启动后不自动打开浏览器
  -h, --help             显示这段说明
USAGE
}

rf_frontend_mode_is_valid() {
    case "$1" in
        auto | dev | production) return 0 ;;
        *) return 1 ;;
    esac
}

# 从 backend/.env 读可选的 FRONTEND_MODE 覆盖。找到取值时置 RF_FRONTEND_MODE
# 并返回 0；文件不存在或没有这一项时返回 1（不改动默认值）。
rf_read_frontend_mode_env() {
    local env_file=$1
    local env_line
    local rf_env_mode
    [ -f "$env_file" ] || return 1
    while IFS= read -r env_line || [ -n "$env_line" ]; do
        case "$env_line" in
            FRONTEND_MODE=*)
                # 去掉首尾空白与成对引号；行内注释等花哨写法不支持，交给校验报错。
                rf_env_mode=$(printf '%s' "${env_line#FRONTEND_MODE=}" | tr -d ' \t\r"'"'"'')
                [ -n "$rf_env_mode" ] || return 1
                RF_FRONTEND_MODE=$rf_env_mode
                return 0
                ;;
        esac
    done <"$env_file"
    return 1
}

# 返回 0 = 同源静态模式（不起 Node，浏览器开后端地址）；1 = dev 模式（Vite）。
# 只对 auto / dev / production 三个值有定义；其它取值在调用前必须先校验掉。
rf_resolve_frontend_mode() {
    local dist_index=$1
    case "$RF_FRONTEND_MODE" in
        dev)
            return 1
            ;;
        production)
            if [ ! -f "$dist_index" ]; then
                die "--frontend-mode production 需要前端静态资产，但没有找到：${dist_index}" \
                    "怎么办：" \
                    "  1) 发布包（zip）自带 frontend/dist，重新下载完整安装包；" \
                    "  2) 源码检出要先构建一次：在 frontend 目录执行 npm run build；" \
                    "  3) 只想本地开发：用默认的 auto，或显式 --frontend-mode dev。"
            fi
            return 0
            ;;
    esac
    # auto：有 dist 走同源，没有退回 dev（本地源码检出的现状）。
    [ -f "$dist_index" ]
}

rf_parse_arguments() {
    local port
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --backend-port)
                [ "$#" -ge 2 ] || rf_argument_error "--backend-port 后面缺少端口号。"
                RF_BACKEND_PORT=$2
                shift 2
                ;;
            --frontend-port)
                [ "$#" -ge 2 ] || rf_argument_error "--frontend-port 后面缺少端口号。"
                RF_FRONTEND_PORT=$2
                shift 2
                ;;
            --frontend-mode)
                [ "$#" -ge 2 ] || rf_argument_error "--frontend-mode 后面缺少模式。"
                RF_FRONTEND_MODE=$2
                RF_FRONTEND_MODE_EXPLICIT=1
                shift 2
                ;;
            --no-browser)
                RF_OPEN_BROWSER=0
                shift
                ;;
            -h | --help)
                rf_usage
                exit 0
                ;;
            *)
                rf_argument_error "无法识别的参数：$1"
                ;;
        esac
    done

    if ! rf_frontend_mode_is_valid "$RF_FRONTEND_MODE"; then
        rf_argument_error "无效的 --frontend-mode 取值：${RF_FRONTEND_MODE}" \
            "可选值：auto / dev / production。"
    fi

    for port in "$RF_BACKEND_PORT" "$RF_FRONTEND_PORT"; do
        case "$port" in
            '' | *[!0-9]*) rf_argument_error "端口必须是数字：$port" ;;
        esac
        if [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ]; then
            rf_argument_error "端口必须在 1024 到 65535 之间：${port}" \
                "小于 1024 的端口在 Linux 上需要 root 权限（或 CAP_NET_BIND_SERVICE），本启动器不会提权。"
        fi
    done
    if [ "$RF_BACKEND_PORT" -eq "$RF_FRONTEND_PORT" ]; then
        rf_argument_error "后端端口与前端端口不能相同：两者都是 ${RF_BACKEND_PORT}。" \
            "用 --backend-port / --frontend-port 指定不同的端口。"
    fi
}

# shellcheck source=lib/common.sh
. "$RF_SCRIPT_DIR/lib/common.sh"

# 状态目录与运行期目录必须在 source python.sh / node.sh **之前**定下来：那两个库在
# source 的瞬间就会用 RF_RUNTIME_DIR 派生出 RF_TOOLS_DIR（便携版 Python 与 Node 的
# 落地位置）。顺序错了，只读安装目录下就会去尝试写安装目录。
RF_STATE_HOME=$(rf_state_home)
RF_RUNTIME_DIR=$(rf_resolve_runtime_dir "$RF_PROJECT_ROOT" "$RF_STATE_HOME")
RF_VENV_DIR=$(rf_resolve_venv_dir "$RF_PROJECT_ROOT" "$RF_STATE_HOME")
if ! rf_dir_writable "$RF_PROJECT_ROOT"; then
    # 一句说明就够：用户不需要知道 mount 选项或容器只读卷是什么，只需要知道
    # "程序文件没被改，数据放在自己的用户目录里"。这里刻意不打印系统报错的原文
    # （"Read-only file system" 之类只会让人以为软件坏了）。
    log_warn "安装目录是只读的（系统级安装或只读挂载时这是正常现象），运行期记录、日志与 Python 环境已改放到 ${RF_STATE_HOME}，安装目录不会被改动。"
fi

# shellcheck source=lib/python.sh
. "$RF_SCRIPT_DIR/lib/python.sh"
# shellcheck source=lib/node.sh
. "$RF_SCRIPT_DIR/lib/node.sh"

# 记录文件名刻意与别的平台区分（Windows 是 runtime/*.json，macOS 是 *.macos.pid）：
# 同名不同格式被另一平台的脚本读到只会互相干扰。
RF_BACKEND_RECORD="$RF_RUNTIME_DIR/backend.linux.pid"
RF_FRONTEND_RECORD="$RF_RUNTIME_DIR/frontend.linux.pid"
RF_BACKEND_STDOUT="$RF_RUNTIME_DIR/backend.stdout.log"
RF_BACKEND_STDERR="$RF_RUNTIME_DIR/backend.stderr.log"
RF_FRONTEND_STDOUT="$RF_RUNTIME_DIR/frontend.stdout.log"
RF_FRONTEND_STDERR="$RF_RUNTIME_DIR/frontend.stderr.log"

# 后端进程命令行里必须出现的片段。stop 之前要拿它复核，避免误停。
RF_BACKEND_COMMAND_PATTERN='uvicorn app.main:app'
# 前端同理。--strictPort 是我们自己传的、vite 默认没有的参数，用它做特征最稳：
# Linux 上 npm 会被 exec 成 `node .../npm-cli.js run dev -- --host ... --strictPort`，
# 只看 "npm" 或 "run dev" 都不够独特。
RF_FRONTEND_COMMAND_PATTERN='run dev.*--strictPort'
# 后端依赖探针：直接让解释器去 import，而不是检查目录名。
# 一个丢了 pydantic、或轮子和解释器不匹配的 venv 能通过"目录存在"检查，
# 然后在 import 时才死，报错只剩一句"启动没成功"。
RF_BACKEND_DEPENDENCY_PROBE='import fastapi, uvicorn, sqlalchemy, alembic, pydantic, pydantic_settings, PIL, pypdf, fpdf, websocket, docx, multipart'

rf_started_backend_pid=""
rf_started_frontend_pid=""

# 失败时收尾：只停"这一次启动起来的"进程，绝不去动用户既有的服务。
rf_cleanup_on_failure() {
    local status=$?
    # 2 是参数错误（rf_argument_error），那时连启动阶段都没进，
    # 再打一段"已停止，没有启动任何服务"只会淹没真正的用法说明。
    if [ "$status" -ne 0 ] && [ "$status" -ne 2 ]; then
        if [ -n "$rf_started_frontend_pid" ]; then
            stop_process_tree "$rf_started_frontend_pid" TERM
            rm -f "$RF_FRONTEND_RECORD"
        fi
        if [ -n "$rf_started_backend_pid" ]; then
            stop_process_tree "$rf_started_backend_pid" TERM
            rm -f "$RF_BACKEND_RECORD"
        fi
        printf '\n%s启动失败。%s\n\n' "$RF_COLOR_RED" "$RF_COLOR_RESET"
        printf '已停止，没有启动任何服务。\n'
        printf '按上面的步骤处理后，关掉这个终端重新执行 bash start.sh 即可。\n'
        printf '如果上面的办法都不行，请把这段内容截图发到项目的 GitHub Issues。\n'
    fi
    return 0
}
trap rf_cleanup_on_failure EXIT

# ---------------------------------------------------------------------------
# 前置检查
# ---------------------------------------------------------------------------

# 最基础的两个外部命令。Linux 与 macOS 不同：curl 不是"系统自带"的一部分，
# 在最小化容器镜像（以及某些精简发行版）里确实可能没有。缺了它后面的每一步都会
# 以奇怪的方式失败（下载不了、探针不通），所以在这里一次说清楚装哪个包。
rf_require_base_tools() {
    local missing=""
    command_exists curl || missing="curl"
    if [ -n "$missing" ]; then
        die "缺少必需的命令：${missing}" \
            "这个命令用于下载运行时与健康检查，本项目不打算（也无法）自己实现它。" \
            "怎么办（按发行版选一条）：" \
            "  Debian/Ubuntu：sudo apt install curl tar" \
            "  Fedora/RHEL：  sudo dnf install curl tar" \
            "  Arch：         sudo pacman -S curl tar" \
            "  Alpine：       sudo apk add curl tar"
    fi
    if ! command_exists tar; then
        die "缺少必需的命令：tar" \
            "便携版 Python 与 Node 都是以 .tar.gz 分发的，没有 tar 无法安装。" \
            "怎么办：Debian/Ubuntu 上 sudo apt install tar；Fedora/RHEL 上 sudo dnf install tar。"
    fi
}

# 首次运行时把"要下载多少"提前说出来。
#
# 为什么值得单独一段：便携版 Python 约 34MB、Node 约 30MB，再加 pip/npm 的依赖包，
# 慢网络上第一屏会静默好几分钟。用户面对"没有任何输出"的正常等待，最常见的反应是
# Ctrl-C 然后报"启动器坏了"。一句预计量就能把这种误判消掉。
# 走静态同源模式时不提 Node：那条路径运行期根本不需要它（见 lib/node.sh 的说明）。
rf_announce_first_run_downloads() {
    local need_python=0
    local need_node=0
    local downloads=""
    local node_note

    if [ ! -x "${RF_VENV_DIR}/bin/python3" ]; then
        need_python=1
    fi
    if [ "$RF_STATIC_FRONTEND" -eq 0 ] && [ ! -x "${RF_FRONTEND_DIR}/node_modules/.bin/vite" ]; then
        need_node=1
    fi
    if [ "$need_python" -eq 0 ] && [ "$need_node" -eq 0 ]; then
        return 0
    fi

    if [ "$need_python" -eq 1 ]; then
        downloads="便携版 Python（约 ${RF_PYTHON_BOOTSTRAP_APPROX_MB} MB）"
    fi
    if [ "$need_node" -eq 1 ]; then
        node_note="便携版 Node.js（约 ${RF_NODE_BOOTSTRAP_APPROX_MB} MB）"
        if [ -n "$downloads" ]; then
            downloads="${downloads}、${node_note}"
        else
            downloads=$node_note
        fi
    fi
    log_info "首次运行需要联网准备：${downloads}，以及 Python/前端依赖包。整个过程只需一次，之后启动不再下载。"
}

# ---------------------------------------------------------------------------
# 后端
# ---------------------------------------------------------------------------

# 准备后端虚拟环境。返回时 RF_VENV_PYTHON 指向可用的解释器。
#
# 位置由 common.sh 的 rf_resolve_venv_dir 决定（可写项目根 → backend/.venv，
# 只读安装目录 → RF_STATE_HOME/venv），本函数不再假设它一定在项目里。
rf_prepare_backend_venv() {
    local venv_config
    local stale_dir
    # RF_VENV_PYTHON 必须是全局：调用方（rf_ensure_backend_dependencies 等）要用它。
    RF_VENV_PYTHON="${RF_VENV_DIR}/bin/python3"
    venv_config="${RF_VENV_DIR}/pyvenv.cfg"

    if [ -x "$RF_VENV_PYTHON" ] && ! rf_venv_version_supported "$venv_config"; then
        # 用窗口外的版本建的 venv 永远装不上钉死的轮子，复用它等于每次都以同一种
        # 方式失败。挪开而不是删除：项目保留可恢复的派生产物，同卷改名是零成本。
        stale_dir="$RF_RUNTIME_DIR/venv-unsupported-$(date '+%Y%m%d-%H%M%S')"
        log_warn "后端虚拟环境是用不受支持的 Python 版本建的，已移到 ${stale_dir} 并重建（原目录没有被删除，需要时可手动找回）。"
        mv "$RF_VENV_DIR" "$stale_dir"
    fi

    if [ ! -x "$RF_VENV_PYTHON" ]; then
        rf_ensure_system_python
        # 只读安装目录下 venv 落在用户目录里，上层目录可能还不存在。
        mkdir -p "$(dirname "${RF_VENV_DIR}")"
        log_info "首次运行：正在创建 Python 虚拟环境（这一步只做一次）..."
        if ! "$RF_PYTHON" -m venv "$RF_VENV_DIR"; then
            # 走到这里通常是两类原因：目录不可写，或解释器缺 ensurepip（Debian/Ubuntu
            # 没装 python3-venv）。两种修法都写出来，不让用户去猜。
            die "创建 Python 虚拟环境失败。" \
                "怎么办：" \
                "  1) Debian/Ubuntu 上多半是缺 python3-venv：sudo apt install python3-venv 后重试；" \
                "  2) 确认 ${RF_VENV_DIR} 可写（没有被设为只读、也没有被安全软件锁定）；" \
                "  3) 删掉该目录后重新执行 bash start.sh；" \
                "  4) 仍失败：把上面的报错原文发到项目的 GitHub Issues。"
        fi
    fi

    if [ ! -x "$RF_VENV_PYTHON" ]; then
        die "没有找到后端的 Python 环境：${RF_VENV_PYTHON}" \
            "怎么办：删掉 ${RF_VENV_DIR} 目录后重新执行 bash start.sh，让它重建一次。"
    fi
}

rf_ensure_backend_dependencies() {
    if "$RF_VENV_PYTHON" -c "$RF_BACKEND_DEPENDENCY_PROBE" >/dev/null 2>&1; then
        return 0
    fi

    # 极少数便携版解释器不带 pip（system-site-packages 被裁掉、或 venv 用了
    # --without-pip 建的）。先补上，再往下走，否则用户的报错会是
    # "No module named pip"，看不出该怎么办。
    if ! "$RF_VENV_PYTHON" -m pip --version >/dev/null 2>&1; then
        log_info "后端环境里没有 pip，正在补装..."
        "$RF_VENV_PYTHON" -m ensurepip --upgrade >/dev/null 2>&1 || true
    fi

    log_info "首次运行：正在安装后端依赖（约 40 个包，第一次要几分钟）..."
    if ! "$RF_VENV_PYTHON" -m pip install --timeout 300 --retries 10 \
        -r "$RF_BACKEND_DIR/requirements.txt"; then
        die "后端依赖安装失败。" \
            "最常见的原因是网络：默认走官方 PyPI，国内经常很慢或直接超时。" \
            "怎么办（按顺序试）：" \
            "  1) 换国内镜像重装（最有效）：" \
            "     \"${RF_VENV_PYTHON}\" -m pip install -i https://mirrors.aliyun.com/pypi/simple -r backend/requirements.txt" \
            "  2) 需要代理时，先在终端里 export HTTPS_PROXY=http://127.0.0.1:端口 再重试；" \
            "  3) 确认能打开 https://mirrors.aliyun.com/pypi/simple/（打不开就是网络被拦了）；" \
            "  4) 仍失败：把上面 pip 的报错原文发到 GitHub Issues。"
    fi
}

rf_start_backend() {
    if is_resumeforge_backend_healthy "$(rf_backend_url)"; then
        log_info "后端已经在运行：$(rf_backend_url)"
        return 0
    fi

    if tcp_port_in_use "$RF_BACKEND_PORT"; then
        # 端口被占但健康检查不过：可能是我们自己上一次运行留下的、已经崩掉的后端
        # （进程还在，服务不响应）。记录能对上就自己收拾，否则明确说"这不是我的"。
        if process_record_match "$RF_BACKEND_RECORD" "$RF_BACKEND_COMMAND_PATTERN"; then
            log_warn "上一次运行留下的简历通后端正占着端口 ${RF_BACKEND_PORT}，先停掉它再启动一个新的。"
            stop_recorded_process "backend" "$RF_BACKEND_RECORD" "$RF_BACKEND_COMMAND_PATTERN"
            sleep 1
        else
            die "端口 ${RF_BACKEND_PORT} 已被别的程序占用（不是简历通自己的后端，所以不会去动它）。" \
                "怎么办（二选一）：" \
                "  1) 关掉占用该端口的程序（想知道是谁：ss -ltnp | grep :${RF_BACKEND_PORT} 或 lsof -nP -iTCP:${RF_BACKEND_PORT} -sTCP:LISTEN）；" \
                "  2) 换一个端口启动：bash start.sh --backend-port 8010"
        fi
    fi

    rf_prepare_backend_venv
    rf_ensure_backend_dependencies

    # 子 shell 里 exec，让记录下来的 PID 就是 uvicorn 本身，
    # 而不是一层随时会消失的 shell 包装。
    (
        cd "$RF_BACKEND_DIR"
        # 默认把 uvicorn 压到 warning：正常启动时不必让用户看一屏框架日志。
        # 出问题时可以用 RF_UVICORN_LOG_LEVEL=info 打开——CI 的 end-to-end 作业就是这么做的，
        # 否则"后端没起来"这种失败只会留下一份什么都没有的 stderr，无从定位。
        # PYTHONUNBUFFERED：日志重定向到文件时 Python 默认是**块缓冲**，出问题时
        # runtime/backend.stderr.log 可能一行都没有（CI 上就因此把"服务其实起来了"
        # 误判成"启动失败"）。无缓冲之后，日志与故障同刻落盘。
        PYTHONUNBUFFERED=1 exec "$RF_VENV_PYTHON" -m uvicorn app.main:app \
            --host 127.0.0.1 --port "$RF_BACKEND_PORT" \
            --log-level "${RF_UVICORN_LOG_LEVEL:-warning}"
    ) >>"$RF_BACKEND_STDOUT" 2>>"$RF_BACKEND_STDERR" &
    rf_started_backend_pid=$!
    save_process_record "$rf_started_backend_pid" "$RF_BACKEND_RECORD"

    log_info "正在等待后端就绪（最多 ${RF_BACKEND_START_TIMEOUT_SECONDS} 秒）..."
    if wait_until_healthy "$(rf_backend_url)" "$RF_BACKEND_START_TIMEOUT_SECONDS" "$rf_started_backend_pid"; then
        log_info "后端已启动：$(rf_backend_url)"
        return 0
    fi

    if ! kill -0 "$rf_started_backend_pid" 2>/dev/null; then
        die "$(format_service_start_failure "后端" "在变得健康之前就退出了" "$RF_BACKEND_STDERR")" \
            "上面是后端的真实报错，通常能直接看出原因（缺依赖、端口被拦、数据库文件损坏等）。"
    fi
    rf_dump_service_state "后端" "$RF_BACKEND_PORT" "$rf_started_backend_pid" "$(rf_backend_url)" >&2
    die "$(format_service_start_failure "后端" "在 ${RF_BACKEND_START_TIMEOUT_SECONDS} 秒内没有启动成功" "$RF_BACKEND_STDERR")" \
        "怎么办：先看上面的日志；如果日志是空的，可能是端口被防火墙拦了，换一个端口试试：" \
        "  bash start.sh --backend-port 8010"
}

# ---------------------------------------------------------------------------
# 中文字体预热
# ---------------------------------------------------------------------------

# 请后端把内置思源黑体拉下来（约 32MB，后端自己在后台线程里下，这里不阻塞）。
#
# 为什么需要：Linux 发行版**没有任何一个**默认安装 CJK 字体，而 `_FONT_CANDIDATES`
# 里那几条（Noto CJK / 文泉驿 / arphic）全是要用户自己 apt 装的包。缺字体时「导出
# PDF」返回 409、只能退回浏览器打印——而用户点「下载 PDF」的那一刻，正是最不该
# 失败的时刻。字体下载完就成为 PDF 导出的最后一级兜底（见 pdf_exporter/fonts.py）。
#
# 为什么走 HTTP 接口而不是在 bash 里再写一遍下载：字节数校验、sha256、进度、取消、
# 失败文案都只有一份实现（services/resume_font_builtin.py）。在 shell 里复制一遍
# 等于埋第二个真相源，两边的清单迟早漂开。
#
# 失败一律只提示、绝不中断启动：字体是锦上添花，为它挡住启动是本末倒置。
rf_warm_up_cjk_font() {
    if [ "${RF_SKIP_FONT_DOWNLOAD:-0}" -eq 1 ]; then
        return 0
    fi
    if ! curl -fsS --max-time 5 -X POST \
        "$(rf_backend_url)/api/settings/fonts/builtin/download" >/dev/null 2>&1; then
        log_dim "没有发起中文字体下载（不影响使用）；需要时在「设置 → 简历字体」里点下载。"
        return 0
    fi
    log_info "已请求准备中文字体（约 32MB，后台进行）；下完导出 PDF 即可直接用。"
}

# ---------------------------------------------------------------------------
# 前端
# ---------------------------------------------------------------------------

rf_ensure_frontend_dependencies() {
    local vite_command="${RF_FRONTEND_DIR}/node_modules/.bin/vite"
    local install_command
    if [ -x "$vite_command" ]; then
        return 0
    fi

    log_info "首次运行：正在安装前端依赖（几百个包，第一次要几分钟）..."
    # npm ci 按当前目录解析 package-lock.json，所以必须先进到 frontend/。
    # 没有 lockfile 的旧源码包用 npm install 现场生成一份，而不是直接报 EUSAGE。
    if [ -f "$RF_FRONTEND_DIR/package-lock.json" ]; then
        install_command=ci
    else
        log_warn "没有找到 frontend/package-lock.json，改用 npm install 现场生成一份（这样装出来的版本可能与发布时不同）。"
        install_command=install
    fi

    if ! (
        cd "$RF_FRONTEND_DIR"
        "$RF_NPM_PATH" "$install_command" \
            --no-audit --no-fund \
            --fetch-timeout=1800000 --fetch-retries=5 \
            --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
    ); then
        die "前端依赖安装失败。" \
            "可能原因：网络不通、npm 镜像不可达、或磁盘空间不足。" \
            "怎么办：" \
            "  1) 手动重试看完整报错：在 frontend 目录执行" \
            "     ${RF_NPM_PATH} install --registry=https://registry.npmmirror.com" \
            "  2) 空间不足时先清理磁盘（node_modules 需要约 400 MB）；" \
            "  3) 需要代理时先在终端里 export HTTPS_PROXY=http://127.0.0.1:端口；" \
            "  4) 仍失败：把上面 npm 的报错原文发到 GitHub Issues。"
    fi
}

rf_start_frontend() {
    if is_resumeforge_backend_healthy "$(rf_frontend_url)"; then
        log_info "前端已经在运行：$(rf_frontend_url)"
        return 0
    fi

    if tcp_port_in_use "$RF_FRONTEND_PORT"; then
        if process_record_match "$RF_FRONTEND_RECORD" "$RF_FRONTEND_COMMAND_PATTERN"; then
            log_warn "上一次运行留下的简历通前端正占着端口 ${RF_FRONTEND_PORT}，先停掉它再启动一个新的。"
            stop_recorded_process "frontend" "$RF_FRONTEND_RECORD" "$RF_FRONTEND_COMMAND_PATTERN"
            sleep 1
        else
            die "端口 ${RF_FRONTEND_PORT} 被另一个前端占用，而且它连的不是本次的后端（所以不会去动它）。" \
                "怎么办（二选一）：" \
                "  1) 关掉占用该端口的程序（想知道是谁：ss -ltnp | grep :${RF_FRONTEND_PORT} 或 lsof -nP -iTCP:${RF_FRONTEND_PORT} -sTCP:LISTEN）；" \
                "  2) 换一个端口启动：bash start.sh --frontend-port 5180"
        fi
    fi

    rf_ensure_node_runtime
    rf_ensure_frontend_dependencies

    # 这个环境变量只作用于本次进程，让 Vite 代理指向上面启动的后端，
    # 不去改用户仓库里受跟踪的或本地的 .env。
    (
        cd "$RF_FRONTEND_DIR"
        export VITE_BACKEND_URL="$(rf_backend_url)"
        exec "$RF_NPM_PATH" run dev -- \
            --host 127.0.0.1 --port "$RF_FRONTEND_PORT" --strictPort
    ) >>"$RF_FRONTEND_STDOUT" 2>>"$RF_FRONTEND_STDERR" &
    rf_started_frontend_pid=$!
    save_process_record "$rf_started_frontend_pid" "$RF_FRONTEND_RECORD"

    log_info "正在等待前端就绪（最多 ${RF_FRONTEND_START_TIMEOUT_SECONDS} 秒）..."
    if wait_until_healthy "$(rf_frontend_url)" "$RF_FRONTEND_START_TIMEOUT_SECONDS" "$rf_started_frontend_pid"; then
        log_info "前端已启动：$(rf_frontend_url)"
        return 0
    fi

    if ! kill -0 "$rf_started_frontend_pid" 2>/dev/null; then
        die "$(format_service_start_failure "前端" "在变得健康之前就退出了" "$RF_FRONTEND_STDERR")" \
            "上面是前端的真实报错，通常能直接看出原因（依赖装坏了、端口被拦等）。"
    fi
    rf_dump_service_state "前端" "$RF_FRONTEND_PORT" "$rf_started_frontend_pid" "$(rf_frontend_url)" >&2
    die "$(format_service_start_failure "前端" "在 ${RF_FRONTEND_START_TIMEOUT_SECONDS} 秒内没有启动成功" "$RF_FRONTEND_STDERR")" \
        "怎么办：先看上面的日志；如果日志是空的，可能是端口被防火墙拦了，换一个端口试试：" \
        "  bash start.sh --frontend-port 5180"
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

rf_main() {
    rf_parse_arguments "$@"
    rf_require_base_tools

    for directory in "$RF_BACKEND_DIR" "$RF_FRONTEND_DIR"; do
        if [ ! -d "$directory" ]; then
            die "找不到项目目录：${directory}" \
                "请确认解压出来的文件夹没有被移动或删除。"
        fi
    done

    # frontend-mode 的解析顺序：命令行 --frontend-mode > backend/.env 的
    # FRONTEND_MODE > 默认 auto。显式传了参数就不要让 .env 反过来覆盖它。
    if [ "$RF_FRONTEND_MODE_EXPLICIT" -eq 0 ]; then
        if rf_read_frontend_mode_env "$RF_BACKEND_DIR/.env"; then
            if ! rf_frontend_mode_is_valid "$RF_FRONTEND_MODE"; then
                rf_argument_error "backend/.env 里的 FRONTEND_MODE 取值无效：${RF_FRONTEND_MODE}" \
                    "可选值：auto / dev / production。"
            fi
        fi
    fi

    RF_STATIC_FRONTEND=0
    if rf_resolve_frontend_mode "$RF_FRONTEND_DIR/dist/index.html"; then
        RF_STATIC_FRONTEND=1
    fi

    mkdir -p "$RF_RUNTIME_DIR"
    rf_announce_first_run_downloads

    log_step "启动后端"
    rf_start_backend

    # 后端已经健康，字体下载交给它自己的后台线程；这里只是"发起"，不等待。
    rf_warm_up_cjk_font

    if [ "$RF_STATIC_FRONTEND" -eq 1 ]; then
        # RF-09 方案 A：dist 由后端同源提供（create_app 里的 mount_static_spa）。
        # 运行期不需要 Node：不起 Vite、不装 node_modules，也不做前端端口的占用检查。
        log_step "前端（后端同源静态模式）"
        log_info "前端页面由后端同源提供：$(rf_backend_url)"
    else
        log_step "启动前端"
        rf_start_frontend
    fi

    rf_page_url="$(rf_frontend_url)"
    if [ "$RF_STATIC_FRONTEND" -eq 1 ]; then
        rf_page_url="$(rf_backend_url)"
    fi

    if [ "$RF_OPEN_BROWSER" -eq 1 ]; then
        # 打不开浏览器不该让刚启动好的服务被收掉。rf_open_browser 永远返回 0：
        # 没有图形会话（服务器 / SSH / CI）时它只把地址打出来。
        rf_open_browser "$rf_page_url"
    fi

    printf '\n'
    log_ok "简历通已就绪。要关闭服务，执行 bash stop.sh（或双击项目根目录的 stop.sh）。"
    printf '打开地址：%s\n' "$rf_page_url"
}

# 只有直接执行时才跑主流程。这样 start.sh 也能被 source 进测试脚本
# （scripts/tests/test-linux-launcher.sh 就靠这个特性逐个验证纯函数），
# 而不会在 source 的瞬间就去启动服务。
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    rf_main "$@"
fi
