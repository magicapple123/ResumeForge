# SPDX-License-Identifier: Apache-2.0
"""界面文案 key 的存在性守卫：**引用了就必须有定义**。

为什么需要它：``ui_text`` 在缺 key 时返回空串（``webform_copy.ui_text``），
``localize_panel`` 在缺值时静默跳过。两处都是"沉默的降级"——2026-11-03 的问题 8 就是
``note.recognizeNoValue`` 从未进表，于是面板上只剩「，点「换个资料…」自己挑一条」这半句，
而调用点看上去完全正确。任何一处再漏 key，这里立刻变红。

纯静态扫描：不起浏览器、不连库，只读源码里的字面量与文案表。
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import app
from app.services.webform.panel_copy import _PHRASES
from app.services.webform.webform_copy import copy_for

APP_ROOT = Path(app.__file__).resolve().parent
# 注入脚本里的占位符（`apply_copy` 的输入）。
_TOKEN = re.compile(r"%%copy:([a-zA-Z0-9_.]+)%%")


def _is_ui_text(node: ast.AST) -> bool:
    if isinstance(node, ast.Name):
        return node.id == "ui_text"
    return isinstance(node, ast.Attribute) and node.attr == "ui_text"


def _docstrings(tree: ast.AST) -> set[int]:
    """模块/类/函数的第一条字符串——里面写的是用法示例，不是真的 key。"""
    found: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                found.add(id(body[0].value))
    return found


def _referenced_keys() -> set[str]:
    keys: set[str] = set()
    for path in APP_ROOT.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        docstrings = _docstrings(tree)
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Constant)
                and isinstance(node.value, str)
                and id(node) not in docstrings
            ):
                keys.update(_TOKEN.findall(node.value))
            # 只认**字面量** key：变量 key 无法静态核对，这里不为它假装通过。
            if (
                isinstance(node, ast.Call)
                and _is_ui_text(node.func)
                and len(node.args) >= 2
                and isinstance(node.args[1], ast.Constant)
                and isinstance(node.args[1].value, str)
            ):
                keys.add(node.args[1].value)
    return keys


def test_every_referenced_copy_key_exists():
    table = copy_for("zh-CN")
    missing = sorted(key for key in _referenced_keys() if key not in table)
    assert not missing, f"这些文案 key 被引用但未定义（ui_text 会返回空串）：{missing}"


def test_panel_phrases_have_english_translations():
    """``localize_panel`` 只在英文表里有值时才替换；缺译文 = 英文界面残留中文。"""
    english = copy_for("en-US")
    missing = sorted({key for _zh, key in _PHRASES if not english.get(key)})
    assert not missing, f"这些面板短语缺英文译文：{missing}"


def test_the_two_empty_state_reasons_are_both_defined():
    """问题 8 的两个分支各自成句，缺任何一条就等于把两件事又合并了。"""
    table = copy_for("zh-CN")
    assert "资料里还没填" in table["note.recognizeNoValue"]
    assert "当前方案未包含" in table["note.sectionFiltered"]
