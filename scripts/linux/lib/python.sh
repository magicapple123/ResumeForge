# SPDX-License-Identifier: Apache-2.0
# ResumeForge Linux 启动链：Python 解释器的查找与自举。
#
# 设计原则：**不要求用户先装任何东西**。
#   1. 先用机器上已有的解释器（PATH、/usr/bin、pyenv、/usr/local、本启动器上次装好的便携版）；
#   2. 都不行就下载一份**便携版 CPython**（python-build-standalone 的 install_only 包），
#      解压到 runtime/tools/ 里直接用。
#
# 为什么不走发行版的包管理器（apt install python3.12）：那需要 root 密码，而且不同
# 发行版/不同版本号的包名各不相同（python3.12 / python312 / python3.12-devel），
# 一个"双击就能用"的启动器不该在最开头让用户去查自己发行版的包名，更不该提权。
# 便携版完全在用户目录里，删掉项目目录就等于卸载干净。
#
# 版本窗口：与 Windows/macOS 两侧同一组常量（3.11 ~ 3.13）。backend/requirements.txt
# 的钉版没有 Python 3.14 的轮子，放宽上界等于让用户去编译 pydantic-core（需要 Rust）。
#
# --- Linux 特有的两个坑，都在下面处理了 ---
#
# 坑一：Debian/Ubuntu 把 venv 与 ensurepip 拆进了单独的 python3-venv 包。
#   系统里明明有 /usr/bin/python3，一跑 "python3 -m venv" 就报
#   "ensurepip is not available"。这是 Linux 上最常见的失败，而且报错完全不指向
#   真正的原因。所以找到候选解释器之后还要再探一次"它能不能建 venv"；不能建时
#   先给出安装建议（不静默失败），**然后继续回落到便携版**——便携版一定是可用退路。
#
# 坑二：PEP 668 的 externally-managed-environment。
#   较新的 Debian/Ubuntu/Fedora 会拒绝在**系统环境**里 pip install，提示
#   "This environment is externally managed"。本项目不受影响：所有依赖都装在
#   backend/.venv 里（或状态目录下的 venv 里），venv 内部不受 PEP 668 约束。
#   之所以写在这里，是因为将来有人看到那条报错时，第一反应会是"加 --break-system-packages"
#   ——那是错的方向，正确的事实是：我们从来不在系统环境里装东西。

: "${RF_PYTHON_MIN_MAJOR:=3}"
: "${RF_PYTHON_MIN_MINOR:=11}"
: "${RF_PYTHON_MAX_MAJOR:=3}"
: "${RF_PYTHON_MAX_MINOR:=13}"
: "${RF_PYTHON_BOOTSTRAP_VERSION:=3.12.14}"
: "${RF_PYTHON_BOOTSTRAP_TAG:=20260901}"
# 便携版 CPython 的摘要写死在仓库里，不来自任何镜像：镜像只能"慢或旧"，不能替换内容。
# 这两个值对应 install_only_stripped 包（精简版）：默认的 install_only 包 106MB，
# 精简版 34MB/29MB。省下的 70MB 对"第一次启动要等多久"的影响远比它删掉的东西重要
# ——被删掉的只有静态库、头文件与测试套件，运行期一个都用不到。
: "${RF_PYTHON_AARCH64_SHA256:=577b4bec0793ad1ff0cbff9adbd0df078eddde38a4c41bf5d83ad381a85ee39d}"
: "${RF_PYTHON_X64_SHA256:=72748da13197c1fb161e3afeef20a6a385ff24f2165e6e2758e47008e7faba4c}"
: "${RF_PYTHON_BOOTSTRAP_APPROX_MB:=34}"
: "${RF_TOOLS_DIR:=$RF_RUNTIME_DIR/tools}"
# 官方 release 直链在国内经常很慢，先试两个 GitHub 加速前缀，官方放最后。
# 每个候选都要过上面那对摘要，所以加速站无法替换内容——它只能"帮你搬"或"搬得慢"。
: "${RF_PYTHON_MIRROR_BASES:=https://ghproxy.net/https://github.com https://gh-proxy.com/https://github.com}"

# 支持的版本区间，用于面向用户的文案，避免文案与常量漂移。
rf_python_window() {
    printf '%s.%s-%s.%s' \
        "$RF_PYTHON_MIN_MAJOR" "$RF_PYTHON_MIN_MINOR" \
        "$RF_PYTHON_MAX_MAJOR" "$RF_PYTHON_MAX_MINOR"
}

rf_python_handle_text() {
    printf 'Python %s' "$(rf_python_window)"
}

# 给定解释器路径，判断是否落在窗口内。探针是"什么都不做，只退出码说话"，
# 所以它不会安装、不会联网、不会写文件。
rf_python_is_supported() {
    local candidate=$1
    [ -n "$candidate" ] || return 1
    [ -x "$candidate" ] || return 1
    "$candidate" -c "import sys; raise SystemExit(0 if (${RF_PYTHON_MIN_MAJOR}, ${RF_PYTHON_MIN_MINOR}) <= sys.version_info[:2] <= (${RF_PYTHON_MAX_MAJOR}, ${RF_PYTHON_MAX_MINOR}) else 1)" \
        >/dev/null 2>&1
}

rf_python_reported_version() {
    "$1" -c "import sys; print('%d.%d.%d' % sys.version_info[:3])" 2>/dev/null
}

# 这个解释器能不能建 venv（Linux 上必须单独探，见文件头的"坑一"）。
#
# 两条探针都要过：
#   * "import venv" —— 解释器里有没有 venv 模块本身；
#   * "import ensurepip" —— Debian/Ubuntu 把它拆进 python3-venv，缺了会在
#     venv 创建的最后一步（安装 pip）失败，报错是
#         Error: [Errno 2] No such file or directory: .../ensurepip
#     或 "ensurepip is not available"。
# 只探 import 不跑真正的创建：真正的创建会写盘，而这里只是"挑选候选"。
rf_python_has_venv_support() {
    local candidate=$1
    [ -n "$candidate" ] || return 1
    [ -x "$candidate" ] || return 1
    "$candidate" -c "import ensurepip, venv" >/dev/null 2>&1
}

# 依次探测候选，找到第一个"版本在窗口内且能建 venv"的解释器，路径写入 RF_PYTHON。
# 返回 0 表示找到。
rf_find_system_python() {
    RF_PYTHON=""

    local candidates=""
    local candidate
    local name
    local minor
    local pyenv_python
    local user_python
    local portable_python
    local reported
    local venv_hint_shown=0

    # 1) PATH 上带版本号的名字先试：它们比裸 python3 更可能正好是窗口内的版本。
    for name in python3.13 python3.12 python3.11 python3; do
        if command_exists "$name"; then
            candidates="$candidates $(command -v "$name")"
        fi
    done

    # 2) 发行版的标准位置。与 macOS 不同，**/usr/bin/python3 必须进候选**：
    #    macOS 的那条是 Xcode 命令行工具的转调桩，没装工具链时会弹图形安装提示；
    #    Linux 上它就是系统 Python，是 Debian/Ubuntu/Fedora 用户最可能有的一个。
    candidates="$candidates /usr/bin/python3 /usr/local/bin/python3"
    for minor in 13 12 11; do
        candidates="$candidates /usr/local/bin/python3.${minor} /usr/bin/python3.${minor}"
    done

    # 3) pyenv 与用户级安装。Linux 开发者常用这两种，而它们在 ~/.pyenv / ~/.local 下，
    #    不一定进 PATH（尤其是从桌面菜单、systemd 或 IDE 拉起的时候）。
    if [ -n "${HOME:-}" ] && [ -d "$HOME/.pyenv/versions" ]; then
        for pyenv_python in "$HOME"/.pyenv/versions/3.1[1-3]*/bin/python3; do
            candidates="$candidates $pyenv_python"
        done
    fi
    if [ -n "${HOME:-}" ]; then
        for user_python in "$HOME"/.local/bin/python3.1[1-3]; do
            candidates="$candidates $user_python"
        done
    fi

    # 4) 本启动器上一次装好的便携版（放在最后：机器上已有的解释器永远优先）。
    for portable_python in "$RF_TOOLS_DIR"/python-*-linux-*/bin/python3; do
        candidates="$candidates $portable_python"
    done

    for candidate in $candidates; do
        # 保留符号链接的真实路径，后面 pyvenv.cfg 的 home 指向它。
        if rf_python_is_supported "$candidate"; then
            if rf_python_has_venv_support "$candidate"; then
                RF_PYTHON=$candidate
                return 0
            fi
            # 版本对、但建不了 venv：这是 Debian/Ubuntu 缺 python3-venv 的典型形态。
            # 不在这里失败——下面会回落到便携版；只把真正的修法说清楚，只说一次。
            if [ "$venv_hint_shown" -eq 0 ]; then
                venv_hint_shown=1
                log_warn "${candidate} 的版本可用，但缺少 venv/ensurepip 组件（Debian/Ubuntu 把它们拆进了单独的系统包）。"
                log_warn "  修法（任选其一，之后无需重装本项目）："
                log_warn "    Debian/Ubuntu：sudo apt install python3-venv"
                log_warn "    Fedora/RHEL：  sudo dnf install python3"
                log_warn "  先不修也行：接下来会自动准备一份便携版 Python，它自带完整的 venv。"
            fi
            continue
        fi
        # 找到名字却版本不对（例如机器上只有 3.14）时说出来，别让用户以为没找到。
        if [ -x "$candidate" ]; then
            reported=$(rf_python_reported_version "$candidate")
            if [ -n "$reported" ]; then
                log_dim "    跳过 ${candidate}（版本 ${reported}，不在 $(rf_python_window) 内）"
            fi
        fi
    done
    return 1
}

# 便携版 CPython 下载地址表，一行一个（调用方按空白拆开即可）。
rf_build_python_bootstrap_urls() {
    local arch=$1
    local upstream_arch
    local archive
    local upstream
    local base
    upstream_arch=$(rf_python_upstream_arch "$arch") || return 1
    archive=$(rf_python_bootstrap_archive_name "$arch")
    upstream="astral-sh/python-build-standalone/releases/download/${RF_PYTHON_BOOTSTRAP_TAG}/${archive}"

    for base in $RF_PYTHON_MIRROR_BASES; do
        printf '%s/%s\n' "$base" "$upstream"
    done
    printf 'https://github.com/%s\n' "$upstream"
}

# 内部架构名 → 上游资产名里的架构段。
#
# python-build-standalone 用的是 aarch64 / x86_64，而本仓库内部的架构名（与 Node
# 发行包一致）是 arm64 / x64。少了这一步，拼出来的资产名在上游不存在——CI 上就是
# 三个源各 404 一次然后整体失败。这两个是**约定**，不是可以随手统一的命名：
# Node 官方发行包只认 x64 / arm64，Python 只认 x86_64 / aarch64，两边都不能改。
rf_python_upstream_arch() {
    local arch=$1
    case "$arch" in
        arm64 | aarch64) printf 'aarch64\n' ;;
        x64 | x86_64) printf 'x86_64\n' ;;
        *) return 1 ;;
    esac
}

# 便携版归档文件名（与上游 release 里的资产名逐字一致）。
# install_only_stripped 是精简版：不含静态库、头文件与测试套件，34MB 而不是 106MB。
rf_python_bootstrap_archive_name() {
    local arch=$1
    local upstream_arch
    upstream_arch=$(rf_python_upstream_arch "$arch") || return 1
    printf 'cpython-%s+%s-%s-unknown-linux-gnu-install_only_stripped.tar.gz\n' \
        "$RF_PYTHON_BOOTSTRAP_VERSION" "$RF_PYTHON_BOOTSTRAP_TAG" "$upstream_arch"
}

rf_python_bootstrap_sha256() {
    case "$1" in
        arm64) printf '%s\n' "$RF_PYTHON_AARCH64_SHA256" ;;
        x64) printf '%s\n' "$RF_PYTHON_X64_SHA256" ;;
        *) return 1 ;;
    esac
}

# 下载并解压便携版 CPython。成功后 RF_PYTHON 指向它。
# install_only 包的顶层目录固定叫 python/，所以解压后要搬一层。
rf_install_portable_python() {
    local arch=$1
    local expected_sha
    local target_dir
    local target_python
    local staging
    local archive_path
    local urls
    expected_sha=$(rf_python_bootstrap_sha256 "$arch") || \
        die "没有为架构 ${arch} 准备便携版 Python。" \
            "这通常意味着脚本里的架构判断出了变化，请把这个报错发到项目的 GitHub Issues。"

    target_dir="$RF_TOOLS_DIR/python-${RF_PYTHON_BOOTSTRAP_VERSION}-linux-${arch}"
    target_python="$target_dir/bin/python3"
    if rf_python_is_supported "$target_python" && rf_python_has_venv_support "$target_python"; then
        RF_PYTHON=$target_python
        return 0
    fi

    mkdir -p "$RF_TOOLS_DIR"
    staging=$(mktemp -d "$RF_TOOLS_DIR/python-bootstrap-XXXXXX") || \
        die "无法在 ${RF_TOOLS_DIR} 下创建临时目录。" \
            "确认项目目录可写（没有被设为只读、也没有被安全软件锁定）。"

    archive_path="$staging/python.tar.gz"
    urls=$(rf_build_python_bootstrap_urls "$arch")

    # shellcheck disable=SC2086  # 需要按空白拆成多个候选 URL
    if ! download_verified "$archive_path" "$expected_sha" \
        "便携版 $(rf_python_handle_text)" "$RF_PYTHON_BOOTSTRAP_APPROX_MB" $urls; then
        rm -rf "$staging"
        die "所有下载源都没能拿到便携版 Python。" \
            "可能原因：网络不通、公司代理，或者 GitHub Releases 被拦。" \
            "怎么办（按顺序试）：" \
            "  1) 用浏览器打开 https://github.com/astral-sh/python-build-standalone/releases 确认能否访问；" \
            "  2) 需要代理时，先在终端里 export HTTPS_PROXY=http://127.0.0.1:端口 再重试；" \
            "  3) 也可以自己装一个 $(rf_python_handle_text) 并确保它能建 venv：" \
            "     Debian/Ubuntu：sudo apt install python3 python3-venv" \
            "     Fedora/RHEL：  sudo dnf install python3" \
            "     Arch：         sudo pacman -S python" \
            "     装好后重新执行 bash start.sh。"
    fi

    log_info "校验通过，正在解压便携版 Python..."
    if ! tar -xzf "$archive_path" -C "$staging"; then
        rm -rf "$staging"
        die "解压便携版 Python 失败（压缩包可能不完整）。" \
            "删掉 runtime/tools 里以 python-bootstrap- 开头的目录后重新执行 bash start.sh。"
    fi
    if [ ! -x "$staging/python/bin/python3" ]; then
        rm -rf "$staging"
        die "解压出来的便携版 Python 里没有 bin/python3。" \
            "请把这条报错发到项目的 GitHub Issues。"
    fi

    rm -rf "$target_dir"
    mv "$staging/python" "$target_dir"
    rm -rf "$staging"

    if ! rf_python_is_supported "$target_python"; then
        die "便携版 Python 装好了，但它无法运行。" \
            "在终端里执行下面这行看看完整报错，并把结果发到 GitHub Issues：" \
            "  ${target_python} -V"
    fi

    # 这里没有 macOS 的 xattr -dr com.apple.quarantine：Linux 没有隔离属性这套机制，
    # 文件能不能执行只取决于挂载选项（noexec）。挂载到 noexec 时的报错是
    # "Permission denied"，那种情况下唯一的修法是把状态目录换到别的分区，
    # 所以下一段专门探测一次并给出可操作的提示。
    if ! "$target_python" -V >/dev/null 2>&1; then
        die "便携版 Python 已解压到 ${target_dir}，但无法执行。" \
            "最常见的原因是 ${RF_TOOLS_DIR} 所在的文件系统以 noexec 选项挂载（常见于 /tmp、/home 的某些配置、容器卷）。" \
            "怎么办：把项目的 runtime 目录换到一个允许执行的位置再重试，例如：" \
            "  RF_STATE_DIR=\$HOME/.local/share/ResumeForge bash start.sh" \
            "（项目目录可写时也可以直接换项目位置。）"
    fi

    RF_PYTHON=$target_python
    return 0
}

# 确保有一个可用的解释器。成功后 RF_PYTHON 可执行，且能建 venv。
rf_ensure_system_python() {
    local arch
    if rf_find_system_python; then
        return 0
    fi

    arch=$(detect_linux_arch)
    log_info "没有找到可用的 $(rf_python_handle_text)（内置 venv 组件），正在自动准备一份便携版..."
    rf_install_portable_python "$arch"
    return 0
}

# 读取 pyvenv.cfg 里的 version 行，判断既有虚拟环境是否由窗口内的解释器创建。
# 用别的版本建的 venv 永远装不上钉死的轮子，复用它只会让每次启动都以同一种方式失败，
# 所以这种情况要把它挪开（不是删除）再重建。
rf_venv_version_supported() {
    local config_path=$1
    local raw
    local major
    local minor
    [ -f "$config_path" ] || return 1
    raw=$(sed -n 's/^[[:space:]]*version[[:space:]]*=[[:space:]]*//p' "$config_path" | head -n 1)
    [ -n "$raw" ] || return 1
    major=$(printf '%s' "$raw" | cut -d. -f1)
    minor=$(printf '%s' "$raw" | cut -d. -f2)
    case "$major$minor" in
        *[!0-9]* | "") return 1 ;;
    esac
    if [ "$major" -lt "$RF_PYTHON_MIN_MAJOR" ] || [ "$major" -gt "$RF_PYTHON_MAX_MAJOR" ]; then
        return 1
    fi
    if [ "$major" -eq "$RF_PYTHON_MIN_MAJOR" ] && [ "$minor" -lt "$RF_PYTHON_MIN_MINOR" ]; then
        return 1
    fi
    if [ "$major" -eq "$RF_PYTHON_MAX_MAJOR" ] && [ "$minor" -gt "$RF_PYTHON_MAX_MINOR" ]; then
        return 1
    fi
    return 0
}
