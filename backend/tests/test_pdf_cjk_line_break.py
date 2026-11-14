# SPDX-License-Identifier: Apache-2.0
"""中文断行的可见性约束：标点不顶行首、不落行尾，窄宽不丢字，加粗标记每行闭合。

头部几条是像素级判据（渲染后读像素/文本），还有一条最关键的：**量高与实际绘制必须推进
相同的行数**——两边差一行，分页就会错位，而且只在特定文案上复现。
"""

from __future__ import annotations

import pypdfium2
import pytest
from app.services.pdf_exporter.line_break import (
    break_lines,
    break_rich_runs,
    cjk_gap_indices,
    soft_line_flags,
)
from app.services.pdf_exporter.rich_text import to_fpdf_markup
from app.services.resume.resume_rich_text import parse_rich_runs
from test_pdf_exporter import _pdf_with_font, needs_font


def _width(text: str) -> float:
    return sum(0.5 if ord(char) < 128 else 1.0 for char in text)


@pytest.mark.parametrize(
    "text",
    [
        "管理 1,600+ 条评测数据并设计 Agent 工作流，实现稳定的 AI 能力交付" * 3,
        "对比 GitHub 与 provider 接口，实现中文混排并验证每行宽度" * 3,
    ],
)
def test_cjk_words_do_not_leave_a_chinese_token_on_a_new_line(text):
    lines = break_lines(text, 24, _width)
    assert "".join(lines) == text
    assert max(_width(line) for line in lines) <= 24
    for word in ("1,600+", "Agent", "AI", "GitHub", "provider"):
        assert sum(line.count(word) for line in lines) == text.count(word)
    assert min(_width(line.rstrip()) for line in lines[:-1]) >= 20


@pytest.mark.parametrize("text", ["甲乙丙，丁戊己", "甲乙（丙丁戊）己", "甲乙丙【丁戊】己"])
def test_punctuation_stays_with_the_adjacent_glyph(text):
    lines = break_lines(text, 3, _width)
    assert "".join(lines) == text
    assert all(not line.startswith(tuple("，）】")) for line in lines)
    assert all(not line.endswith(tuple("（【")) for line in lines)


@pytest.mark.parametrize("width", [0, 0.1, 1, 3])
def test_narrow_width_preserves_all_characters_and_explicit_blank_lines(width):
    text = "甲Agent乙\n\n丙 1,600+ 丁\n"
    lines = break_lines(text, width, _width)
    assert "".join(lines) == text.replace("\n", "")
    assert len(lines) <= len(text) + 1
    assert lines[-1] == ""


def test_bold_is_closed_on_each_line_without_changing_the_visible_text():
    text = "中文 **加粗 Agent 以及数字 1,600+ 的长段落需要跨行** 普通正文"
    lines = break_rich_runs(parse_rich_runs(text), 10, lambda char, bold: _width(char))
    assert "".join(run.text for line in lines for run in line) == "".join(
        span.text for span in parse_rich_runs(text)
    )
    projected, markdown = to_fpdf_markup(text, width=10, width_of=lambda char, bold: _width(char))
    assert markdown is True
    assert all(line.count("**") % 2 == 0 for line in projected.split("\n"))
    assert "Agent" in projected
    assert "1,600+" in projected


@needs_font
def test_canvas_prebreaks_cjk_using_the_actual_drawn_font():
    from fpdf.enums import MethodReturnValue

    pdf = _pdf_with_font()
    pdf.set_font("resume-cjk", "", 10.5)
    text = "负责 1,600+ 条数据的 Agent 产品设计以及中文长段落需求分析和实现" * 4
    width = 82.0
    lines = pdf.multi_cell(width, 5, text, dry_run=True, output=MethodReturnValue.LINES)
    usable = width - 2 * pdf.c_margin
    glyph = pdf.rich_text_width("中")
    assert len(lines) >= 3
    assert all(pdf.rich_text_width(line.rstrip()) <= usable for line in lines)
    assert "1,600+" in "\n".join(lines)
    assert "Agent" in "\n".join(lines)
    # Natural advances intentionally stay truthful: positioning belongs in the PDF.
    # Preserving ASCII tokens makes breakpoint-only <=1Han mathematically impossible.
    pdf.set_xy(20, 20)
    pdf.multi_cell(width, 5, text, align="L", new_y="NEXT")
    right_edges = _rendered_right_edges(bytes(pdf.output()), top=20, line_height=5)
    assert len(right_edges) == len(lines)
    for right in right_edges[:-1]:
        assert 20 + width - pdf.c_margin - right <= glyph + 0.01


@needs_font
def test_dry_run_and_render_advance_by_the_same_number_of_lines():
    pdf = _pdf_with_font()
    pdf.set_font("resume-cjk", "", 10.5)
    text = "中文 **Agent 产品设计加粗片段与 1,600+ 数据评测** 持续改进" * 4
    height = pdf._dry_run_height(80, 5, text)
    top = pdf.get_y()
    pdf.multi_cell(80, 5, text, new_y="NEXT")
    assert pdf.get_y() - top == pytest.approx(height)


def _rendered_right_edges(data, *, top, line_height):
    rows = {}
    with pypdfium2.PdfDocument(data) as document:
        page = document[0]
        textpage = page.get_textpage()
        try:
            factor = 72 / 25.4
            first_center = (297 - top - line_height / 2) * factor
            for index in range(textpage.count_chars()):
                char = textpage.get_text_range(index, 1)
                if char.isspace():
                    continue
                _left, bottom, right, upper = textpage.get_charbox(index)
                row = round((first_center - (bottom + upper) / 2) / (line_height * factor))
                rows[row] = max(rows.get(row, 0), right / factor)
        finally:
            textpage.close()
            page.close()
    return [rows[key] for key in sorted(rows)]


def test_boundary_spacing_preserves_atomic_ascii_and_attached_punctuation():
    text = "中文（Agent 1,600+）GitHub provider AI，结束"
    gaps = cjk_gap_indices(text)
    for token in ("Agent", "1,600+", "GitHub", "provider", "AI"):
        start = text.index(token)
        assert gaps.isdisjoint(range(start, start + len(token) - 1))
    assert text.index("（") not in gaps
    assert text.index("）") - 1 not in gaps
    assert text.index("，") - 1 not in gaps


def test_only_inserted_linebreaks_are_justified():
    runs = parse_rich_runs("甲乙丙丁\n短行\n\n末段甲乙丙丁")
    lines = break_rich_runs(runs, 3, lambda char, bold: _width(char))
    assert soft_line_flags(runs, lines) == [True, False, False, False, True, False]


@needs_font
@pytest.mark.parametrize("align", ["L", "J"])
def test_actual_justified_bold_rows_fit_and_final_explicit_line_stays_short(align):
    pdf = _pdf_with_font()
    pdf.set_font("resume-cjk", "", 10.5)
    pdf.set_xy(20, 20)
    text = (
        "中文 **Agent 与 1,600+ 条数据的加粗设计**（命中 / 无命中 / 继续）保持 GitHub provider AI。"
        * 4
    )
    pdf.multi_cell(82, 5, text + "\n短行保持原样", align=align, new_y="NEXT")
    rows = _rendered_right_edges(bytes(pdf.output()), top=20, line_height=5)
    assert len(rows) >= 5
    assert all(101 - right <= 3.704166666666666 + 0.01 for right in rows[:-2])
    assert 101 - rows[-1] > 30


@needs_font
def test_justified_multicell_preserves_paging_and_font_metrics():
    pdf = _pdf_with_font()
    pdf.set_font("resume-cjk", "", 10.5)
    natural = pdf.rich_text_width("中文 Agent")
    pdf.set_xy(20, 275)
    text = "负责 1,600+ 条数据的 Agent 产品设计以及中文长段落需求分析和实现" * 20
    pdf.multi_cell(82, 5, text + "终点标记", new_y="NEXT")
    assert pdf.page >= 2
    assert pdf.rich_text_width("中文 Agent") == natural
    with pypdfium2.PdfDocument(bytes(pdf.output())) as document:
        page = document[len(document) - 1]
        textpage = page.get_textpage()
        try:
            assert "终点标记" in textpage.get_text_range()
        finally:
            textpage.close()
            page.close()


@needs_font
def test_explicit_character_spacing_and_stretch_use_the_same_break_budget():
    pdf = _pdf_with_font()
    pdf.set_font("resume-cjk", "", 10.5)
    pdf.set_char_spacing(0.5)
    pdf.set_stretching(110)
    text = "中文 **Agent 产品设计与 1,600+ 数据** 持续改进" * 8
    height = pdf._dry_run_height(82, 5, text)
    pdf.set_xy(20, 20)
    pdf.multi_cell(82, 5, text, new_y="NEXT")
    assert pdf.get_y() - 20 == pytest.approx(height)
    rows = _rendered_right_edges(bytes(pdf.output()), top=20, line_height=5)
    assert len(rows) == round(height / 5)
    assert all(-0.05 <= 101 - right <= 3.704166666666666 + 0.01 for right in rows[:-1])
