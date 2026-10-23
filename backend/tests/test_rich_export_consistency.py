# SPDX-License-Identifier: Apache-2.0
"""同一份带 ``**`` 的内容，五个消费方必须说同一件事。

加粗标记的失败方式是"某个输出里露着星号"——HTML 对了、PDF 里还露着 `**`、Word 里
既没加粗也没去掉标记。这类不一致不会报错，只有人眼能发现。所以这里用**同一份内容**
逐条钉住：

* HTML：含 ``<strong>`` 且不含 ``**``；
* PDF：读回的文字里没有 ``**``，页数与"剥掉标记的同内容"一致；
* Word：正文里没有 ``**``，且存在 ``bold=True`` 的 run；
* 纯文本：没有 ``**``；
* ATS：加粗与否不影响评分与关键词命中（标记不该被当成正文）。
"""

from __future__ import annotations

import re
from io import BytesIO

import pytest
from app.schemas.resume import ResumeContent
from app.services.ats_check import check_ats
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import render_html
from app.services.pdf_exporter import build_resume_pdf, font_available
from app.services.resume.resume_rich_text import strip_markers
from app.services.resume.resume_templates import RESUME_TEMPLATES
from app.services.txt_exporter import export_txt
from docx import Document
from pypdf import PdfReader

needs_font = pytest.mark.skipif(not font_available(), reason="本机没有可用的中文字体")

BOLD_SUMMARY = "**负责**后端服务的设计与开发，带 8 人团队交付。"
BOLD_DESCRIPTION = ["**实现**检索接口，P99 从 800ms 降到 120ms。", "维护离线任务调度。"]


def _resume(summary: str = BOLD_SUMMARY, description: list[str] | None = None) -> ResumeContent:
    return ResumeContent(
        name="张三",
        phone="13800000000",
        email="zhangsan@example.com",
        job_intent="后端工程师",
        summary=summary,
        experience=[
            {
                "company": "字节跳动",
                "role": "后端工程师",
                "description": list(BOLD_DESCRIPTION if description is None else description),
            }
        ],
        projects=[
            {
                "name": "检索平台",
                "role": "负责人",
                "description": ["**主导**架构设计与容量评估。"],
                "highlights": ["QPS 从 2k 提升到 20k"],
            }
        ],
        skills=[{"name": "Python", "level": "熟练"}],
    )


def _plain_resume() -> ResumeContent:
    """同一份内容，只是把标记换掉（可见文本逐字相同）。"""
    return _resume(
        summary=strip_markers(BOLD_SUMMARY),
        description=[strip_markers(line) for line in BOLD_DESCRIPTION],
    )


def _pdf_text(content: bytes) -> str:
    reader = PdfReader(BytesIO(content))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


# ===== HTML =====


_SCRIPT_RE = re.compile(r"<script[\s\S]*?</script\s*>", re.IGNORECASE)


@pytest.mark.parametrize("template", sorted(RESUME_TEMPLATES))
def test_no_marker_literal_leaks_into_the_rendered_html(template):
    """**内容里没有标记时，产物里一个 `**` 都不该有。**

    这条防的不是用户输入，而是**模板自己**：模板作者用 Markdown 写注释（`这里**不得**再乘`），
    那些 `**` 会原样落进导出的 `<style>` 与 `<script>`——用户看不到加粗，却能在产物里搜到
    星号，验收里的"产物不得含标记字面量"就是这么破的。用例跑全部 8 套（含已下线的三套，
    它们仍要能渲染老简历）。
    """
    plain = ResumeContent(name="张三", summary="负责后端服务的设计与开发。")

    html = render_html(plain, template=template)

    assert "**" not in html, f"模板 {template} 的输出里出现了标记字面量"


def _body(html: str) -> str:
    """只看 `<body>` 之后、且不含 `<script>` 的内容区域。

    样式表与页数自适应脚本里都有 `**`（那是注释），它们不是正文，也不该被替换——
    这正是 `apply_rich_html` 的"只处理文本段"要保证的事。
    """
    return _SCRIPT_RE.sub("", html.split("<body", 1)[1])


def test_html_turns_paired_markers_into_strong():
    html = render_html(_resume(), template="classic")

    assert "<strong>负责</strong>" in _body(html)
    assert "**" not in _body(html)


def test_html_keeps_unpaired_asterisks_as_text():
    """未配对是"用户真想写字面的星号"，HTML 里也不该被吃掉。"""
    plain = ResumeContent(name="张三", summary="带 8 人团队 ** 交付，负责后端服务。")
    body = _body(render_html(plain, template="classic"))

    assert "**" in body
    assert "<strong>" not in body


def test_html_does_not_replace_markers_inside_style_blocks():
    """样式表里出现 `<strong>` 会把页面写坏：文本段之外一律不许替换。

    （模板的 CSS 注释里本来就有 `**不得**` 这种写法，它必须原样留着。）
    """
    html = render_html(_resume(), template="classic")

    head = html.split("<body", 1)[0]
    assert "<strong>" not in head


# ===== PDF =====


@needs_font
def test_pdf_text_has_no_markers():
    result = build_resume_pdf(_resume(), template="classic", page_limit=1)

    text = _pdf_text(result.content)
    assert "负责" in text
    assert "**" not in text


@needs_font
def test_pdf_page_count_matches_the_stripped_version():
    """量高与绘制同参：加粗标记不占行宽，页数必须与"没有标记"完全一致。"""
    with_markers = build_resume_pdf(_resume(), template="classic", page_limit=2)
    without_markers = build_resume_pdf(_plain_resume(), template="classic", page_limit=2)

    assert with_markers.pages == without_markers.pages


# ===== Word =====


def test_docx_marks_the_runs_bold_and_drops_the_markers():
    result = build_resume_docx(_resume(), template="classic", page_limit=1)

    document = Document(BytesIO(result.content))
    text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    assert "**" not in text
    assert "负责后端服务的设计与开发" in text

    bold_segments = [
        run.text
        for paragraph in document.paragraphs
        for run in paragraph.runs
        if run.bold and "负责" in run.text
    ]
    assert bold_segments, "摘要里的 `**负责**` 必须落成 bold=True 的 run"


def test_docx_bold_run_is_a_separate_run_from_the_rest():
    """加粗必须只包住被标记的那几个字（不是整段加粗）。"""
    result = build_resume_docx(_resume(), template="classic", page_limit=1)

    document = Document(BytesIO(result.content))
    summary_paragraph = next(
        paragraph for paragraph in document.paragraphs if "后端服务的设计与开发" in paragraph.text
    )
    assert len(summary_paragraph.runs) >= 2
    assert summary_paragraph.runs[0].text == "负责"
    assert summary_paragraph.runs[0].bold is True
    assert summary_paragraph.runs[-1].bold is not True


# ===== 纯文本 / Markdown =====


def test_txt_export_has_no_markers():
    text = export_txt(_resume())

    assert "负责后端服务的设计与开发" in text
    assert "**" not in text


def test_txt_export_keeps_unpaired_asterisks():
    text = export_txt(_resume(summary="带 8 人团队 ** 交付"))

    assert "**" in text


# ===== ATS =====


def test_ats_result_is_identical_with_and_without_markers():
    jd = "后端工程师 Python 检索 接口"
    with_markers = check_ats(_resume(), jd)
    without_markers = check_ats(_plain_resume(), jd)

    assert with_markers.score == without_markers.score
    assert with_markers.matched_keywords == without_markers.matched_keywords
    assert with_markers.missing_keywords == without_markers.missing_keywords
    assert with_markers.coverage_ratio == without_markers.coverage_ratio
