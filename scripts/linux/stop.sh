#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# ResumeForge 停止器（Linux）。
#
# 与 macOS 侧的 scripts/macos/stop.sh、Windows 侧的 stop.cmd / Stop-ResumeForge.ps1
# 对应：按 PID 记录停掉后端与前端。
# 只停"记录对得上的"进程——PID 存在、命令行匹配、启动时刻签名一致，三者缺一不可，
# 所以 PID 被复用或记录过期时不会误杀无关程序。
#
# 用法：bash stop.sh
#      双击项目根目录的 stop.sh 也可以（文件管理器里选"在终端中运行"）。
#      加 --skip-backend 只停前端（桌面应用内的「退出」走这条：后端正在自己退出，
#      停它会把正在跑的退出流程一起带走）。
#
# 参数用 `"$@"` 遍历而不是裸 `$1`：脚本开着 `set -u`，无参调用时裸 `$1` 会直接报错
# 退出，而 CI 与双击启动都是无参调用。

set -euo pipefail

RF_SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RF_PROJECT_ROOT=$(cd "$RF_SCRIPT_DIR/../.." && pwd)

# shellcheck source=lib/common.sh
. "$RF_SCRIPT_DIR/lib/common.sh"

# 状态目录与 start.sh 用同一套规则（RF_STATE_DIR 是测试/CI 的注入口，
# 其次是 XDG_DATA_HOME，最后才是 ~/.local/share）。
RF_STATE_HOME=$(rf_state_home)

# 运行记录可能落在**不止一个**目录里，停服务时必须把每一处都看一遍：
#   * 当前版本：rf_resolve_runtime_dir 的解析结果（项目根可写就在项目根下的 runtime/，
#     只读安装目录则落到状态目录）——这是 primary，永远排第一；
#   * 桌面壳：在 Electron userData 之下又拼了一层产品名，于是除了终端入口解析出的
#     <state>/runtime 之外，还可能存在 <state>/ResumeForge/runtime。
# 只认 primary 的后果不是"少停了一个服务"：用户执行 stop.sh 会看到"没有找到运行记录"，
# 而后端其实还在跑、端口仍被占着，下一次启动直接撞端口占用。
# 候选列表（含去重与顺序）只有 common.sh 一处实现（rf_runtime_dir_candidates），
# 因此这里和 start.sh 看的是同一批目录，不可能分叉。这也正是它对一个短横线
# 都不许变成死代码的原因——它一旦没人调用，表现就是"服务停不掉"，而任何
# 单目录用例都不会变红。
RF_RUNTIME_DIRS=$(rf_runtime_dir_candidates "$RF_PROJECT_ROOT" "$RF_STATE_HOME")

# 记录文件名与 start.sh 完全一致（同目录、同后缀）。只拼**文件名**：目录由上面的
# 候选列表逐个给，写死一个目录就等于回到"只认一处"的老毛病。
RF_BACKEND_RECORD_NAME='backend.linux.pid'
RF_FRONTEND_RECORD_NAME='frontend.linux.pid'

# 与 start.sh 保持一致：这几个片段是"这确实是我们启动的进程"的特征。
RF_BACKEND_COMMAND_PATTERN='uvicorn app.main:app'
RF_FRONTEND_COMMAND_PATTERN='run dev.*--strictPort'

# rf_stop_one DISPLAY_NAME RECORD_NAME COMMAND_PATTERN
#
# 对每个候选目录各尝试一次停止，命中即收工。三处刻意的取舍：
#   * 目录不存在、或目录里没有记录 → 静默跳过。没留下东西的目录不该在正常输出里刷屏；
#   * 记录存在但对不上（PID 已死 / PID 被复用 / 命令行不符）→ **不是错误**，先记下
#     这个目录、继续看下一个。原因：primary 里可能躺着上一次运行留下的残留记录，
#     而真正在跑的那份记录在桌面壳目录里；如果在第一个对不上的目录就收工，"停不掉"
#     会被原样保留下来。
#   * 一个候选目录都没找到记录时，才打印"没有找到运行记录"。
#
# 记录本身的三重校验（PID + 命令行 + 启动时刻）完全由 common.sh 的
# process_record_match 负责，这里一个字都不重写——多看几处目录不会误停无关进程。
rf_stop_one() {
    local display_name=$1
    local record_name=$2
    local pattern=$3
    local candidate_dir
    local record_path
    local seen_dirs=""
    local stopped_dir=""
    local stale_dir=""

    # here-doc 而不是 `printf | while read`：后者会起子 shell，循环里赋的
    # stopped_dir / stale_dir 出了循环就没了。
    while IFS= read -r candidate_dir; do
        [ -n "$candidate_dir" ] || continue

        # 去重：候选来自两个来源，项目根正好落在 <state>/ResumeForge 时两者重合。
        # 用 |目录| 包起来再匹配，避免 /a/runtime 与 /a/runtime-old 这类前缀误判。
        case "$seen_dirs" in
            *"|${candidate_dir}|"*) continue ;;
        esac
        seen_dirs="$seen_dirs|$candidate_dir|"

        [ -d "$candidate_dir" ] || continue

        record_path="$candidate_dir/$record_name"
        [ -f "$record_path" ] || continue

        if ! process_record_match "$record_path" "$pattern"; then
            if [ -z "$stale_dir" ]; then
                stale_dir=$candidate_dir
            fi
            continue
        fi

        # 路径写进输出：用户报"停不掉"时，第一个要问的就是"你到底看的哪个目录"。
        log_info "${display_name}：在 ${candidate_dir} 找到运行记录。"
        stop_recorded_process "$display_name" "$record_path" "$pattern"
        stopped_dir=$candidate_dir
        break
    done <<EOF
${RF_RUNTIME_DIRS}
EOF

    if [ -n "$stopped_dir" ]; then
        # 已经停掉一个，就不要再对别的目录动手：同一个服务只该有一份记录，
        # 另一处若还留着对不上的记录，那是上次运行的历史残留（不动它，只提示）。
        if [ -n "$stale_dir" ]; then
            log_warn "${stale_dir} 里还有一份对不上的旧记录，已保留（可能属于更早的一次运行）。"
        fi
        return 0
    fi

    if [ -n "$stale_dir" ]; then
        record_path="$stale_dir/$record_name"
        recorded_pid=$(process_record_field "$record_path" "process_id") || recorded_pid=""
        log_warn "${display_name}：记录与当前进程对不上，**没有**停止任何进程。"
        log_warn "记录里的 PID 是 ${recorded_pid}。如果确认那还是简历通的进程，可以手动停止："
        log_warn "    kill ${recorded_pid}"
        log_warn "如果这个 PID 已经被系统分配给别人了（PID 会被复用），删掉记录即可："
        log_warn "    rm -f ${record_path}"
        return 0
    fi

    log_info "${display_name}：没有找到运行记录（可能本来就没启动）。"
    return 0
}

# 列出"监听端口 → 监听进程 PID"的对应关系，一行一条 "端口 空格 PID"。
#
# 为什么单独写一层而不是像 macOS 那样直接解析 lsof：Linux 上 ss（iproute2）比 lsof
# 常见得多，而且不依赖 /proc 之外的东西；最小化容器里常常根本没有 lsof。
# 两种工具的输出格式完全不同，所以统一在这一个函数里归一化成同一种格式，上面
# 的停止逻辑就只认那一种。
rf_port_pid_pairs() {
    if command_exists ss; then
        # ss -ltnp 的典型行：
        #   LISTEN 0 511 127.0.0.1:8005 0.0.0.0:* users:(("python3",pid=1234,fd=12))
        # 第 4 列是本地地址:端口；PID 只在有权限看别人进程时才会出现。
        ss -ltnp 2>/dev/null | awk '
            {
                port = $4
                sub(/.*:/, "", port)
                if (port !~ /^[0-9]+$/) next
                pid = ""
                if (match($0, /pid=[0-9]+/)) {
                    pid = substr($0, RSTART + 4, RLENGTH - 4)
                }
                if (pid == "") next
                print port " " pid
            }'
        return 0
    fi
    if command_exists lsof; then
        # lsof -Fpn 的输出：每个进程一行 "p<pid>"，随后每个地址一行 "n<addr>"。
        lsof -nP -iTCP -sTCP:LISTEN -Fpn 2>/dev/null | awk '
            /^p/ { pid = substr($0, 2); next }
            /^n/ {
                port = substr($0, 2)
                sub(/.*:/, "", port)
                if (port ~ /^[0-9]+$/ && pid != "") print port " " pid
            }'
    fi
    return 0
}

# 兜底：没有运行记录时，按「监听端口 + 命令行特征 + HTTP 自报身份」找简历通并停掉。
#
# 记录缺失并不等于服务没在跑：被别的终端/脚本直接拉起、记录文件被清理，都会留下一个
# 没有记录的实例；这时只靠记录会出现「执行 stop.sh、输出"没有找到运行记录"，后端
# 却还在跑」。兜底的安全边界比记录校验只多不少：
#   1. 监听端口的进程命令行必须匹配本仓库的启动特征（后端 uvicorn app.main:app；
#      前端带 --strictPort——这是启动器自己传的，普通 Vite 项目默认没有）；
#   2. 该端口必须自报 ResumeForge：/api/health 的 name 字段；前端在后端已退出、
#      代理不可用时退回检查首页标题里的 ResumeForge。
# 任一条件不满足就不动，绝不按进程名批量杀（pkill -f node 会带走用户的 IDE）。
rf_port_looks_like_resumeforge() {
    local display_name=$1
    local port=$2
    local health
    local page
    health=$(curl -fsS --max-time 2 "http://127.0.0.1:${port}/api/health" 2>/dev/null || true)
    case "$health" in
        *'"name":"ResumeForge"'*) return 0 ;;
    esac
    if [ "$display_name" = "frontend" ]; then
        page=$(curl -fsS --max-time 2 "http://127.0.0.1:${port}/" 2>/dev/null || true)
        case "$page" in
            *ResumeForge*) return 0 ;;
        esac
    fi
    return 1
}

# 从监听端口的进程往上找匹配到的最外层祖先：前端监听的是 Vite 的 node 进程，
# 记录/启动的是 npm / sh 包装层，停整棵树要从最外层动手，否则子进程会留下、端口仍被占。
rf_find_process_tree_root() {
    local target=$1
    local pattern=$2
    local current=$target
    local depth=0
    local parent
    local parent_command
    while [ "$depth" -lt 6 ]; do
        parent=$(ps -o ppid= -p "$current" 2>/dev/null | tr -d ' ' || true)
        case "$parent" in
            '' | *[!0-9]*) break ;;
        esac
        [ "$parent" -gt 1 ] || break
        parent_command=$(ps -p "$parent" -o args= 2>/dev/null || true)
        if printf '%s\n' "$parent_command" | grep -Eq "$pattern"; then
            target=$parent
        fi
        [ "$parent" = "$current" ] && break
        current=$parent
        depth=$((depth + 1))
    done
    printf '%s\n' "$target"
}

# rf_stop_unrecorded DISPLAY_NAME COMMAND_PATTERN
rf_stop_unrecorded() {
    local display_name=$1
    local pattern=$2
    local pairs
    local port
    local listener_pid
    local command_line
    local kill_target
    local waited
    command_exists curl || return 0

    pairs=$(rf_port_pid_pairs)
    [ -n "$pairs" ] || return 0

    while IFS=' ' read -r port listener_pid; do
        case "$listener_pid" in
            '' | *[!0-9]*) continue ;;
        esac
        case "$port" in
            '' | *[!0-9]*) continue ;;
        esac

        command_line=$(process_command_line "$listener_pid")
        printf '%s\n' "$command_line" | grep -Eq "$pattern" || continue
        rf_port_looks_like_resumeforge "$display_name" "$port" || continue

        kill_target=$(rf_find_process_tree_root "$listener_pid" "$pattern")
        log_info "${display_name}：没有运行记录，按端口 ${port} 识别为简历通，正在停止..."
        stop_process_tree "$kill_target" TERM
        waited=0
        while [ "$waited" -lt 10 ] && kill -0 "$kill_target" 2>/dev/null; do
            sleep 1
            waited=$((waited + 1))
        done
        if kill -0 "$kill_target" 2>/dev/null; then
            stop_process_tree "$kill_target" KILL
        fi
        log_info "已停止 ${display_name}（没有运行记录，按端口与健康检查识别）。"
        return 0
    done <<EOF
${pairs}
EOF
    return 0
}

RF_SKIP_BACKEND=0
for rf_argument in "$@"; do
    case "$rf_argument" in
        --skip-backend) RF_SKIP_BACKEND=1 ;;
        *) log_warn "忽略未知参数：${rf_argument}" ;;
    esac
done

log_info "正在停止 ResumeForge..."
RF_STOP_BACKEND_FALLBACK_PATTERN='uvicorn app.main:app'
RF_STOP_FRONTEND_FALLBACK_PATTERN='vite.*--strictPort|run dev.*--strictPort'
if [ "$RF_SKIP_BACKEND" -eq 0 ]; then
    rf_stop_one "backend" "$RF_BACKEND_RECORD_NAME" "$RF_BACKEND_COMMAND_PATTERN"
    rf_stop_unrecorded "backend" "$RF_STOP_BACKEND_FALLBACK_PATTERN"
else
    log_info "backend：按请求跳过（应用自己在退出）。"
fi
rf_stop_one "frontend" "$RF_FRONTEND_RECORD_NAME" "$RF_FRONTEND_COMMAND_PATTERN"
rf_stop_unrecorded "frontend" "$RF_STOP_FRONTEND_FALLBACK_PATTERN"
printf '\n'
log_ok "已完成。数据都在 backend/data 目录里，没有被动过。"
