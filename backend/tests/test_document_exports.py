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


# ===== html_text 的标签处理是「确定性解析」而不是正则（CodeQL py/bad-tag-filter） =====
#
# 旧的实现用 `<script.*?</script>` / `<[^>]+>` 三连正则剥标签，漏得很有代表性：大小写
# 混写、`</script >` 带空格、未闭合到文件尾会被当成正文留下来；属性值里出现 `>` 时又会
# 从中间截断，把 `b'>` 这类碎片吐到「纸面文本」里。下面这几条钉的是**解析器行为**：
# 换成标准库 html.parser 后，这些变体一律按 HTML 词法处理，与具体写法无关。


def test_html_text_drops_script_and_style_variants_regex_missed():
    """大小写混写 / `</script >` 带空格 / 属性引号：脚本与样式体都不进纸面文本。"""
    assert html_text("<body><SCRIPT>alert(1)</SCRIPT><p>正文</p></body>") == "正文"
    assert html_text("<body><script>alert(1)</script ><p>正文</p></body>") == "正文"
    assert (
        html_text("<body><script type='text/javascript'>alert(1)</script><p>正文</p></body>")
        == "正文"
    )
    # CSS 里的 `>` 组合选择器不能把 style 块提前截断。
    assert html_text("<body><STYLE>a>b{color:red}</STYLE><h1>标题</h1></body>") == "标题"
    assert html_text("<body><style>.x{}</style><script>y()</script><p>留</p></body>") == "留"


def test_html_text_drops_self_closing_and_unclosed_script():
    """自闭合与未闭合到文件尾：标签本身不进文本，其后的正文照常提取。"""
    # 自闭合 `<script src=x />` 没有内容体：标签被丢弃，后面的段落还在。
    assert html_text("<body><script src=x /><p>正文</p></body>") == "正文"
    # 未闭合的 `<script>`：余下内容都是脚本体，一个字都不吐（与浏览器同向）。
    assert html_text("<body><p>正文</p><script>alert(1)") == "正文"


def test_html_text_does_not_truncate_on_gt_inside_attribute():
    """属性值里的 `>` 不再从中间截断（旧正则 `<[^>]+>` 会吐 `b'>` 碎片）。"""
    assert html_text("<body><div data-resume-path='a>b'>正文</div></body>") == "正文"


def test_html_text_keeps_character_references_verbatim():
    """实体按**原文**保留：不 decode 成 `&` / `'`，与旧实现逐字节一致。"""
    assert (
        html_text("<body><p>&amp; &#x27; &#20013; &lt;b&gt;</p></body>")
        == "&amp; &#x27; &#20013; &lt;b&gt;"
    )


def test_html_text_keeps_tag_boundaries_as_separators():
    """每个标签只当一个分隔符：`<p>a</p><p>b</p>` 仍是 `a b`，不会粘成 `ab`。"""
    assert html_text("<body><p>a</p><p>b</p></body>") == "a b"
    # 长得像 script 的别的标签（`<scriptx>`）不能被当成脚本整体删掉。
    assert html_text("<body><p>正文</p><scriptx>保留</scriptx></body>") == "正文 保留"


def test_html_text_only_reads_after_body_tag():
    """`split("<body>", 1)[-1]` 的既有语义：body 之前的 head/style 不参与提取。"""
    assert (
        html_text("<html><head><style>.a{color:red}</style></head><body><p>正文</p></body></html>")
        == "正文"
    )
    # 没有 `<body>` 时按原样整段解析（与旧实现同口径）。
    assert html_text("<p>正文</p>") == "正文"


def test_html_text_never_emits_a_live_script_tag_from_nested_residue():
    """`<scr<script>ipt>` 这类残片：`<script` 不会被当正文吐出来。"""
    text = html_text("<body><scr<script>ipt>alert(1)</script><p>正文</p></body>")
    assert "<script" not in text
    assert "正文" in text
