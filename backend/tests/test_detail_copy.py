# SPDX-License-Identifier: Apache-2.0
"""守卫：后端 ``HTTPException.detail`` 里不许出现「请」。

为什么要有这条
--------------
规范 ``docs/ui-copy-guide.md`` §2.4 定的是「detail 只出**原因**」，§4.6 定的是
「动作由前端拼」：``frontend/src/api/errorGuidance.ts`` 的 ``formatErrorGuidance()``
已经把每条错误渲染成「原因 · 建议 · 编号」三段，其中「建议」写的就是"重试 / 换文件 /
去设置页配置"这类动作。

于是 detail 里再写一句「请稍后重试」的直接后果是用户看到**两段"请你…"**：

    原因：生成第一题失败，请稍后重试 · 建议：重试；若反复出现，请导出诊断包… · 编号：ab12cd34

46 条这样的 detail 横跨 21 个文件，靠人记是记不住的——所以钉一条守卫。**不是**要求
detail 读起来更简洁，而是要求它别抢前端的活。

边界（写清楚，免得后来者以为漏了）
--------------------------------
* 只看字面量：``detail="…"`` / ``detail=f"…"`` / 相邻字面量相加。变量拼出来的
  （``detail=str(exc)``、``detail=exc.public_message``）不在这里判——它们的内容由各自的
  服务层决定，硬扫会变成假红。
* 只看 ``app/api/**``：服务层的 ``ValueError`` / ``DomainError`` 文案大多不会到前端
  （``app/services`` 里那批是内部消息），把它们一起扫会逼着改一堆只写进日志的字符串。
  真要收那批，另开一轮做「服务层错误文案 → 原因化」的迁移。
* 注释与日志不算：``grep`` 复查时会看到 ``# 修复"请求 page_limit=2…"`` 这类命中，
  那是「请求」这个词，不是「请」这个动作。
"""

from __future__ import annotations

import ast
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1] / "app" / "api"

# 「请」是动作段的信号；规范 §2.4 要求 detail 只写原因。
BANNED = "请"


def _literal_text(node: ast.AST) -> str | None:
    """取出字符串字面量的文本；变量/调用等动态值返回 ``None``（不判）。

    ``f"…"`` 与 ``"a" "b"`` 都把常量段拼起来——动态段用占位符代替，判断只看常量文本。
    """
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        parts: list[str] = []
        for value in node.values:
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                parts.append(value.value)
            else:
                parts.append("{}")
        return "".join(parts)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = _literal_text(node.left)
        right = _literal_text(node.right)
        if left is not None and right is not None:
            return left + right
    return None


def _is_http_exception(node: ast.Call) -> bool:
    """``HTTPException(...)`` 或 ``fastapi.HTTPException(...)``。"""
    func = node.func
    if isinstance(func, ast.Name):
        return func.id == "HTTPException"
    if isinstance(func, ast.Attribute):
        return func.attr == "HTTPException"
    return False


def _detail_literals() -> list[tuple[str, int, str]]:
    """扫 ``app/api`` 下所有 ``HTTPException(detail=…)`` 的字面量 detail。"""
    found: list[tuple[str, int, str]] = []
    for path in sorted(API_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        rel = path.relative_to(API_DIR.parents[0]).as_posix()
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and _is_http_exception(node)):
                continue
            for keyword in node.keywords:
                if keyword.arg != "detail":
                    continue
                text = _literal_text(keyword.value)
                if text is not None:
                    found.append((rel, node.lineno, text))
    return found


def test_detail_literals_do_not_carry_the_action_word():
    """detail 只写原因，不许自带「请…」动作段（动作归前端 errorGuidance）。"""
    offenders = [
        f"{where}:{line}  detail={text!r}"
        for where, line, text in _detail_literals()
        if BANNED in text
    ]
    assert offenders == [], (
        "detail 里出现了「请」——动作段归前端 api/errorGuidance.ts 的 formatErrorGuidance()，"
        "detail 只写原因（规范 §2.4 / §4.6）。逐条改成原因，别把「请…」留在 detail：\n"
        + "\n".join(offenders)
    )


def test_the_scan_actually_reaches_the_details():
    """守卫不能空转：扫不到 detail 时上面那条永远绿，等于没有守卫。

    实测口径（2026-10-22）：``app/api`` 里含中文字面量的 detail 有一百多条。
    这里定 100 条的下限，改动把细节挪走时先降到这里再说——下限一降就说明扫描口径坏了。
    """
    details = _detail_literals()
    assert len(details) >= 100, (
        f"只扫到 {len(details)} 条 detail 字面量，扫描口径可能已经失效"
        "（例如 detail 被挪进 helper 后不再是字面量）"
    )
