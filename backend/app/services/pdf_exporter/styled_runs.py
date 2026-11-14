# SPDX-License-Identifier: Apache-2.0
"""带行内字号/颜色的段落绘制（R-11 的 PDF 出口）。

## 为什么必须单独一条路径

fpdf2 的 markdown 只认“加粗/斜体/下划线/删除线”，**没有逐 run 的字号与颜色**：
字号是整段的 `font_size_pt`，颜色是画布级状态。所以带 `{@size=…,color=…}` 的段落
不能交给 `multi_cell` 的 markdown 模式，必须按行、按 run 自己画。

## 只在“真有样式”时接管

`render_multiline` / `render_singleline` 先问 `styled_spans(text)`：

* 返回 None（没有 `{@` 标记）→ 完全走原来的 fpdf 路径，**历史产物逐字节不变**；
* 返回 span 列表 → 由本模块排版与绘制，y 的推进、`dry_run` 量高、`new_x/new_y`
  语义与 fpdf 的 `multi_cell` 对齐，调用方不需要知道走了哪条路。

这样把风险限制在“用户确实给某几个字调了字号/颜色”的段落上，而不是所有正文。

## 折行口径

逐字符累加宽度（每个字符按它所属 span 的字号量），遇到放不下时回退到最近一个
**合法断点**：空格之后、或 CJK 字符之后。找不到断点就硬断（与浏览器对超长英文串的
行为一致）。与 HTML 侧的差别只在“行尾是否可以更紧一点”，不会溢出、不会串行。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fpdf.enums import XPos, YPos

from ..resume.resume_inline_style import has_inline_style, hex_to_rgb
from ..resume.resume_rich_text import RichSpan, parse_rich_runs

#: 断点判定：CJK 字符之后可以断行（与 `line_break.cjk_gap_indices` 同一类字符集）。
_CJK_RANGES = (
    (0x2E80, 0x9FFF),
    (0x3000, 0x303F),
    (0xF900, 0xFAFF),
    (0xFF00, 0xFFEF),
)


def _is_cjk(char: str) -> bool:
    code = ord(char)
    return any(low <= code <= high for low, high in _CJK_RANGES)


def _text_color(pdf: Any) -> tuple[int, int, int]:
    """画布当前的文字颜色 → RGB 元组。

    fpdf2 的 `text_color` 是 `DeviceRGB`（0–1 浮点），**不能**直接 `*` 解包——
    这里统一换回 0–255 的整数元组，绘制结束后用它还原。
    """
    color = pdf.text_color
    if isinstance(color, tuple):
        return color
    red = getattr(color, "r", 0.0) or 0.0
    green = getattr(color, "g", 0.0) or 0.0
    blue = getattr(color, "b", 0.0) or 0.0
    return (round(red * 255), round(green * 255), round(blue * 255))


@dataclass
class _Glyph:
    """一个字符 + 它自己的样式与宽度（mm）。"""

    char: str
    width: float
    size_pt: float
    bold: bool
    color: tuple[int, int, int] | None
    link: str | None = None


def styled_spans(text: str) -> list[RichSpan] | None:
    """有行内样式就返回解析结果，否则 None（调用方据此决定走不走新路径）。"""
    if not has_inline_style(text):
        return None
    spans = parse_rich_runs(text)
    if not any(span.size or span.color for span in spans):
        return None
    return spans


def _glyphs(pdf: Any, spans: list[RichSpan], base_pt: float, bold: bool) -> list[_Glyph]:
    """把 span 列表摊成逐字符的 glyph（每个字符按所属 span 的字号量宽）。"""
    glyphs: list[_Glyph] = []
    spacing = pdf.char_spacing * pdf.font_stretching / 100 / pdf.k
    for span in spans:
        size_pt = base_pt * (span.size or 1.0)
        weight = span.bold or bold
        pdf.set_font(pdf.font_family, "B" if weight else "", size_pt)
        for char in span.text:
            glyphs.append(
                _Glyph(
                    char=char,
                    width=pdf.get_string_width(char) + spacing,
                    size_pt=size_pt,
                    bold=weight,
                    color=hex_to_rgb(span.color),
                    link=span.link,
                )
            )
    return glyphs


def _line_break(glyphs: list[_Glyph], width: float) -> list[list[_Glyph]]:
    """贪心折行，断点优先空格之后、其次 CJK 字符之后，超出时回退到最近断点。"""
    lines: list[list[_Glyph]] = []
    current: list[_Glyph] = []
    used = 0.0
    last_break = -1
    for glyph in glyphs:
        if glyph.char == "\n":
            lines.append(current)
            current, used, last_break = [], 0.0, -1
            continue
        current.append(glyph)
        used += glyph.width
        if glyph.char.isspace() or _is_cjk(glyph.char):
            last_break = len(current)
        if used <= width:
            continue
        if last_break > 0 and last_break < len(current):
            lines.append(current[:last_break])
            rest = current[last_break:]
            current = rest
            used = sum(item.width for item in rest)
        else:
            lines.append(current[:-1])
            current = [current[-1]]
            used = current[0].width
        last_break = -1
    if current:
        lines.append(current)
    return [line for line in lines if line]


def _draw_line(pdf: Any, line: list[_Glyph], x: float, y: float, width: float, align: str) -> None:
    """画一行：按 (字号/加粗/颜色/链接) 分组，每组一个 cell。"""
    natural = sum(glyph.width for glyph in line)
    slack = max(0.0, width - natural)
    offset = {"C": slack / 2, "R": slack}.get(align, 0.0)
    cursor = x + offset
    height = max((pdf.line_advance(glyph.size_pt) for glyph in line), default=0.0)
    previous_color = _text_color(pdf)
    old_margin = pdf.c_margin
    pdf.c_margin = 0
    try:
        group: list[_Glyph] = []
        for glyph in [*line, None]:
            same = (
                group
                and glyph is not None
                and glyph.size_pt == group[0].size_pt
                and glyph.bold == group[0].bold
                and glyph.color == group[0].color
                and glyph.link == group[0].link
            )
            if group and not same:
                run = "".join(item.char for item in group)
                run_width = sum(item.width for item in group)
                pdf.set_font(pdf.font_family, "B" if group[0].bold else "", group[0].size_pt)
                pdf.set_text_color(*(group[0].color or previous_color))
                pdf.set_xy(cursor, y)
                pdf.cell(
                    run_width,
                    height,
                    run,
                    new_x=XPos.RIGHT,
                    new_y=YPos.TOP,
                    link=group[0].link or "",
                )
                cursor += run_width
                group = []
            if glyph is not None:
                group.append(glyph)
    finally:
        pdf.c_margin = old_margin
        pdf.set_text_color(*previous_color)


def draw_paragraph(
    pdf: Any,
    spans: list[RichSpan],
    *,
    x: float,
    y: float,
    width: float,
    line_height: float,
    align: str,
    dry_run: bool,
    output: Any,
) -> float | tuple[float, float] | list[str]:
    """排一段带样式的正文，返回与 `multi_cell` 同形的结果。

    * ``output == "HEIGHT"``（量高，`_dry_run_height` 用它）→ 返回总高度（mm）；
    * 其余 → 逐行绘制并按 `new_x/new_y` 收尾，返回 `(x, y)`。
    """
    saved_font = (pdf.font_family, pdf.font_style, pdf.font_size_pt)
    base_pt = pdf.font_size_pt
    bold = "B" in pdf.font_style
    glyphs = _glyphs(pdf, spans, base_pt, bold)
    lines = _line_break(glyphs, width)
    height = line_height * len(lines)
    if output == "HEIGHT" or dry_run:
        pdf.set_font(*saved_font)
        return height
    cursor_y = y
    for line in lines:
        if not pdf.measuring and cursor_y + line_height > pdf.page_break_trigger:
            pdf.add_page()
            cursor_y = pdf.get_y()
            pdf.set_x(x)
        _draw_line(pdf, line, x, cursor_y, width, align)
        cursor_y += line_height
    pdf.set_font(*saved_font)
    return cursor_y


def position_after(
    pdf: Any,
    *,
    start_x: float,
    start_y: float,
    width: float,
    height: float,
    new_x: Any,
    new_y: Any,
) -> tuple[float, float]:
    """按 fpdf2 的 `new_x` / `new_y` 语义收尾（只覆盖仓库里实际用到的几种）。"""
    right = start_x + width
    final_x = {
        XPos.RIGHT: right,
        XPos.RMARGIN: pdf.w - pdf.r_margin,
        XPos.LEFT: start_x,
        XPos.LMARGIN: pdf.l_margin,
        XPos.START: start_x,
        XPos.END: right,
        XPos.CENTER: start_x + width / 2,
    }.get(new_x, right)
    final_y = {
        YPos.NEXT: start_y + height,
        YPos.TOP: start_y,
        YPos.LAST: start_y,
        YPos.TMARGIN: pdf.t_margin,
        YPos.BMARGIN: pdf.h - pdf.b_margin,
    }.get(new_y, start_y + height)
    pdf.set_xy(final_x, final_y)
    return final_x, final_y


__all__ = ["draw_paragraph", "position_after", "styled_spans"]
