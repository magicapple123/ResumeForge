# SPDX-License-Identifier: Apache-2.0
"""覆盖层排版：把新文字按原块的宽度 / 字号 / 行距 / 对齐重新断行，画成一张单页 PDF。

**为什么自己断行而不用 `multi_cell`**：`multi_cell` 以"格子的顶边"定位，而 PDF 的正文是
按**基线**排的——同一块里中英混排时，用顶边对齐会让改完的那行上下错半格。所以这里自己
算行（宽度用 fpdf2 的 `get_string_width`，与新字用同一份字体度量），再用 `text()`
把每行画在**基线上**（`text()` 的原点就是基线）。

**画的是透明覆盖层**：旧文字已经被删掉了（见 `external_resume_pdf_erase`），不需要白底，
而且不涂白正好保住原来的表格线 / 底纹 / 图片。

**断行规则**：中文按字断、西文按词断，带最基本的标点禁则（行首不出现 `，。、）」` 之类，
行尾不留 `（「` 之类）。超宽（单个不可断单元都比块宽）时按比例缩字号并置
``scaled=True``，由上层如实告诉用户"字号已被缩小"。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from fpdf import FPDF

from .external_resume_pdf_blocks import TextBlock
from .external_resume_pdf_scan import PdfEditError, system_font_path

logger = logging.getLogger(__name__)

CODE_FONT_MISSING = "pdf_font_missing"
CODE_TEXT_EMPTY = "pdf_text_empty"
CODE_TEXT_TOO_LONG = "pdf_text_too_long"
CODE_TEXT_UNRENDERABLE = "pdf_text_unrenderable"

# 单块新文字上限：够改一整段，也挡得住"手滑把整份简历粘进一个块"。
MAX_BLOCK_TEXT_CHARS = 4000
# 超宽时最多缩到原字号的这个比例，再小就宁可不改（看不清的字没有意义）。
MIN_SCALE = 0.5
# 两端对齐时每行最多拉开多少（相对字号），超过就退回左对齐（避免拉出大缝隙）。
MAX_JUSTIFY_RATIO = 0.4

# 行首禁则 / 行尾禁则（简化版）：只处理最常见的中文标点，不做完整 JLREQ。
_NO_LINE_START = set("，。、；：？！）〕】》」』”’·…%,.;:?!)]}>")
_NO_LINE_END = set("（〔【《「『“‘([{<")

_FONT_FAMILY = "resume-overlay"


@dataclass(frozen=True)
class OverlayLayout:
    """覆盖层的排版结果。"""

    content: bytes
    lines: int
    font_size: float
    scaled: bool
    # 最后一行基线（PDF 坐标，y 向上）；块变高时它比原块的 y0 更低。
    last_baseline: float


def _is_cjk(text: str) -> bool:
    return any(
        "\u2e80" <= ch <= "\u9fff" or "\u3000" <= ch <= "\u303f" or "\uff00" <= ch <= "\uffef"
        for ch in text
    )


def _units(text: str) -> list[str]:
    """把一段文字拆成"不可断单元"：中文单字、西文单词、空白。"""
    units: list[str] = []
    buffer = ""
    for ch in text:
        if ch.isspace():
            if buffer:
                units.append(buffer)
                buffer = ""
            units.append(ch)
            continue
        if _is_cjk(ch):
            if buffer:
                units.append(buffer)
                buffer = ""
            units.append(ch)
            continue
        buffer += ch
    if buffer:
        units.append(buffer)
    return units


def _wrap(text: str, width: float, measure) -> list[str]:
    """按块宽断行；`measure(s)` 返回 ``s`` 在当前字号下的宽度。"""
    lines: list[str] = []
    for paragraph in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        units = _units(paragraph)
        if not units:
            lines.append("")
            continue
        current: list[str] = []
        current_width = 0.0
        for unit in units:
            unit_width = measure(unit)
            if current and current_width + unit_width > width:
                # 行首禁则：不让标点落到下一行的开头，宁可让这一行略超宽。
                if unit in _NO_LINE_START and _is_cjk(unit):
                    current.append(unit)
                    current_width += unit_width
                    continue
                # 行尾禁则：别把开括号留在上一行行尾。
                while current and current[-1] in _NO_LINE_END:
                    moved = current.pop()
                    current_width -= measure(moved)
                    lines.append("".join(current).rstrip())
                    current = [moved]
                    current_width = measure(moved)
                lines.append("".join(current).rstrip())
                current = [] if unit.isspace() else [unit]
                current_width = 0.0 if unit.isspace() else unit_width
                continue
            current.append(unit)
            current_width += unit_width
        lines.append("".join(current).rstrip())
    return lines or [""]


def _max_unit_width(text: str, measure) -> float:
    return max((measure(unit) for unit in _units(text) if not unit.isspace()), default=0.0)


def render_block_text(
    block: TextBlock,
    new_text: str,
    *,
    page_width: float,
    page_height: float,
) -> OverlayLayout:
    """把 ``new_text`` 排成覆盖层 PDF（与原页同尺寸、透明底、只有新字）。"""
    text = new_text.replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    if not text.strip():
        raise PdfEditError(
            CODE_TEXT_EMPTY, message="新的文字不能为空；要清空这一块请直接删除这份简历"
        )
    if len(text) > MAX_BLOCK_TEXT_CHARS:
        raise PdfEditError(
            CODE_TEXT_TOO_LONG,
            f"{len(text)} 字",
            message=f"单块最多 {MAX_BLOCK_TEXT_CHARS} 字，请分几块改",
        )
    font_path = system_font_path()
    if font_path is None:
        raise PdfEditError(
            CODE_FONT_MISSING,
            message="找不到可用的中文字体，无法重排新文字；请先在设置里下载内置字体",
        )

    width = max(block.width, 1.0)
    size = block.size
    scaled = False
    pdf = FPDF(unit="pt", format=(page_width, page_height))
    pdf.set_auto_page_break(auto=False)
    pdf.add_font(_FONT_FAMILY, "", str(font_path))
    pdf.add_page()
    pdf.set_font(_FONT_FAMILY, size=size)

    # 单个不可断单元就比块宽还宽（长英文单词 / 长数字串）→ 按比例缩字号。
    widest = _max_unit_width(text, pdf.get_string_width)
    if widest > width:
        target = block.size * (width / widest)
        if target < block.size * MIN_SCALE:
            raise PdfEditError(
                CODE_TEXT_UNRENDERABLE,
                f"块宽 {block.width:.0f}pt",
                message="这段文字即使缩到最小字号也放不进原来的宽度，请改短一些或分成几块",
            )
        size = target
        scaled = True
        pdf.set_font(_FONT_FAMILY, size=size)

    lines = _wrap(text, width, pdf.get_string_width)
    if len(lines) == 1 and pdf.get_string_width(lines[0]) > width and not scaled:
        # 兜底：断行后仍超宽（禁则把它撑出去了），缩字号重排一次。
        ratio = width / max(pdf.get_string_width(lines[0]), 1.0)
        size = max(size * ratio, block.size * MIN_SCALE)
        scaled = True
        pdf.set_font(_FONT_FAMILY, size=size)
        lines = _wrap(text, width, pdf.get_string_width)

    leading = block.leading if block.leading > size else size * 1.35
    align = block.align
    last_baseline = block.baseline
    for index, line in enumerate(lines):
        baseline = block.baseline - index * leading
        line_width = pdf.get_string_width(line)
        x = block.x0
        if align == "right":
            x = block.x1 - line_width
        elif align == "center":
            x = block.x0 + (width - line_width) / 2
        spacing = 0.0
        if align == "justify" and index < len(lines) - 1 and len(line) > 1:
            extra = (width - line_width) / (len(line) - 1)
            if 0 < extra <= size * MAX_JUSTIFY_RATIO:
                spacing = extra
        pdf.set_char_spacing(spacing)
        pdf.text(x, page_height - baseline, line)
        pdf.set_char_spacing(0)
        if index == len(lines) - 1:
            last_baseline = baseline

    content = bytes(pdf.output())
    return OverlayLayout(
        content=content,
        lines=len(lines),
        font_size=round(size, 2),
        scaled=scaled,
        last_baseline=last_baseline,
    )


__all__ = [
    "CODE_FONT_MISSING",
    "CODE_TEXT_EMPTY",
    "CODE_TEXT_TOO_LONG",
    "CODE_TEXT_UNRENDERABLE",
    "MAX_BLOCK_TEXT_CHARS",
    "MIN_SCALE",
    "OverlayLayout",
    "render_block_text",
]
