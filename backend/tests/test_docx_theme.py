# SPDX-License-Identifier: Apache-2.0
"""W05：Word 导出的字体族名 / 条目间距 / 正文与辅助色（与 HTML/PDF 同源）。

背景：Word 曾把字体写死成"微软雅黑"、正文/辅助色写死成常量的 RGB，与 PDF 的解析
（模板默认 → 用户版式覆盖）各说各话；条目之间也没有模板 .entry 的下边距。W05 把这些
统一到同一份来源：

* 字体族名：读**用户实际所选字体文件**的 name 表（@@render_docx_font_name@@），不嵌入、
  不伪报；查看端没装这一族字体会被替代，属已知边界（能力矩阵 docx.custom_font = approx）。
* 条目间距：按模板 @@entry_gap@@ 写段前距（与 PDF 的 @@pdf.ln(entry_gap)@@ 同源）。
* 正文/辅助色：与 PDF 共用 @@resolve_text@@ / @@resolve_muted@@（版式覆盖 → 模板 → 兜底）。

字体用 @@tests/font_fixtures@@ 现场合成的 @@Test Sans@@（族名固定、不依赖开发机字体），
所以这些断言在 CI 上可重复，也不会把真实字体文件塞进仓库。
"""

from __future__ import annotations

import io
import zipfile

import pytest
from app.schemas.resume import ResumeContent
from app.services.docx_blocks import DOCX_FONT, resolve_docx_font_name
from app.services.docx_exporter import build_resume_docx
from app.services.pdf_exporter import reset_font_cache, resolve_layout
from app.services.pdf_exporter.layout import _PX_TO_MM as _PX_TO_MM_LAYOUT
from app.services.resume.resume_templates import FONT_SCALES
from docx import Document
from docx.shared import RGBColor
from font_fixtures import build_test_font, write_font

FONT_FILE = "TestSans.ttf"
FONT_FAMILY = "Test Sans"
MM_TO_TWIPS = 1440 / 25.4


@pytest.fixture(autouse=True)
def fixed_font():
    write_font(FONT_FILE, build_test_font())
    reset_font_cache()
    yield
    reset_font_cache()


def _resume() -> ResumeContent:
    return ResumeContent(
        name="张三",
        gender="男",
        phone="13800000000",
        email="zhangsan@example.com",
        job_intent="后端工程师",
        summary="**负责**后端服务的设计与交付。",
        experience=[
            {"company": "甲公司", "role": "工程师", "description": ["做了甲。"]},
            {"company": "乙公司", "role": "工程师", "description": ["做了乙。"]},
        ],
        skills=[{"name": "Python", "level": "熟练"}],
    )


def _build(template: str = "classic", **kwargs) -> bytes:
    return build_resume_docx(
        _resume(),
        template=template,
        page_limit=1,
        format_config=kwargs.pop("format_config", {"font": FONT_FILE}),
        **kwargs,
    ).content


def _document(content: bytes):
    return Document(io.BytesIO(content))


def _paragraph(document, needle: str):
    return next(paragraph for paragraph in document.paragraphs if needle in paragraph.text)


# ===== 1. 字体族名：真实族名、不嵌入、缺资源时退回默认 =====


def test_docx_declares_the_selected_fonts_real_family_name():
    """run 的 ascii 与 eastAsia 都写成所选字体的真实族名（中文不回退默认字体）。"""
    content = _build()
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        xml = bundle.read("word/document.xml").decode("utf-8")
    assert ('w:ascii="' + FONT_FAMILY + '"') in xml
    assert ('w:eastAsia="' + FONT_FAMILY + '"') in xml
    assert "微软雅黑" not in xml or FONT_FAMILY in xml


def test_docx_does_not_embed_font_files():
    """python-docx 只写字体名：包里不许出现 word/fonts/*（不伪报"已嵌入"）。"""
    with zipfile.ZipFile(io.BytesIO(_build())) as bundle:
        embedded = [name for name in bundle.namelist() if name.startswith("word/fonts/")]
    assert embedded == [], f"Word 包不应嵌入字体文件：{embedded}"


def test_font_family_is_read_from_the_font_file_not_hardcoded():
    """族名来自字体文件，且"选中的字体被删"时回落当前可用字体而不是留下坏名字。"""
    assert resolve_docx_font_name(FONT_FILE) == FONT_FAMILY
    # 与 PDF 同一条回落规则：字体文件没了 → 用当前可用字体（读它的真实族名）。
    assert resolve_docx_font_name("不存在的字体.ttf") == resolve_docx_font_name(None)


def test_font_family_falls_back_when_no_font_resource_exists(monkeypatch):
    """本机一个可用字体都没有时退回历史默认族名——不伪报一个读不出来的字体。"""
    from app.services import docx_fonts

    monkeypatch.setattr(docx_fonts, "resolve_font_paths", lambda font_key: None)
    assert resolve_docx_font_name("任意.ttf") == DOCX_FONT


# ===== 2. 条目间距：按模板 entry_gap 写段前距 =====


def _entry_space_before(content: bytes, company: str) -> float:
    paragraph = _paragraph(_document(content), company)
    return paragraph.paragraph_format.space_before.twips


def test_docx_entry_spacing_matches_the_template_entry_gap():
    """同分区内第二条的段前距 = 固定段前 + 模板 entry_gap（HTML/PDF 的 .entry 下边距）。"""
    base_px = float(FONT_SCALES["standard"]["base_px"])
    layout = resolve_layout(template="classic", base_px=base_px, format_config={"font": FONT_FILE})
    content = _build()
    first = _entry_space_before(content, "甲公司")
    second = _entry_space_before(content, "乙公司")
    fixed = base_px * _PX_TO_MM_LAYOUT * 0.2 * MM_TO_TWIPS
    gap = layout.gap_mm(layout.entry_gap) * MM_TO_TWIPS

    assert first == pytest.approx(fixed, abs=3.0)
    assert second - first == pytest.approx(gap, abs=3.0)
    assert gap > 100, "classic 的条目间距约 3.2mm，换算成 twips 应远大于 100"


def test_docx_entry_spacing_follows_the_template():
    """换模板（elegant 的 entry_gap 更大）条目间距必须跟着变，而不是写死一个值。"""
    base_px = float(FONT_SCALES["standard"]["base_px"])
    classic = resolve_layout(template="classic", base_px=base_px, format_config=None)
    elegant = resolve_layout(template="elegant", base_px=base_px, format_config=None)
    assert elegant.entry_gap != classic.entry_gap

    for template, layout in (("classic", classic), ("elegant", elegant)):
        content = _build(template)
        gap = _entry_space_before(content, "乙公司") - _entry_space_before(content, "甲公司")
        # twip 取整：每段各自四舍五入，允许 3 twips（≈0.05mm）误差。
        assert gap == pytest.approx(layout.gap_mm(layout.entry_gap) * MM_TO_TWIPS, abs=3.0)


# ===== 3. 正文 / 辅助色：与 PDF 同一份解析 =====


def _run_colors(document, needle: str) -> list[str]:
    paragraph = _paragraph(document, needle)
    return [
        str(run.font.color.rgb)
        for run in paragraph.runs
        if run.font.color is not None and run.font.color.rgb is not None
    ]


def test_docx_body_and_muted_colors_follow_the_layout_overrides():
    """用户的「正文颜色 / 辅助文字颜色」必须真的作用到 Word（此前是写死的两个常量）。"""
    content = _build(
        format_config={"font": FONT_FILE, "text_color": "#112233", "muted_color": "#445566"}
    )
    document = _document(content)

    body = _run_colors(document, "负责")
    muted = _run_colors(document, "后端工程师")
    assert body and body[0] == str(RGBColor(0x11, 0x22, 0x33))
    assert muted and muted[0] == str(RGBColor(0x44, 0x55, 0x66))


def test_docx_colors_come_from_the_template_when_not_overridden():
    """不设颜色时读模板 :root 的 --text/--muted（technical 与 classic 不同）。"""
    from app.services.resume.resume_templates import TEMPLATE_LAYOUT_DEFAULTS

    technical = TEMPLATE_LAYOUT_DEFAULTS["technical"]
    content = _build("technical")
    document = _document(content)
    text_hex = str(technical["text"]).lstrip("#").upper()
    muted_hex = str(technical["muted"]).lstrip("#").upper()

    assert str(RGBColor.from_string(text_hex)) in _run_colors(document, "负责")
    assert str(RGBColor.from_string(muted_hex)) in _run_colors(document, "后端工程师")


# ===== 4. 粗体：片段级 bold run，标记不落进正文 =====


def test_docx_bold_markers_become_bold_runs_without_the_markers():
    document = _document(_build())
    summary = _paragraph(document, "后端服务的设计")
    assert "**" not in summary.text
    bold_runs = [run for run in summary.runs if run.bold]
    assert any("负责" in run.text for run in bold_runs), "**负责** 应落成 bold=True 的 run"
    assert not any("**" in run.text for run in summary.runs)


# ===== 5. 页数估算：与 PDF 用同一份"所选字体" =====


def test_docx_page_estimate_uses_the_selected_font_and_matches_pdf():
    """量高与 PDF 同一份字体解析：同一内容 / 参数下，Word 估算与 PDF 页数差 ≤1。

    此前 Word 的估算用"当前全局字体"（不看这份简历选的字体），于是换了字体之后 PDF 的
    页数变了、Word 的页数提示却没变——两个数字说的不是同一份纸面。
    """
    from app.services.pdf_exporter import build_resume_pdf

    resume = _resume()
    format_config = {"font": FONT_FILE}
    pdf = build_resume_pdf(resume, template="scholar", page_limit=2, format_config=format_config)
    docx = build_resume_docx(resume, template="scholar", page_limit=2, format_config=format_config)

    assert docx.pages is not None
    assert abs(docx.pages - pdf.pages) <= 1
