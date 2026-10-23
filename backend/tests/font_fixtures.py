# SPDX-License-Identifier: Apache-2.0
"""测试用的最小字体：现场合成，不往仓库里塞十几 MB 的真字体。

R10 的链路（读字体 → 按字符集子集化 → base64 → 注入 HTML）只依赖 sfnt 结构，一款
只含几十个方块字形的小 TTF 就能完整覆盖；真实中文字体只影响子集体积，不影响正确性。
"""

from __future__ import annotations

import io
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

# 简历里最常出现的一小撮字，测试里直接用它当字体覆盖范围。
DEFAULT_TEXT = "简历张三测试后端工程师公司大学"


def _box_glyph():
    """一个 480×700 的方块：轮廓只要非空，能被子集化与渲染即可。"""
    pen = TTGlyphPen(None)
    pen.moveTo((60, 0))
    pen.lineTo((60, 700))
    pen.lineTo((540, 700))
    pen.lineTo((540, 0))
    pen.closePath()
    return pen.glyph()


def build_test_font(text: str = DEFAULT_TEXT, family: str = "Test Sans") -> bytes:
    """合成一个只含 ``text`` 中字符的最小 TTF，返回文件字节。"""
    chars = sorted(set(text))
    glyph_order = [".notdef", *(f"uni{ord(char):04X}" for char in chars)]
    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap({ord(char): f"uni{ord(char):04X}" for char in chars})
    builder.setupGlyf({name: _box_glyph() for name in glyph_order})
    builder.setupHorizontalMetrics({name: (600, 60) for name in glyph_order})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable(
        {
            "familyName": family,
            "styleName": "Regular",
            "uniqueFontIdentifier": f"{family} Regular",
            "fullName": f"{family} Regular",
            "psName": family.replace(" ", "") + "-Regular",
            "version": "Version 1.0",
        }
    )
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200)
    builder.setupPost()
    buffer = io.BytesIO()
    builder.save(buffer)
    return buffer.getvalue()


def write_font(name: str, data: bytes) -> Path:
    """把字体字节直接写进字体目录，返回文件路径。

    上传接口（``POST /api/settings/fonts``）已于 2026-11 下线，服务层的 ``save_font``
    随之删除。测试仍然需要"磁盘上有一个字体文件"这个前提——这就是它唯一要做的事，
    刻意不复刻任何校验逻辑（文件名白名单、体积上限那些都属于已经不存在的那条链路）。
    """
    from app.services import user_fonts

    directory = user_fonts.fonts_dir()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_bytes(data)
    return path
