# SPDX-License-Identifier: Apache-2.0
"""PDF 绘制入口（v2）：消费 DocumentPlan，画一份简历。

**唯一真相是 plan**：字段位置/顺序/分栏/条目头布局/分页意图都由 planner 算好，本模块
只做三件事：

1. 把 Inline 段拼成纸面字符串（strong 段投影成 fpdf2 的加粗标记，行内格式由 canvas 唯一
   收口，见 canvas._rich_text_args）；
2. 按 plan 的布局选绘制原语：条目头 split/stacked/meta_first、lead/trail 的 equal 网格
   （按内容预算列宽）与 flow 顺排、body 的 bullet/paragraph；
3. 分页：section.start_on_new_page / keep_together、条目 keep_together（用 measuring 孪生
   画布量整条高度后预留），其余交给 canvas.ensure_space 与 multi_cell 的自然分页。

**不缩字号、不重复拼字段**：没有第二份"哪个字段该在哪"的规则；字号只有布局参数。
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import TYPE_CHECKING

from fpdf.enums import XPos, YPos

from ...schemas.resume_document import EntryLayout
from ...schemas.resume_document_plan import (
    BlockPlan,
    CellPlan,
    DocumentPlan,
    EntryPlan,
    Inline,
    SectionPlan,
)
from ..resume.document_html import default_cell_gap, join_cell_texts
from ..resume.resume_style import RoleStyle
from .canvas import _ResumePDF
from .fonts import FONT_FAMILY
from .header import draw_header
from .layout import _PX_TO_PT
from .meta_columns import column_widths, draw_meta_columns, set_meta_font
from .style_blocks import _bold, _color, _letter_spacing_mm, _line_height, _scale

if TYPE_CHECKING:  # pragma: no cover - 只为类型检查
    pass

#: 角色/对象覆盖查询函数（与 header / style_blocks 同一形态）；None = 模板默认。
RoleStyleQuery = Callable[..., RoleStyle | None]

_ALIGN = {"left": "L", "center": "C", "right": "R", "justify": "J"}


def inline_text(segments: Sequence[Inline]) -> str:
    """行内段拼成纸面字符串：strong 段投影成加粗标记（fpdf2 markdown 口径）。"""
    parts: list[str] = []
    for segment in segments:
        text = str(getattr(segment, "text", "") or "")
        if not text:
            continue
        if getattr(segment, "strong", False) and not text.startswith("**"):
            text = "**" + text + "**"
        parts.append(text)
    return "".join(parts)


def _role_style(style: RoleStyleQuery | None, role: str, object_id: str | None = None):
    return style(role, object_id=object_id) if style is not None else None


def _draw_paragraph(
    pdf: _ResumePDF,
    text: str,
    *,
    base: float,
    style: RoleStyle | None,
    section: str = "",
    object_id: str | None = None,
) -> None:
    """一段正文（multi_cell）：字号/行高/字色/对齐可被 body 角色/对象覆盖。"""
    if not text.strip():
        return
    layout = pdf.layout
    size = base * _scale(style)
    line_height = _line_height(pdf, style, size)
    align = _ALIGN.get(str(style.align) if style is not None and style.align else "left", "L")
    # Q11：正文加粗用 B 字重；段落缩进按 indent 偏移左缘与可用宽度；字距用
    # fpdf2 set_char_spacing（文档单位 mm，画完复位，不影响后续段落）。
    bold = _bold(pdf, style, False)
    letter_spacing = _letter_spacing_mm(base, style)
    indent_mm = (
        layout.gap_mm(float(style.indent))
        if style is not None and style.indent is not None
        else 0.0
    )
    pdf.set_font(FONT_FAMILY, "B" if bold else "", size * _PX_TO_PT)
    pdf.set_text_color(*_color(style, pdf.body_text))
    if style is not None and style.space_before is not None:
        pdf.ln(layout.gap_mm(float(style.space_before)))
    pdf.ensure_space(line_height)
    top = pdf.get_y()
    pdf.set_x(pdf.frame_left + indent_mm)
    width = max(1.0, pdf.frame_width - indent_mm)
    if letter_spacing:
        pdf.set_char_spacing(letter_spacing)
    from .style_blocks import _wrapmode_args

    pdf.multi_cell(
        width,
        line_height,
        text,
        align=align,
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
        **_wrapmode_args(pdf, text, width, size * _PX_TO_PT),
    )
    if letter_spacing:
        pdf.set_char_spacing(0)
    if style is not None and style.space_after is not None:
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
) -> None:
    """正文块：连续要点合成一批 bullets（行内格式/分页口径与既有实现一致），段落单独画。"""
    pending: list[str] = []

    def flush() -> None:
        if not pending:
            return
        pdf.bullets(
            list(pending),
            base,
            style=style,
            section=section,
            object_id=object_id,
            split_ok=split_ok,
        )
        pending.clear()

    for block in blocks:
        text = inline_text(block.segments).strip()
        if not text:
            continue
        if block.kind == "bullet":
            pending.append(text)
        else:
            flush()
            _draw_paragraph(pdf, text, base=base, style=style, section=section, object_id=object_id)
    flush()


def _draw_head(
    pdf: _ResumePDF,
    entry: EntryPlan,
    *,
    section_key: str,
    base: float,
    role_style: RoleStyleQuery | None,
) -> None:
    """条目头：split 用左右两段（右侧右对齐）；stacked / meta_first 用上下两行。"""
    head = entry.head
    title_style = _role_style(role_style, "entry_title", entry.id)
    meta_style = _role_style(role_style, "meta", entry.id)
    title = inline_text(head.title).strip()
    meta = inline_text(head.meta).strip()
    if not title and not meta:
        return
    layout = pdf.layout
    if head.layout == "split":
        pdf.entry_head(
            title,
            meta,
            base,
            style=title_style,
            meta_style=meta_style,
            section=section_key,
            object_id=entry.id,
            keep_lines=1,
        )
        return
    title_size = base * layout.entry_title_ratio * _scale(title_style)
    meta_size = base * layout.entry_meta_ratio * _scale(meta_style)
    title_height = pdf.line_advance(title_size)
    meta_height = pdf.line_advance(meta_size)
    if title_style is not None and title_style.space_before is not None:
        pdf.ln(layout.gap_mm(float(title_style.space_before)))
    pdf.ensure_space(title_height + meta_height)
    top = pdf.get_y()

    def draw_line(text: str, *, size_px: float, style: RoleStyle | None, bold: bool, fallback):
        if not text:
            return
        pdf.set_font(FONT_FAMILY, "B" if bold else "", size_px * _PX_TO_PT)
        pdf.set_text_color(*_color(style, fallback))
        pdf.set_x(pdf.frame_left)
        from .style_blocks import _wrapmode_args

        pdf.multi_cell(
            pdf.frame_width,
            pdf.line_advance(size_px),
            text,
            align="L",
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
            **_wrapmode_args(pdf, text, pdf.frame_width, size_px * _PX_TO_PT),
        )

    bold_title = (
        title_style.bold if title_style is not None and title_style.bold is not None else True
    )
    if head.layout == "meta_first":
        draw_line(meta, size_px=meta_size, style=meta_style, bold=False, fallback=pdf.muted_text)
        draw_line(
            title,
            size_px=title_size,
            style=title_style,
            bold=bool(bold_title),
            fallback=pdf.body_text,
        )
    else:
        draw_line(
            title,
            size_px=title_size,
            style=title_style,
            bold=bool(bold_title),
            fallback=pdf.body_text,
        )
        draw_line(meta, size_px=meta_size, style=meta_style, bold=False, fallback=pdf.muted_text)
    pdf.set_text_color(*pdf.body_text)
    pdf.record(kind="entry", section=section_key, y_top=top, object_id=entry.id, text=title)


def _draw_cell_rows(
    pdf: _ResumePDF,
    rows: Sequence[Sequence[CellPlan]],
    layout: EntryLayout,
    *,
    section_key: str,
    entry_id: str,
    base: float,
    role_style: RoleStyleQuery | None,
) -> None:
    """lead / trail 的灰字段行：equal = 按内容预算列宽并排；flow = 一行顺排。

    planner 已把标签文本（标签：值）与 flow 的分隔符写进 CellPlan.segments，这里只拼接。
    """
    if not rows:
        return
    style = _role_style(role_style, "meta", entry_id)
    align = layout.align or "equal"
    columns = layout.columns or 1
    gap_ratio = layout.gap if layout.gap is not None else default_cell_gap(align)
    gap_mm = pdf.layout.gap_mm(gap_ratio)
    texts = [
        [inline_text(cell.segments) for cell in row if inline_text(cell.segments)] for row in rows
    ]
    texts = [row for row in texts if row]
    if not texts:
        return
    if align == "flow":
        for row in texts:
            pdf.meta_line("".join(row), base, style=style)
        return
    set_meta_font(pdf, base, style)
    widths = column_widths(pdf, texts, columns, gap_mm, pdf.frame_width)
    for row in texts:
        if len(row) <= 1:
            pdf.meta_line(row[0], base, style=style)
        else:
            draw_meta_columns(pdf, row, widths, gap_mm, base, style=style)


def _draw_entry(
    pdf: _ResumePDF,
    entry: EntryPlan,
    *,
    section_key: str,
    base: float,
    role_style: RoleStyleQuery | None,
    split_ok: bool,
) -> None:
    _draw_head(pdf, entry, section_key=section_key, base=base, role_style=role_style)
    _draw_cell_rows(
        pdf,
        entry.lead_rows,
        entry.layout,
        section_key=section_key,
        entry_id=entry.id,
        base=base,
        role_style=role_style,
    )
    _draw_body_blocks(
        pdf,
        entry.body,
        base=base,
        style=_role_style(role_style, "body", entry.id),
        section=section_key,
        object_id=entry.id,
        split_ok=split_ok,
    )
    _draw_cell_rows(
        pdf,
        entry.trail_rows,
        entry.layout,
        section_key=section_key,
        entry_id=entry.id,
        base=base,
        role_style=role_style,
    )


def _reserve_entry_height(
    pdf: _ResumePDF,
    entry: EntryPlan,
    *,
    section_key: str,
    base: float,
    role_style: RoleStyleQuery | None,
) -> None:
    """keep_together：先在同宽度的 measuring 孪生画布上量整条高度，再决定是否换页。

    量不了（字体未注册）就跳过预留——宁可少一次分页判断，也不能导不出。
    """
    if pdf.measuring:
        return
    probe = pdf.measuring_twin()
    if probe is None:
        return
    probe.set_frame(pdf.frame_left, pdf.frame_width)
    probe.set_xy(pdf.frame_left, pdf.layout.margin_top)
    _draw_entry(
        probe, entry, section_key=section_key, base=base, role_style=role_style, split_ok=True
    )
    height = probe.get_y() - probe.layout.margin_top
    if 0 < height <= probe.layout.usable_height_per_page:
        pdf.ensure_space(height)


def _text_section_body(section: SectionPlan) -> str:
    """text kind 的正文纯文本（多段落用换行连接；空块跳过）。"""
    if not section.entries:
        return ""
    parts = [inline_text(block.segments).strip() for block in section.entries[0].body]
    return "\n".join(part for part in parts if part)


def _draw_section(
    pdf: _ResumePDF,
    section: SectionPlan,
    *,
    base: float,
    leading: float,
    role_style: RoleStyleQuery | None,
) -> bool:
    """画一个分区；返回是否真的画了东西（空分区不吃前导间距）。"""
    layout = pdf.layout
    if (
        section.layout.start_on_new_page
        and not pdf.measuring
        and pdf.get_y() > layout.margin_top + 0.5
    ):
        pdf.add_page()
    keep = bool(section.layout.keep_together)
    # text kind（个人总结）：标题 + 整段正文作为整体预留（W08 keep_together 语义）——
    # 页尾不留孤行、下一页页首也不留寡行。与 v1 摘要的 ensure_title_paragraph 同口径。
    text_body = _text_section_body(section) if section.kind == "text" else ""
    if text_body and section.title and not section.layout.hide_title and not pdf.measuring:
        pdf.ensure_title_paragraph(
            text_body,
            base,
            leading_gap=leading,
            style=_role_style(role_style, "section_title"),
            body_style=_role_style(role_style, "body"),
            keep_lines=1 if keep else 0,
        )
    if section.layout.hide_title:
        gap_mm = layout.gap_mm(leading) if leading else 0.0
        if gap_mm > 0:
            pdf.ensure_space(gap_mm)
            pdf.ln(gap_mm)
    elif section.title:
        pdf.section_title(
            section.title,
            base,
            leading_gap=leading,
            style=_role_style(role_style, "section_title"),
            section=section.key,
            keep_lines=1 if keep else 0,
        )
    if section.kind == "inline":
        # 技能 / 语言：沿用模板真实的标签形状（标签几何与 v1 skill_tags 同源）——
        # 换成平文本会让 scholar 的项目符号、modern 的描边胶囊等模板特征在 PDF 里消失。
        labels = [
            join_cell_texts(inline_text(cell.segments) for cell in row) for row in section.rows
        ]
        labels = [label for label in labels if label.strip()]
        if not labels:
            return False
        pdf.skill_tags(labels, base, style=_role_style(role_style, "body"))
        return True
    if section.kind == "text":
        if not section.entries:
            return False
        _draw_body_blocks(
            pdf,
            section.entries[0].body,
            base=base,
            style=_role_style(role_style, "body"),
            section=section.key,
            object_id=section.entries[0].id,
        )
        return True
    if not section.entries:
        return False
    for index, entry in enumerate(section.entries):
        # 条目级分页（计划 §6.2）：start_on_new_page 另起一页；keep_together 整条预留。
        broke = False
        if (
            entry.layout.start_on_new_page
            and not pdf.measuring
            and pdf.get_y() > layout.margin_top + 0.5
        ):
            pdf.add_page()
            broke = True
        if index and not broke:
            pdf.ln(layout.gap_mm(layout.entry_gap))
        entry_keep = keep or bool(entry.layout.keep_together)
        if entry_keep:
            _reserve_entry_height(
                pdf, entry, section_key=section.key, base=base, role_style=role_style
            )
        _draw_entry(
            pdf,
            entry,
            section_key=section.key,
            base=base,
            role_style=role_style,
            split_ok=not entry_keep,
        )
    return True


def draw_document(
    pdf: _ResumePDF,
    plan: DocumentPlan,
    *,
    include_photo: bool = True,
    role_style: RoleStyleQuery | None = None,
) -> None:
    """把 DocumentPlan 画进画布（测量与最终渲染共用这一段，保证"量的就是画的"）。"""
    layout = pdf.layout
    base = layout.base_px
    draw_header(
        pdf,
        plan.header,
        layout=layout,
        base=base,
        include_photo=include_photo,
        role_style=role_style,
    )
    drawers: dict[str, Callable[[_ResumePDF, float], bool]] = {}
    for section in plan.sections:
        drawers[section.key] = lambda target, leading, section=section: _draw_section(
            target, section, base=base, leading=leading, role_style=role_style
        )
    keys = [section.key for section in plan.sections]
    if layout.column_count > 1 and keys:
        from .columns import render_sections

        render_sections(pdf, keys, drawers)
        return
    first = True
    for key in keys:
        leading = layout.header_gap if first else layout.section_gap
        if drawers[key](pdf, leading):
            first = False


__all__ = ["draw_document", "inline_text"]
