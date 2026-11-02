# SPDX-License-Identifier: Apache-2.0
"""Word 内容渲染（v2）：DocumentPlan -> python-docx 段落 / 无框表格 / 分页符。

**与 PDF 同一份 plan**：字段位置、条目头布局（split/stacked/meta_first）、lead/trail 的
列布局、body 的 bullet/paragraph 都由 planner 决定，本模块只把 plan 落成 Word 元素：

* 条目头 split：左标题加粗、右侧元信息用定在版心右缘的右制表位；
* lead / trail：equal 用无框表格（solo 行横向合并单元格），flow 用一行段落（分隔符已由
  planner 写进 segments）；
* body：bullet 走悬挂缩进列表，paragraph 走普通段落；inline 板块用一段多 run 文本；
* 分页：section.start_on_new_page 落成 Word 分页符；keep_together 交给 Word 自然分页
  （导出侧只标记 overflow、不截断内容）。

字号 / 颜色 / 间距全部来自 ResumeLayout 与 DocxTheme（与 PDF 同一来源）；不缩字号。
页头 / 正文块 / 灰字段列 / Inline 段拆 run 等通用件在 docx_document_parts.py。
"""

from __future__ import annotations

from collections.abc import Sequence

from docx.shared import Mm

from ..schemas.resume_document_plan import DocumentPlan, EntryPlan, Inline, SectionPlan
from .docx_blocks import DocxTheme, entry_head, paragraph, section_title, section_title_gap_mm
from .docx_document_parts import (
    RoleStyleQuery,
    add_segments,
    align_value,
    draw_blocks,
    draw_cell_rows,
    draw_header,
    plain_text,
    style_of,
)
from .pdf_exporter import _PX_TO_MM
from .resume.document_html import CELL_JOIN, cell_needs_separator


def _head_line(
    doc,
    segments: Sequence[Inline],
    *,
    base: float,
    layout,
    theme: DocxTheme,
    role_style: RoleStyleQuery | None,
    role: str,
    object_id: str,
    space_before_mm: float = 0.0,
    keep_with_next: bool = False,
) -> None:
    """stacked / meta_first 的标题行或元信息行（整行一段，不左右分栏）。"""
    node = paragraph(doc, space_before_mm=space_before_mm, keep_with_next=keep_with_next)
    style = style_of(role_style, role, object_id)
    if style is not None:
        node.paragraph_format.alignment = (
            align_value(style.align) or node.paragraph_format.alignment
        )
    add_segments(
        node,
        segments,
        base=base,
        layout=layout,
        theme=theme,
        role_style=role_style,
        default_role=role,
        object_id=object_id,
        bold_default=role == "entry_title",
    )


def _draw_entry(
    doc,
    entry: EntryPlan,
    *,
    base: float,
    layout,
    theme: DocxTheme,
    role_style: RoleStyleQuery | None,
    space_before_mm: float,
) -> None:
    title_style = style_of(role_style, "entry_title", entry.id)
    meta_style = style_of(role_style, "meta", entry.id)
    head = entry.head
    title = plain_text(head.title)
    meta = plain_text(head.meta)
    if head.layout == "split":
        entry_head(
            doc,
            title,
            meta,
            base=base,
            layout=layout,
            theme=theme,
            space_before_extra_mm=space_before_mm,
            style=title_style,
            meta_style=meta_style,
        )
    elif head.layout == "meta_first":
        _head_line(
            doc,
            head.meta,
            base=base,
            layout=layout,
            theme=theme,
            role_style=role_style,
            role="meta",
            object_id=entry.id,
            space_before_mm=space_before_mm,
            keep_with_next=True,
        )
        _head_line(
            doc,
            head.title,
            base=base,
            layout=layout,
            theme=theme,
            role_style=role_style,
            role="entry_title",
            object_id=entry.id,
        )
    else:
        _head_line(
            doc,
            head.title,
            base=base,
            layout=layout,
            theme=theme,
            role_style=role_style,
            role="entry_title",
            object_id=entry.id,
            space_before_mm=space_before_mm,
            keep_with_next=True,
        )
        _head_line(
            doc,
            head.meta,
            base=base,
            layout=layout,
            theme=theme,
            role_style=role_style,
            role="meta",
            object_id=entry.id,
        )
    draw_cell_rows(
        doc,
        entry.lead_rows,
        entry.lead_layout,
        base=base,
        page_layout=layout,
        theme=theme,
        role_style=role_style,
        object_id=entry.id,
    )
    draw_blocks(
        doc,
        entry.body,
        base=base,
        layout=layout,
        theme=theme,
        role_style=role_style,
        object_id=entry.id,
    )
    draw_cell_rows(
        doc,
        entry.trail_rows,
        entry.trail_layout,
        base=base,
        page_layout=layout,
        theme=theme,
        role_style=role_style,
        object_id=entry.id,
    )


def _mark_page_break(doc, start_index: int) -> None:
    """把「从新页开始」落到该分区第一段的 w:pageBreakBefore（不插空段落、不占版心）。"""
    paragraphs = doc.paragraphs[start_index:]
    if paragraphs:
        paragraphs[0].paragraph_format.page_break_before = True


def _chain_keep_with_next(doc, start_index: int, end_index: int | None = None) -> None:
    """keep_together：给定范围内除最后一段外都 keepNext（Word 的"整块不跨页"表达）。

    ``end_index=None`` = 到文档末尾（分区级）；条目级传入该条目结束下标，避免把
    相邻条目也串进同一块。"""
    paragraphs = doc.paragraphs[start_index:end_index]
    for node in paragraphs[:-1]:
        node.paragraph_format.keep_with_next = True


def _space_mm(length) -> float:
    """python-docx 的段距（`Length` / `None`）→ 毫米；没设过按 0 算。"""
    if length is None:
        return 0.0
    try:
        return float(length.mm)
    except Exception:  # noqa: BLE001 - 极端情况下按 0 处理，不能因此中断导出
        return 0.0


def _bump_space_before(node, extra_mm: float) -> None:
    """给段落的段前距**累加** `extra_mm`（#9：把标题段距挪到相邻段落时用）。"""
    if extra_mm <= 0:
        return
    node.paragraph_format.space_before = Mm(
        _space_mm(node.paragraph_format.space_before) + extra_mm
    )


def _bump_space_after(node, extra_mm: float) -> None:
    """给段落的段后距**累加** `extra_mm`。"""
    if extra_mm <= 0:
        return
    node.paragraph_format.space_after = Mm(_space_mm(node.paragraph_format.space_after) + extra_mm)


def _last_body_paragraph(doc):
    """文档最后一个**块级**元素若是段落就返回它，否则 `None`。

    #9 要把分区间距挪到"上一段的段后"。若上一块是无框表格（lead 行 equal 布局），
    加在表格**上方**那个段落上会把间距放到错误的位置——这种时候调用方退回保留段前距。
    """
    paragraphs = doc.paragraphs
    if not paragraphs:
        return None
    last = paragraphs[-1]._element
    # 只看"段落 / 表格"两种块级元素：`w:body` 末尾还有一个 `w:sectPr`（页面设置），
    # 直接拿最后一个子元素比较会永远不相等，竖条段距就永远挪不出去。
    blocks = [
        child
        for child in last.getparent()
        if child.tag.endswith("}p") or child.tag.endswith("}tbl")
    ]
    return paragraphs[-1] if blocks and blocks[-1] is last else None


def _paragraph_after(doc, node):
    """紧跟在 `node` 之后的**段落**（中间夹着表格 / 已是最后一块时返回 `None`）。"""
    siblings = list(node._element.getparent())
    try:
        index = siblings.index(node._element)
    except ValueError:
        return None
    if index + 1 >= len(siblings):
        return None
    following = siblings[index + 1]
    if not following.tag.endswith("}p"):
        return None
    for candidate in doc.paragraphs:
        if candidate._element is following:
            return candidate
    return None


def _draw_section(
    doc,
    section: SectionPlan,
    *,
    base: float,
    layout,
    theme: DocxTheme,
    role_style: RoleStyleQuery | None,
    accent: tuple[int, int, int],
    accent_soft: tuple[int, int, int],
) -> None:
    # v2 分页收敛为分区级：w:pageBreakBefore 落在该分区第一段上（标题或首个条目头），
    # 比"插一个只有分页符的空段落"更贴近 Word 的段落属性语义（后者会占一行）。
    page_break = bool(section.layout.start_on_new_page)
    keep = bool(section.layout.keep_together)
    section_start = len(doc.paragraphs)
    title_style = style_of(role_style, "section_title")
    bar_title = getattr(layout, "section_title_style", "plain") == "left_bar"
    title_index: int | None = None
    if not section.layout.hide_title and section.title:
        previous = _last_body_paragraph(doc)
        gap_mm = section_title_gap_mm(base, layout, title_style)
        if bar_title and previous is not None and not page_break:
            # #9：Word 的段落左边框会把**段前距**一起框进竖条（行盒 1.7em + 间距 1.3em +
            # 段后 0.4em ≈ 3.4em，正是用户截图里"三倍高、悬在标题上方"的样子）。把分区间距
            # 挪到上一段的段后，竖条就只包住行盒。标题是第一段 / 紧跟分页符时没有"上一段"，
            # 保留原段前距（竖条会略高，可接受）。
            _bump_space_after(previous, gap_mm)
            section_title(
                doc,
                section.title,
                base,
                layout,
                accent,
                accent_soft,
                theme=theme,
                style=title_style,
                space_before_mm=0.0,
                space_after_mm=0.0,
            )
        else:
            section_title(
                doc,
                section.title,
                base,
                layout,
                accent,
                accent_soft,
                theme=theme,
                style=title_style,
            )
        title_index = len(doc.paragraphs) - 1
        if page_break:
            _mark_page_break(doc, section_start)
            page_break = False

    def settle_title_spacing() -> None:
        """标题后的 0.4em 挪到**下一段的段前**（只对 left_bar）。

        同样是为了不让段落边框把段后距算进竖条高度。找不到"紧随其后的段落"时（下一块
        是表格 / 本分区没有内容）这 0.4em 就**不写入**：宁可少 0.4em 的呼吸感，也不把
        间距落到表格下方——那会在版面上凭空多出一个空档，且离标题很远。实际排版里
        每个分区的第一块都是段落（条目头 / 正文块），这条兜底只防御性存在。
        """
        if not bar_title or title_index is None:
            return
        following = _paragraph_after(doc, doc.paragraphs[title_index])
        if following is not None:
            _bump_space_before(following, base * _PX_TO_MM * 0.4)

    if section.kind == "inline":
        # inline 板块是**一段**多 run 文本（条目内字段用 · 连接、条目之间用 planner 的
        # row_separator），与 HTML 的一个 div / Markdown 的一行同构。
        block_start = len(doc.paragraphs)
        node = paragraph(doc)
        for row_index, row in enumerate(section.rows):
            if row_index and section.row_separator:
                add_segments(
                    node,
                    [Inline(text=section.row_separator, role="meta")],
                    base=base,
                    layout=layout,
                    theme=theme,
                    role_style=role_style,
                    default_role="meta",
                )
            for index, cell in enumerate(row):
                if index and cell_needs_separator(cell):
                    add_segments(
                        node,
                        [Inline(text=CELL_JOIN, role="meta")],
                        base=base,
                        layout=layout,
                        theme=theme,
                        role_style=role_style,
                        default_role="meta",
                    )
                add_segments(
                    node,
                    cell.segments,
                    base=base,
                    layout=layout,
                    theme=theme,
                    role_style=role_style,
                    default_role="body",
                )
        if page_break:
            _mark_page_break(doc, block_start)
        if keep:
            _chain_keep_with_next(doc, section_start)
        settle_title_spacing()
        return
    if section.kind == "text":
        block_start = len(doc.paragraphs)
        if section.entries:
            draw_blocks(
                doc,
                section.entries[0].body,
                base=base,
                layout=layout,
                theme=theme,
                role_style=role_style,
                object_id=section.entries[0].id,
            )
        if page_break:
            _mark_page_break(doc, block_start)
        if keep:
            _chain_keep_with_next(doc, section_start)
        settle_title_spacing()
        return
    for index, entry in enumerate(section.entries):
        entry_start = len(doc.paragraphs)
        # 条目级分页（计划 §6.2）：True = 该条目另起一页 / 整条尽量不跨页。
        entry_break = bool(entry.layout.start_on_new_page)
        entry_keep = keep or bool(entry.layout.keep_together)
        space_before = base * _PX_TO_MM * layout.entry_gap if index else 0.0
        _draw_entry(
            doc,
            entry,
            base=base,
            layout=layout,
            theme=theme,
            role_style=role_style,
            space_before_mm=space_before,
        )
        entry_end = len(doc.paragraphs)
        if page_break or entry_break:
            _mark_page_break(doc, entry_start)
            page_break = False
        if entry_keep:
            _chain_keep_with_next(doc, entry_start, entry_end)
    settle_title_spacing()
    if keep:
        _chain_keep_with_next(doc, section_start)


def draw_document(
    doc,
    plan: DocumentPlan,
    *,
    layout,
    base: float,
    include_photo: bool,
    theme: DocxTheme,
    accent: tuple[int, int, int],
    accent_soft: tuple[int, int, int],
    role_style: RoleStyleQuery | None,
    font_key: str | None = None,
) -> None:
    """把 DocumentPlan 写成 Word 正文（页头 + 所有分区）。"""
    draw_header(
        doc,
        plan,
        layout=layout,
        base=base,
        include_photo=include_photo,
        theme=theme,
        accent=accent,
        accent_soft=accent_soft,
        font_key=font_key,
    )
    for section in plan.sections:
        _draw_section(
            doc,
            section,
            base=base,
            layout=layout,
            theme=theme,
            role_style=role_style,
            accent=accent,
            accent_soft=accent_soft,
        )


__all__ = ["draw_document"]
