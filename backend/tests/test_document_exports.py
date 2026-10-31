# SPDX-License-Identifier: Apache-2.0
"""四出口文本对拍（v2）：同一份 document 在 HTML / PDF / Word / Markdown / TXT 里
必须包含相同的字段值、顺序一致、隐藏项不出现、正文没有异常「标签：值」串。

这是"四个出口说同一件事"的守门用例：planner 是字段位置/顺序/格式化的唯一真相，任何
渲染器自己再拼一份字段就会在这里露出来。
"""

from __future__ import annotations

import json
import re

import pytest
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import export_json, export_markdown, render_html
from app.services.pdf_exporter import build_resume_pdf, font_available
from app.services.resume.resume_sample import sample_resume_content
from app.services.txt_exporter import export_txt
from tests.document_export_samples import (
    HIDDEN_VALUES,
    ORDERED_VALUES,
    docx_text,
    html_text,
    make_document,
    normalize_text,
    pdf_text,
)

needs_font = pytest.mark.skipif(not font_available(), reason="本机没有可用的中文字体")


def _outputs() -> dict[str, str]:
    """同一份 document 的五个纸面文本出口（PDF / Word 懒加载，字体缺失时跳过）。"""
    document = make_document()
    return {
        "html": html_text(render_html(document, template="classic", page_limit=2)),
        "markdown": normalize_text(export_markdown(document)),
        "txt": normalize_text(export_txt(document)),
    }


def test_html_markdown_txt_share_fields_and_order():
    outputs = _outputs()
    for name, text in outputs.items():
        for value in ORDERED_VALUES:
            assert value in text, f"{name} 缺少字段值：{value}"
        positions = [text.index(value) for value in ORDERED_VALUES]
        assert positions == sorted(positions), f"{name} 字段顺序与 plan 不一致"


@needs_font
def test_pdf_and_docx_share_fields_and_order():
    import io

    import pypdf
    from docx import Document

    document = make_document()
    pdf = build_resume_pdf(document, template="classic", page_limit=2)
    docx = build_resume_docx(document, template="classic", page_limit=2)
    # 质量门：产物是合法文件、可被标准库重新打开（不是"字节非空"就算过）。
    assert len(pypdf.PdfReader(io.BytesIO(pdf.content)).pages) == pdf.pages
    Document(io.BytesIO(docx.content))
    for name, text in (("pdf", pdf_text(pdf.content)), ("docx", docx_text(docx.content))):
        for value in ORDERED_VALUES:
            assert value in text, f"{name} 缺少字段值：{value}"
        positions = [text.index(value) for value in ORDERED_VALUES]
        assert positions == sorted(positions), f"{name} 字段顺序与 plan 不一致"


@needs_font
def test_all_outputs_agree_on_hidden_values():
    document = make_document()
    texts = {
        "html": html_text(render_html(document)),
        "markdown": export_markdown(document),
        "txt": export_txt(document),
        "docx": docx_text(build_resume_docx(document).content),
        "pdf": pdf_text(build_resume_pdf(document).content),
    }
    for name, text in texts.items():
        for hidden in HIDDEN_VALUES:
            assert hidden not in text, f"{name} 把隐藏内容画到了纸面上：{hidden}"


def test_markdown_and_txt_are_same_content_without_markup():
    document = make_document()
    markdown = export_markdown(document)
    plain = export_txt(document)
    # TXT 是 Markdown 去掉标记后的同源产物：正文行必须逐字一致（空行/标记除外）。
    for line in plain.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        assert stripped in markdown or stripped in {
            part.strip("# ").strip() for part in markdown.splitlines()
        }


def test_json_export_is_v2_delivery_document():
    document = make_document()
    payload = json.loads(export_json(document))
    assert payload["version"] == 2
    assert payload["language"] == "zh-CN"
    section_keys = [section["key"] for section in payload["sections"]]
    assert section_keys == ["education", "projects", "skills", "summary"]
    education = payload["sections"][0]
    # 隐藏条目与 placement=hidden 字段是"不上纸面"的：交付 JSON 里也不出现。
    assert [entry["id"] for entry in education["entries"]] == ["ob_edu000001"]
    project_items = payload["sections"][1]["entries"][0]["items"]
    assert all(item.get("placement") != "hidden" for item in project_items)
    # List item 的 hidden_values 是"隐藏的列表值"：交付 JSON 既不投递这些值，也不留 hidden_values 键。
    for item in project_items:
        assert item.get("kind") != "list" or "hidden_values" not in item
    assert "秘密值" not in json.dumps(payload, ensure_ascii=False)
    # 照片是内嵌 data URL：交付 JSON 不写（与 v1 的 export_json 口径一致）。
    header_items = payload["header"]["items"]
    assert all(item.get("placement") != "photo" for item in header_items)


def test_no_v1_render_residue_and_same_section_order():
    """质量门：不留 v1 渲染残留；HTML 与 Markdown 的分区标题/顺序同源（同一份 plan）。"""
    document = make_document()
    html = render_html(document)
    markdown = export_markdown(document)
    plain = export_txt(document)
    # v1 的路径是下标（education.0.school）；v2 必须是 item id 路径。
    assert not re.search(r'data-resume-path="[a-z_]+\.[0-9]+\.', html)
    assert "_resume_blocks" not in html
    for text in (html, markdown, plain):
        assert "undefined" not in text
        assert "resume." not in text
    html_titles = re.findall(r'data-role="section_title">([^<]+)<', html)
    markdown_titles = re.findall(r"^## (.+)$", markdown, flags=re.M)
    assert html_titles and html_titles == markdown_titles


def test_export_entries_accept_v1_content():
    """入口接受 v1 ResumeContent：先经 converter 转换再走同一份 plan。"""
    legacy = sample_resume_content()
    html = render_html(legacy)
    markdown = export_markdown(legacy)
    assert legacy.name in html_text(html)
    assert legacy.name in markdown
    payload = json.loads(export_json(legacy))
    assert payload["version"] == 2


def test_html_data_resume_paths_are_v2_item_paths():
    document = make_document()
    html = render_html(document)
    paths = re.findall(r'data-resume-path="([^"]*)"', html)
    assert paths
    for path in paths:
        assert path.startswith("header.") or re.match(
            r"^(education|projects|skills|summary)\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$", path
        ), f"不是 v2 路径：{path}"
        assert not re.match(r"^(education|experience|projects)\.[0-9]+\.[0-9]+$", path)
    # 定位粒度是 item：标签 + 值共享同一路径是契约（同一路径可多次出现）。
    assert "education.ob_edu000001.it_edu000001" in paths
