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

import pypdfium2 as pdfium
import pytest
from app.schemas.resume import ResumeContent
from app.schemas.resume_document_plan import Inline
from app.services.ats_check import check_ats
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import render_html
from app.services.pdf_exporter import build_resume_pdf, font_available
from app.services.pdf_exporter.document_fields import _glyphs
from app.services.resume.resume_rich_text import strip_markers
from app.services.resume.resume_templates import RESUME_TEMPLATES
from app.services.txt_exporter import export_txt
from docx import Document
from pypdf import PdfReader
from test_pdf_exporter import _pdf_with_font

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


_SCRIPT_RE = re.compile(r"<script[\s\S]*?</script[^>]*>", re.IGNORECASE)


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


# ===== 行内字号 / 颜色：`_glyphs` 这条支路（F23）=====

#: 纸面位置 → 该位置在 `_glyphs` 里的 role。lead / trail / subtitle 在 plan 里都是 meta，
#: 但它们是**四个不同的 slot**，所以逐一列出而不是只测一个 meta。
_GLYPH_SLOTS = {
    "正文块": "body",
    "lead（正文前灰字）": "meta",
    "trail（正文后灰字）": "meta",
    "title（条目标题）": "entry_title",
    "meta（条目元信息）": "meta",
    "subtitle（求职意向）": "meta",
    "field_label（字段名）": "field_label",
}


@needs_font
@pytest.mark.parametrize("slot,role", sorted(_GLYPH_SLOTS.items()))
def test_field_glyphs_carry_inline_size_and_color(slot, role):
    """`_glyphs` 是"字段被单独调过样式"时的公共绘制入口（F23）。

    修复前它逐段解析了标记、也把标记剥掉了，但 `run.size` / `run.color` **从未读出来**：
    纸面看不到 `{@…}` 原文，看起来"解析成功"，实际字号与颜色全是字段角色的默认值。
    这里直接量 `_Glyph`，不依赖像素——`(size, color)` 错在哪一段一眼可判。
    """
    pdf = _pdf_with_font()
    segment = Inline(text="甲{@size=0.8,color=#c0392b}乙{@}丙", role=role, path="s.e.f")
    glyphs = _glyphs(pdf, [segment], 14.0, lambda *args, **kwargs: None, "e1")
    middle = [glyph for glyph in glyphs if glyph.text == "乙"]
    plain = [glyph for glyph in glyphs if glyph.text == "甲"]

    assert len(middle) == 1 and len(plain) == 1
    assert middle[0].color == (192, 57, 43), slot
    expected = plain[0].size * 0.8
    assert middle[0].size == pytest.approx(expected), slot


@needs_font
def test_field_glyphs_fall_back_to_the_role_color_for_invalid_hex():
    """非法颜色整份作废（按字面），合法但只给字号时颜色仍取角色回退色。"""
    pdf = _pdf_with_font()
    segment = Inline(text="{@size=0.8}小字{@}", role="meta", path="s.e.f")
    glyphs = _glyphs(pdf, [segment], 14.0, lambda *args, **kwargs: None, "e1")

    assert [glyph.text for glyph in glyphs] == ["小", "字"]
    assert all(glyph.color == pdf.muted_text for glyph in glyphs)


# ===== 六出口 × 四类标记：同一份内容必须说同一件事 =====

ALL_MARKERS = "**负责**{@size=0.9}8 人{@}{@color=#c0392b}红字{@}[官网](https://x.dev)。"


def test_all_four_marker_kinds_agree_across_the_exporters():
    """一份内容同时带加粗 / 字号 / 颜色 / 链接，六个出口逐项对拍。

    F23 的失败方式是"某个纸面位置悄悄丢了样式"：草稿对、精确 PDF 不对。所以这里不按单个
    marker 拆测试，而是让它们**同时出现**——只要任何一个出口少处理一类，对应断言就红。
    """
    content = ResumeContent(name="张三", summary=ALL_MARKERS)

    body = _body(render_html(content, template="classic"))
    assert "<strong>负责</strong>" in body
    assert 'style="font-size:90%"' in body
    assert "color:#c0392b" in body
    assert 'href="https://x.dev"' in body
    assert "**" not in body and "{@" not in body

    pdf_text = _pdf_text(build_resume_pdf(content, template="classic", page_limit=1).content)
    assert "负责" in pdf_text and "红字" in pdf_text
    assert "**" not in pdf_text and "{@" not in pdf_text

    txt = export_txt(content)
    assert "红字" in txt and "**" not in txt and "{@" not in txt
    # TXT 只印链接的 label，不印 URL（与 strip_markers 的口径一致）。
    assert "https://x.dev" not in txt

    document = Document(
        BytesIO(build_resume_docx(content, template="classic", page_limit=1).content)
    )
    docx_text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    assert "红字" in docx_text and "**" not in docx_text and "{@" not in docx_text


@needs_font
def test_pdf_name_never_prints_markers():
    """姓名行不吃行内格式，但**必须**把标记剥掉（F23 顺带收口）。

    修复前 `name_gender` 完全不调 `parse_rich_runs`：`**张三**` 会在纸面上连星号一起印出。
    """
    content = ResumeContent(name="**张三**", phone="13800000000", summary="后端工程师。")

    text = _pdf_text(build_resume_pdf(content, template="classic", page_limit=1).content)

    assert "张三" in text
    assert "**" not in text


def _red_pixels(data: bytes) -> int:
    image = pdfium.PdfDocument(data)[0].render(scale=2).to_pil().convert("RGB")
    return sum(1 for pixel in image.getdata() if pixel[0] > 140 and pixel[1] < 90 and pixel[2] < 90)


@needs_font
def test_pdf_trail_field_keeps_its_inline_color():
    """验收原文：`{@color=#c0392b}` 放在**正文后灰字**，导出后必须出现红色像素。

    正文块的颜色早就有用例（`test_resume_inline_style.py`）；这条守的是"位置换了就丢"。
    """
    from tests.document_export_samples import make_document

    plain = make_document()
    colored = make_document()
    colored["sections"][0]["entries"][0]["items"][6]["value"] = "{@color=#c0392b}全日制红字{@}"

    plain_pdf = build_resume_pdf(plain, template="classic", page_limit=1)
    colored_pdf = build_resume_pdf(colored, template="classic", page_limit=1)
    text = _pdf_text(colored_pdf.content)

    assert "全日制红字" in text
    assert "{@" not in text
    assert _red_pixels(plain_pdf.content) == 0
    assert _red_pixels(colored_pdf.content) > 50  # noqa: PLR2004


@needs_font
def test_pdf_field_head_keeps_inline_color_when_the_field_has_its_own_style():
    """F23 的原始现场：**这一条在修复前必红**。

    只要条目里有一个字段被单独调过样式（`object_roles`），整条头部（title + meta）就改由
    `_glyphs` 绘制；修复前它会把行内颜色丢掉，而正文块（`_styled`）仍然是红的——这正是
    用户说的"有时候生效、有时候不生效，取决于放在纸面哪个位置"。
    """
    from tests.document_export_samples import make_document

    document = make_document()
    # 标题带行内颜色；样式调在**另一个**字段上，只为把绘制切到 `_glyphs` 这条支路。
    document["sections"][0]["entries"][0]["items"][0]["value"] = "{@color=#c0392b}示例大学红字{@}"
    format_config = {
        "object_roles": {"education.ob_edu000001.it_edu000003:meta": {"font_scale": 1.05}}
    }

    styled = build_resume_pdf(
        document, template="classic", page_limit=1, format_config=format_config
    )
    plain_document = make_document()
    plain = build_resume_pdf(plain_document, template="classic", page_limit=1)

    assert "示例大学红字" in _pdf_text(styled.content)
    assert "{@" not in _pdf_text(styled.content)
    assert _red_pixels(plain.content) == 0
    assert _red_pixels(styled.content) > 50  # noqa: PLR2004
