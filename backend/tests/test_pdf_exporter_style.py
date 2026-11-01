# SPDX-License-Identifier: Apache-2.0
"""PDF 的局部排版落地（Q11）：正文加粗 / 字距 / 段落缩进。

从 test_pdf_exporter.py 拆出（2026-10-31，纯搬迁）：原文件超过 500 行预算；
本组用例只守 W07 对象的正文级属性在 PDF 里的绘制结果（字体面 / Tc 操作符 / 左缘偏移），
字体与画布夹具复用主文件的 _pdf_with_font（"画的就是量的"同一套来源）。
"""

from io import BytesIO

import pytest
from app.services.resume.resume_style import RoleStyle
from pypdf import PdfReader
from test_pdf_exporter import _MM_TO_PT, _PX_TO_MM, _pdf_with_font, _text_runs, needs_font

# ===== Q11：PDF 正文加粗 / 字距 / 段落缩进（局部排版四出口一致）=====
#
# 2026-10-31 用户口径：同一份局部排版在 HTML / Word / PDF 三个出口必须同效。此前 PDF
# 的段落绘制固定常规字重、无字距、缩进恒 0——面板里调「正文 → 加粗 / 字距 / 缩进」，
# 精确预览与导出都不变。斜体仍不支持（没有斜体字形，保留"不支持"说明）。


def _draw_paragraph_pdf(style) -> bytes:
    """用私有绘制原语画一段正文，返回 PDF 字节（字体/版式与真实导出同一来源）。"""
    from app.services.pdf_exporter.document_render import _draw_paragraph

    pdf = _pdf_with_font()
    _draw_paragraph(pdf, "一段正文文本", base=14.0, style=style, section="experience")
    return bytes(pdf.output())


def _font_runs(content: bytes) -> list[tuple[str, str]]:
    """(字体 BaseFont 名, 文本) 列表：用来区分正文用了常规面还是粗体面。"""
    reader = PdfReader(BytesIO(content))
    runs: list[tuple[str, str]] = []

    def visit(text, cm, tm, font_dict, font_size) -> None:  # noqa: ANN001 - pypdf 回调签名
        text = text.replace("\x00", "")
        if not text.strip():
            return
        base_font = str((font_dict or {}).get("/BaseFont", ""))
        runs.append((base_font, text))

    for page in reader.pages:
        page.extract_text(visitor_text=visit)
    return runs


def test_pdf_paragraph_indent_offsets_the_left_edge():

    plain = _text_runs(_draw_paragraph_pdf(RoleStyle()))[0]
    indented = _text_runs(_draw_paragraph_pdf(RoleStyle(indent=1.0)))[0]
    expected_pt = 14.0 * 1.0 * _PX_TO_MM * _MM_TO_PT
    assert indented[0] - plain[0] == pytest.approx(expected_pt, abs=0.5)


def test_pdf_paragraph_bold_uses_the_bold_face():

    plain_font = _font_runs(_draw_paragraph_pdf(RoleStyle()))[0][0]
    bold_font = _font_runs(_draw_paragraph_pdf(RoleStyle(bold=True)))[0][0]
    assert plain_font != bold_font


def test_pdf_paragraph_letter_spacing_sets_the_tc_operator():
    """字距 → fpdf2 的 Tc（文档单位 mm），且画完复位成 0（不影响后续段落）。"""

    reader = PdfReader(BytesIO(_draw_paragraph_pdf(RoleStyle(letter_spacing=0.05))))
    data = b"".join(page.get_contents().get_data() for page in reader.pages)
    expected = 14.0 * 0.05 * _PX_TO_MM
    assert f"{expected:.2f} Tc".encode() in data
    assert b"0.00 Tc" in data, "字距用完必须复位，否则后续段落全部被加宽"

def _draw_entry_head_pdf(meta_style) -> bytes:
    """画一条 split 条目头（画布/字体与真实导出同源），返回 PDF 字节。"""

    pdf = _pdf_with_font()
    pdf.entry_head(
        "清华大学 · 计算机科学与技术",
        "2018.09 - 2022.06",
        14.0,
        style=RoleStyle(),
        meta_style=meta_style,
    )
    return bytes(pdf.output())


def _meta_x(content: bytes) -> float:
    for x, _y, _size, text in _text_runs(content):
        if "2018.09" in text:
            return x
    raise AssertionError("PDF 里没找到 meta 日期")


@needs_font
def test_pdf_entry_head_inline_moves_meta_next_to_the_title():
    """#5：日期位置=紧随标题（meta_align=inline）在 PDF 里必须真的挪到标题右侧。

    旧实现 inline 分支把左 cell 给成「版心 - 间距 - meta 宽」，左 cell 几乎占满整行，
    meta 被顶到版心右缘——与 right 档只差一个栏间距（实测 1.4pt），设置等于没生效。
    """

    inline_x = _meta_x(_draw_entry_head_pdf(RoleStyle(meta_align="inline")))
    right_x = _meta_x(_draw_entry_head_pdf(RoleStyle(meta_align="right")))
    assert inline_x < 300.0, f"inline 日期仍停在右缘: x={inline_x}"
    assert right_x > 400.0, f"right 日期没有贴右缘: x={right_x}"
    assert inline_x < right_x - 100.0, "inline 与 right 的日期位置差值太小，设置没生效"


@needs_font
def test_pdf_entry_head_meta_bold_uses_the_bold_face():
    """#5c：meta 角色开启加粗后，PDF 的日期必须用粗体面（旧实现硬编码常规面）。"""

    runs = _font_runs(_draw_entry_head_pdf(RoleStyle(meta_align="inline", bold=True)))
    meta_fonts = [font for font, text in runs if "2018.09" in text]
    assert meta_fonts and all("Bold" in font for font in meta_fonts), meta_fonts

