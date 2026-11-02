# SPDX-License-Identifier: Apache-2.0
"""任务 13：逐列宽度 / 逐间隔的 schema 校验、生效判定与三出口一致性。

这里钉四件事：
1. 模型层只校验"自身自洽"（合计 100、长度匹配），不做"长度 == 列数"——条目级的列数常是
   继承来的，模型不知道；
2. `resolved_column_geometry` 在长度对不上时**整体作废**，绝不做部分应用；
3. 旧数据（没有这两个字段）的 HTML 产物逐字节不变——这是"不迁移已存数据"的硬要求；
4. Word 的列宽按"扣掉间隔后的可用宽"折算，间隔落到单元格右边距；没有几何信息时表格
   一个属性都不改。
"""

from __future__ import annotations

import io
import re

import pypdf
import pytest
from app.schemas.resume_document import (
    EntryLayout,
    FieldItem,
    ResumeDocument,
    ResumeEntry,
    ResumeSection,
    SectionLayout,
)
from app.services.docx_document_parts import apply_column_geometry
from app.services.pdf_exporter import build_resume_pdf, font_available
from app.services.resume.column_geometry import resolved_column_geometry
from app.services.resume.document_html import build_resume_html
from app.services.resume.document_plan import build_document_plan
from docx import Document
from pydantic import ValidationError
from tests.document_export_samples import make_document

needs_font = pytest.mark.skipif(not font_available(), reason="本机没有可用的中文字体")


def _document(layout: SectionLayout) -> ResumeDocument:
    return ResumeDocument(
        language="zh-CN",
        sections=[
            ResumeSection(
                id="sec_edu0001",
                key="education",
                kind="entries",
                layout=layout,
                entries=[
                    ResumeEntry(
                        id="ent_edu0001",
                        items=[
                            FieldItem(
                                id="it_gpa0001", key="gpa", placement="lead", value="3.8/4.0"
                            ),
                            FieldItem(id="it_rank0001", key="rank", placement="lead", value="6/48"),
                            FieldItem(
                                id="it_adv0001", key="advisor", placement="lead", value="周敏华"
                            ),
                        ],
                    )
                ],
            )
        ],
    )


def _render(layout: SectionLayout) -> str:
    document = _document(layout)
    plan = build_document_plan(document, None)
    return build_resume_html(
        document,
        plan,
        template_file="resume.html.j2",
        page_limit=1,
        base_px=14.0,
        language="zh-CN",
        csp_nonce="x",
    )


def _sub_grid(html: str) -> str:
    match = re.search(r'<div class="sub sub-row sub-grid[^>]*>', html)
    assert match is not None, "样例必须渲染出灰字段网格"
    return match.group(0)


def test_schema_rejects_inconsistent_geometry() -> None:
    with pytest.raises(ValidationError):
        SectionLayout(columns=3, column_widths=[40, 30, 20])
    with pytest.raises(ValidationError):
        SectionLayout(columns=3, column_widths=[0, 50, 50])
    with pytest.raises(ValidationError):
        SectionLayout(columns=3, column_widths=[60, 40], column_gaps=[1, 2])
    with pytest.raises(ValidationError):
        SectionLayout(columns=3, column_gaps=[1, 99])


def test_schema_accepts_partial_geometry() -> None:
    """只有宽度 / 只有间隔都合法：用户可以先调宽度，再调间隔。"""
    assert SectionLayout(columns=2, column_widths=[70, 30]).column_widths == [70.0, 30.0]
    assert SectionLayout(columns=2, column_gaps=[1.2]).column_gaps == [1.2]
    entry = EntryLayout(column_widths=[40, 60])
    assert entry.column_widths == [40.0, 60.0]
    assert entry.columns is None  # 列数可以继承，模型层不替它判定


def test_resolved_geometry_drops_mismatched_lengths() -> None:
    assert resolved_column_geometry(3, [40, 30, 30], [1.5, 0.8]) == ([40.0, 30.0, 30.0], [1.5, 0.8])
    # 三列宽度用在两列上：整体作废，不做部分应用
    assert resolved_column_geometry(2, [40, 30, 30], None) == (None, None)
    # 间隔数量不对，但宽度合法：宽度照常生效
    assert resolved_column_geometry(3, [40, 30, 30], [1.5]) == ([40.0, 30.0, 30.0], None)
    # 单列没有逐列可言
    assert resolved_column_geometry(1, [50, 50], [1.0]) == (None, None)


def test_html_emits_explicit_columns_and_per_cell_padding() -> None:
    html = _render(SectionLayout(columns=3, column_widths=[40, 30, 30], column_gaps=[1.5, 0.8]))
    grid = _sub_grid(html)
    assert "grid-template-columns: 40.0% 30.0% 30.0%" in grid
    assert "column-gap: 0" in grid
    # 前两列各自吃自己的间隔，最后一列不加右边距（padding 在格子上，不在容器上）
    assert html.count("padding-right: calc(var(--fs) * 1.5)") == 1
    assert html.count("padding-right: calc(var(--fs) * 0.8)") == 1
    assert html.count("padding-right:") == 2


def test_html_without_geometry_is_unchanged() -> None:
    """没有逐列信息时，产物必须与"加这功能之前"完全一致（等宽 + 统一 column-gap）。"""
    plain = _sub_grid(_render(SectionLayout(columns=3)))
    assert "sub-cols-3" in plain
    assert "grid-template-columns" not in plain
    assert "padding-right" not in plain
    # 长度对不上时同样回到这条路径
    mismatch = _sub_grid(_render(SectionLayout(columns=3, column_widths=[60, 40])))
    assert mismatch == plain


def test_docx_applies_widths_and_per_gap_margins() -> None:
    document = Document()
    table = document.add_table(rows=2, cols=3)
    layout = EntryLayout(columns=3, column_widths=[40, 30, 30], column_gaps=[1.5, 0.8])
    apply_column_geometry(table, document, 3, layout, base=14.0)

    widths = [column.width for column in table.columns]
    assert all(width for width in widths)
    assert widths[0] > widths[1] == widths[2]  # 40 / 30 / 30
    raw = table._tbl.xml
    # 只有前两列有间隔，第三列不加边距：2 行 × 2 格 = 4 个 tcMar
    assert raw.count("<w:tcMar>") == 4
    assert "<w:right" in raw


def test_docx_without_geometry_leaves_table_alone() -> None:
    document = Document()
    table = document.add_table(rows=1, cols=3)
    before = table._tbl.xml
    apply_column_geometry(table, document, 3, EntryLayout(columns=3), base=14.0)
    assert table._tbl.xml == before


@needs_font
def test_pdf_honours_per_column_widths() -> None:
    """PDF 有独立的绘制器（不走 HTML/CSS），所以这条必须单独钉：
    第一列从 40% 变 50% 时，第二列文本的横坐标要跟着右移，且量级对得上（≈10% 内容宽）。

    没有这条守卫时，`column_widths` 只在 HTML 生效、PDF 静默按内容量宽——2026-11-02 实测过
    这个漏（40/30/30 与 50/25/25 的 PDF 文本坐标**完全一致**）。
    """
    document = make_document()
    section = next(item for item in document["sections"] if item["key"] == "education")

    def first_x_by_text(widths: list[float]) -> dict[str, float]:
        section["layout"].update({"columns": 2, "column_widths": widths, "column_gaps": None})
        pdf = build_resume_pdf(document, template="classic", page_limit=2)
        found: dict[str, float] = {}

        def visit(text, cm, tm, font_dict, font_size):  # noqa: ANN001 - pypdf 回调签名
            clean = text.strip()
            if clean and clean not in found:
                found[clean] = round(tm[4], 1)

        pypdf.PdfReader(io.BytesIO(pdf.content)).pages[0].extract_text(visitor_text=visit)
        return found

    narrow_first = first_x_by_text([40, 60])
    wide_first = first_x_by_text([60, 40])
    label = next(key for key in wide_first if "核心课程" in key)
    assert label in narrow_first
    shift = wide_first[label] - narrow_first[label]
    # 内容宽 400pt 量级下 20% 差距 ≈ 80pt；给足够宽的区间，只钉方向与量级。
    assert shift > 20, (
        f"第二列没有跟着第一列变宽而右移：{narrow_first[label]} → {wide_first[label]}"
    )
