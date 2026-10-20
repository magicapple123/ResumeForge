# SPDX-License-Identifier: Apache-2.0
"""产品知识一致性守卫：``product_knowledge`` 的事实快照与实际脚本 / 文档对拍。

``backend/app/services/product_knowledge.py`` 集中存放启动 / 升级 / 平台支持的事实
文本，助手系统提示（``app/api/assistant.py::_system_prompt``）从它动态拼入。这里把
每条事实与仓库里真实存在的脚本、README、``docs/upgrading.md`` 对拍，防止"改了脚本
忘了改知识源（或反过来）"时，助手开始对用户说出过时的启动 / 升级步骤。

对拍口径（RF-09 落地后的现行口径）：
- 启动：双击 ``start.cmd``（Windows）/ ``start.command``（macOS）零依赖一键启动；
  发布包自带 ``frontend/dist`` 由后端同源提供页面，运行期不需要 Node；5173 仅 dev 模式。
- 升级：``update.cmd`` / ``update.command``；检查更新入口是页头「使用指南」旁的刷新
  图标或设置 → 应用 → 软件更新；应用内覆盖安装目前只支持 Windows。
- Linux：没有一键脚本、未做兼容验证，知识源必须如实说明。
"""
from __future__ import annotations

from pathlib import Path

from app.api.assistant import _system_prompt
from app.services.product_knowledge import (
    DEFAULT_BACKEND_PORT,
    DEV_ONLY_FRONTEND_PORT,
    PLATFORM_NOTE,
    build_platform_note,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
README_MD = REPO_ROOT / "README.md"
UPGRADING_MD = REPO_ROOT / "docs" / "upgrading.md"
ASSISTANT_SYSTEM_MD = REPO_ROOT / "backend" / "app" / "prompts" / "assistant_system.md"

# 平台知识段必须点到名的一键入口（与 README「快速开始」表格、userGuideSteps 的
# 「开始与停止」「检查更新」两条同口径）。
ONE_CLICK_SCRIPTS = (
    "start.cmd",
    "stop.cmd",
    "update.cmd",
    "start.command",
    "stop.command",
    "update.command",
)


def _read(path: Path) -> str:
    assert path.exists(), f"对拍对象不存在：{path}"
    return path.read_text(encoding="utf-8")


# ===== 一键脚本本身必须存在 =====


def test_all_one_click_launcher_scripts_exist():
    for name in ONE_CLICK_SCRIPTS:
        assert (REPO_ROOT / name).is_file(), f"缺少一键脚本 {name}；若确已改名，同步改 product_knowledge.py 与本测试"


# ===== 知识源的端口 / 模式事实与启动器脚本一致 =====


def test_default_backend_port_matches_windows_launcher():
    ps1 = _read(REPO_ROOT / "scripts" / "Start-ResumeForge.ps1")
    assert f"[int]$BackendPort = {DEFAULT_BACKEND_PORT}" in ps1, (
        "Windows 启动器的默认端口与 product_knowledge.DEFAULT_BACKEND_PORT 不一致"
    )


def test_default_backend_port_matches_macos_launcher():
    start_sh = _read(REPO_ROOT / "scripts" / "macos" / "start.sh")
    assert f"RF_BACKEND_PORT={DEFAULT_BACKEND_PORT}" in start_sh, (
        "macOS 启动器的默认端口与 product_knowledge.DEFAULT_BACKEND_PORT 不一致"
    )


def test_auto_frontend_mode_is_the_default_on_both_platforms():
    """auto 模式 = 发布包自带 dist 时由后端同源提供页面（运行期不需要 Node）。

    这是"5173 只是 dev 端口"这条知识成立的前提；两个平台必须都默认 auto。
    """
    ps1 = _read(REPO_ROOT / "scripts" / "Start-ResumeForge.ps1")
    start_sh = _read(REPO_ROOT / "scripts" / "macos" / "start.sh")
    assert '$FrontendMode = "auto"' in ps1
    assert "RF_FRONTEND_MODE=auto" in start_sh
    assert str(DEV_ONLY_FRONTEND_PORT) in PLATFORM_NOTE, (
        "知识源必须说明 5173 仅用于 dev 模式，防止助手把 npm run dev 当作用户启动方式"
    )


# ===== 知识源文本自身的完整性 =====


def test_platform_note_names_every_one_click_entry():
    for name in ONE_CLICK_SCRIPTS:
        assert name in PLATFORM_NOTE, f"平台知识段漏了一键入口 {name}"
    assert "右键" in PLATFORM_NOTE and "打开" in PLATFORM_NOTE, (
        "macOS 首次打开被拦的处理（右键 → 打开）必须写进知识源"
    )
    assert f"http://127.0.0.1:{DEFAULT_BACKEND_PORT}" in PLATFORM_NOTE


def test_platform_note_states_in_app_update_scope_and_linux_honestly():
    assert "应用内覆盖安装目前只支持 Windows" in PLATFORM_NOTE
    assert "未经过兼容验证" in PLATFORM_NOTE or "未官方支持" in PLATFORM_NOTE, (
        "Linux 未验证这一点必须如实写，不能暗示它有一键体验"
    )


def test_platform_note_agrees_with_readme_quick_start():
    """README（用户会读的权威文档）与知识源关键句对拍——宽松包含，不逐字。"""
    readme = _read(README_MD)
    for needle in ("start.cmd", "start.command", f"http://127.0.0.1:{DEFAULT_BACKEND_PORT}"):
        assert needle in readme, f"README 缺少知识源关键句：{needle}"
    for needle in ("update.cmd", "update.command"):
        assert needle in readme, f"README 更新段缺少一键更新入口：{needle}"


def test_platform_note_agrees_with_upgrading_doc():
    upgrading = _read(UPGRADING_MD)
    assert "应用内覆盖安装目前只支持 Windows" in upgrading, (
        "docs/upgrading.md 与 product_knowledge 的覆盖安装口径必须一致（都是只支持 Windows）"
    )
    assert "update.command" in upgrading and "update.cmd" in upgrading


# ===== 助手系统提示面 =====


def test_system_prompt_carries_platform_note(db_session):
    prompt = _system_prompt(db_session)
    assert "【启动与升级（平台事实）】" in prompt, "系统提示必须拼入平台知识段"
    for needle in ("start.command", "update.command", "应用内覆盖安装目前只支持 Windows"):
        assert needle in prompt
    # 知识段来自单一来源：build_platform_note() 与常量必须一致
    assert build_platform_note() == PLATFORM_NOTE


def test_system_prompt_has_no_stale_manual_launch_advice():
    """旧口径（macOS/Linux 没有一键启动器、手动 npm run dev）不得再出现在提示面。"""
    stale = [
        "没有同等的一键",
        "npm ci、npm run dev，然后打开",
        "其他平台不要承诺",
    ]
    base = ASSISTANT_SYSTEM_MD.read_text(encoding="utf-8")
    for needle in stale:
        assert needle not in base, f"assistant_system.md 仍含旧口径：{needle}"
        assert needle not in PLATFORM_NOTE, f"product_knowledge 仍含旧口径：{needle}"


# ===== 与既有知识审计测试互补：更新条目的可见口径 =====


def test_feature_catalog_update_entry_matches_upgrading_doc():
    """feature_catalog 的 update_check 条目（助手能力地图）与升级文档同口径。

    旧话"macOS/Linux 仍按升级文档手动更新"暗示 macOS 没有一键更新——实际 macOS
    有 ``update.command``（docs/upgrading.md），能力地图不得再说反。
    """
    from app.services.feature_catalog import FEATURES

    update_text = next(f.where for f in FEATURES if f.key == "update_check")
    assert "macOS/Linux 仍按升级文档手动更新" not in update_text, (
        f"update_check 条目对 macOS 的更新口径过时（macOS 有 update.command）：{update_text}"
    )
    assert "update.command" in update_text, (
        f"update_check 条目应点名 macOS 的一键更新入口：{update_text}"
    )
