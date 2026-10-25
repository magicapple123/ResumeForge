# SPDX-License-Identifier: Apache-2.0
"""Word 导出的自建分区渲染（C2/R-79）。

**为什么单独成文件**：``docx_sections.py`` 已贴着 500 行硬预算（``tests/test_file_size_budget.py``
的红线），而"自建分区写什么"与系统分区是两件独立的事——沿用 W21 把学术三节拆到
``docx_academic_sections`` 的同一做法，共用原语仍从 ``docx_blocks`` / ``docx_section_shared`` 取，
不与 ``docx_sections`` 互相 import。

**口径**：系统分区之后输出；分区标题用**内容里的自建定义名**（不走 ``section_titles``——自建
字段名是用户定义的，不属语言包）；条目 = 主文本 + 其余非空字段的「标签：值」行，顺序由
投影层冻结，渲染端不再排序。空列表输出零字节——没有自建分区的旧简历 Word 产物逐字节不变。
"""

from __future__ import annotations

from functools import partial

from .docx_blocks import DocxTheme
from .docx_blocks import _style_color as _color
from .docx_blocks import _style_scale as _scale
from .docx_blocks import meta_line as _meta_line
from .docx_blocks import paragraph as _paragraph
from .docx_blocks import section_title as _section_title
from .docx_blocks import set_run_font as _set_run_font
from .docx_rich import add_rich_runs
from .docx_section_shared import _apply_break, _break_plan, _role
from .pdf_exporter import _PX_TO_PT


def section_custom(
    doc,
    resume,
    *,
    base: float,
    layout,
    accent,
    accent_soft,
    theme: DocxTheme,
    language: str,
    overrides=None,
) -> None:
    """自建大字段独立成栏：标题=大字段名，条目=主文本 + 「标签：值」行。"""
    entry_gap = layout.gap_mm(layout.entry_gap)
    body_style = _role(overrides, "body")
    for section in resume.custom_sections:
        entries = [
            entry
            for entry in section.entries
            if entry.text.strip() or any(line.value.strip() for line in entry.lines)
        ]
        if not entries:
            continue
        _section_title(
            doc,
            section.title,
            base,
            layout,
            accent,
            accent_soft,
            theme=theme,
            style=_role(overrides, "section_title"),
        )
        _apply_break(doc, _break_plan(overrides, "section", section.key))
        for index, entry in enumerate(entries):
            if entry.text.strip():
                node = _paragraph(doc, space_before_mm=entry_gap if index else 0.0)
                add_rich_runs(
                    node,
                    entry.text.strip(),
                    partial(_set_run_font, font_name=theme.font_name),
                    size_pt=base * _PX_TO_PT * _scale(body_style),
                    color=_color(body_style, theme.body_text),
                )
            for line in entry.lines:
                value = line.value.strip()
                if value:
                    _meta_line(doc, f"{line.label}：{value}", base=base, layout=layout, theme=theme)


__all__ = ["section_custom"]
