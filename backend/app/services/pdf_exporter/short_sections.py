# SPDX-License-Identifier: Apache-2.0
"""PDF 导出：摘要 / 技能 / 语言能力 / 荣誉奖项这四个"短分区"。

从 `pdf_exporter/render.py` 拆出：该文件贴着 500 行生产代码预算，而这四节都是
"分区标题 + 一小段内容"的短渲染，与 `render.py` 里"逐条目画教育 / 经历 / 项目"的编排
不是同一件事。**拆分是纯搬迁，行为零变化**：绘制语句、调用顺序与参数逐行照搬。

排版参数与角色覆盖仍由调用方解析（`render.py` 是唯一读 `format_config` 的地方），
本模块只接收结果：

- `base` / `labels` / `fields` / `language` / `field_layout`：排版与文案；
- `role_style`：W07 角色/对象样式覆盖（返回 None = 用模板值）；
- `pagination`：W08 分页计划（`keep_with_next` / 强制换页）；
- `body`：摘要正文的 `multi_cell` 由 `render.py` 注入，保证"量的"就是"画的"。

四个函数签名统一为 ``(pdf, leading, *, 上述上下文)``，各函数只用其中几项，其余的
由 ``**_shared`` 吸收——调用方用 `functools.partial` 一次绑定同一份上下文，于是它们
与其余 drawer 一样是 ``drawer(pdf, leading) -> bool``，单栏与双栏两条路径共用同一个
字典（见 `render.py` 的 ``brief()``）。
"""

from __future__ import annotations

from ..resume.profile_field_lines import profile_field_rows
from .media import _join
from .profile_fields import (
    draw_bullets_with_profile_fields,
    language_tag_text,
    skill_tag_text,
)

__all__ = ["draw_awards", "draw_languages", "draw_skills", "draw_summary"]


def draw_summary(
    pdf,
    leading: float,
    *,
    resume,
    base: float,
    labels,
    role_style,
    pagination,
    body,
    **_shared,
) -> bool:
    """摘要：标题 + 整段正文（空摘要零输出）。"""
    text = resume.summary.strip()
    if not text:
        return False
    # W08：标题 + 整段摘要整体预留（keep_together）——页尾不留一行孤行，下一页页首也不留。
    pdf.ensure_title_paragraph(
        text,
        base,
        leading_gap=leading,
        style=role_style("section_title"),
        body_style=role_style("body"),
        keep_lines=pagination.section("summary").keep_with_next,
    )
    pdf.section_title(
        labels["summary"],
        base,
        leading_gap=leading,
        style=role_style("section_title"),
        section="summary",
        keep_lines=pagination.section("summary").keep_with_next,
    )
    body(pdf, text)
    return True


def draw_awards(
    pdf,
    leading: float,
    *,
    resume,
    base: float,
    labels,
    fields,
    role_style,
    pagination,
    field_layout,
    **_shared,
) -> bool:
    """荣誉奖项：每行 "名称 · 时间 · 描述"，多列时按条目几何并排（W4）。"""
    if not resume.awards:
        return False
    pdf.section_title(
        labels["awards"],
        base,
        leading_gap=leading,
        style=role_style("section_title"),
        section="awards",
        keep_lines=pagination.section("awards").keep_with_next,
    )
    award_lines = [_join([award.name, award.date, award.description]) for award in resume.awards]
    draw_bullets_with_profile_fields(
        pdf,
        award_lines,
        [profile_field_rows(a, "awards", fields, field_layout) for a in resume.awards],
        base=base,
        style=role_style("body"),
        section="awards",
        # W4：把分区配置传下去，多列时一行并排画（不传 = 旧的逐行连接）。
        section_key="awards",
        field_layout=field_layout,
        # W4 条目级：把 awards 列表一起传下去，几何按该条实际生效的配置算
        # （与 draw_profile_meta 同一份 `_entry_geometry`）。
        items=resume.awards,
    )
    return True


def draw_skills(
    pdf,
    leading: float,
    *,
    resume,
    base: float,
    labels,
    fields,
    language: str,
    role_style,
    pagination,
    **_shared,
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
    leading: float,
    *,
    resume,
    base: float,
    labels,
    fields,
    language: str,
    role_style,
    pagination,
    **_shared,
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
    # 与技能同一类短标签行：语言（水平 · 证书 · 分数）· 取得时间。
    tags = [
        language_tag_text(item, language, fields)
        for item in resume.languages
        if language_tag_text(item, language, fields)
    ]
    if not tags:
        return False
    pdf.skill_tags(tags, base, style=role_style("body"))
    return True
