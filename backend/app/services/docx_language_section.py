# SPDX-License-Identifier: Apache-2.0
"""Word 导出：语言能力分区（2026-10 独立成栏）。

从 `docx_sections.py` 拆出：该文件贴着 500 行硬预算，而语言能力与技能是同一类
"短标签行"，渲染逻辑自成一节。这里只做"这一节写哪些字段、按什么顺序写"；段落级
原语仍来自 `docx_blocks` / `docx_section_shared`，与其它分区同一套。

口径：一行一条 `语言（水平 · 证书 · 分数）`，取得时间作为行尾元信息；空字段不产生
多余分隔符（与 HTML / PDF / Markdown 同一字段顺序）。
"""

from __future__ import annotations

from functools import partial

from ..schemas.resume import ResumeContent
from .docx_blocks import DocxTheme
from .docx_blocks import paragraph as _paragraph
from .docx_blocks import section_title as _section_title
from .docx_blocks import set_run_font as _set_run_font
from .docx_section_shared import _apply_break, _break_plan, _role
from .pdf_exporter import _PX_TO_PT
from .resume.resume_labels import field_labels, level_text, section_titles

__all__ = ["section_languages"]


def section_languages(
    doc,
    resume: ResumeContent,
    *,
    base: float,
    layout,
    accent,
    accent_soft,
    theme: DocxTheme,
    language: str,
    overrides=None,
) -> None:
    """语言能力：一行一条，样式沿用技能行的"短标签行"。"""
    if not resume.languages:
        return
    labels = section_titles(language)
    fields = field_labels(language)
    _section_title(
        doc,
        labels["languages"],
        base,
        layout,
        accent,
        accent_soft,
        theme=theme,
        style=_role(overrides, "section_title"),
    )
    _apply_break(doc, _break_plan(overrides, "section", "languages"))
    rows: list[str] = []
    for item in resume.languages:
        detail = " · ".join(part for part in (item.level, item.certificate, item.score) if part)
        label = level_text(item.name, detail, language) if item.name else detail
        if item.obtained_at:
            obtained = f"{fields['obtained']}：{item.obtained_at}"
            label = f"{label} · {obtained}" if label else obtained
        if label:
            rows.append(label)
    if not rows:
        return
    # W08：短标签行不跨页（与 PDF 的整行标签一致）。
    paragraph = _paragraph(doc, keep_together=True)
    set_font = partial(_set_run_font, font_name=theme.font_name)
    for index, label in enumerate(rows):
        run = paragraph.add_run(("　" if index else "") + label)
        set_font(run, size_pt=base * layout.tag_font_ratio * _PX_TO_PT, color=accent)
