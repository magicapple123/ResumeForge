# SPDX-License-Identifier: Apache-2.0
"""行内字号/颜色（R-11）：`{@size=0.9,color=#c00}…{@}` 的解析与四个出口。

协议只有这一份定义（`resume_inline_style`），其余模块只消费 `parse_rich_runs`。
本文件钉五件事：

1. 属性白名单：非法 size/color/未知键整份作废，按字面保留；
2. 嵌套：内层覆盖同名属性，未设的沿用外层；
3. 未闭合：整段按字面（不把后面的文字整片染色）；
4. 与既有加粗/链接共存（`**{@size=0.9}x{@}**`）；
5. 三个出口都真的生效：HTML 出 style、Word 出 run 字号/颜色、PDF 出现红色像素。
"""

from __future__ import annotations

import io
import re
import zipfile

import pypdfium2 as pdfium
from app.schemas.resume import ResumeContent
from app.schemas.resume_document_plan import Inline
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import export_markdown
from app.services.pdf_exporter.fit import build_resume_pdf
from app.services.resume.document_converter import ensure_document_version
from app.services.resume.document_plan import build_document_plan, plan_to_text
from app.services.resume.document_plan_format import plain_text
from app.services.resume.resume_inline_style import (
    InlineStyle,
    mask_inline_styles,
    parse_style,
    split_masked,
    strip_style_markers,
)
from app.services.resume.resume_rich_text import (
    apply_rich_html,
    parse_rich_runs,
    strip_markers,
)
from app.services.txt_exporter import export_txt

TEXT = "带 {@size=0.9}8 人{@}团队，{@color=#c0392b}红字{@}。"


def test_parse_style_whitelists_attributes():
    assert parse_style("size=0.9") == InlineStyle(0.9, None)
    assert parse_style("color=#C0392B") == InlineStyle(None, "#c0392b")
    assert parse_style(" size = 0.9 , color = #c00 ") == InlineStyle(0.9, "#c00")
    # 越界 / 非数值 / 未知键 / 空属性一律作废（整份），交给"按字面"分支。
    assert parse_style("size=9") is None
    assert parse_style("size=abc") is None
    assert parse_style("color=red") is None
    assert parse_style("weight=bold") is None
    assert parse_style("") is None


def test_mask_and_split_round_trip():
    masked, styles = mask_inline_styles(TEXT)
    assert len(styles) == 2
    assert "size=0.9" not in masked and "color=#c0392b" not in masked
    pieces = split_masked(masked, styles)
    assert [text for text, _style in pieces] == ["带 ", "8 人", "团队，", "红字", "。"]
    assert pieces[1][1] == InlineStyle(0.9, None)
    assert pieces[3][1] == InlineStyle(None, "#c0392b")


def test_nested_styles_merge_and_unclosed_stays_literal():
    merged = [span for span in parse_rich_runs("{@size=0.9}{@color=#c00}8 人{@}{@}") if span.text]
    assert len(merged) == 1
    assert (merged[0].size, merged[0].color) == (0.9, "#c00")

    # 未闭合：整段按字面，一个样式都不生效。
    broken = parse_rich_runs("坏 {@size=0.9} 未闭合")
    assert "".join(span.text for span in broken) == "坏 {@size=0.9} 未闭合"
    assert all(span.size is None and span.color is None for span in broken)


def test_styles_compose_with_bold_and_links():
    spans = parse_rich_runs("**粗里带 {@size=0.9}小字{@}**")
    assert [span.text for span in spans] == ["粗里带 ", "小字"]
    assert all(span.bold for span in spans)
    assert spans[1].size == 0.9

    linked = parse_rich_runs("[{@color=#c00}官网{@}](https://x.dev)")
    assert len(linked) == 1
    assert linked[0].link == "https://x.dev"
    assert linked[0].color == "#c00"


def test_strip_and_html_projections():
    assert strip_markers(TEXT) == "带 8 人团队，红字。"
    html = apply_rich_html(TEXT)
    assert 'style="font-size:90%"' in html
    assert 'style="color:#c0392b"' in html
    assert "{@" not in html


def test_docx_runs_carry_size_and_color():
    content = ResumeContent(name="张三", summary=TEXT)
    data = build_resume_docx(content, template="classic", format_config=None).content
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        xml = archive.read("word/document.xml").decode("utf-8")
    assert "C0392B" in xml.upper()
    # 0.9× 的 run 字号比正文小：XML 里应出现两种 `w:sz`（半磅值），小的约等于大的 0.9 倍。
    sizes = sorted({int(value) for value in re.findall(r'w:sz w:val="(\d+)"', xml)})
    assert len(sizes) >= 2, sizes
    # 文档里同时有姓名/标题等字号，所以要在**任意一对**里找 0.9 倍的关系。
    assert any(
        abs(small / large - 0.9) < 0.05 for small in sizes for large in sizes if large > small
    ), sizes


def _red_pixels(data: bytes) -> int:
    image = pdfium.PdfDocument(data)[0].render(scale=2).to_pil().convert("RGB")
    return sum(1 for pixel in image.getdata() if pixel[0] > 140 and pixel[1] < 90 and pixel[2] < 90)


def test_pdf_draws_styled_runs_without_leaking_markers():
    styled = build_resume_pdf(
        ResumeContent(name="张三", summary=TEXT), template="classic", format_config=None
    )
    plain = build_resume_pdf(
        ResumeContent(name="张三", summary="带 8 人团队，红字。"),
        template="classic",
        format_config=None,
    )
    text = "\n".join(
        page.get_textpage().get_text_range() for page in pdfium.PdfDocument(styled.content)
    )
    assert "{@" not in text and "\ue000" not in text
    assert "8 人" in text and "红字" in text
    assert styled.pages == plain.pages
    # 只有带样式的那份出现红色像素。
    assert _red_pixels(styled.content) > 100  # noqa: PLR2004
    assert _red_pixels(plain.content) == 0


# ===== F22：字段名带标记时的纯文本出口 =====
#
# 字段名开放编辑之后，`item.label` 里可能出现 `**` 与 `{@size=…}`。纸面（HTML/PDF/Word）
# 走解析、没问题；纯文本出口（TXT / Markdown / plan_to_text）以前是原串拼接，会把标记
# 印出来。这里逐个出口钉住"标记不泄漏、可见文字不少一个字符"。


def _labelled_document() -> dict:
    """一份最小值简历，把「专业」的字段名改成带标记的串。"""
    document = ensure_document_version(
        {
            "name": "张三",
            "phone": "13800000000",
            "job_intent": "后端工程师",
            "education": [
                {
                    "school": "上海大学",
                    "major": "市场营销",
                    "degree": "本科",
                    "start_date": "2017-09",
                    "end_date": "2021-06",
                }
            ],
        }
    )
    for section in document["sections"]:
        for entry in section.get("entries", []):
            for item in entry.get("items", []):
                if item.get("key") == "major":
                    item["label"] = "**专业**{@size=0.9}方向{@}"
                    item["show_label"] = True
                    # 标签只有落在 lead/trail 行才印在纸面上（title 行只拼值）。
                    item["placement"] = "trail"
                    # title 位不印字段名（`item_inlines` 只服务 lead/trail），挪到 trail。
                    item["placement"] = "trail"
    return document


def test_strip_style_markers_keeps_visible_text_and_bold():
    assert strip_style_markers("带 {@size=0.9}8 人{@}**团队**") == "带 8 人**团队**"
    # 没有标记时逐字不变（历史产物不受影响）
    plain = "带 8 人团队"
    assert strip_style_markers(plain) is plain or strip_style_markers(plain) == plain
    # 未闭合 / 非法属性：整段按字面保留（与解析侧的退化口径一致）
    assert strip_style_markers("{@size=0.9}未闭合") == "{@size=0.9}未闭合"
    assert strip_style_markers("{@size=9}越界{@}") == "{@size=9}越界{@}"


def test_markdown_keeps_bold_but_drops_style_markers():
    markdown = export_markdown(_labelled_document())
    assert "{@" not in markdown
    assert "\ue000" not in markdown
    # Markdown 是有格式的出口：加粗标记要留给它自己。
    assert "**专业**" in markdown
    assert "专业方向" in markdown.replace("**", "")


def test_txt_has_no_markers_at_all():
    text = export_txt(_labelled_document())
    assert "{@" not in text
    assert "**" not in text
    assert "专业方向：市场营销" in text


def test_plain_text_strips_markers_on_a_single_segment():
    """纯文本出口的单元级守卫：字段名段里的标记必须先剥再拼。"""
    segments = [
        Inline(text="**专业**{@size=0.9}方向{@}", role="field_label", path=""),
        Inline(text="：市场营销", role="meta", path=""),
    ]
    assert plain_text(segments) == "专业方向：市场营销"


def test_plan_to_text_strips_field_label_markers():
    plan = build_document_plan(_labelled_document())
    lines = plan_to_text(plan)
    joined = "\n".join(lines)

    assert "{@" not in joined and "**" not in joined
    assert any("专业方向：市场营销" in line for line in lines), lines
