# SPDX-License-Identifier: Apache-2.0
"""PDF 出口（v2）：字段文本/顺序、隐藏项、start_on_new_page 分页、溢出语义
（pages / pages_needed / overflow 三者的自洽）、lead 列与 hide_title。"""

from __future__ import annotations

import copy
import io

import pypdf
import pytest
from app.services.pdf_exporter import build_resume_pdf, font_available
from tests.document_export_samples import (
    HIDDEN_VALUES,
    ORDERED_VALUES,
    make_document,
    pdf_text,
)

needs_font = pytest.mark.skipif(not font_available(), reason="本机没有可用的中文字体")


def _pages(data: bytes) -> list[str]:
    reader = pypdf.PdfReader(io.BytesIO(data))
    return [" ".join((page.extract_text() or "").split()) for page in reader.pages]


@needs_font
def test_pdf_contains_fields_in_plan_order():
    pdf = build_resume_pdf(make_document(), template="classic", page_limit=2)
    text = pdf_text(pdf.content)
    for value in ORDERED_VALUES:
        assert value in text, f"PDF 缺少字段值：{value}"
    positions = [text.index(value) for value in ORDERED_VALUES]
    assert positions == sorted(positions)
    for hidden in HIDDEN_VALUES:
        assert hidden not in text
    assert pdf.pages >= 1 and pdf.pages_needed == pdf.pages and pdf.overflow is False


@needs_font
def test_pdf_start_on_new_page_and_hide_title():
    document = copy.deepcopy(make_document())
    for section in document["sections"]:
        if section["key"] == "projects":
            section["layout"] = {"start_on_new_page": True}
        if section["key"] == "education":
            section["layout"] = {"hide_title": True}
    pdf = build_resume_pdf(document, template="classic", page_limit=3)
    pages = _pages(pdf.content)
    assert len(pages) >= 2
    assert "教育经历" not in pdf_text(pdf.content)
    assert "校园招聘会" in pages[-1] or any("校园招聘会" in page for page in pages[1:])


@needs_font
def test_pdf_overflow_truncates_and_reports_pages_needed():
    document = copy.deepcopy(make_document())
    summary = document["sections"][-1]["entries"][0]["items"]
    for index in range(40):
        summary.append(
            {
                "kind": "text",
                "id": f"pt_sum_{index:05d}",
                "text": f"第 {index} 段补充说明，用来把内容撑到多页。" * 3,
                "style": "paragraph",
            }
        )
    pdf = build_resume_pdf(document, template="classic", page_limit=1)
    assert pdf.overflow is True
    assert pdf.pages == 1
    assert pdf.pages_needed is not None and pdf.pages_needed > 1


@needs_font
def test_pdf_keeps_lead_rows_before_body():
    pdf = build_resume_pdf(make_document(), template="classic", page_limit=2)
    text = pdf_text(pdf.content)
    assert text.index("3.7/4.0") < text.index("国家奖学金")
    assert text.index("市场调研") < text.index("国家奖学金")
