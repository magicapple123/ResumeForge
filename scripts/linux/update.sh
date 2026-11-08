#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# ResumeForge 更新器（Linux）。
#
# 目标：**自动覆盖程序文件**，用户不需要懂 git、也不需要手动解压。
# 与 macOS 侧的 scripts/macos/update.sh、Windows 侧的 Update-ResumeForge.ps1 同源，
# 但按 Linux 的发布形态实现：从 GitHub Release 下载本平台的 zip 包，校验 sidecar
# 摘要后覆盖程序文件。
#
# 覆盖范围（白名单，其余一律不动）：
#   写：backend/app、backend/requirements.txt、frontend/dist、scripts/、docs/、
#       根目录的 *.md 与启动脚本（start.sh / stop.sh / update.sh 等）
#   不写：backend/data/（数据库、数据集、备份）、backend/.env、runtime/、desktop/、
#         .git/、frontend/node_modules、backend/.venv
# 为什么用白名单而不是黑名单：白名单的失效形态是"某个文件没更新到"（用户看得见、
# 再更新一次就好），黑名单的失效形态是"用户数据库被覆盖"（不可逆）。同一类错误
# 的代价差着数量级，所以这里选前者。
#
# 覆盖前会把将被替换的内容复制到 runtime/backup-<时间戳>/。
#
#   为什么是"复制"而不是"挪走"（macOS 那份写的是挪）：脚本自己就住在 scripts/ 里，
#   把 scripts/ 挪走会让正在执行的这个文件从中途消失；而且挪动是"先破后立"，
#   一旦复制阶段失败，安装目录里就留下一个空洞。复制则是"先立后破"——任何一步
#   失败时，磁盘上的程序文件要么是旧的、要么是新的，不会出现"什么都没有"。
#   两种方式的恢复能力完全一样：备份都在 runtime/backup-<时间戳>/ 里，没有被删除。
#   本机没有回收站，所以这里**绝不硬删**任何被替换的内容。
#
# 用法：bash update.sh              （检查并更新）
#      bash update.sh --check      （只检查，不下载不覆盖）
#      bash update.sh --dry-run    （说明会做什么，同样不下载不覆盖）
#      bash update.sh --archive 路径（用已下载的 zip 更新，离线/自建镜像时用）
#      bash update.sh -h           （帮助）

set -euo pipefail

RF_SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RF_PROJECT_ROOT=$(cd "$RF_SCRIPT_DIR/../.." && pwd)

# 仓库与发布来源。RESUMEFORGE_UPDATE_REPO 与 macOS 侧同名同语义（换成自建 fork /
# 内网镜像时不用改脚本）。RESUMEFORGE_UPDATE_TAG 是测试与 CI 的注入口：给了它就不
# 联网解析"最新 release"，直接用这个 tag。
RF_REPOSITORY=${RESUMEFORGE_UPDATE_REPO:-magicapple123/ResumeForge}
RF_RELEASE_TAG_OVERRIDE=${RESUMEFORGE_UPDATE_TAG:-}

RF_CHECK_ONLY=0
RF_DRY_RUN=0
RF_ARCHIVE_PATH=""
# 覆盖计数与暂存目录在顶层先初始化：这两个变量在函数里累加/赋值，而脚本开着
# set -u —— 少了初始化，任何"先调函数再赋值"的路径（尤其是测试脚本直接调
# rf_copy_program_files）都会以一个莫名其妙的 unbound variable 中止。
RF_COPIED_FILES=0
RF_STAGING=""
RF_BACKUP_DIR=""
RF_BACKUP_PATHS=""

# shellcheck source=lib/common.sh
. "$RF_SCRIPT_DIR/lib/common.sh"

# 运行期目录：与 start.sh / stop.sh 同一套规则（项目根只读时落到状态目录），
# 否则更新器的临时目录与备份会写进一个写不进去的地方（RF_STATE_DIR 是测试注入口）。
RF_STATE_HOME=$(rf_state_home)
RF_RUNTIME_DIR=$(rf_resolve_runtime_dir "$RF_PROJECT_ROOT" "$RF_STATE_HOME")
RF_VENV_DIR=$(rf_resolve_venv_dir "$RF_PROJECT_ROOT" "$RF_STATE_HOME")

# shellcheck source=lib/node.sh
. "$RF_SCRIPT_DIR/lib/node.sh"

: "${RF_TOOLS_DIR:=$RF_RUNTIME_DIR/tools}"

# 更新包可能很大（含 frontend/dist），超时给得比启动器宽松。
RF_DOWNLOAD_TIMEOUT_SECONDS=1800

rf_usage() {
    cat <<'USAGE'
用法：bash update.sh [选项]

选项：
  --check                只检查有没有新版本，不下载也不改动任何文件
  --dry-run              只说明会做什么，不改动任何文件
  --archive PATH         用本地已下载的 zip 更新（而不是联网获取）
  -h, --help             显示这段说明

说明：更新只覆盖程序文件。backend/data/（数据库、数据集、备份）、backend/.env
      与 runtime/ 永远不会被覆盖；覆盖前会把旧文件复制到 runtime/backup-<时间戳>/。
USAGE
}

rf_parse_arguments() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --check)
                RF_CHECK_ONLY=1
                shift
                ;;
            --dry-run)
                RF_DRY_RUN=1
                shift
                ;;
            --archive)
                [ "$#" -ge 2 ] || die "--archive 后面缺少文件路径。" \
                    "执行 bash update.sh --help 可以看到全部可用选项。"
                RF_ARCHIVE_PATH=$2
                shift 2
                ;;
            -h | --help)
                rf_usage
                exit 0
                ;;
            *)
                die "无法识别的参数：$1" "执行 bash update.sh --help 可以看到全部可用选项。"
                ;;
        esac
    done
}

# ---------------------------------------------------------------------------
# 版本与资产名（纯函数；守卫测试逐个断言）
# ---------------------------------------------------------------------------

# 本地版本号的唯一事实来源是 backend/app/config.py 的 app_version。
# 用与 scripts/check_version_sync.py、Build-Release.ps1 同一条正则读它，
# 避免"校验器和消费方各读各的"。
rf_local_version() {
    local config_path=$1
    [ -f "$config_path" ] || return 1
    sed -n 's/.*app_version[[:space:]]*:[[:space:]]*str[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
        "$config_path" | head -n 1
}

# v2.0.0 / 2.0.0 → 2.0.0。GitHub 的 tag 普遍带 v 前缀，而本地版本号不带。
rf_release_tag_to_version() {
    local tag=$1
    local version
    [ -n "$tag" ] || return 1
    version=${tag#v}
    case "$version" in
        '' | *[!0-9.]*) return 1 ;;
    esac
    printf '%s\n' "$version"
}

# 本平台的发布包文件名。与 Build-Release.ps1 的约定一致：
#   ResumeForge-<version>-<Platform>.zip，Platform 取 windows / macos / all。
# Linux 包因此是 ResumeForge-<version>-linux.zip，摘要 sidecar 就在它旁边。
rf_linux_asset_name() {
    local version=$1
    [ -n "$version" ] || return 1
    printf 'ResumeForge-%s-linux.zip\n' "$version"
}

# 资产下载地址。tag 保留 v 前缀（Release 的下载路径用的是 tag 原名）。
rf_update_asset_url() {
    local tag=$1
    local asset=$2
    [ -n "$tag" ] || return 1
    [ -n "$asset" ] || return 1
    printf 'https://github.com/%s/releases/download/%s/%s\n' "$RF_REPOSITORY" "$tag" "$asset"
}

# 远端版本是否比本地新。相等或更旧都不更新：
# 用户可能装的是更新的内测版，把远端旧包盖上去等于降级。
rf_remote_is_newer() {
    local remote=$1
    local local_version=$2
    [ -n "$remote" ] || return 1
    [ -n "$local_version" ] || return 0
    [ "$remote" = "$local_version" ] && return 1
    rf_version_ge "$remote" "$local_version"
}

# 相对项目根的路径是否属于"程序文件"白名单。
#
# 语义是**白名单**：只有这里明确返回 0 的路径才允许被复制/覆盖，其余一律"原地不动"
# （默认值就是不动）。这个方向是刻意的：白名单漏一条的表现是"某类文件没更新到"
# ——用户看得见、再更新一次就好；黑名单漏一条的表现是"用户数据被覆盖"——不可逆。
#
# 注意 `data` 这个名字在不同层级含义完全不同，这条规则必须按**相对路径**判断：
#   * backend/app/data/  → 受 git 跟踪的**程序资源**（skills.json、ats_keywords.json、
#     career_scenarios/catalog.json），preflight 依赖它们。必须覆盖；
#   * backend/data/      → 用户数据（resume_forge.db、backups、captures、exports、
#     fonts、browser-profile）。绝不能碰。
# 历史上按"名字叫 data 就跳过"写，结果是新版本往 backend/app/data/ 加的文件永远
# 到不了老用户机器上（macOS 与 Windows 两侧 2026-10-01 都修过同一个 bug，
# 见 scripts/macos/update.sh 的同名注释与 test-macos-launcher.sh 的对应断言）。
rf_is_program_path() {
    local rel=$1
    case "$rel" in
        /*) rel=${rel#/} ;;
    esac
    [ -n "$rel" ] || return 1

    case "$rel" in
        backend/app/*) return 0 ;;
        backend/requirements.txt) return 0 ;;
        # 后端还有三样常被漏掉的东西：迁移配置、开发依赖、运维脚本。
        # 漏了 alembic.ini 的后果是"新版本的迁移链跑不起来"，而报错只会说找不到配置。
        backend/requirements-dev.txt) return 0 ;;
        backend/alembic.ini) return 0 ;;
        backend/scripts/*) return 0 ;;
        frontend/dist/*) return 0 ;;
        scripts/*) return 0 ;;
        docs/*) return 0 ;;
    esac

    # 根目录下的单层文件（不能有斜杠）：*.md、启动脚本，以及构建/许可文件。
    case "$rel" in
        */*) return 1 ;;
    esac
    case "$rel" in
        *.md) return 0 ;;
        start.sh | stop.sh | update.sh) return 0 ;;
        start.command | stop.command | update.command) return 0 ;;
        start.cmd | stop.cmd | update.cmd | uninstall.cmd | Create-DesktopShortcut.cmd) return 0 ;;
        LICENSE | pyproject.toml) return 0 ;;
    esac
    return 1
}

# 明确禁止写入的路径（白名单之外的第二道闸）。
#
# 两道闸不是冗余：白名单按"允许"判断，一旦有人把规则写宽（比如某天加一条
# `backend/*`），用户数据就会在没有任何提示的情况下被覆盖。这一条把最要命的
# 几个位置钉死，任何情况下都不许写。
rf_is_protected_path() {
    local rel=$1
    case "$rel" in
        /*) rel=${rel#/} ;;
    esac
    [ -n "$rel" ] || return 1

    case "$rel" in
        backend/data | backend/data/*) return 0 ;;
        backend/.env) return 0 ;;
        runtime | runtime/*) return 0 ;;
        desktop | desktop/*) return 0 ;;
        .git | .git/*) return 0 ;;
        .env) return 0 ;;
        backend/.venv | backend/.venv/*) return 0 ;;
        frontend/node_modules | frontend/node_modules/*) return 0 ;;
    esac
    return 1
}

# ---------------------------------------------------------------------------
# 联网：解析最新 release
# ---------------------------------------------------------------------------

# 输出最新 release 的 tag（如 v2.0.0）。
#
# 为什么不调 GitHub API：api.github.com 对未认证请求限流到每小时 60 次，而很多用户
# 走的是共享出口 IP（公司、学校、运营商 NAT），拿到 403 的概率不低；403 的表现是
# "更新器坏掉了"，最难解释。这里改用 releases/latest 的 HTTP 重定向——没有限流，
# 也不解析 JSON（Linux 不预装 jq，用 sed 硬凑 JSON 正则是在最需要可靠的地方赌运气）。
rf_resolve_latest_tag() {
    local latest_url
    local final_url
    local tag
    if [ -n "$RF_RELEASE_TAG_OVERRIDE" ]; then
        printf '%s\n' "$RF_RELEASE_TAG_OVERRIDE"
        return 0
    fi

    latest_url="https://github.com/${RF_REPOSITORY}/releases/latest"
    final_url=$(curl -fsSL -o /dev/null -w '%{url_effective}' --max-time 30 "$latest_url" 2>/dev/null) || return 1
    case "$final_url" in
        */releases/tag/*) ;;
        *) return 1 ;;
    esac
    tag=${final_url##*/releases/tag/}
    tag=${tag%%\?*}
    [ -n "$tag" ] || return 1
    printf '%s\n' "$tag"
}

# ---------------------------------------------------------------------------
# 下载与解包
# ---------------------------------------------------------------------------

# 下载发布包并**先校验 sidecar 摘要**，再交给调用方解压。
#
# sidecar 与压缩包来自同一台服务器，所以它挡的是传输损坏与"半个文件被当成完整文件"
# （GitHub 断流时 curl 有时会留下一个长度不对但能解出部分的包——那种包解出来会覆盖
# 掉一半程序文件，是最坏的形态），不是防篡改。期望摘要写死在仓库里的那种保证只适用
# 于运行时（Python/Node），因为它们的字节是固定版本；发布包每个版本都不同。
rf_download_release_archive() {
    local tag=$1
    local asset=$2
    local archive=$3
    local archive_url
    local sidecar_url
    local sidecar
    local expected_sha
    local actual_sha

    archive_url=$(rf_update_asset_url "$tag" "$asset")
    sidecar_url="${archive_url}.sha256"

    log_info "==> 正在下载更新包：${asset}"
    if ! download_file "$archive_url" "$archive"; then
        die "下载更新包失败：${archive_url}" \
            "怎么办：" \
            "  1) 用浏览器打开 https://github.com/${RF_REPOSITORY}/releases 手动下载 ${asset}，" \
            "     再用 bash update.sh --archive 路径 来更新；" \
            "  2) 需要代理时，先在终端里 export HTTPS_PROXY=http://127.0.0.1:端口 再重试；" \
            "  3) 确认磁盘剩余空间足够（更新包 + 解压后约需 200 MB）。"
    fi

    log_info "==> 正在校验更新包（.sha256）"
    sidecar="$archive.sha256"
    if ! download_file "$sidecar_url" "$sidecar"; then
        actual_sha=$(sha256_of "$archive")
        die "拿不到 ${asset} 的摘要文件，为了安全已停止更新（下载的包未被使用）。" \
            "如果你确认这个包来自可信渠道，可以自己核对摘要后手动更新：" \
            "  1) 计算本地摘要：sha256sum \"本地的 ${asset}\"" \
            "  2) 与发布页公布的摘要比对（当前下载到的文件摘要为 ${actual_sha}）" \
            "  3) 一致则用 bash update.sh --archive 路径 跳过联网更新。"
    fi

    # sidecar 是 "<hash>  <filename>" 的常规格式（Build-Release.ps1 按 LF 写出，
    # 因此 sha256sum -c 在 Linux 上也能直接用）。只取第一段，忽略文件名与行尾 CR。
    expected_sha=$(awk 'NR == 1 { print $1 }' "$sidecar" | tr -d '\r')
    case "$expected_sha" in
        [0-9a-f][0-9a-f]*) ;;
        *)
            die "摘要文件的格式无法识别（第一行不是十六进制摘要）：${sidecar_url}" \
                "这通常说明下载到的是错误页而不是摘要文件（例如公司网关的拦截页）。"
            ;;
    esac

    actual_sha=$(sha256_of "$archive")
    if [ "$actual_sha" != "$expected_sha" ]; then
        die "更新包校验失败，已停止更新（旧的程序文件没有被改动）。" \
            "期望摘要：${expected_sha}" \
            "实际摘要：${actual_sha}" \
            "怎么办：" \
            "  1) 重新执行一次（可能是下载中断导致的损坏）；" \
            "  2) 仍然失败就从发布页手动下载 ${asset} 并用 --archive 指定；" \
            "  3) 如果用的是代理/加速站，换一个再试。"
    fi
    log_dim "    摘要一致：${actual_sha}"
}

# 解压 zip。三种工具按"最可能装了什么"排序：
#   unzip  —— 最常见，且会还原权限位；
#   bsdtar —— libarchive 家庭自带（Arch、部分 Alpine 镜像）；
#   python3 -m zipfile —— 最后兜底：Linux 上几乎总有 python3，但**不还原权限位**，
#                          所以后面必须补一次 chmod（rf_restore_launcher_modes）。
rf_extract_zip() {
    local archive=$1
    local destination=$2
    mkdir -p "$destination"
    if command_exists unzip; then
        unzip -q -o "$archive" -d "$destination"
        return $?
    fi
    if command_exists bsdtar; then
        bsdtar -xf "$archive" -C "$destination"
        return $?
    fi
    if command_exists python3; then
        log_warn "没有 unzip，改用 python3 -m zipfile 解压（可执行位由更新器补回）。"
        python3 -m zipfile -e "$archive" "$destination"
        return $?
    fi
    die "没有可用的解压工具（unzip / bsdtar / python3 都没有）。" \
        "怎么办：Debian/Ubuntu 上 sudo apt install unzip；Fedora/RHEL 上 sudo dnf install unzip。"
}

# ---------------------------------------------------------------------------
# 备份与覆盖
# ---------------------------------------------------------------------------

# 备份清单：固定目录 + "发布包里实际带来的根目录文件"。
#
# 为什么不能只写死一份常量：根目录的启动脚本与 *.md 会不会被替换，取决于**这一版
# 发布包里带了什么**。写死的话，要么备份了一堆本次根本不会动的文件（备份目录里装
# 满"不会被替换"的东西，回滚语义就模糊了），要么漏备份——比如漏了根目录三件套，
# 回滚之后用户的 start.sh 还是被覆盖过的新版本，而其余文件已经回退，得到一个
# 半新半旧的安装目录。
RF_BACKUP_PATHS_BASE="backend/app backend/alembic.ini backend/requirements.txt backend/requirements-dev.txt backend/scripts frontend/dist scripts docs"

# rf_collect_backup_paths EXTRACTED_DIR
# 产出 RF_BACKUP_PATHS：**即将被替换**的顶层路径（相对项目根，空格分隔）。
rf_collect_backup_paths() {
    local extracted=$1
    local entry
    local name
    RF_BACKUP_PATHS=$RF_BACKUP_PATHS_BASE

    for entry in "$extracted"/*; do
        [ -f "$entry" ] || continue
        name=$(basename "$entry")
        rf_is_program_path "$name" || continue
        case " $RF_BACKUP_PATHS " in
            *" $name "*) continue ;;
        esac
        RF_BACKUP_PATHS="$RF_BACKUP_PATHS $name"
    done
}

rf_prepare_backup_dir() {
    RF_BACKUP_DIR="$RF_RUNTIME_DIR/backup-$(date '+%Y%m%d-%H%M%S')"
    mkdir -p "$RF_BACKUP_DIR"
}

# 暂存目录（下载的包与解压结果都放这里）。放在 runtime/ 下而不是 /tmp：
# /tmp 在不少发行版上是 tmpfs（占内存）或挂载了 noexec，而更新包解压后可达 200MB。
rf_prepare_staging() {
    mkdir -p "$RF_RUNTIME_DIR"
    RF_STAGING="$RF_RUNTIME_DIR/update-$(date '+%Y%m%d-%H%M%S')"
    mkdir -p "$RF_STAGING"
}

# 把"将被替换的现有内容"整体复制到备份目录。
# 只复制**当前存在**的路径：第一次安装/升级路径变化时不该凭空造出空目录。
rf_backup_program_files() {
    local rel
    local src
    local dest
    local backed_up=0
    for rel in $RF_BACKUP_PATHS; do
        src="$RF_PROJECT_ROOT/$rel"
        [ -e "$src" ] || continue
        dest="$RF_BACKUP_DIR/$rel"
        mkdir -p "$(dirname "$dest")"
        if cp -R "$src" "$dest" 2>/dev/null; then
            backed_up=$((backed_up + 1))
        else
            # 备份失败就不能往下覆盖：没有回头路的更新比"不更新"危险得多。
            die "备份 ${rel} 失败，已停止更新（旧的程序文件没有被改动）。" \
                "可能是磁盘空间不足或 ${RF_RUNTIME_DIR} 不可写。" \
                "怎么办：清理磁盘后重试；或用 --check 先确认版本，再手动下载发布包。"
        fi
    done
    log_dim "    覆盖前的备份：${RF_BACKUP_DIR}（${backed_up} 个路径）"
}

# rf_install_file SRC DST
# 用"先写临时文件、再 rename"的方式替换一个文件，而不是直接 cp 覆盖。
#
# 两个理由，都是踩得到的：
#   1) **正在运行的就是这个更新器本身**（scripts/linux/update.sh 属于要覆盖的白名单）。
#      直接 cp -f 会先 truncate 目标文件，而 bash 还在按偏移继续读这份脚本——读到的是
#      被改写后的内容，表现为"更新到一半脚本突然不执行了"或执行了半句命令。
#      rename 只替换目录项，已经打开的那个 inode 不受影响，正在跑的脚本继续读旧内容。
#   2) 断电/被 kill 时，目标位置要么是完整的旧文件、要么是完整的新文件，不会留半个。
rf_install_file() {
    local src=$1
    local dst=$2
    local tmp="${dst}.rf-new-$$"
    if ! cp -f "$src" "$tmp"; then
        rm -f "$tmp" 2>/dev/null || true
        return 1
    fi
    if ! mv -f "$tmp" "$dst"; then
        rm -f "$tmp" 2>/dev/null || true
        return 1
    fi
    return 0
}

# 递归复制白名单内的文件。累计写入全局 RF_COPIED_FILES（供收尾统计）。
#
# 这里刻意 **不删除** 目标目录里多余的旧文件（与 macOS/Windows 侧行为一致）：
# 删除是不可逆的，而多留一个已废弃的文件几乎不会造成问题。
#
# local 同样是必需的：函数递归时，全局变量会被内层帧覆盖，返回后 "dst" 已经指向
# 更深的目录——后续文件的复制会静默落错位置（表现是"更新成功，但某些文件还是旧的"）。
rf_copy_program_files() {
    local src=$1
    local dst=$2
    local rel=${3:-}
    local entry
    local name
    local child_rel
    local failed=0

    mkdir -p "$dst"
    for entry in "$src"/* "$src"/.[!.]*; do
        [ -e "$entry" ] || continue
        name=$(basename "$entry")
        # 排除 . 与 .. 的展开残渣（.[!.]* 在部分 shell 上会带出 "." ）
        [ "$name" = "." ] && continue
        [ "$name" = ".." ] && continue

        if [ -n "$rel" ]; then
            child_rel="${rel}/${name}"
        else
            child_rel=$name
        fi

        # 先过禁止表：任何情况下都不许写用户数据。
        if rf_is_protected_path "$child_rel"; then
            continue
        fi

        if [ -d "$entry" ]; then
            # 目录本身不在白名单里没关系（backend/、frontend/ 都是中间层），
            # 递归下去总会落到具体文件；只有真正要复制的文件才受白名单约束。
            rf_copy_program_files "$entry" "$dst/$name" "$child_rel" || failed=1
        else
            rf_is_program_path "$child_rel" || continue
            if rf_install_file "$entry" "$dst/$name"; then
                RF_COPIED_FILES=$((RF_COPIED_FILES + 1))
            else
                log_warn "写入失败：${child_rel}"
                failed=1
            fi
        fi
    done
    return "$failed"
}

# 补回启动脚本的可执行位。
#
# 为什么必须补：python3 -m zipfile 这条兜底路径不还原权限位，而没有 +x 的
# start.sh 会让用户双击/直接执行时得到 "Permission denied"——更新看起来很成功，
# 启动却坏了。存量发布包的解压路径（unzip）本来是对的，补一次是幂等的。
rf_restore_launcher_modes() {
    local rel
    local target
    for rel in start.sh stop.sh update.sh start.command stop.command update.command \
        scripts/linux/start.sh scripts/linux/stop.sh scripts/linux/update.sh \
        scripts/linux/lib/common.sh scripts/linux/lib/python.sh scripts/linux/lib/node.sh \
        scripts/macos/start.sh scripts/macos/stop.sh scripts/macos/update.sh; do
        target="$RF_PROJECT_ROOT/$rel"
        [ -f "$target" ] || continue
        chmod +x "$target" 2>/dev/null || true
    done
}

# 回滚：把备份里的内容复制回去。
#
# 语义要说清楚：这一步恢复的是"覆盖前存在的每一个文件的内容"。中断的那次更新
# 新加进来的文件会留下来（它们是纯新增，旧启动器不引用）。备份目录本身不删除，
# 用户可以自己再核对一次。
rf_rollback_from_backup() {
    local rel
    local src
    local dest
    log_warn "正在从备份回滚程序文件：${RF_BACKUP_DIR}"
    for rel in $RF_BACKUP_PATHS; do
        src="$RF_BACKUP_DIR/$rel"
        [ -e "$src" ] || continue
        dest="$RF_PROJECT_ROOT/$rel"
        mkdir -p "$(dirname "$dest")"
        if cp -R "$src/." "$dest/" 2>/dev/null || cp -R "$src" "$dest" 2>/dev/null; then
            log_dim "    已回滚：${rel}"
        else
            log_warn "回滚 ${rel} 失败，备份仍在 ${RF_BACKUP_DIR}，请手动复制回去。"
        fi
    done
    log_warn "回滚完成。备份目录保留在 ${RF_BACKUP_DIR}，确认无误后可自行删除。"
}

# ---------------------------------------------------------------------------
# 依赖同步
# ---------------------------------------------------------------------------

# 依赖同步：venv 与 node_modules 都在才做，否则让下次启动自己处理。
# 更新器的职责边界是"程序文件"，依赖只是顺手同步——失败也只提示，不把更新结果
# 报成失败（程序文件已经更新好了，下次启动会再试一遍）。
rf_sync_dependencies() {
    local requirements="$RF_PROJECT_ROOT/backend/requirements.txt"
    local venv_python="${RF_VENV_DIR}/bin/python3"
    if [ -f "$requirements" ] && [ -x "$venv_python" ]; then
        log_info "==> 正在同步后端依赖"
        if ! "$venv_python" -m pip install --disable-pip-version-check -r "$requirements"; then
            log_warn "后端依赖同步失败，但程序文件已经更新。下次启动会再试一次。"
        fi
    else
        log_info "    没有找到后端的虚拟环境；下次启动时会自动创建。"
    fi

    if [ -f "$RF_PROJECT_ROOT/frontend/package.json" ] &&
        [ -d "$RF_PROJECT_ROOT/frontend/node_modules" ] &&
        rf_find_system_node_runtime; then
        log_info "==> 正在同步前端依赖（npm ci）"
        if ! (cd "$RF_PROJECT_ROOT/frontend" && "$RF_NPM_PATH" ci --no-audit --no-fund); then
            log_warn "前端依赖同步失败，但程序文件已经更新。下次启动会再试一次。"
        fi
    else
        log_info "    前端依赖不完整或本机没有 Node；下次启动时会自动处理。"
    fi
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

# 只有直接执行时才跑主流程，理由同 start.sh：测试脚本要 source 它来验证纯函数。
rf_main() {
    local local_version
    local tag
    local remote_version
    local asset
    local available_url
    local archive

    rf_parse_arguments "$@"

    log_info "ResumeForge 更新器（Linux）"
    log_info "项目目录：${RF_PROJECT_ROOT}"

    if [ "$RF_DRY_RUN" -eq 1 ]; then
        log_warn "演练模式：不会下载、不会改动任何文件。"
    fi
    if [ "$RF_CHECK_ONLY" -eq 1 ]; then
        log_warn "只检查模式：不会下载、不会改动任何文件。"
    fi

    local_version=$(rf_local_version "$RF_PROJECT_ROOT/backend/app/config.py") || local_version=""
    if [ -z "$local_version" ]; then
        # 读不到本地版本不该让更新失败（可能是被改过的目录结构），但要如实说明，
        # 因为下面的"是否更新"判断会因此退化成"总是更新"。
        log_warn "读不到本地版本号（backend/app/config.py 的 app_version）；将按发布页的最新版直接更新。"
        local_version="0.0.0"
    fi
    log_info "当前版本：${local_version}"

    # --archive：跳过联网，直接用本地包。这条路径不需要知道远端版本。
    if [ -n "$RF_ARCHIVE_PATH" ]; then
        if [ ! -f "$RF_ARCHIVE_PATH" ]; then
            die "找不到更新包：${RF_ARCHIVE_PATH}" \
                "检查路径是否写对（相对路径是相对当前工作目录，不是项目目录）。"
        fi
        if [ "$RF_CHECK_ONLY" -eq 1 ]; then
            log_info "本地更新包：${RF_ARCHIVE_PATH}（--check 不做任何改动）。"
            return 0
        fi
        if [ "$RF_DRY_RUN" -eq 1 ]; then
            log_warn "会用本地更新包 ${RF_ARCHIVE_PATH} 覆盖程序文件（backend/data、backend/.env、runtime 会保留）。"
            return 0
        fi
        log_info "==> 使用本地更新包（不联网，也不校验 sidecar 摘要）"
        rf_prepare_staging
        rf_apply_archive "$RF_ARCHIVE_PATH"
        return 0
    fi

    tag=$(rf_resolve_latest_tag) || tag=""
    if [ -z "$tag" ]; then
        die "没能查到最新版本（网络不通、GitHub 被拦，或该仓库还没有发布过 release）。" \
            "怎么办：" \
            "  1) 用浏览器打开 https://github.com/${RF_REPOSITORY}/releases 看能否访问；" \
            "  2) 需要代理时，先在终端里 export HTTPS_PROXY=http://127.0.0.1:端口 再重试；" \
            "  3) 已经手动下载了安装包的话，直接用：bash update.sh --archive 路径。"
    fi
    remote_version=$(rf_release_tag_to_version "$tag") || remote_version=""
    if [ -z "$remote_version" ]; then
        die "最新 release 的 tag 无法解析成版本号：${tag}" \
            "请把这条报错发到项目的 GitHub Issues（发布页出现了非预期的 tag 命名）。"
    fi
    log_info "最新版本：${remote_version}（tag ${tag}）"

    asset=$(rf_linux_asset_name "$remote_version")
    if ! rf_remote_is_newer "$remote_version" "$local_version"; then
        log_ok "已经是最新版本，不需要更新。"
        return 0
    fi

    # 这里就是"挑不到本平台包"的分支：明确说清楚并**以 0 退出**。
    # 更新器把"没有可用的更新"当成正常结果，而不是错误——用户的机器没有任何问题，
    # 用法错误才该非零退出。
    available_url=$(rf_update_asset_url "$tag" "$asset")
    if [ "$RF_CHECK_ONLY" -eq 0 ] && [ "$RF_DRY_RUN" -eq 0 ]; then
        # 用 HEAD 探测资产是否存在：不存在时 GitHub 返回 404。
        # 必须在真正下载之前探，否则用户会看到一个"下载失败"——那是在报症状而不是原因。
        if ! curl -fsSL -o /dev/null --head --max-time 30 "$available_url" 2>/dev/null; then
            log_warn "当前平台没有可用更新：${tag} 里没有 ${asset}。"
            log_warn "（发布的程序包只覆盖 windows / macos / all 时，Linux 版可能还在构建中。）"
            log_warn "想看全部发布内容：https://github.com/${RF_REPOSITORY}/releases/tag/${tag}"
            return 0
        fi
    fi

    if [ "$RF_CHECK_ONLY" -eq 1 ]; then
        log_ok "发现新版本：${remote_version}（当前 ${local_version}）。执行 bash update.sh 即可更新。"
        return 0
    fi
    if [ "$RF_DRY_RUN" -eq 1 ]; then
        log_warn "会下载 ${available_url} 并覆盖程序文件。"
        log_dim "    backend/data、backend/.env、runtime、backend/.venv、frontend/node_modules 会保留。"
        return 0
    fi

    rf_prepare_staging
    archive="$RF_STAGING/$asset"
    rf_download_release_archive "$tag" "$asset" "$archive"
    rf_apply_archive "$archive"
}

# 解压 + 备份 + 覆盖 + 收尾。--archive 与联网两条路径共用这一段，
# 避免两条路径的行为慢慢漂移（那正是"手动更新能用、自动更新坏了"的成因）。
rf_apply_archive() {
    local archive=$1
    local extracted
    local entry

    rf_prepare_backup_dir
    extracted="$RF_STAGING/extracted"
    RF_EXTRACTED=""

    log_info "==> 正在解压更新包"
    if ! rf_extract_zip "$archive" "$extracted"; then
        die "解压更新包失败：${archive}" \
            "确认文件完整（重新下载一次），或用 --archive 指定另一个文件。"
    fi
    for entry in "$extracted"/*; do
        if [ -d "$entry" ]; then
            RF_EXTRACTED=$entry
            break
        fi
    done
    if [ -z "$RF_EXTRACTED" ]; then
        die "更新包里没有找到任何目录。" \
            "到 https://github.com/${RF_REPOSITORY}/releases 手动下载完整安装包。"
    fi
    # 健全性检查：发布包的顶层目录里一定有 backend/。缺了说明下载到的不是本项目的包
    # （最坏情况是被网关替换成了错误页 zip），宁可不更新。
    if [ ! -d "$RF_EXTRACTED/backend" ]; then
        die "更新包的结构不对（顶层目录里没有 backend/）。" \
            "下载到的可能不是 ResumeForge 的发布包；请到发布页手动核对后重试。"
    fi

    log_info "==> 正在备份将被替换的程序文件"
    rf_collect_backup_paths "$RF_EXTRACTED"
    rf_backup_program_files

    log_info "==> 正在覆盖程序文件（backend/data、backend/.env、runtime 会保留）"
    RF_COPIED_FILES=0
    if ! rf_copy_program_files "$RF_EXTRACTED" "$RF_PROJECT_ROOT"; then
        rf_rollback_from_backup
        die "覆盖程序文件失败，已回滚。" \
            "常见原因是磁盘空间不足或某个文件被占用。" \
            "备份仍在 ${RF_BACKUP_DIR}，程序文件已恢复到更新前的状态。"
    fi
    rf_restore_launcher_modes
    log_dim "    共覆盖 ${RF_COPIED_FILES} 个文件；旧文件备份在 ${RF_BACKUP_DIR}"
    log_dim "    解压出来的内容保留在：${RF_STAGING}"

    rf_sync_dependencies

    printf '\n'
    log_ok "更新完成。"
    log_ok "双击（或执行）start.sh 重新启动即可；backend/data 里的数据没有被改动。"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    rf_main "$@"
fi
