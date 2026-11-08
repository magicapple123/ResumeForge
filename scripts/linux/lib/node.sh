# SPDX-License-Identifier: Apache-2.0
# ResumeForge Linux 启动链：Node.js / npm 的查找与自举。
#
# 什么时候真的需要 Node —— 这一条要先说清楚，否则后来者会把它当成硬依赖：
#
#   发布包自带 frontend/dist 时，页面由后端同源提供（RF-09 方案 A），**运行期
#   根本不需要 Node**：不起 Vite、不装 node_modules、不占第二个端口。只有下面
#   两种情况才会用到本文件：
#     * 显式传了 --frontend-mode dev（想跑 Vite 开发服务器，要热更新）；
#     * 目录里没有 frontend/dist（源码检出、或用户自己删过构建产物），
#       auto 模式于是退回 dev。
#   也就是说：装好的用户机器上，Node 一轮都不会被下载；只有开发者和源码检出用户
#   会走到下面的自举路径。这也解释了为什么这里的下载量提示是"必要时"。
#
# 版本上界没有钉：Node 是向前兼容的，比要求的更新没有问题；下界 20.19.0 来自
# Vite 6 的 engines 要求（frontend/package.json 的 engines 字段与它一致）。
#
# 自举方式与 macOS/Python 一致：缺了就下载一份**便携版 Node** 到 runtime/tools/ 里
# ——不写 /usr/local、不弹管理员密码、不动用户已有的 nvm / n / volta。
# Linux 上尤其不能走发行版的包管理器：NodeSource 要 root，而分发版自带的 node
# 常年低于 20（Debian 12 是 18，Ubuntu 22.04 也是 18）。

: "${RF_NODE_MIN_VERSION:=20.19.0}"
: "${RF_NODE_BOOTSTRAP_VERSION:=24.19.0}"
# 摘要是仓库里的常量，不来自镜像——镜像只能"慢或旧"，不能替换内容。
: "${RF_NODE_AARCH64_SHA256:=d28c8a5bf0a808f0ed434a1dce8c54ae98f0371c0bd86ac58abc613f73e6643f}"
: "${RF_NODE_X64_SHA256:=f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4}"
: "${RF_NODE_BOOTSTRAP_APPROX_MB:=30}"
: "${RF_NODE_MIRROR_BASES:=https://mirrors.huaweicloud.com/nodejs https://cdn.npmmirror.com/binaries/node https://mirrors.cloud.tencent.com/nodejs-release}"

# 给定 node 可执行文件，打印版本号（去掉 v 前缀），失败返回非零。
rf_node_reported_version() {
    local node_path=$1
    local raw
    [ -n "$node_path" ] || return 1
    [ -x "$node_path" ] || return 1
    raw=$("$node_path" --version 2>/dev/null | head -n 1) || return 1
    raw=${raw#v}
    case "$raw" in
        '' | *[!0-9.]*) return 1 ;;
    esac
    printf '%s\n' "$raw"
}

# 一个候选运行时必须同时具备可用的 node 与 npm，且版本达标。
# 只看目录存在是不够的：node 与 npm 可能来自不同的包（发行版把 npm 拆成单独的
# npm 包、nvm 切到一半、或 node 装了但 npm 的全局链接没建），那种情况下启动器会在
# "前端启动超时"上失败，报错却指向后端——这里提前把它挡掉。
rf_node_runtime_candidate_ok() {
    local node_path=$1
    local npm_path=$2
    local version
    local npm_version

    [ -x "$npm_path" ] || return 1
    version=$(rf_node_reported_version "$node_path") || return 1
    rf_version_ge "$version" "$RF_NODE_MIN_VERSION" || return 1

    npm_version=$("$npm_path" --version 2>/dev/null | head -n 1)
    case "$npm_version" in
        [0-9]*.[0-9]*.[0-9]*) return 0 ;;
        *) return 1 ;;
    esac
}

# 依次探测候选目录，找到第一个 node 与 npm 同目录且都合格的运行时。
# 成功时设置 RF_NODE_PATH、RF_NPM_PATH、RF_NODE_VERSION 并返回 0。
rf_find_system_node_runtime() {
    RF_NODE_PATH=""
    RF_NPM_PATH=""
    RF_NODE_VERSION=""

    local candidate_dirs=""
    local candidate_dir
    local nvm_bin
    local volta_bin
    local portable_bin

    # PATH 上显式找到的 node 所在目录优先；npm 必须与它同目录。
    if command_exists node; then
        candidate_dirs="$candidate_dirs $(dirname "$(command -v node)")"
    fi

    # 从桌面菜单 / systemd / IDE 拉起的进程不一定继承登录 shell 的 PATH，所以常见
    # 安装位置必须显式列出。Linux 上 /usr/bin 是发行版包的位置，/usr/local/bin 是
    # 用户自己装（make install、官方 binary 包）的位置。
    candidate_dirs="$candidate_dirs /usr/local/bin /usr/bin /bin"

    # nvm 与 volta：两者都把版本目录藏在 $HOME 下，且都靠 shell 初始化脚本改 PATH
    # ——非交互进程拿不到。
    if [ -n "${HOME:-}" ]; then
        for nvm_bin in "$HOME"/.nvm/versions/node/*/bin; do
            candidate_dirs="$candidate_dirs $nvm_bin"
        done
        for volta_bin in "$HOME"/.volta/bin; do
            candidate_dirs="$candidate_dirs $volta_bin"
        done
    fi

    # 本启动器上一次装好的便携版，排在最前面：它一定是我们校验过的那一份。
    for portable_bin in "$RF_TOOLS_DIR"/node-v*-linux-*/bin; do
        candidate_dirs="$portable_bin $candidate_dirs"
    done

    for candidate_dir in $candidate_dirs; do
        [ -d "$candidate_dir" ] || continue
        if rf_node_runtime_candidate_ok "$candidate_dir/node" "$candidate_dir/npm"; then
            RF_NODE_PATH="$candidate_dir/node"
            RF_NPM_PATH="$candidate_dir/npm"
            RF_NODE_VERSION=$(rf_node_reported_version "$RF_NODE_PATH")
            return 0
        fi
    done
    return 1
}

# 便携版 Node 的归档文件名。
# 与 Python 相反，Node 官方口径的架构名就是 x64 / arm64（不是 x86_64 / aarch64），
# 所以这里**不能**做上游名转换——两个生态的命名约定不同，谁都不能"统一"。
rf_node_bootstrap_archive_name() {
    local arch=$1
    case "$arch" in
        x64 | arm64) printf 'node-v%s-linux-%s.tar.gz\n' "$RF_NODE_BOOTSTRAP_VERSION" "$1" ;;
        *) return 1 ;;
    esac
}

rf_build_node_bootstrap_urls() {
    local arch=$1
    local archive
    local base
    archive=$(rf_node_bootstrap_archive_name "$arch") || return 1
    for base in $RF_NODE_MIRROR_BASES; do
        printf '%s/v%s/%s\n' "$base" "$RF_NODE_BOOTSTRAP_VERSION" "$archive"
    done
    printf 'https://nodejs.org/dist/v%s/%s\n' "$RF_NODE_BOOTSTRAP_VERSION" "$archive"
}

rf_node_bootstrap_sha256() {
    case "$1" in
        arm64) printf '%s\n' "$RF_NODE_AARCH64_SHA256" ;;
        x64) printf '%s\n' "$RF_NODE_X64_SHA256" ;;
        *) return 1 ;;
    esac
}

# 下载并解压便携版 Node。成功后 RF_NODE_PATH / RF_NPM_PATH 指向它。
rf_install_portable_node() {
    local arch=$1
    local expected_sha
    local archive_base
    local target_dir
    local staging
    local archive_path
    local urls
    expected_sha=$(rf_node_bootstrap_sha256 "$arch") || \
        die "没有为架构 ${arch} 准备便携版 Node.js。" \
            "请把这条报错发到项目的 GitHub Issues。"

    archive_base="node-v${RF_NODE_BOOTSTRAP_VERSION}-linux-${arch}"
    target_dir="$RF_TOOLS_DIR/$archive_base"
    if rf_node_runtime_candidate_ok "$target_dir/bin/node" "$target_dir/bin/npm"; then
        RF_NODE_PATH="$target_dir/bin/node"
        RF_NPM_PATH="$target_dir/bin/npm"
        RF_NODE_VERSION=$(rf_node_reported_version "$RF_NODE_PATH")
        return 0
    fi

    mkdir -p "$RF_TOOLS_DIR"
    staging=$(mktemp -d "$RF_TOOLS_DIR/node-bootstrap-XXXXXX") || \
        die "无法在 ${RF_TOOLS_DIR} 下创建临时目录。" \
            "确认项目目录可写（没有被设为只读、也没有被安全软件锁定）。"

    archive_path="$staging/node.tar.gz"
    urls=$(rf_build_node_bootstrap_urls "$arch")

    # shellcheck disable=SC2086  # 需要按空白拆成多个候选 URL
    if ! download_verified "$archive_path" "$expected_sha" \
        "便携版 Node.js $RF_NODE_BOOTSTRAP_VERSION" "$RF_NODE_BOOTSTRAP_APPROX_MB" $urls; then
        rm -rf "$staging"
        die "所有下载源都没能拿到 Node.js 运行时。" \
            "可能原因：网络不通、公司代理，或者镜像站被拦。" \
            "怎么办（按顺序试）：" \
            "  1) 用浏览器打开 https://mirrors.huaweicloud.com/nodejs/ 确认能否访问；" \
            "  2) 需要代理时，先在终端里 export HTTPS_PROXY=http://127.0.0.1:端口 再重试；" \
            "  3) 也可以自己装好 Node.js ${RF_NODE_MIN_VERSION} 或更新版本（nvm / volta / 官方二进制包都行），" \
            "     装好后重新执行 bash start.sh；" \
            "  4) 如果只是想用发布包，检查 frontend/dist 是否存在——有 dist 时运行期完全不需要 Node。"
    fi

    log_info "校验通过，正在解压便携版 Node.js..."
    if ! tar -xzf "$archive_path" -C "$staging"; then
        rm -rf "$staging"
        die "解压便携版 Node.js 失败（压缩包可能不完整）。" \
            "删掉 runtime/tools 里以 node-bootstrap- 开头的目录后重新执行 bash start.sh。"
    fi

    if [ ! -d "$staging/$archive_base" ]; then
        rm -rf "$staging"
        die "下载到的 Node.js 压缩包里没有预期的目录 ${archive_base}。" \
            "请把这条报错发到项目的 GitHub Issues。"
    fi

    rm -rf "$target_dir"
    mv "$staging/$archive_base" "$target_dir"
    rm -rf "$staging"

    if ! rf_node_runtime_candidate_ok "$target_dir/bin/node" "$target_dir/bin/npm"; then
        die "便携版 Node.js 装好了，但 node/npm 无法使用。" \
            "在终端里执行下面两行看看完整报错，并把结果发到 GitHub Issues：" \
            "  ${target_dir}/bin/node --version" \
            "  ${target_dir}/bin/npm --version" \
            "如果报的是 Permission denied，多半是该目录所在文件系统以 noexec 挂载。"
    fi

    RF_NODE_PATH="$target_dir/bin/node"
    RF_NPM_PATH="$target_dir/bin/npm"
    RF_NODE_VERSION=$(rf_node_reported_version "$RF_NODE_PATH")
    return 0
}

# 确保有一个可用的 Node/npm。成功后 RF_NODE_PATH、RF_NPM_PATH、RF_NODE_VERSION 可用。
rf_ensure_node_runtime() {
    local arch
    if rf_find_system_node_runtime; then
        return 0
    fi

    arch=$(detect_linux_arch)
    log_info "没有找到可用的 Node.js/npm（需要 ${RF_NODE_MIN_VERSION} 或更新版本），正在自动准备一份便携版..."
    rf_install_portable_node "$arch"
    return 0
}
