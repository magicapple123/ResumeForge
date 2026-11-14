# SPDX-License-Identifier: Apache-2.0
"""正文块（段落 / 项目符号）的 PDF 绘制，含字段级覆盖的落点。

为什么分成两条画法：它们的**字节稳定性要求**不一样。

- 纯文本块走 :func:`_draw_paragraph` 的 ``multi_cell``：折行交给 fpdf2，属于既有产物，
  改口径会让所有旧简历的 PDF 跟着变；
- 带字段级样式或行内标记的块必须先 ``flush()`` 掉批量项目符号，再逐块自己量宽、画：
  否则"这一块要单独缩进"会作用到整批项目符号上，看起来像整段都被改了。

字段级取样式只看 ``is_field_path(block.path)``：命中才用这个字段的覆盖，否则沿用条目的
``body`` 角色。加粗 / 字号 / 颜色的标记语法由 ``document_inline`` 统一投影，这里不再判断
协议本身。
"""

from collections.abc import Callable, Sequence

from fpdf.enums import XPos, YPos

from ...schemas.resume_document_plan import BlockPlan
from ..resume.field_style_target import is_field_path
from ..resume.resume_style import RoleStyle
from .canvas import _ResumePDF
from .document_fields import draw_label_segments, has_styled_labels
from .document_inline import inline_text
from .fonts import FONT_FAMILY
from .layout import _PX_TO_PT
from .style_blocks import _bold, _color, _letter_spacing_mm, _line_height, _scale

_ALIGN = {"left": "L", "center": "C", "right": "R", "justify": "J"}


def _draw_paragraph(
    pdf: _ResumePDF,
    text: str,
    *,
    base: float,
    style: RoleStyle | None,
    section: str = "",
    object_id: str | None = None,
) -> None:
    if not text.strip():
        return
    layout = pdf.layout
    size = base * _scale(style)
    line_height = _line_height(pdf, style, size)
    align = _ALIGN.get(str(style.align) if style is not None and style.align else "left", "L")
    bold = _bold(pdf, style, False)
    letter_spacing = _letter_spacing_mm(base, style)
    indent_mm = layout.gap_mm(float(style.indent)) if style and style.indent is not None else 0.0
    pdf.set_font(FONT_FAMILY, "B" if bold else "", size * _PX_TO_PT)
    pdf.set_text_color(*_color(style, pdf.body_text))
    if style and style.space_before is not None:
        pdf.ln(layout.gap_mm(float(style.space_before)))
    pdf.ensure_space(line_height)
    top = pdf.get_y()
    pdf.set_x(pdf.frame_left + indent_mm)
    width = max(1.0, pdf.frame_width - indent_mm)
    if letter_spacing:
        pdf.set_char_spacing(letter_spacing)
    pdf.multi_cell(width, line_height, text, align=align, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    if letter_spacing:
        pdf.set_char_spacing(0)
    if style and style.space_after is not None:
        pdf.ln(layout.gap_mm(float(style.space_after)))
    pdf.set_text_color(*pdf.body_text)
    if section:
        pdf.record(kind="point", section=section, y_top=top, object_id=object_id, text=text)


def _draw_body_blocks(
    pdf: _ResumePDF,
    blocks: Sequence[BlockPlan],
    *,
    base: float,
    style: RoleStyle | None,
    section: str,
    object_id: str | None,
    split_ok: bool = False,
    role_style: Callable | None = None,
) -> None:
    pending: list[str] = []
    pending_style = style
    previous_bullet = False

    def flush() -> None:
        if pending:
            if pending_style != style and pending_style and pending_style.space_before is not None:
                pdf.ln(pdf.layout.gap_mm(float(pending_style.space_before)))
            pdf.bullets(
                list(pending),
                base,
                style=pending_style,
                section=section,
                object_id=object_id,
                split_ok=split_ok,
            )
            if pending_style != style and pending_style and pending_style.space_after is not None:
                pdf.ln(pdf.layout.gap_mm(float(pending_style.space_after)))
            pending.clear()

    for block in blocks:
        text = inline_text(block.segments).strip()
        if not text:
            continue
        block_style = (
            role_style("body", object_id=block.path)
            if role_style and is_field_path(block.path)
            else style
        )
        if has_styled_labels(block.segments, role_style, object_id):
            flush()
            size = base * _scale(block_style)
            if previous_bullet:
                pdf.ln(pdf.layout.gap_mm(pdf.layout.li_gap))
            if block_style and block_style.space_before is not None:
                pdf.ln(pdf.layout.gap_mm(float(block_style.space_before)))
            indent = (
                pdf.layout.gap_mm(float(block_style.indent))
                if block_style and block_style.indent is not None
                else 0
            )
            if block.kind == "bullet":
                indent = max(indent, pdf.layout.gap_mm(pdf.layout.li_indent))
            pdf.ensure_space(pdf.line_advance(size))
            top = pdf.get_y()
            if block.kind == "bullet" and (not block_style or block_style.bullet != "none"):
                pdf.set_font(FONT_FAMILY, "", size * _PX_TO_PT)
                pdf.set_text_color(*_color(block_style, pdf.body_text))
                pdf.set_xy(pdf.frame_left, top)
                pdf.cell(
                    indent,
                    pdf.line_advance(size),
                    "–" if block_style and block_style.bullet == "dash" else "•",
                )
                pdf.set_y(top)
            draw_label_segments(
                pdf,
                block.segments,
                base=base,
                role_style=role_style,
                width=pdf.frame_width - indent,
                left=pdf.frame_left + indent,
                entry_id=object_id,
                align=(block_style.align or "left") if block_style else "left",
            )
            if block_style and block_style.space_after is not None:
                pdf.ln(pdf.layout.gap_mm(float(block_style.space_after)))
            pdf.record(kind="point", section=section, y_top=top, object_id=object_id, text=text)
            previous_bullet = block.kind == "bullet"
            continue
        if block.kind == "bullet":
            spaced_field = (
                block_style != style
                and block_style
                and (block_style.space_before is not None or block_style.space_after is not None)
            )
            if block_style != pending_style or (pending and spaced_field):
                flush()
                if previous_bullet:
                    pdf.ln(pdf.layout.gap_mm(pdf.layout.li_gap))
                pending_style = block_style
            pending.append(text)
            previous_bullet = True
        else:
            flush()
            previous_bullet = False
            _draw_paragraph(
                pdf, text, base=base, style=block_style, section=section, object_id=object_id
            )
    flush()
