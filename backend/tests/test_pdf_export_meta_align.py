# SPDX-License-Identifier: Apache-2.0
"""#5：日期位置（``meta_align``）的**端到端**守卫——从内容到 PDF 字节的整条导出链路。

**为什么还需要这个文件**：``test_pdf_exporter_style.py`` 只测绘制原语
（``_ResumePDF.entry_head`` 直接给 ``RoleStyle(meta_align=...)``），所以它证不了
"用户在面板里设的日期位置真的走到了纸上"。审计用真实导出测量时看到两档 Δx=0
（设置等于没生效）而单测全绿——差别就在"覆盖是否从 ``format_config`` 一路传到
``draw_entry_head``"这一段，没有任何用例覆盖。

本文件只做一件事：用**示例简历 + 真实 planner 的对象 id** 造 ``format_config``，
调 ``build_resume_pdf`` 拿真实产物，再从 PDF 内容流里量日期横坐标。它守的是接线，
不是绘制算法（绘制算法由 style_blocks 的用例守）。
"""

import re
from io import BytesIO

from app.services.pdf_exporter import build_resume_pdf
from app.services.resume.document_html import coerce_document
from app.services.resume.document_plan import build_document_plan
from app.services.resume.resume_sample import sample_resume_content
from pypdf import PdfReader
from test_pdf_exporter import needs_font

# 「日期长什么样」只认形状（``YYYY.MM``）：具体年月属于示例内容，不抄进断言里。
_DATE_RE = re.compile(r"\d{4}[.\-/]\d{1,2}")


def _plan():
    """示例简历 -> 真实 DocumentPlan（与 ``build_resume_pdf`` 内部同一条转换链）。"""
    content = sample_resume_content("standard", "classic")
    document = coerce_document(content, language="zh-CN", format_config=None)
    return content, build_document_plan(document, None, "zh-CN")


def _inline_text(segments) -> str:  # noqa: ANN001 - Inline 序列，与渲染器同口径
    """与 ``document_render.inline_text`` 同口径的朴素拼接（只用于取量具文本）。"""
    from app.services.pdf_exporter.document_render import inline_text

    return inline_text(segments)


def _date_entry() -> tuple[object, str, str]:
    """挑一个「左标题 + 右侧日期」的 split 条目，返回 ``(内容, 对象 id, 日期文本)``。

    示例简历里"教育"把日期折进了标题行内（``本科 · 2019.09 - 2023.06``），量它看不出
    ``meta_align`` 的差别——那种行内日期本来就不受该设置管辖。所以按**文字形状**
    （meta 里出现 ``YYYY.MM`` 且标题非空）挑，而不是写死某个板块键。
    """
    content, plan = _plan()
    for section in plan.sections:
        for entry in section.entries:
            metatext = _inline_text(entry.head.meta).strip()
            titletext = _inline_text(entry.head.title).strip()
            if entry.head.layout == "split" and titletext and _DATE_RE.search(metatext):
                return content, entry.id, metatext
    raise AssertionError("示例简历里没有「标题 + 日期」的 split 条目，无法验证日期位置")


def _export(content, object_id: str, meta_align: str) -> bytes:  # noqa: ANN001
    """按"用户设了某个条目的日期位置"这一份 format_config 真实导出一份 PDF。"""
    pdf = build_resume_pdf(
        content,
        template="classic",
        page_limit=2,
        font_scale="standard",
        language="zh-CN",
        format_config={"objects": {object_id: {"meta_align": meta_align}}},
    )
    return pdf.content


def _meta_x(pdf_bytes: bytes, needle: str) -> float:
    """PDF 里含 ``needle`` 的那段文字的横坐标（pt，原点在左上角）。"""
    reader = PdfReader(BytesIO(pdf_bytes))
    hits: list[float] = []

    def visit(text, cm, tm, font_dict, font_size) -> None:  # noqa: ANN001 - pypdf 回调签名
        # fpdf2 对 CID-keyed CFF 字体会让 pypdf 读出前置 U+0000（见 test_pdf_exporter 注释）；
        # 几何（tm[4]）不受影响，剥掉 NUL 才能做文本匹配。
        if needle in text.replace("\x00", ""):
            hits.append(float(tm[4]))

    for page in reader.pages:
        page.extract_text(visitor_text=visit)
    assert len(hits) == 1, f"日期「{needle}」在 PDF 里出现 {len(hits)} 次，量具不唯一：{hits}"
    return hits[0]


@needs_font
def test_export_meta_align_changes_the_date_position_on_the_paper():
    """inline ↔ right 两档必须真的改动纸面日期位置（旧审计实测 Δx=0）。"""
    content, object_id, metatext = _date_entry()
    inline_pdf = _export(content, object_id, "inline")
    right_pdf = _export(content, object_id, "right")

    inline_x = _meta_x(inline_pdf, metatext)
    right_x = _meta_x(right_pdf, metatext)

    delta = right_x - inline_x
    assert delta >= 20.0, (
        f"日期位置设置没有生效：inline x={inline_x:.2f}pt、right x={right_x:.2f}pt，"
        f"差值仅 {delta:.2f}pt（要求 ≥20pt）"
    )
    # 「紧随标题」就是把日期拽到标题右侧，而不是只让开一个栏间距；这里要求 inline 的
    # 起点明显靠左（不到 right 的八成），避免只对齐了一点点也算过。
    assert inline_x <= right_x * 0.8, (
        f"inline 日期没有贴到标题右侧：inline x={inline_x:.2f}pt vs right x={right_x:.2f}pt"
    )
    # 弱断言：两档产物必须不是同一串字节（防"设置被静默丢弃但仍然复用了旧产物"）。
    assert inline_pdf != right_pdf, "两档日期位置导出的 PDF 字节完全相同，覆盖没有进入产物"
