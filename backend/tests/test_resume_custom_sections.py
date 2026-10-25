# SPDX-License-Identifier: Apache-2.0
"""C2/R-79：ResumeContent 自建分区在四格式导出中的行为。

覆盖契约 §4.3：
- 结构校验（title/label 非空、条目 text 或 lines 至少一个非空、各自上限）；
- 空 custom_sections 时 HTML/Markdown/Word 输出与"显式空列表"一致——缺省字段不改变任何
  旧产物（跨版本的内容基线由 test_export_golden 的 manifest 钉住）；
- 有自建分区时标题 / 主文本 / 「标签：值」行出现在 HTML、Markdown、Word（docx XML 文本）
  与 PDF，位置在 13 个系统分区之后、顺序由内容冻结；
- XSS 转义、空白条目被跳过、不引入任何缩字号。
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from xml.etree import ElementTree

import pytest
from app.schemas.resume import (
    ResumeContent,
    ResumeCustomEntry,
    ResumeCustomLine,
    ResumeCustomSection,
)
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import export_json, export_markdown, render_html
from app.services.pdf_exporter import build_resume_pdf, font_available
from app.services.resume.resume_sample import sample_resume_content
from app.services.resume.resume_templates import RESUME_TEMPLATES
from pydantic import ValidationError

TEMPLATES = sorted(RESUME_TEMPLATES)
# 页头 / 系统分区的已知文案：自建分区必须排在它们之后。
SYSTEM_END_MARKER = "个人总结"
W_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def _line(label: str, value: str) -> ResumeCustomLine:
    return ResumeCustomLine(label=label, value=value)


def _entry(text: str = "", lines: tuple[tuple[str, str], ...] = (), entry_id: str = "e1"):
    return ResumeCustomEntry(
        entry_id=entry_id, text=text, lines=[_line(label, value) for label, value in lines]
    )


def _open_source() -> ResumeCustomSection:
    return ResumeCustomSection(
        key="custom:open-source",
        title="开源贡献",
        entries=[
            _entry(
                text="维护统一网关平台的开源插件生态。",
                lines=(
                    ("角色", "维护者"),
                    ("链接", "https://example.com/gateway-plugins?a=1&b=2"),
                ),
                entry_id="os-1",
            ),
            _entry(text="主导插件契约评审流程。", entry_id="os-2"),
        ],
    )


def _resume(*sections: ResumeCustomSection) -> ResumeContent:
    return sample_resume_content().model_copy(update={"custom_sections": list(sections)})


def _no_nonce(html: str) -> str:
    return re.sub(r"nonce(?:-|=)[\"']?[0-9a-f]+", "nonce-X", html)


def _docx_paragraphs(content: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        root = ElementTree.fromstring(bundle.read("word/document.xml"))
    return [
        "".join(node.text or "" for node in paragraph.iterfind(".//w:t", W_NS))
        for paragraph in root.iterfind(".//w:body/w:p", W_NS)
    ]


def _pdf_text(content: bytes) -> str:
    import pypdf

    return "".join(page.extract_text() or "" for page in pypdf.PdfReader(io.BytesIO(content)).pages)


def _require_pdf():
    if not font_available():
        pytest.skip("本机没有可用中文字体，无法验证服务端 PDF；其余三格式已覆盖")


# ===== 结构与序列化 =====


def test_empty_custom_sections_are_not_serialized():
    """缺省空列表不进入 content JSON：旧记录的内容指纹（交付快照）逐字节不变。"""
    content = sample_resume_content()
    assert "custom_sections" not in content.model_dump()
    # 旧记录（JSON 里根本没有这个键）读取后仍是空列表，且序列化后同样不出现。
    parsed = ResumeContent.model_validate({"name": "张三", "summary": "旧简历"})
    assert parsed.custom_sections == []
    assert "custom_sections" not in parsed.model_dump()


def test_custom_section_round_trips_through_json():
    payload = _resume(_open_source()).model_dump()
    assert payload["custom_sections"][0]["title"] == "开源贡献"
    restored = ResumeContent.model_validate(payload)
    assert restored.custom_sections[0].entries[1].text == "主导插件契约评审流程。"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"title": ""},
        {"title": "   "},
        {"title": "x" * 41},
        {"title": "标题", "entries": [_entry(text="a")] * 201},
    ],
)
def test_section_validation(kwargs):
    with pytest.raises(ValidationError):
        ResumeCustomSection(key="custom:x", **kwargs)


def test_entry_and_line_validation():
    with pytest.raises(ValidationError):
        ResumeCustomEntry(text="   ", lines=[])
    with pytest.raises(ValidationError):
        ResumeCustomLine(label=" ")
    with pytest.raises(ValidationError):
        ResumeCustomEntry(text="x" * 4001)
    with pytest.raises(ValidationError):
        ResumeCustomLine(label="x", value="y" * 2001)
    with pytest.raises(ValidationError):
        ResumeCustomEntry(text="x", lines=[_line("l", "v")] * 31)
    # 有标签行、没主文本是合法形态（条目 = 主文本 + 标签行，主文本可以缺省）。
    assert ResumeCustomEntry(text="", lines=[_line("角色", "维护者")]).lines
    # 空 entries 的分区也合法（模板 / 导出按"空分区跳过"处理，不能让历史内容 500）。
    assert ResumeCustomSection(title="空分区").entries == []


def test_title_and_label_are_stripped():
    section = ResumeCustomSection(
        title="  开源贡献  ", entries=[_entry(lines=((" 角色 ", " 值 "),))]
    )
    assert section.title == "开源贡献"
    assert section.entries[0].lines[0].label == "角色"


# ===== 空 custom_sections：旧产物不变 =====


@pytest.mark.parametrize("template", TEMPLATES)
def test_empty_custom_sections_keep_html_identical(template: str):
    content = sample_resume_content()
    with_empty_list = content.model_copy(update={"custom_sections": []})
    assert _no_nonce(render_html(content, template=template)) == _no_nonce(
        render_html(with_empty_list, template=template)
    )
    # 宏没有留下任何占位痕迹（空列表输出零字节）。
    assert 'data-section="custom:' not in render_html(content, template=template)
    assert "custom_sections" not in render_html(content, template=template)


def test_empty_custom_sections_keep_markdown_and_word_identical():
    content = sample_resume_content()
    with_empty_list = content.model_copy(update={"custom_sections": []})
    assert export_markdown(content) == export_markdown(with_empty_list)
    # docx 的 zip 时间戳每次都不同，逐"内容"比较：document.xml 的段落文本必须一致。
    assert _docx_paragraphs(build_resume_docx(content).content) == _docx_paragraphs(
        build_resume_docx(with_empty_list).content
    )


def test_empty_custom_sections_keep_pdf_identical():
    _require_pdf()
    content = sample_resume_content()
    with_empty_list = content.model_copy(update={"custom_sections": []})
    assert _pdf_text(build_resume_pdf(content).content) == _pdf_text(
        build_resume_pdf(with_empty_list).content
    )


# ===== 有自建分区：四格式都要出现，且排在系统分区之后 =====


@pytest.mark.parametrize("template", TEMPLATES)
def test_html_renders_custom_section(template: str):
    html = render_html(_resume(_open_source()), template=template)
    assert "开源贡献" in html
    assert "维护统一网关平台的开源插件生态。" in html
    assert "角色：<span" in html
    assert "https://example.com/gateway-plugins?a=1&amp;b=2" in html
    assert 'data-resume-path="custom_sections.0.entries.0.text"' in html
    assert 'data-resume-path="custom_sections.0.entries.1.text"' in html
    assert 'data-resume-path="custom_sections.0.entries.0.lines.0.value"' in html
    assert 'data-resume-path="custom_sections.0.entries.0.lines.1.value"' in html
    # 顺序：13 个系统分区之后（渲染端不排序，顺序由内容冻结）。
    assert html.index("开源贡献") > html.index(SYSTEM_END_MARKER)


def test_split_template_keeps_custom_section_outside_the_grid():
    """双栏模板里自建分区是独立成栏的整幅区块，不能塞进两两并排的 grid。"""
    html = render_html(_resume(_open_source()), template="split")
    assert '</div>\n<div class="section" data-section="custom:open-source">' in html
    assert html.index("开源贡献") > html.index('data-columns="2"')


def test_markdown_renders_custom_section():
    markdown = export_markdown(_resume(_open_source()))
    assert "## 开源贡献" in markdown
    assert "维护统一网关平台的开源插件生态。" in markdown
    assert "- 角色：维护者" in markdown
    assert markdown.index("## 开源贡献") > markdown.index("## " + SYSTEM_END_MARKER)


def test_docx_renders_custom_section():
    paragraphs = _docx_paragraphs(build_resume_docx(_resume(_open_source())).content)
    text = "\n".join(paragraphs)
    assert "开源贡献" in text
    assert "维护统一网关平台的开源插件生态。" in text
    assert "角色：维护者" in text
    assert "链接：https://example.com/gateway-plugins?a=1&b=2" in text
    assert text.index("开源贡献") > text.index(SYSTEM_END_MARKER)


def test_pdf_renders_custom_section():
    _require_pdf()
    text = _pdf_text(build_resume_pdf(_resume(_open_source())).content)
    assert "开源贡献" in text
    assert "维护统一网关平台的开源插件生态。" in text
    assert "角色：维护者" in text
    assert text.index("开源贡献") > text.index(SYSTEM_END_MARKER)


def test_json_export_carries_custom_sections():
    payload = json.loads(export_json(_resume(_open_source())))
    assert payload["custom_sections"][0]["key"] == "custom:open-source"
    assert payload["custom_sections"][0]["entries"][0]["lines"][0]["label"] == "角色"


def test_content_order_is_preserved():
    first = ResumeCustomSection(key="custom:a", title="分区甲", entries=[_entry(text="甲一")])
    second = ResumeCustomSection(key="custom:b", title="分区乙", entries=[_entry(text="乙一")])
    html = render_html(_resume(first, second))
    markdown = export_markdown(_resume(first, second))
    assert html.index("分区甲") < html.index("分区乙")
    assert markdown.index("## 分区甲") < markdown.index("## 分区乙")


# ===== 边界：空分区 / 空白条目 / 转义 / 不缩字号 =====


def test_empty_sections_and_blank_entries_are_skipped():
    blank = ResumeCustomSection(
        key="custom:blank",
        title="空白分区",
        entries=[ResumeCustomEntry(text="   ", lines=[_line("x", "  ")])],
    )
    no_entries = ResumeCustomSection(key="custom:none", title="没有条目", entries=[])
    resume = _resume(blank, no_entries)
    html = render_html(resume)
    markdown = export_markdown(resume)
    docx_text = "\n".join(_docx_paragraphs(build_resume_docx(resume).content))
    for output in (html, markdown, docx_text):
        assert "空白分区" not in output
        assert "没有条目" not in output


def test_custom_section_text_is_escaped():
    hostile = ResumeCustomSection(
        key="custom:xss",
        title="<script>alert('t')</script>",
        entries=[
            ResumeCustomEntry(
                text="<script>alert('x')</script>",
                lines=[_line("<b>标签</b>", "<img src=x onerror=alert(1)>")],
            )
        ],
    )
    html = render_html(_resume(hostile))
    assert "<script>alert('t')</script>" not in html
    assert "&lt;script&gt;" in html
    assert "<img src=x onerror=alert(1)>" not in html
    assert "&lt;img src=x onerror=alert(1)&gt;" in html


def test_custom_sections_do_not_introduce_auto_shrink():
    """C2 不改分页口径：自建分区只多画内容，不新增任何缩字号挂钩。"""
    html = render_html(_resume(_open_source()), template="classic")
    assert "--fit-scale" not in html


def test_custom_template_gets_custom_sections_too():
    """用户自制模板复用 `_resume_sections.j2`，自建分区同样出现。"""
    html = render_html(
        _resume(_open_source()),
        template_html='<!doctype html><html><body>{% include "_resume_sections.j2" %}</body></html>',
    )
    assert "开源贡献" in html
    assert "角色：<span" in html
