# SPDX-License-Identifier: Apache-2.0
"""W08-BE（核心）：分页意图的三格式消费与终止规则。

已落地范围：HTML 打印 CSS（角色 CSS 模块已有单测）、PDF 强制新页（含"连续强制不吐空白页"
终止规则）、Word page_break_before / keep_with_next / keep_together。
未落地（后端后续补）：DrawnSpan 渲染日志与 pagination/report 端点、续页姓名/页码绘制、
PDF keep_with_next 预留高度、长链接断行、Windows 之外的分页矩阵文档更新。
"""

from __future__ import annotations

import io
import zipfile

from app.schemas.resume import ResumeContent
from app.services.pdf_exporter import build_resume_pdf
from test_pdf_exporter import needs_font

ID_A = "exp_12345678"
ID_B = "exp_87654321"


def _resume() -> ResumeContent:
    return ResumeContent(
        name="张三",
        job_intent="后端工程师",
        experience=[
            {"company": "甲公司", "role": "工程师", "description": ["做了甲。"], "id": ID_A},
            {"company": "乙公司", "role": "工程师", "description": ["做了乙。"], "id": ID_B},
        ],
    )


def _config(entries: dict) -> dict:
    return {"pagination": {"version": 1, "entries": entries}}


@needs_font
def test_pdf_break_before_starts_a_new_page():
    baseline = build_resume_pdf(_resume(), template="classic", page_limit=3)
    forced = build_resume_pdf(
        _resume(),
        template="classic",
        page_limit=3,
        format_config=_config({ID_B: {"break_before": "page"}}),
    )
    # 手工分页只在页面还有内容时才换页——它必须让这份一页简历变成两页（且只多一页）。
    assert baseline.pages == 1
    assert forced.pages == 2


@needs_font
def test_two_consecutive_breaks_do_not_emit_a_blank_page():
    """终止规则 1：连续两条 break_before 只在**当前页已有内容**时换页，不吐空白页。"""
    forced = build_resume_pdf(
        _resume(),
        template="classic",
        page_limit=3,
        format_config=_config({ID_A: {"break_before": "page"}, ID_B: {"break_before": "page"}}),
    )
    # 每条 break_before 在"当前页已有内容"时都换一页：首页(页头+甲) → 第 2 页(乙)；
    # 关键终止性质是**每一页都有内容**（不吐空白页），而不是页数越少越好。
    assert forced.pages == 3
    from pypdf import PdfReader

    pages_text = [page.extract_text() or "" for page in PdfReader(io.BytesIO(forced.content)).pages]
    assert all(text.strip() for text in pages_text), "强制分页不许产生空白页"


def test_word_applies_page_break_before_and_keep_together():
    from app.services.docx_exporter import build_resume_docx

    document = build_resume_docx(
        _resume(),
        template="classic",
        page_limit=3,
        format_config=_config(
            {ID_B: {"break_before": "page", "keep_with_next": 1, "allow_split": False}}
        ),
    )
    with zipfile.ZipFile(io.BytesIO(document.content)) as bundle:
        xml = bundle.read("word/document.xml").decode("utf-8")
    assert "<w:pageBreakBefore" in xml or 'w:pageBreakBefore w:val="true"' in xml
    assert "<w:keepNext" in xml
    assert "<w:keepLines" in xml


def test_html_print_css_carries_manual_breaks_only():
    from app.services.exporter import render_html

    resume = _resume()
    default_html = render_html(resume)
    assert '[data-object-id="exp_12345678"] { break-before' not in default_html
    html = render_html(resume, format_config=_config({ID_B: {"break_before": "page"}}))
    assert "@media print" in html
    assert '[data-object-id="exp_87654321"] { break-before: page; }' in html


def test_word_continuation_header_and_footer():
    """W08：重复姓名进 section.header、页码进 section.footer（PAGE/NUMPAGES 域）。"""
    from app.services.docx_exporter import build_resume_docx

    document = build_resume_docx(
        _resume(),
        template="classic",
        page_limit=3,
        format_config={
            "pagination": {
                "version": 1,
                "entries": {ID_B: {"break_before": "page"}},
                "continuation": {"repeat_name": True, "page_numbers": True},
            }
        },
    )
    with zipfile.ZipFile(io.BytesIO(document.content)) as bundle:
        names = bundle.namelist()
        header = next(
            (bundle.read(n).decode("utf-8") for n in names if n.startswith("word/header")), ""
        )
        footer = next(
            (bundle.read(n).decode("utf-8") for n in names if n.startswith("word/footer")), ""
        )
    assert "张三" in header, "续页重复姓名应进页眉"
    assert "PAGE" in footer and "NUMPAGES" in footer, "页码应为 PAGE/NUMPAGES 域"


def test_word_default_has_no_extra_header_footer():
    """默认（未开续页信息）不加任何 header/footer —— 旧产物不变。"""
    from app.services.docx_exporter import build_resume_docx

    content = build_resume_docx(_resume(), template="classic", page_limit=3).content
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        assert not [n for n in bundle.namelist() if n.startswith(("word/header", "word/footer"))]
