# SPDX-License-Identifier: Apache-2.0
"""PDF 导出：技能 / 语言能力这两类"短标签行"分区。

从 `pdf_exporter/render.py` 拆出：该文件贴着 500 行硬预算，而这两节共享同一套
"短标签行（`pdf.skill_tags`）"渲染，逻辑自成一节。排版参数与角色样式仍由调用方
传入（render.py 是唯一解析 format_config 的地方），本模块不重新读配置。
"""

from __future__ import annotations

from .profile_fields import language_tag_text, skill_tag_text

__all__ = ["draw_languages", "draw_skills"]


def draw_skills(
    pdf,
    resume,
    *,
    base: float,
    leading: float,
    labels,
    fields,
    language: str,
    role_style,
    pagination,
) -> bool:
    """技能标签行：名称（等级）+ 行内「技能分类」。"""
    if not resume.skills:
        return False
    pdf.section_title(
        labels["skills"],
        base,
        leading_gap=leading,
        style=role_style("section_title"),
        section="skills",
        keep_lines=pagination.section("skills").keep_with_next,
    )
    # 标签文案与预览一致（`level_text`：技能名 + 本语言的等级括号）。用标签绘制而不是
    # 用分隔符连成一行文本——后者在预览里是带底色的小框，导出后却看不出任何标签形状。
    pdf.skill_tags(
        [skill_tag_text(skill, language, fields) for skill in resume.skills],
        base,
        style=role_style("body"),
    )
    return True


def draw_languages(
    pdf,
    resume,
    *,
    base: float,
    leading: float,
    labels,
    fields,
    language: str,
    role_style,
    pagination,
) -> bool:
    """语言能力（2026-10 独立成栏）：与技能同一类短标签行。"""
    if not resume.languages:
        return False
    pdf.section_title(
        labels["languages"],
        base,
        leading_gap=leading,
        style=role_style("section_title"),
        section="languages",
        keep_lines=pagination.section("languages").keep_with_next,
    )
    tags = [
        text for item in resume.languages if (text := language_tag_text(item, language, fields))
    ]
    if not tags:
        return False
    pdf.skill_tags(tags, base, style=role_style("body"))
    return True
