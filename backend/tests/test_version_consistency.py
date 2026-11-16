# SPDX-License-Identifier: Apache-2.0
"""版本号一致性：两处真实来源必须相同。

前端界面不显示版本，所以不一致不会在界面上暴露，只会出现在 README、Releases 页、
`/api/health` 和备份 manifest 四处。这条测试让"发版时改漏一处"在 CI 上立刻失败。
"""

import json
import re
from pathlib import Path

from app.config import get_settings

REPO_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_JSON = REPO_ROOT / "frontend" / "package.json"
DESKTOP_PACKAGE_JSON = REPO_ROOT / "desktop" / "package.json"
FRONTEND_LOCK = REPO_ROOT / "frontend" / "pnpm-lock.yaml"
DESKTOP_LOCK = REPO_ROOT / "desktop" / "pnpm-lock.yaml"
FRONTEND_WORKSPACE = REPO_ROOT / "frontend" / "pnpm-workspace.yaml"
DESKTOP_WORKSPACE = REPO_ROOT / "desktop" / "pnpm-workspace.yaml"
LEGACY_NPM_LOCK = REPO_ROOT / "frontend" / "package-lock.json"
LEGACY_DESKTOP_NPM_LOCK = REPO_ROOT / "desktop" / "package-lock.json"
README = REPO_ROOT / "README.md"
# GitHub 默认展示英文版；中文版是 README.zh-CN.md，两处版本号必须同步。
README_ZH = REPO_ROOT / "README.zh-CN.md"

# 包管理器版本：迁移到 pnpm 后这两个字段是硬约束的来源，改一处漏一处会让
# `pnpm install` 在本地静默漂版本、在 CI 上 fail。文案保持一致便于排查。
PINNED_PNPM_VERSION = "12.21.0"
PINNED_PACKAGE_MANAGER = f"pnpm@{PINNED_PNPM_VERSION}"


def test_backend_and_frontend_versions_match():
    package_version = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))["version"]

    assert get_settings().app_version == package_version


def test_frontend_lockfile_exists_and_package_lock_is_gone():
    """pnpm 锁文件必须在，npm 锁文件必须彻底消失。

    这里没有"根包版本同步"断言：pnpm 的 importers 段不记录根包版本，那个同步点
    已经不存在了。锁文件是否过期由 CI 的 `pnpm install --frozen-lockfile` 守。
    保留下来的价值是防止回退——双锁文件共存（package-lock.json 被重新生成）
    是这次迁移最可能的回滚路径，一旦出现就会有两个互相矛盾的依赖真相。
    """
    lock_text = FRONTEND_LOCK.read_text(encoding="utf-8")

    assert "lockfileVersion:" in lock_text

    assert not LEGACY_NPM_LOCK.exists(), (
        "frontend/package-lock.json 必须保持删除；npm 与 pnpm 的锁文件共存会让依赖"
        "真相分叉（改一处另一处不会更新）"
    )
    assert not LEGACY_DESKTOP_NPM_LOCK.exists(), (
        "desktop/package-lock.json 必须保持删除；理由同上。desktop 的依赖真相只在 "
        "desktop/pnpm-lock.yaml 里"
    )


def test_package_manifests_pin_pnpm():
    """两个 package.json 必须同时钉住 pnpm 版本。

    `engines.pnpm` 是精确串匹配（写成 12.20.0 会 ERR_PNPM_UNSUPPORTED_ENGINE），
    `packageManager` 决定 Corepack/CI 用哪个版本。两处必须一致，否则会出现
    "本地 12.20 通过、CI 12.21 重解析锁文件"这类只在 CI 上暴露的漂移。
    """
    for manifest_path in (PACKAGE_JSON, DESKTOP_PACKAGE_JSON):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        label = manifest_path.relative_to(REPO_ROOT).as_posix()

        assert manifest["engines"]["pnpm"] == PINNED_PNPM_VERSION, (
            f"{label} 的 engines.pnpm 必须是 {PINNED_PNPM_VERSION}"
        )
        assert manifest["packageManager"] == PINNED_PACKAGE_MANAGER, (
            f"{label} 的 packageManager 必须是 {PINNED_PACKAGE_MANAGER}"
        )
        assert manifest["engines"]["node"], f"{label} 必须保留 node 版本约束"


def test_readme_states_the_current_version():
    package_version = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))["version"]

    assert f"Version: `{package_version}`" in README.read_text(encoding="utf-8")
    assert f"当前版本：`{package_version}`" in README_ZH.read_text(encoding="utf-8")


def test_lockfiles_are_single_yaml_document():
    """锁文件必须只有一个 YAML 文档，据此守住 Dependabot 的 JS 安全告警。

    pnpm 12 一旦把 `packageManager` 纳管，就会在 `pnpm-lock.yaml` 里写第二个 YAML
    文档（`---` 分隔），第一个文档只描述环境本身：`configDependencies`、
    `packageManagerDependencies` 和 16 个 `@pnpm/exe.*` 平台二进制，真正的依赖在
    第二个文档里。GitHub 的依赖图只解析第一个文档，于是 JS 依赖全部看不见，
    Dependabot 的 security alerts / security updates 与 dependency-review 一起失效，
    而本地 `pnpm install` 完全正常——失败只在 GitHub 上出现，极难察觉。

    修法是 `pnpm-workspace.yaml` 顶层的 `pmOnFail: ignore`（两个 workspace 都要有，
    只改锁文件不改配置会在下一次 install 时变回双文档）。设置后 `pnpm install
    --lockfile-only` 会重生成单文档锁文件，包条目不变。代价是 `packageManager` 的
    版本校验变软（版本不匹配不再自动切换/报错），由 `engines.pnpm` 的精确串硬校验
    兜底——那部分断言在 test_package_manifests_pin_pnpm 里。

    失败时的排查顺序：先确认两个 `pnpm-workspace.yaml` 的 `pmOnFail: ignore` 没被删，
    再 `pnpm install --lockfile-only` 重新生成锁文件（该命令不碰 node_modules）。
    """
    document_separator = re.compile(r"(?m)^---$")
    env_document_marker = "packageManagerDependencies"

    for label, lock_path in (
        ("frontend/pnpm-lock.yaml", FRONTEND_LOCK),
        ("desktop/pnpm-lock.yaml", DESKTOP_LOCK),
    ):
        lock_text = lock_path.read_text(encoding="utf-8")

        separators = document_separator.findall(lock_text)
        assert not separators, (
            f"{label} 出现了 {len(separators)} 个 YAML 文档分隔符 `---`：锁文件变回"
            "双文档 = GitHub 依赖图读不到 JS 依赖 = Dependabot 安全告警失效。"
            "修法是确认 pnpm-workspace.yaml 的 `pmOnFail: ignore` 没被删，"
            "再 `pnpm install --lockfile-only` 重生成（不碰 node_modules）"
        )
        assert env_document_marker not in lock_text, (
            f"{label} 出现了 `{env_document_marker}`：说明 pnpm 又开始把自己写进锁文件，"
            "GitHub 依赖图将只读这个环境文档，Dependabot 看不到真实依赖。"
            "修法同上：补回 `pmOnFail: ignore` 后 `pnpm install --lockfile-only`"
        )

    for label, workspace_path in (
        ("frontend/pnpm-workspace.yaml", FRONTEND_WORKSPACE),
        ("desktop/pnpm-workspace.yaml", DESKTOP_WORKSPACE),
    ):
        workspace_text = workspace_path.read_text(encoding="utf-8")
        assert re.search(r"(?m)^pmOnFail:\s*ignore\s*$", workspace_text), (
            f"{label} 顶层必须有 `pmOnFail: ignore`。只把锁文件改成单文档而不改配置"
            "会被下一次 `pnpm install` 覆盖回双文档；这条断言防的正是那种"
            "\"看起来已经修好\"的回退"
        )
