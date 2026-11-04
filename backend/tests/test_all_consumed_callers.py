# SPDX-License-Identifier: Apache-2.0
"""``load_all_consumed_profile`` 的使用契约守卫（需求 8，纯静态扫描）。

背景：``profile_reader.load_all_consumed_profile`` 是全项目**唯一**会带出"用户已隐藏板块"
的取数函数（语义就是"不按组裁剪"）。它现在只被网申快照的重叠字段裁决使用，而那里只取
政治面貌 / 出生 / 导师 / 研究方向这几个专用字段，碰不到板块内容——**所以当前是安全的，
但安全性全靠调用方自律**。任何面向用户或模型的链路换成它，隐藏板块立刻泄露，而这类改动
看起来非常无害（"我只是想拿完整资料"）。

三条断言（毫秒级，不碰数据库、不 import 被测模块）：

1. ``app/{api,services}`` 下所有 ``load_all_consumed_profile(...)`` 调用点必须在白名单里，
   否则变红并报出**文件 + 行号**；
2. 白名单每条都必须带具体理由与到期日（到期后变红点名，与行数预算同一套语义）；
3. 白名单里的调用点消失 → 报「幽灵豁免」，逼着删掉失效条目（否则名单只会越来越长）。
"""

from __future__ import annotations

import ast
import datetime
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCAN_ROOTS = ("backend/app/api", "backend/app/services")
TARGET = "load_all_consumed_profile"
# 理由至少要比"暂缓"这类空话长；太短的条目大概率没想清楚为什么允许。
_MIN_REASON_CHARS = 12


@dataclass(frozen=True)
class Exemption:
    """一条书面豁免：具体理由 + 到期日（ISO 日期，到期后守卫变红点名）。"""

    reason: str
    expires: str


# 白名单（路径相对仓库根）。**新增调用点必须在这里登记**，并写清"为什么它碰不到板块内容"。
_ALLOWED: dict[str, Exemption] = {
    "backend/app/services/webform/data/profile_snapshot.py": Exemption(
        "网申快照的重叠字段裁决只取政治面貌/出生/导师/研究方向等专用字段，"
        "不读板块内容；'不按组裁剪'正是该裁决的语义前提",
        "2027-06-30",
    ),
}


def _python_files(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    return sorted(path for path in root.rglob("*.py") if "__pycache__" not in path.parts)


def _relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def _call_sites() -> list[tuple[str, int]]:
    """所有调用点：``(相对路径, 行号)``，按 import 别名识别，不只认函数本名。"""
    sites: list[tuple[str, int]] = []
    for root_name in SCAN_ROOTS:
        for path in _python_files(REPO_ROOT / root_name):
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            except SyntaxError:  # 半成品文件由别的守卫负责，这里不重复报语法错
                continue
            names = {TARGET}
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    for alias in node.names:
                        if alias.name == TARGET and alias.asname:
                            names.add(alias.asname)
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func
                called = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
                if called in names:
                    sites.append((_relative(path), node.lineno))
    return sorted(sites)


def test_call_sites_are_all_whitelisted():
    offenders = [f"{path}:{line}" for path, line in _call_sites() if path not in _ALLOWED]
    assert offenders == [], (
        "load_all_consumed_profile 会带出用户已隐藏的板块，禁止用于展示/生成链路；"
        f"未登记的调用点：{offenders}"
    )


def test_known_call_site_is_present():
    """扫描器本身要有对照点：调用点变 0 说明扫描坏了（或函数被误删），不能静默变绿。"""
    paths = {path for path, _line in _call_sites()}
    assert set(_ALLOWED) <= paths, f"扫描器没找到已知调用点：{sorted(paths)}"


def test_whitelist_entries_carry_reason_and_expiry():
    today = datetime.date.today()
    for path, exemption in _ALLOWED.items():
        assert len(exemption.reason.strip()) >= _MIN_REASON_CHARS, f"{path} 的豁免理由太笼统"
        expires = datetime.date.fromisoformat(exemption.expires)
        assert expires > today, f"{path} 的豁免已于 {exemption.expires} 到期，需要复核或删除"


def test_whitelist_has_no_ghost_entries():
    used = {path for path, _line in _call_sites()}
    ghosts = sorted(path for path in _ALLOWED if path not in used)
    assert ghosts == [], f"白名单里的调用点已消失，属于幽灵豁免，必须删除：{ghosts}"
