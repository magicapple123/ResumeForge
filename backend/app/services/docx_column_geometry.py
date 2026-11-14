# SPDX-License-Identifier: Apache-2.0
"""Word 表格的列宽/列距（从 ``docx_document_parts`` 搬出，纯搬迁）。

为什么单独一个模块：这段逻辑只碰"表格几何"，与页眉/正文块的段落拼装没有关系；
放在 ``docx_document_parts`` 里把那个文件顶过了 500 行预算。搬出来之后
``docx_document_parts`` 继续 re-export ``apply_column_geometry``，调用方不用改。
"""

from __future__ import annotations

from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm

from ..schemas.resume_document import EntryLayout, RowLayout
from .pdf_exporter import _PX_TO_MM
from .resume.column_geometry import resolved_column_geometry


def apply_column_geometry(
    table, doc, columns: int, layout: EntryLayout | RowLayout, *, base: float
) -> None:
    """把逐列宽度 / 逐间隔 / 分布写进 Word 表格（任务 13 + 问题 4）。

    - 宽度：百分比按**扣掉间隔后的可用宽**折算，保证 40/30/30 与 HTML 的口径一致
      （HTML 里百分比是相对网格内容宽，间隔由 padding 表达，不占百分比）；
    - 间隔：Word 没有逐列 `column-gap`，只能落到每个单元格的右边距（`w:tcMar/w:right`）；
    - 分布 = 两端（`justify="between"`）：Word 的表格没有 `space-between`，只能"表格铺满
      版心 + 每列等宽"来近似（列宽无法按内容量），最后一列由 `draw_cell_rows` 右对齐，
      于是最后一段文字的右缘同样落在版心右边界；
    - 三者都没给（或长度对不上）就直接返回，不改表格任何属性——旧文档产物逐字节不变。
    """
    widths, gaps = resolved_column_geometry(columns, layout.column_widths, layout.column_gaps)
    between = (getattr(layout, "justify", None) or "start") == "between" and widths is None
    if widths is None and gaps is None and not between:
        return
    section = doc.sections[-1]
    total_emu = int(section.page_width - section.left_margin - section.right_margin)
    gap_mm = [float(gap) * base * _PX_TO_MM for gap in (gaps or [])]
    usable_emu = total_emu - int(Mm(sum(gap_mm)))
    if between:
        # 铺满版心：每列均分（Word 没有"按内容量宽"，等宽是唯一稳定的近似）。
        widths = [100.0 / columns for _ in range(columns)]
    if widths is not None:
        table.autofit = False
        for index, share in enumerate(widths):
            table.columns[index].width = int(usable_emu * share / 100.0)
        for row in table.rows:
            for index, cell in enumerate(row.cells):
                if index < columns:
                    cell.width = table.columns[index].width
    if gaps is not None:
        for row in table.rows:
            for index, cell in enumerate(row.cells):
                if index < len(gap_mm):
                    set_cell_right_margin(cell, gap_mm[index])


def set_cell_right_margin(cell, millimetres: float) -> None:
    """单个单元格的右边距（twips）。python-docx 没有暴露 tcMar，只能碰 XML。"""
    if millimetres <= 0:
        return
    tc_pr = cell._tc.get_or_add_tcPr()
    margins = tc_pr.find(qn("w:tcMar"))
    if margins is None:
        margins = OxmlElement("w:tcMar")
        tc_pr.append(margins)
    right = margins.find(qn("w:right"))
    if right is None:
        right = OxmlElement("w:right")
        margins.append(right)
    right.set(qn("w:w"), str(int(Mm(millimetres).twips)))
    right.set(qn("w:type"), "dxa")


__all__ = ["apply_column_geometry", "set_cell_right_margin"]
