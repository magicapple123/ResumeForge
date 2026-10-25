# SPDX-License-Identifier: Apache-2.0
"""PDF 的自建分区绘制（C2/R-79）。

HTML / Word / Markdown 都已有自建分区，而服务端 PDF 是 fpdf 直绘（不经过 HTML 模板，
见 `pdf_exporter/__init__.py` 开头的说明），所以这里补一份**绘制**。

**不新增第二套版式口径**：区块标题、正文段、「标签：值」行全部复用
`render._draw_resume` 里已有的原语（通过参数传入的 `body` 与 `style_for`，前者就是
同一份单栏正文绘制），分页 / 字号 / 行距 / 页边距一个都没多出来；本模块只决定"画什么、
按什么顺序画"。顺序由内容冻结（13 个系统分区之后、资料页全局顺序），渲染端不再排序。
没有自建分区时本模块一个字节都不画——旧简历 PDF 逐字节不变。
"""

from __future__ import annotations

from .section_presence import custom_section_has_content


def _entry_has_content(entry) -> bool:
    return bool(entry.text.strip()) or any(line.value.strip() for line in entry.lines)


def draw_custom(pdf, resume, base: float, layout, first_section: bool, style_for, body) -> None:
    """在系统分区之后按内容顺序画自建分区；双栏模板里同样排在 grid 之外（整幅宽）。"""
    leading = layout.header_gap if first_section else layout.section_gap
    entry_gap = layout.gap_mm(layout.entry_gap)
    for section in resume.custom_sections:
        if not custom_section_has_content(section):
            continue
        entries = [entry for entry in section.entries if _entry_has_content(entry)]
        if not entries:
            continue
        pdf.section_title(
            section.title, base, leading_gap=leading, style=style_for("section_title")
        )
        leading = layout.section_gap
        for index, entry in enumerate(entries):
            if index:
                pdf.ln(entry_gap)
            if entry.text.strip():
                body(pdf, entry.text.strip())
            for line in entry.lines:
                value = line.value.strip()
                if value:
                    pdf.meta_line(f"{line.label}：{value}", base, style=style_for("meta"))


__all__ = ["draw_custom"]
