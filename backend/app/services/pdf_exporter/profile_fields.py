# SPDX-License-Identifier: Apache-2.0
"""F8 纸面新增字段的 PDF 绘制 helper（render.py / research_render.py 共用）。

**为什么单独成文件**：pdf_exporter/render.py 贴着 500 行硬预算，而"新增字段按什么顺序、
用什么样式画"在两处（主分区与学术分区）是同一件事。这里的 helper 只做绘制，字段顺序与
标签全部来自 services/resume/profile_field_lines 与 resume_labels，不维护第二份映射。

**旧产物逐字节不变**：没有新增字段时两个 helper 都不画任何东西（awards 仍走原来的一次
pdf.bullets 调用形状），与改造前的绘制顺序/段落数完全一致。
"""

from __future__ import annotations

from collections.abc import Sequence

from ..resume.profile_field_lines import profile_field_lines, profile_field_text
from ..resume.resume_labels import level_text


def draw_profile_meta(pdf, item, section_key: str, *, base: float, fields, style=None) -> None:
    """在条目既有内容之后画「标签：值」行（空值跳过；fields = field_labels(language)）。"""
    for label, value in profile_field_lines(item, section_key, fields):
        pdf.meta_line(f"{label}：{value}", base, style=style)


def skill_tag_text(skill, language: str, fields) -> str:
    """技能标签文本：既有「名称（等级）」+ 行内「 · 技能分类：值」（Lead F8 裁决）。"""
    text = level_text(skill.name, skill.level, language)
    extra = profile_field_text(skill, "skills", fields)
    return f"{text} · {extra}" if extra else text


def draw_bullets_with_profile_fields(
    pdf,
    lines: Sequence[str],
    extras: Sequence[Sequence[tuple[str, str]]],
    *,
    base: float,
    style=None,
    section: str | None = None,
) -> None:
    """awards 专用：有新增字段时逐条 bullets + 其后追加标签行；否则保持原一次调用。"""
    if any(extras):
        for line, rows in zip(lines, extras, strict=True):
            pdf.bullets([line], base, style=style, section=section)
            for label, value in rows:
                pdf.meta_line(f"{label}：{value}", base, style=style)
    else:
        pdf.bullets(list(lines), base, style=style, section=section)


__all__ = ["draw_bullets_with_profile_fields", "draw_profile_meta", "skill_tag_text"]
