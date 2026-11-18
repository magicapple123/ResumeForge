# SPDX-License-Identifier: Apache-2.0
"""Word 渲染的段落级拼装件（v2）：页眉 / 正文块 / lead-trail 列 / Inline 段 -> run。

docx_document_render.py 贴着 500 行预算，这里放与"分区/条目语义"无关的通用件：
页头、正文块、灰字段列、行内段拆 run、角色样式取值。两个模块共享同一套字号/颜色口径
（全部来自 ResumeLayout 与 DocxTheme，不存第二份数值）。
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from functools import partial

from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Mm

from ..schemas.resume_document import RowLayout
from ..schemas.resume_document_plan import CellPlan, Inline
from .docx_blocks import (
    DocxTheme,
    meta_line,
    paragraph,
    set_run_font,
)
from .docx_column_geometry import apply_column_geometry as apply_column_geometry
from .docx_document_body import apply_field_spacing
from .docx_document_body import draw_blocks as draw_blocks
from .docx_rich import add_rich_runs
from .pdf_exporter import _PX_TO_PT
from .resume.document_label_styles import has_styled_labels
from .resume.field_style_target import is_field_path
from .resume.resume_style import RoleStyle

logger = logging.getLogger(__name__)

#: 毫米 → 磅（1pt = 25.4/72 mm）。Word 的段落边框 `space` 只认磅。
_MM_TO_PT = 72.0 / 25.4

#: 角色/对象覆盖查询函数（与 PDF / HTML 同一形态）；None = 模板默认。
RoleStyleQuery = Callable[..., RoleStyle | None]

_ALIGN = {
    "left": WD_ALIGN_PARAGRAPH.LEFT,
    "center": WD_ALIGN_PARAGRAPH.CENTER,
    "right": WD_ALIGN_PARAGRAPH.RIGHT,
    "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
}


def plain_text(segments: Sequence[Inline]) -> str:
    """行内段拼成纯文本（条目头的左右两段不再逐段换样式）。"""
    return "".join(str(getattr(seg, "text", "") or "") for seg in segments).strip()


def rich_text(segments: Sequence[Inline]) -> str:
    """行内段拼成带行内标记的文本（strong 段用加粗标记，交给 add_rich_runs 拆 run）。"""
    parts: list[str] = []
    for segment in segments:
        text = str(getattr(segment, "text", "") or "")
        if not text:
            continue
        if getattr(segment, "strong", False) and not text.startswith("**"):
            text = "**" + text + "**"
        parts.append(text)
    return "".join(parts)


def style_of(
    role_style: RoleStyleQuery | None, role: str, object_id: str | None = None
) -> RoleStyle | None:
    """角色/对象覆盖查询；无覆盖返回 None（= 模板值）。"""
    return role_style(role, object_id=object_id) if role_style is not None else None


def _has_header_field_style(header, role_style: RoleStyleQuery | None) -> bool:
    """页眉联系方式里是否有**字段级**覆盖（QW-6）：决定整行一个 run 还是按段写。"""
    if role_style is None:
        return False
    for line in header.contact_lines:
        for segment in line:
            if not is_field_path(segment.path):
                continue
            role = str(getattr(segment, "role", "") or "meta")
            if style_of(role_style, role, segment.path) != style_of(role_style, role):
                return True
    return False


def scale_of(style: RoleStyle | None) -> float:
    return float(style.font_scale) if style is not None and style.font_scale else 1.0


def color_of(style: RoleStyle | None, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
    """角色覆盖的字色（#rrggbb）；未设或非法回落到模板色。"""
    value = style.color if style is not None else None
    if not isinstance(value, str):
        return fallback
    text = value.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    if len(text) != 6:
        return fallback
    try:
        return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))
    except ValueError:
        return fallback


def role_ratio(layout, role: str) -> float:
    """角色 -> 该角色在模板里的字号基准（与 HTML/PDF 的 data-role 层级同源）。"""
    ratios = {
        "name": layout.name_ratio,
        "section_title": layout.section_title_ratio,
        "entry_title": layout.entry_title_ratio,
        "meta": layout.entry_meta_ratio,
        "field_label": layout.entry_meta_ratio,
        "body": 1.0,
    }
    return float(ratios.get(role, 1.0))


def add_segments(
    node,
    segments: Sequence[Inline],
    *,
    base: float,
    layout,
    theme: DocxTheme,
    role_style: RoleStyleQuery | None,
    default_role: str,
    object_id: str | None = None,
    bold_default: bool = False,
    ratio_override: float | None = None,
) -> None:
    """把 plan 的 Inline 段写成一段多 run 文本；每段按自己的 role 取字号/颜色。"""
    set_font = partial(set_run_font, font_name=theme.font_name)
    for segment in segments:
        text = str(getattr(segment, "text", "") or "")
        if not text:
            continue
        role = str(getattr(segment, "role", "") or default_role)
        target = segment.path if is_field_path(segment.path) else object_id
        style = style_of(role_style, role, target)
        size = base * (ratio_override or role_ratio(layout, role)) * scale_of(style)
        fallback = theme.body_text if role == "body" else theme.muted_text
        # Q11：run 吃角色/对象覆盖的加粗与字距——此前只认段内的 ** ** / ❗标记，
        # 面板里调「正文 → 加粗 / 字距」对 Word 完全无效。
        # #5d：斜体整体移除；segment.italic 字段已不存在，不再读取。
        style_bold = style.bold if style is not None and style.bold is not None else None
        bold = bool(getattr(segment, "strong", False)) or (
            style_bold if style_bold is not None else bold_default
        )
        letter_spacing_pt = (
            base * float(style.letter_spacing) * _PX_TO_PT
            if style is not None and style.letter_spacing is not None
            else None
        )
        add_rich_runs(
            node,
            text,
            set_font,
            bold=bold,
            size_pt=size * _PX_TO_PT,
            color=color_of(style, fallback),
            letter_spacing_pt=letter_spacing_pt,
        )



def draw_cell_rows(
    doc,
    rows: Sequence[Sequence[CellPlan]],
    layout: RowLayout,
    *,
    base: float,
    page_layout,
    theme: DocxTheme,
    role_style: RoleStyleQuery | None,
    object_id: str | None,
) -> None:
    """lead / trail：equal = 无框表格（solo 行合并）；flow = 一行段落。

    ``layout`` 是**这一侧**的生效列布局（问题 4：正文前 / 正文后可以各是不同列数）。

    逐列宽度 / 逐间隔（任务 13）：给了宽度就按内容宽的比例设每一列的列宽；给了间隔就
    把间隔做成"右侧单元格边距"（Word 的表格只有统一 cell spacing，逐间隔只能落在单元格
    边距上）。长度对不上时 `resolved_column_geometry` 返回 (None, None)，表格回到默认
    等宽——产物字节与改前一致。

    分布 = 两端（问题 4）：表格铺满版心（见 `apply_column_geometry`），**最后一列右对齐**，
    于是最后一段文字的右缘与 PDF / HTML 一样落在内容区右边界。
    """
    if not rows:
        return
    meta_style = style_of(role_style, "meta", object_id)
    align = layout.align or "equal"
    columns = int(layout.columns or 1)
    between = (layout.justify or "start") == "between" and columns > 1
    if align == "flow" or columns <= 1:
        for row in rows:
            if not row:
                continue
            segments = [segment for cell in row for segment in cell.segments]
            if has_styled_labels(segments, role_style, object_id) or any(
                is_field_path(seg.path) and style_of(role_style, "meta", seg.path) != meta_style
                for seg in segments
            ):
                node = paragraph(doc)
                add_segments(
                    node,
                    segments,
                    base=base,
                    layout=page_layout,
                    theme=theme,
                    role_style=role_style,
                    default_role="meta",
                    object_id=object_id,
                )
                continue
            meta_line(
                doc,
                "".join(rich_text(cell.segments) for cell in row),
                base=base,
                layout=page_layout,
                theme=theme,
                style=meta_style,
            )
        return
    table = doc.add_table(rows=len(rows), cols=columns)
    apply_column_geometry(table, doc, columns, layout, base=base)
    for row_index, row in enumerate(rows):
        cells = [table.cell(row_index, index) for index in range(columns)]
        if len(row) == 1 and columns > 1:
            cells = [cells[0].merge(cells[-1])]
        for index, cell in enumerate(cells):
            node = cell.paragraphs[0]
            node.paragraph_format.space_after = Mm(0)
            # 分布 = 两端：最后一列右对齐（表格已铺满版心），让末段文字贴住右边界。
            if between and not (len(row) == 1 and columns > 1) and index == len(cells) - 1:
                node.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            segments = row[min(index, len(row) - 1)].segments if row else []
            if segments and is_field_path(segments[0].path):
                field_style = style_of(role_style, "meta", segments[0].path)
                if field_style != meta_style:
                    apply_field_spacing(node, field_style, page_layout)
            add_segments(
                node,
                segments,
                base=base,
                layout=page_layout,
                theme=theme,
                role_style=role_style,
                default_role="meta",
                object_id=object_id,
            )
    # 表格与下一条内容之间留一点段后距（Word 表格没有 margin-bottom）。
    paragraph(doc, space_after_mm=0)


def align_value(value: str | None):
    """角色 align -> Word 段落对齐常量；未知/空返回 None（保持默认）。"""
    return _ALIGN.get(str(value or ""))


__all__ = [
    "RoleStyleQuery",
    "add_segments",
    "align_value",
    "color_of",
    "draw_blocks",
    "draw_cell_rows",
    "plain_text",
    "rich_text",
    "role_ratio",
    "scale_of",
    "style_of",
]
