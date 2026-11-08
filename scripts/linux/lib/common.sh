# SPDX-License-Identifier: Apache-2.0
# ResumeForge Linux 启动链：日志、下载校验、端口探测、进程记录与停止。
#
# 由 scripts/linux/start.sh、stop.sh、update.sh 共同 source。
# 与其它平台的对应关系：
#   scripts/macos/lib/common.sh   → 本文件（同一套职责，按 Linux 的工具集重写）
#   ResumeForge.Common.ps1        → 本文件
#   ResumeForge.Python.ps1        → lib/python.sh
#   ResumeForge.Node.ps1          → lib/node.sh
#   ResumeForge.Process.ps1       → start.sh（编排）
#
# 为什么是"重写"而不是"照抄 macOS 那份"：两者职责相同，但落到具体工具上差异不小，
# 而这类脚本一旦在错误的地方"照抄"，故障形态是沉默的：
#   * 端口探测：macOS 用 lsof，Linux 上 ss（iproute2）几乎总是存在且不依赖 root，
#     只有 ss 缺席时才退回 lsof；
#   * 摘要：Linux 有 coreutils 的 sha256sum，shasum/openssl 只作兜底；
#   * 打开浏览器：macOS 的 open 在 Linux 上不存在，要 xdg-open，而且要能接受
#     "根本没有图形会话"这种在服务器/SSH 上极常见的状态；
#   * 状态目录：macOS 是 ~/Library/Application Support，Linux 是 XDG 的
#     ~/.local/share；
#   * 架构名：macOS 只有 arm64/x64 两种，Linux 还有一堆（i686、armv7l、riscv64…），
#     所以架构探测必须**明确拒绝**未知架构并列出支持矩阵，而不是猜。
#
# 兼容性约束：只用 POSIX shell 常规能力 + bash 3.2 就有的特性（不用关联数组、
# 不用 ${var,,}、不用 mapfile/readarray）。理由与 macOS 侧相同：这份代码要能在
# 老发行版、容器里的 bash、以及 Git Bash（Windows 上的开发者跑守卫测试）里跑通。
#
# 显示约定：所有面向用户的输出都走 log_* 函数，颜色只在终端里启用
# （重定向到文件时会退化成纯文本，日志文件因此仍然可读）。

: "${RF_DOWNLOAD_TIMEOUT_SECONDS:=600}"

if [ -t 1 ]; then
    RF_COLOR_RESET=$'\033[0m'
    RF_COLOR_RED=$'\033[31m'
    RF_COLOR_GREEN=$'\033[32m'
    RF_COLOR_YELLOW=$'\033[33m'
    RF_COLOR_CYAN=$'\033[36m'
    RF_COLOR_DIM=$'\033[2m'
else
    RF_COLOR_RESET=""
    RF_COLOR_RED=""
    RF_COLOR_GREEN=""
    RF_COLOR_YELLOW=""
    RF_COLOR_CYAN=""
    RF_COLOR_DIM=""
fi

log_info() { printf '%s\n' "$*"; }
log_dim() { printf '%s%s%s\n' "$RF_COLOR_DIM" "$*" "$RF_COLOR_RESET"; }
log_step() { printf '\n%s==> %s%s\n' "$RF_COLOR_CYAN" "$*" "$RF_COLOR_RESET"; }
log_ok() { printf '%s%s%s\n' "$RF_COLOR_GREEN" "$*" "$RF_COLOR_RESET"; }
log_warn() { printf '%s%s%s\n' "$RF_COLOR_YELLOW" "$*" "$RF_COLOR_RESET" >&2; }

# die 打印可执行的处置建议后以非零码退出。
# 用法：die "第一行原因" "第二行怎么办" ...
die() {
    printf '\n%s%s%s\n' "$RF_COLOR_RED" "$1" "$RF_COLOR_RESET" >&2
    shift
    for line in "$@"; do
        printf '%s\n' "$line" >&2
    done
    exit 1
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# rf_version_ge A B → A >= B（点分数字，比较前三位）
# 不用 sort -V：它来自 GNU coreutils，但那不是重点——重点是这段逻辑要在任何
# 环境里给出同一个答案，包括 busybox sort 与 Git Bash 的 sort。
#
# 本文件里所有"把参数赋值给变量"的函数都用 local 声明。这不是风格偏好：bash 的
# 作用域是**动态**的，函数里不给 local 的赋值会写进调用者的同名局部变量里。举一个
# 真实踩过的坑：rf_is_program_path 把参数存进全局 rel，而调用它的递归复制函数
# 恰好也有一个局部 rel——递归一层之后 rel 变成了子路径，拼出来的相对路径逐层翻倍，
# 结果是"该覆盖的没覆盖、该跳过的反而被复制"。那类 bug 不会报错，只会让更新
# 悄悄漏掉文件。
rf_version_ge() {
    local a=$1
    local b=$2
    local index=1
    local part_a
    local part_b
    while [ "$index" -le 3 ]; do
        part_a=$(printf '%s' "$a" | cut -d. -f"$index")
        part_b=$(printf '%s' "$b" | cut -d. -f"$index")
        part_a=${part_a:-0}
        part_b=${part_b:-0}
        case "$part_a$part_b" in
            *[!0-9]*) return 1 ;;
        esac
        if [ "$part_a" -gt "$part_b" ]; then
            return 0
        fi
        if [ "$part_a" -lt "$part_b" ]; then
            return 1
        fi
        index=$((index + 1))
    done
    return 0
}

# ---------------------------------------------------------------------------
# 架构与平台
# ---------------------------------------------------------------------------

# 输出 arm64 或 x64，与 Node.js 发行包的命名一致。
#
# 与 macOS 最大的不同是**必须显式拒绝**未知架构：macOS 上 uname -m 只会给出
# arm64 / x86_64（Rosetta 下也是 x86_64），而 Linux 上可能是 i686、armv7l、s390x、
# riscv64……这些平台上没有任何一份预编译运行时可用。静默地"当作 x64 继续"会让
# 用户走到"下载成功、解压成功、一执行就 exec format error"——一个看起来像文件
# 损坏、实则架构不符的报错。在这里停下来并把支持矩阵说清楚，比事后解释便宜得多。
detect_linux_arch() {
    machine=$(uname -m)
    case "$machine" in
        x86_64 | amd64) printf 'x64\n' ;;
        aarch64 | arm64) printf 'arm64\n' ;;
        *)
            die "无法识别的处理器架构：${machine}" \
                "本项目只提供两种预编译运行时：x86_64（x64）与 aarch64（arm64）。" \
                "支持的架构对照：" \
                "  x86_64 / amd64  →  x64     （绝大多数 PC 与服务器）" \
                "  aarch64 / arm64 →  arm64   （ARM 服务器、树莓派 4/5 的 64 位系统）" \
                "当前机器是 ${machine}，没有对应的 Python/Node 运行时。" \
                "如果这台机器是 32 位 ARM（armv7l）或旧式 32 位 x86（i686），" \
                "请换一台 64 位机器，或用 Docker 跑同一个项目。"
            ;;
    esac
}

# ---------------------------------------------------------------------------
# 状态目录：Linux 用 XDG，不用 macOS 的 Application Support
#
# 与 macOS 那一套的**语义**完全一致，只换落点：
#   macOS：~/Library/Application Support/ResumeForge
#   Linux：${XDG_DATA_HOME:-$HOME/.local/share}/ResumeForge
#
# RF_STATE_DIR 保留为同名同语义的注入口（测试与 CI 用它把状态目录钉到临时目录里），
# 优先级最高；其次是 XDG_DATA_HOME（遵循 XDG 规范，用户设了就该听）；最后才是
# ~/.local/share 这个 XDG 的默认值。
#
# 为什么不在 XDG_CONFIG_HOME：这里放的是运行记录、日志、虚拟环境、便携运行时，
# 全是"数据"不是"配置"。配置（backend/.env）永远留在项目里，不动。
rf_state_home() {
    if [ -n "${RF_STATE_DIR:-}" ]; then
        printf '%s\n' "$RF_STATE_DIR"
        return 0
    fi
    printf '%s/ResumeForge\n' "${XDG_DATA_HOME:-$HOME/.local/share}"
}

# ---------------------------------------------------------------------------
# 运行期目录解析：项目根可写性
#
# 为什么需要这一层（与 macOS 侧同一个设计问题）：发布包可能被解压到只读位置
# ——/opt 下的系统级安装、被 squashfs 挂载的 AppImage 式分发、root 装好之后由
# 普通用户运行、容器里挂进来的只读卷……这些情况下"在项目根下建 runtime/ 与
# backend/.venv"必然失败。程序文件与运行期状态必须能分开存。
#
# 因此两个目录改由下面这组纯函数决定：
#   * 项目根可写（源码检出、CI 的可写工作树）→ 与以前完全一致，行为零变化；
#   * 项目根只读（打包安装）→ 落到 RF_STATE_HOME。
# 只读判断交给 rf_dir_writable 一处实现，start / stop / update 都调它，
# 三条脚本对"记录在哪儿"的看法才不可能分叉（分叉的表现是"服务停不掉"）。
# ---------------------------------------------------------------------------

# rf_dir_writable DIR
# 目录存在、可写，并且**真的能把一个文件写进去**时才返回 0。
#
# 为什么不只测 test -w：只读挂载、ACL、容器里的只读 bind mount，以及被安全软件
# 锁定的目录，在 test -w 上给出的答案并不可靠（root 身份尤其乐观——root 对
# 0444 的目录照样能写，但对只读挂载不能）。写一个临时文件再删掉，是唯一能落到
# "这次启动到底会不会失败"上的判据。临时文件随即删除，因此对调用方没有残留副作用。
rf_dir_writable() {
    local dir=$1
    [ -n "$dir" ] || return 1
    [ -d "$dir" ] || return 1
    [ -w "$dir" ] || return 1

    local probe="$dir/.rf-write-probe-$$"
    if ( : >"$probe" ) 2>/dev/null; then
        rm -f "$probe" 2>/dev/null || true
        return 0
    fi
    rm -f "$probe" 2>/dev/null || true
    return 1
}

# rf_resolve_runtime_dir PROJECT_ROOT STATE_HOME
# 运行期目录（pid 记录、日志、便携版运行时缓存）。只 echo 路径，不做任何写入。
rf_resolve_runtime_dir() {
    local project_root=$1
    local state_home=$2
    if rf_dir_writable "$project_root"; then
        printf '%s\n' "$project_root/runtime"
    else
        printf '%s\n' "$state_home/runtime"
    fi
}

# rf_resolve_venv_dir PROJECT_ROOT STATE_HOME
# 后端虚拟环境目录。同样只 echo 路径：建不建由调用方决定（start.sh 才建）。
rf_resolve_venv_dir() {
    local project_root=$1
    local state_home=$2
    if rf_dir_writable "$project_root"; then
        printf '%s\n' "$project_root/backend/.venv"
    else
        printf '%s\n' "$state_home/venv"
    fi
}

# rf_runtime_dir_candidates PROJECT_ROOT STATE_HOME
# 列出"运行记录可能在这些目录里"，一行一个，第一个是 rf_resolve_runtime_dir
# 的当前解析结果。只做**只读探测**：目录不存在就不列，绝不创建、绝不迁移。
#
# 为什么会有不止一个：桌面壳（Electron）与终端入口对"状态目录"的理解可能不同
# ——壳把 userData 再拼一层产品名（<state>/ResumeForge/runtime），终端入口解析
# 出的是 <state>/runtime。用户在图形界面里启动、再去终端点 stop，就会遇到
# "记录在另一处、服务停不掉"。停服务时把所有可能的位置都看一遍；记录本身有
# PID+命令行+启动时刻三重校验（process_record_match），多看一处不会误停无关进程。
rf_runtime_dir_candidates() {
    local project_root=$1
    local state_home=$2
    local primary
    local desktop_state_home

    primary=$(rf_resolve_runtime_dir "$project_root" "$state_home")
    printf '%s\n' "$primary"

    desktop_state_home="$state_home/ResumeForge"
    if [ -d "$desktop_state_home/runtime" ] && [ "$desktop_state_home/runtime" != "$primary" ]; then
        printf '%s\n' "$desktop_state_home/runtime"
    fi
}

# ---------------------------------------------------------------------------
# 下载与校验
# ---------------------------------------------------------------------------

# sha256_of FILE → 十六进制摘要（小写）
# Linux 上 sha256sum（coreutils）几乎总是存在，所以它排第一；shasum（perl 脚本）
# 与 openssl 只在极简容器、busybox 环境里兜底。
sha256_of() {
    if command_exists sha256sum; then
        sha256sum "$1" | awk '{print $1}'
    elif command_exists shasum; then
        shasum -a 256 "$1" | awk '{print $1}'
    elif command_exists openssl; then
        openssl dgst -sha256 "$1" | awk '{print $NF}'
    else
        die "系统里既没有 sha256sum、shasum 也没有 openssl，无法校验下载内容。" \
            "Debian/Ubuntu：sudo apt install coreutils" \
            "Fedora/RHEL：sudo dnf install coreutils"
    fi
}

# download_file URL TARGET
# 返回 0 表示成功。刻意不在这里做校验：调用方要能一口气试多个镜像，
# 并逐个说明"这个源为什么不行"。
download_file() {
    curl -fL --connect-timeout 20 --max-time "$RF_DOWNLOAD_TIMEOUT_SECONDS" \
        --retry 2 --retry-delay 3 -o "$2" "$1"
}

# download_verified TARGET EXPECTED_SHA256 LABEL APPROX_MB URL [URL...]
#
# 按顺序尝试每个候选 URL，第一个摘要匹配的才被接受。
# 期望摘要写死在仓库里、不来自镜像，所以镜像只能"慢或旧"，不能替换内容。
# 每个候选失败都单独说一声：只说"下载失败"会让用户以为是自己网络全断了，
# 而实际情况常常是某一个加速站挂了、下一个源本来是好的。
download_verified() {
    local target=$1
    local expected=$2
    local label=$3
    local approx_size=$4
    local url
    local actual
    shift 4

    if [ "$#" -eq 0 ]; then
        log_warn "没有可用的下载源，跳过 ${label} 的下载。"
        return 1
    fi

    log_info "正在下载经过校验的${label}（约 ${approx_size} MB）..."
    for url in "$@"; do
        if download_file "$url" "$target"; then
            actual=$(sha256_of "$target")
            if [ "$actual" = "$expected" ]; then
                return 0
            fi
            log_warn "${url} 返回的文件摘要不匹配（期望 ${expected}，实际 ${actual}）。换下一个源..."
        else
            log_warn "${url} 下载失败。换下一个源..."
        fi
        rm -f "$target"
    done

    return 1
}

# ---------------------------------------------------------------------------
# 端口与健康检查
# ---------------------------------------------------------------------------

# 端口是否已被监听。
#
# ss（iproute2）优先：它在几乎所有发行版里都是 base 包的一部分，不需要 root 就能
# 看到监听者，而且不会像 lsof 那样在容器里因为缺少 /proc 权限而静默返回空。
# lsof 只作兜底——它在最小化容器镜像里常常根本没装。
# 两者都没有时按"没有占用"处理：后续启动会自己失败并给出真实报错，比这里猜错更安全。
tcp_port_in_use() {
    local port=$1
    if command_exists ss; then
        # 只比第 4 列（Local Address:Port）的尾部，这样 127.0.0.1:8005、*:8005、
        # [::]:8005 三种写法都能命中，而 :80050 不会被误判成 8005。
        ss -ltn 2>/dev/null | awk -v p=":${port}" '$4 ~ (p "$") { found = 1 } END { exit !found }'
        return $?
    fi
    command_exists lsof || return 1
    [ -n "$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null)" ]
}

# rf_print_listeners PORT
# 打印该端口的监听者（尽力而为：没有工具就什么都不打印，绝不因此失败）。
# 单独拉出来是为了让报错文案与"现场快照"共用同一份实现，两处说法不会漂移。
rf_print_listeners() {
    local port=$1
    if command_exists ss; then
        ss -ltnp 2>/dev/null | awk -v p=":${port}" '$4 ~ (p "$")'
    elif command_exists lsof; then
        lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null
    fi
    return 0
}

# 服务地址一律**现用现派生**。
#
# 不要提前算好存进变量：端口可以被命令行覆盖（--backend-port 8123），而任何在赋值
# 时刻算好的 URL 都会停在默认端口上。CI 上就是这么栽的——服务好好地监听在 8123，
# 探针却一直敲 8005，于是"90 秒内没有启动成功"。这类错位在只有默认端口的环境里
# 永远看不出来，所以这里用函数从结构上杜绝。
rf_backend_url() {
    printf 'http://127.0.0.1:%s\n' "$RF_BACKEND_PORT"
}

rf_frontend_url() {
    printf 'http://127.0.0.1:%s\n' "$RF_FRONTEND_PORT"
}

# 只做健康探针，不做重定向判断：两个服务都从同一个 /api/health 取答案
# （前端经由 Vite 代理转发，代理不通时这个探针同样会失败）。
is_resumeforge_backend_healthy() {
    local url=$1
    local body
    body=$(curl -fsS --max-time 2 "$url/api/health" 2>/dev/null) || return 1
    case "$body" in
        *'"status"'*'"ok"'*) return 0 ;;
        *) return 1 ;;
    esac
}

# 启动失败时打印"同刻"的服务状态。
#
# 为什么必须在这一刻打：脚本失败后会把自己起的进程停掉，事后（比如 CI 的收尾步骤）
# 再去看端口，只能看到"确实没有监听者"——那既可能是"从没起来"，也可能是"被停掉了"，
# 两种情况分不开。这里趁进程还在，把端口监听者、PID 存活与探针详情一并留下。
rf_dump_service_state() {
    local service_label=$1
    local port=$2
    local pid=$3
    local url=$4
    local listeners

    printf '%s\n' "---- ${service_label}启动失败现场 ----" >&2
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        printf '%s\n' "进程仍然存活（PID ${pid}）：不是「启动即退出」，而是没能进入可服务状态。" >&2
    else
        printf '%s\n' "进程已经退出（PID ${pid:-未知}）。" >&2
    fi
    listeners=$(rf_print_listeners "$port")
    if [ -n "$listeners" ]; then
        printf '%s\n' "端口 ${port} 的监听者：" "$listeners" >&2
    else
        printf '%s\n' "端口 ${port} 没有任何监听者（或本机没有 ss/lsof，无法查询）。" >&2
    fi
    printf '%s\n' "探针 ${url}/api/health ：" >&2
    curl -v --max-time 3 "$url/api/health" >&2 2>&1 || printf '%s\n' "（探针失败）" >&2
    printf '%s\n' "---- 现场结束 ----" >&2
}

# wait_until_healthy URL TIMEOUT_SECONDS [PID]
# PID 存在时，进程已死就立即返回失败——一个已经退出的子进程永远不会变健康。
# 报错应该指向真实原因（脚本写错、依赖缺失），而不是被拖到超时之后。
wait_until_healthy() {
    local url=$1
    local timeout=$2
    local watched_pid=${3:-}
    local elapsed=0
    while [ "$elapsed" -lt "$timeout" ]; do
        if is_resumeforge_backend_healthy "$url"; then
            return 0
        fi
        if [ -n "$watched_pid" ] && ! kill -0 "$watched_pid" 2>/dev/null; then
            return 1
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    return 1
}

# ---------------------------------------------------------------------------
# 打开浏览器（Linux 特有的一段）
# ---------------------------------------------------------------------------

# rf_open_browser URL
#
# 说明两件事：
#   1) Linux 上没有 macOS 的 open，用 xdg-open（freedesktop 标准），Wayland 与 X11
#      都走它；没有它就直接给出手动地址，而不是让用户去猜为什么双击没反应。
#   2) **没有图形会话时不算失败**。在服务器、SSH、CI、systemd 里启动时
#      DISPLAY / WAYLAND_DISPLAY 都是空的，xdg-open 要么报错要么挂住。这时唯一
#      正确的行为是把地址打出来（用户可能是在另一台机器上通过 SSH 转发端口访问）。
#      这个函数因此**永远返回 0**——它只负责"尽力打开并说清楚"，不参与成败判定。
rf_open_browser() {
    local url=$1

    if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
        log_warn "没有图形会话（DISPLAY 与 WAYLAND_DISPLAY 都没有设置），请手动访问 ${url}"
        return 0
    fi

    if ! command_exists xdg-open; then
        log_warn "本机没有 xdg-open，请手动访问 ${url}"
        return 0
    fi

    if ! xdg-open "$url" >/dev/null 2>&1; then
        log_warn "没能自动打开浏览器，请手动访问 ${url}"
    fi
    return 0
}

# ---------------------------------------------------------------------------
# 进程记录：只停"确实是自己启动的那个进程"
#
# 记录格式是**扁平的 key=value**，不是 Windows 那边的 JSON。
# 理由：Linux 不预装 jq，而自己解析自己写的 JSON 只能靠 sed 硬凑正则——出错的
# 时候正好是最需要它可靠的时候（要停进程了）。key=value 读回来是一行 sed。
# 文件名也刻意与 Windows 的 runtime/*.json、macOS 的 *.macos.pid 区分：同名不同格式，
# 被另一平台的脚本读到只会互相干扰。runtime/ 是 gitignore 的，不入库。
# ---------------------------------------------------------------------------

# 进程启动时刻的签名。用 lstart 的原始字符串而不是自己算 Unix 时间：
# 它不需要解析、不受时区影响，同一个进程每次读出来都是同一串。
process_start_signature() {
    ps -p "$1" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

process_command_line() {
    # 用 args 而不是 command：两者的差异在 Linux 上体现为"是否带 PID 前缀"
    # 之类的细节，而 args 在所有支持的平台上都只是"命令行本身"。
    ps -p "$1" -o args= 2>/dev/null
}

# save_process_record PID RECORD_PATH
save_process_record() {
    local pid=$1
    local record=$2
    {
        printf 'process_id=%s\n' "$pid"
        printf 'started_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        printf 'start_signature=%s\n' "$(process_start_signature "$pid")"
    } >"$record"
}

# process_record_field RECORD_PATH FIELD
process_record_field() {
    [ -f "$1" ] || return 1
    sed -n "s/^$2=//p" "$1" | head -n 1
    return 0
}

# process_record_match RECORD_PATH COMMAND_PATTERN
# 三项全部对得上才认：PID 存在、命令行匹配、启动时刻签名一致。
# PID 复用与残留记录都会在这里被挡掉，因此绝不会误停无关进程。
process_record_match() {
    local record=$1
    local pattern=$2
    local pid
    local command_line
    local recorded_signature
    local current_signature

    [ -f "$record" ] || return 1
    pid=$(process_record_field "$record" "process_id")
    case "$pid" in
        '' | *[!0-9]*) return 1 ;;
    esac
    kill -0 "$pid" 2>/dev/null || return 1

    command_line=$(process_command_line "$pid")
    [ -n "$command_line" ] || return 1
    printf '%s\n' "$command_line" | grep -Eq "$pattern" || return 1

    recorded_signature=$(process_record_field "$record" "start_signature")
    if [ -n "$recorded_signature" ]; then
        current_signature=$(process_start_signature "$pid")
        [ "$recorded_signature" = "$current_signature" ] || return 1
    fi
    return 0
}

# 按 PID 递归停止整棵子进程树。Vite 的 esbuild 子进程、npm 的 sh 包装层都要一起走，
# 否则端口会一直被占住，下一次启动就会撞上"端口被占用"。
#
# local 是必需的，不是风格问题：这个函数是递归的，而 shell 函数里的变量默认是全局的。
# 少了 local，递归返回后 $pid 已经指向**子进程**，"kill 父进程"这一步就会打在最后
# 一个子进程身上——父进程活下来、端口继续被占，而日志显示"已停止"。macOS 那份实现
# 有同样的隐患，Linux 这份不复制它。
stop_process_tree() {
    local pid=$1
    local signal=${2:-TERM}
    local children
    local child
    [ -n "$pid" ] || return 0
    kill -0 "$pid" 2>/dev/null || return 0

    children=$(pgrep -P "$pid" 2>/dev/null || true)
    for child in $children; do
        stop_process_tree "$child" "$signal"
    done
    kill -"$signal" "$pid" 2>/dev/null || true
}

# stop_recorded_process DISPLAY_NAME RECORD_PATH COMMAND_PATTERN
stop_recorded_process() {
    local display_name=$1
    local record=$2
    local pattern=$3
    local pid
    local waited

    [ -f "$record" ] || return 0

    if ! process_record_match "$record" "$pattern"; then
        log_warn "没有停止 ${display_name}：记录与当前进程对不上（可能是上一次运行留下的残留）。"
        return 0
    fi

    pid=$(process_record_field "$record" "process_id")
    stop_process_tree "$pid" TERM
    waited=0
    while [ "$waited" -lt 10 ] && kill -0 "$pid" 2>/dev/null; do
        sleep 1
        waited=$((waited + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
        stop_process_tree "$pid" KILL
    fi
    rm -f "$record"
    log_info "已停止 ${display_name}。"
}

# ---------------------------------------------------------------------------
# 启动失败时的报错：把日志尾巴直接打出来
# ---------------------------------------------------------------------------

# 打印日志最后 N 行（丢掉空行）。
# 显式 return 0：调用方在 set -e + pipefail 下用命令替换取结果，
# "整个文件都是空行"必须算读取成功、而不是失败。
log_tail() {
    local path=$1
    local count=${2:-12}
    if [ -f "$path" ]; then
        grep -v '^[[:space:]]*$' "$path" 2>/dev/null | tail -n "$count" || true
    fi
    return 0
}

# format_service_start_failure DISPLAY_NAME REASON LOG_PATH
# 把日志尾巴打在报错里：双击 start.sh 的用户通常不会去看
# runtime/backend.stderr.log，只说"看日志"等于什么都没说。
format_service_start_failure() {
    local display_name=$1
    local reason=$2
    local log_path=$3
    local message
    local tail_output

    message="${display_name} ${reason}。日志：${log_path}"
    tail_output=$(log_tail "$log_path" 12)
    if [ -z "$tail_output" ]; then
        printf '%s（日志是空的）。\n' "$message"
    else
        printf '%s\n最后几行：\n%s\n' "$message" "$tail_output"
    fi
}
