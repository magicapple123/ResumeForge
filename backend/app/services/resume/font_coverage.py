# SPDX-License-Identifier: Apache-2.0
"""缺字与粗体可用性检测（W11 / D08）。

**为什么要做**：paper 上"字没画出来"是简历最不能接受的一类缺陷——用户在屏幕上看
不出区别（浏览器会 fallback 字体），导出的 PDF 里却是一个空白。fpdf2 只在日志里
打 `missing the following glyphs`，产品层从来没有回答过"这份简历用当前字体缺哪些字"。

**不新增依赖**：`fonttools` 是 fpdf2 的既有运行时依赖，直接读字体的 cmap 即可。
字体解析失败时返回 `checked=False`，**不抛异常**——检查入口不该因为一个坏字体文件
整体 500；同时也不许把"没查成"说成"没有问题"（调用方按 `checked` 区分）。
"""

from __future__ import annotations

import contextlib
from functools import lru_cache

from fontTools.ttLib import TTFont

from ..pdf_exporter.fonts import resolve_font_paths

# 一次最多回多少个缺字（够定位问题即可，避免把整份字体里缺的几万个字符全塞进响应）。
MAX_MISSING_CHARS = 40


@lru_cache(maxsize=16)
def _cmap_codepoints(path: str, mtime_ns: int) -> frozenset[int] | None:
    """读一个字体文件的 cmap（码位集合）。`mtime_ns` 只用于失效缓存。"""
    del mtime_ns  # 只作为缓存键使用；读文件时不参与逻辑。
    try:
        font = TTFont(path, lazy=True)
    except Exception:  # noqa: BLE001 - 坏字体文件：检查功能降级，不影响导出
        return None
    try:
        codepoints: set[int] = set()
        for table in font["cmap"].tables:  # type: ignore[attr-defined]
            codepoints.update(table.cmap.keys())
        return frozenset(codepoints)
    except Exception:  # noqa: BLE001 - 缺 cmap/损坏表：同上
        return None
    finally:
        with contextlib.suppress(Exception):
            font.close()


def _cmap_for(path: str) -> frozenset[int] | None:
    try:
        mtime_ns = int(__import__("os").stat(path).st_mtime_ns)
    except OSError:
        return None
    return _cmap_codepoints(path, mtime_ns)


def _visible_chars(text: str) -> list[str]:
    """待检查的字符序列：去空白与代理项，保持出现顺序（重复只保留一次）。"""
    seen: set[str] = set()
    ordered: list[str] = []
    for char in text:
        if char.isspace() or 0xD800 <= ord(char) <= 0xDFFF:
            continue
        if char in seen:
            continue
        seen.add(char)
        ordered.append(char)
    return ordered


def _missing(path: str | None, chars: list[str]) -> tuple[list[str], bool]:
    if not path:
        return [], False
    cmap = _cmap_for(path)
    if cmap is None:
        return [], False
    missing = [char for char in chars if ord(char) not in cmap]
    return missing[:MAX_MISSING_CHARS], len(missing) > MAX_MISSING_CHARS


def coverage(font_name: str | None, text: str) -> dict:
    """返回 `{checked, font, bold_available, missing, truncated}`（与 schema 同形）。

    `font_name` 是 `format_config.font` 的值（`None` = 跟随全局/系统字体，
    `__system__` = 显式系统字体）；解析逻辑与导出**同一条** `resolve_font_paths`，
    不另写字体发现规则。
    """
    paths = resolve_font_paths(font_name)
    if paths is None:
        return {
            "checked": False,
            "font": font_name,
            "bold_available": False,
            "missing": {},
            "truncated": False,
        }
    regular, bold = paths
    chars = _visible_chars(text)
    missing: dict[str, list[str]] = {}
    truncated = False
    regular_missing, regular_truncated = _missing(regular, chars)
    truncated = truncated or regular_truncated
    if regular_missing:
        missing["regular"] = regular_missing
    if bold and bold != regular:
        bold_missing, bold_truncated = _missing(bold, chars)
        truncated = truncated or bold_truncated
        if bold_missing:
            missing["bold"] = bold_missing
    return {
        "checked": True,
        "font": font_name,
        "bold_available": bool(bold and bold != regular),
        "missing": missing,
        "truncated": truncated,
    }


__all__ = ["MAX_MISSING_CHARS", "coverage"]
