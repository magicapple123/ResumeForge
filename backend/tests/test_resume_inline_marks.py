# SPDX-License-Identifier: Apache-2.0
"""W07 协议 v2：字符级斜体与链接的**唯一解析器**与六个消费方的一致性。

加粗已有 test_resume_rich_text.py 覆盖；本文件补协议 v2 新增的斜体与链接，并逐渲染器
钉住"同一份解析结果"：

* 解析：分层切分（先双星号、再单星号、最后链接）、落单按字面保留、URL 白名单；
* HTML：em / a href rel=noopener，非法 scheme 不变成链接、属性值仍被转义；
* Word：run.italic=True 真斜体；链接输出 "label (URL)" 可见文本；
* PDF：无真斜体（近似：不倾斜、文本可提取）；链接同样 "label (URL)"，且**不生成**
  URI 注释（fpdf2 的 markdown 自动链接被禁用，javascript: 不会进入 PDF 注释）；
* TXT：链接只留 label（不印刷 URL）；Markdown / 交付 JSON 原样保留标记；
* 能力矩阵：与实现同一口径（HTML 支持、docx italic supported / link approx、
  pdf italic approx / link unsupported）。
"""

from __future__ import annotations

import io
import json
import re
import zipfile

import pytest
from app.schemas.resume import ResumeContent
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import export_json, export_markdown, render_html
from app.services.pdf_exporter import build_resume_pdf
from app.services.resume.format_capabilities import CAPABILITIES, level_of
from app.services.resume.resume_rich_text import (
    MAX_LINK_URL_LENGTH,
    RichSpan,
    apply_rich_html,
    is_valid_link_url,
    parse_rich_runs,
    strip_markers,
)
from app.services.txt_exporter import export_txt
from pypdf import PdfReader
from test_pdf_exporter import needs_font

MARKED_SUMMARY = (
    "**负责** *高并发* 交易系统，作品见 [官网](https://example.com/work?x=1&y=2) "
    "与 [邮箱](mailto:hr@example.com)。"
)
LINK_URL = "https://example.com/work?x=1&y=2"
LINK_TEXT = f"官网 ({LINK_URL})"


def _resume(summary: str = MARKED_SUMMARY) -> ResumeContent:
    return ResumeContent(
        name="张三",
        email="zhangsan@example.com",
        job_intent="后端工程师",
        summary=summary,
        experience=[
            {
                "company": "甲公司",
                "role": "后端工程师",
                "start_date": "2021-01",
                "end_date": "2024-01",
                "description": ["**主导** *检索* 重构，[文档](https://docs.example.com/x)。"],
            }
        ],
    )


def _compact(text: str) -> str:
    """去掉全部空白与 CID 字体的 NUL：折行/提取方式不影响"内容在不在"。"""
    return "".join((text or "").replace("\x00", "").split())


def _pdf_page_texts(content: bytes) -> tuple[str, list]:
    reader = PdfReader(io.BytesIO(content))
    text = "".join(page.extract_text() or "" for page in reader.pages)
    annots = [page.get("/Annots") for page in reader.pages]
    return _compact(text), annots


def _docx_text_and_xml(content: bytes) -> tuple[str, str]:
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        xml = bundle.read("word/document.xml").decode("utf-8")
    text = re.sub(r"<[^>]+>", "", xml)
    return text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">"), xml


def _html_body(html: str) -> str:
    body = html.split("<body", 1)[1]
    # 结束标签允许带属性（`</script attr>`）——CodeQL py/bad-tag-filter 的两轮口径
    # 都落在这一处（先 `</script\s*>`，后 `</script[^>]*>`）。
    return re.sub(r"<script\b[\s\S]*?</script[^>]*>", "", body)


# ===== 1. 解析：分层切分与字面保留 =====


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("", []),
        # 斜体：成对生效，落单/相邻的星号按字面保留（双星号不是两个斜体）。
        ("*斜体*", [RichSpan("斜体", italic=True)]),
        ("前*中*后", [RichSpan("前"), RichSpan("中", italic=True), RichSpan("后")]),
        ("a*b", [RichSpan("a*b")]),
        ("**加粗**", [RichSpan("加粗", bold=True)]),
        # 先切双星号再切单星号：双星号内部即使含单星号也不会被拆成斜体。
        ("a **b** c", [RichSpan("a "), RichSpan("b", bold=True), RichSpan(" c")]),
        ("***a***", [RichSpan("*a", bold=True), RichSpan("*")]),
        # 链接：label 即可见文本；URL 存进 link 字段。
        ("[官网](https://e.com/x)", [RichSpan("官网", link="https://e.com/x")]),
        (
            "见[官网](https://e.com)或[邮箱](mailto:a@b.com)。",
            [
                RichSpan("见"),
                RichSpan("官网", link="https://e.com"),
                RichSpan("或"),
                RichSpan("邮箱", link="mailto:a@b.com"),
                RichSpan("。"),
            ],
        ),
        # 斜体里放链接 / 加粗里放链接：两种样式同时成立。
        ("*[官网](https://e.com)*", [RichSpan("官网", italic=True, link="https://e.com")]),
        ("**[官网](https://e.com)**", [RichSpan("官网", bold=True, link="https://e.com")]),
        # 非法 scheme / 落单括号 / 空 label 一律按字面文本保留，不吞字符。
        ("[x](javascript:alert)", [RichSpan("[x](javascript:alert)")]),
        ("[x](data:text/html,hi)", [RichSpan("[x](data:text/html,hi)")]),
        ("[x]()", [RichSpan("[x]()")]),
        ("[](https://e.com)", [RichSpan("[](https://e.com)")]),
        ("[未闭合(https://e.com)", [RichSpan("[未闭合(https://e.com)")]),
        # 超长 URL（>512）不作为链接。
        (
            "[abc](" + "https://e.com/" + "x" * MAX_LINK_URL_LENGTH + ")",
            [RichSpan("[abc](" + "https://e.com/" + "x" * MAX_LINK_URL_LENGTH + ")")],
        ),
        # 未配对的双星号仍原样保留。
        ("a**b", [RichSpan("a**b")]),
        ("****", []),
    ],
)
def test_parse_rich_runs(text: str, expected: list[RichSpan]) -> None:
    assert parse_rich_runs(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "",
        "普通正文",
        "**加粗** *斜体* [官网](https://e.com)",
        "[x](javascript:alert)",
        "a*b",
        "**未闭合",
        "***混排***",
        "见[文档](mailto:a@b.com)。",
    ],
)
def test_parse_is_idempotent_and_does_not_mutate_visible_text(text: str) -> None:
    once = parse_rich_runs(text)
    assert parse_rich_runs(text) == once
    assert "".join(span.text for span in once) == strip_markers(text)


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://e.com", True),
        ("http://e.com/a?b=1", True),
        ("HTTPS://E.COM", True),
        ("mailto:a@b.com", True),
        ("javascript:alert(1)", False),
        ("data:text/html,hi", False),
        ("/relative/path", False),
        ("https://e.com/a b", False),
        ("", False),
        ("https://e.com/" + "x" * MAX_LINK_URL_LENGTH, False),
    ],
)
def test_link_url_whitelist(url: str, expected: bool) -> None:
    assert is_valid_link_url(url) is expected


def test_strip_markers_keeps_link_label_only() -> None:
    """契约：TXT/ATS 里链接只留 label，不印刷 URL；非法链接整段字面保留。"""
    assert strip_markers("见[官网](https://e.com)") == "见官网"
    assert strip_markers("*斜体*与**加粗**") == "斜体与加粗"
    assert strip_markers("[x](javascript:alert)") == "[x](javascript:alert)"
    assert strip_markers("落单 * 与 ** 原样") == "落单 * 与 ** 原样"


# ===== 2. HTML：链接与斜体收口 =====


def test_html_renders_em_and_safe_anchor() -> None:
    html = apply_rich_html("<p>" + MARKED_SUMMARY + "</p>")
    assert "<strong>负责</strong>" in html
    assert "<em>高并发</em>" in html
    assert f'<a href="{LINK_URL.replace("&", "&amp;")}" rel="noopener noreferrer">官网</a>' in html
    assert 'href="mailto:hr@example.com"' in html


def test_html_does_not_link_an_invalid_scheme() -> None:
    html = apply_rich_html("<p>[x](javascript:alert)</p>")
    assert "<a " not in html
    assert "[x](javascript:alert)" in html


def test_html_escapes_url_entities_and_rejects_quote_urls() -> None:
    """URL 进 href 前必须转义 &；含引号的 URL 直接判非法（不冒险写进属性）。"""
    escaped = apply_rich_html("<p>[x](https://e.com/?a=1&b=2)</p>")
    assert 'href="https://e.com/?a=1&amp;b=2"' in escaped
    quoted = apply_rich_html('<p>[x](https://e.com/?q="onmouseover=1)</p>')
    assert "<a " not in quoted, "含引号的 URL 不能写进 href 属性"
    assert '[x](https://e.com/?q="onmouseover=1)' in quoted


def test_html_skips_style_script_and_attributes() -> None:
    html = apply_rich_html(
        "<style>p::after{content:'*x*'}</style>"
        '<p title="*tip*">*正文* [a](https://e.com)</p>'
        "<script>var a='*b*'</script>"
    )
    assert "<style>p::after{content:'*x*'}</style>" in html
    assert '<p title="*tip*">' in html
    assert "<em>正文</em>" in html
    assert "<script>var a='*b*'</script>" in html


def test_rendered_html_consumes_the_shared_parser() -> None:
    body = _html_body(render_html(_resume(), template="classic"))
    assert "<strong>负责</strong>" in body
    assert "<em>高并发</em>" in body
    assert 'rel="noopener noreferrer"' in body
    # 标记字面量不许泄漏到纸面（模板 CSS 注释在 style 里，不在此断言范围）。
    assert "**" not in body
    assert "](https://" not in body


# ===== 3. Word：真斜体 + 可见 URL 文本 =====


def test_docx_marks_italic_runs_and_expands_links() -> None:
    content = build_resume_docx(_resume(), template="classic", page_limit=2).content
    text, xml = _docx_text_and_xml(content)

    assert "**" not in text and "*高并发*" not in text
    assert "官网" in text and LINK_URL in text, "Word 链接必须是可见文本 label (URL)"
    assert "<w:i" in xml, "斜体应落成 run.font.italic"
    assert "<w:b" in xml, "加粗应落成 run.font.bold"

    from docx import Document

    document = Document(io.BytesIO(content))
    italic_runs = [
        run.text for paragraph in document.paragraphs for run in paragraph.runs if run.italic
    ]
    assert italic_runs and "高并发" in "".join(italic_runs)


# ===== 4. PDF：近似（不倾斜、文本可提取）+ 链接只做可见文本 =====


@needs_font
def test_pdf_uses_visible_text_and_never_prints_markers() -> None:
    artifact = build_resume_pdf(_resume(), template="classic", page_limit=2)
    text, annots = _pdf_page_texts(artifact.content)

    assert "高并发" in text, "斜体近似渲染仍必须保留文字（不倾斜）"
    assert LINK_TEXT.replace(" ", "") in text, "PDF 链接应输出 label (URL) 可见文本"
    assert "**" not in text and "*" not in text and "](https://" not in text
    assert all(annotation is None for annotation in annots), "PDF 不应生成可点击链接注释"


@needs_font
def test_pdf_never_turns_a_script_url_into_a_link_annotation() -> None:
    resume = _resume(summary="[x](javascript:alert) 正常文本")
    artifact = build_resume_pdf(resume, template="classic", page_limit=1)
    text, annots = _pdf_page_texts(artifact.content)

    assert "[x](javascript:alert)" in text, "非法 scheme 必须按字面文本保留"
    assert all(annotation is None for annotation in annots)


# ===== 5. TXT / Markdown / JSON：同一份解析结果的不同投影 =====


def test_txt_keeps_labels_without_urls() -> None:
    text = export_txt(_resume())
    assert "官网" in text and "邮箱" in text
    assert LINK_URL not in text and "mailto:" not in text
    assert "*" not in text


def test_markdown_and_delivery_json_keep_the_source_markers() -> None:
    resume = _resume()
    markdown = export_markdown(resume)
    assert "**负责**" in markdown
    assert "*高并发*" in markdown
    assert f"[官网]({LINK_URL})" in markdown
    payload = json.loads(export_json(resume))
    assert payload["summary"] == MARKED_SUMMARY


# ===== 6. 能力矩阵与实现同口径 =====


def test_capability_matrix_matches_the_actual_rendering() -> None:
    """矩阵是用户能看到的承诺：HTML 真斜体/真链接、docx 真斜体、pdf 只有近似与可见文本。"""
    assert level_of("html", "italic") == "supported"
    assert level_of("html", "link_clickable") == "supported"
    assert level_of("docx", "italic") == "supported"
    assert level_of("docx", "link_clickable") == "approx"
    assert level_of("pdf", "italic") == "approx"
    assert level_of("pdf", "link_clickable") == "unsupported"
    for fmt in ("html", "pdf", "docx", "markdown", "txt", "json"):
        assert "italic" in CAPABILITIES[fmt] and "link_clickable" in CAPABILITIES[fmt]
