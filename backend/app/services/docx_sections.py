# SPDX-License-Identifier: Apache-2.0
"""Word 导出的七个正文分区渲染（W05 从 `docx_exporter` 拆出）。

**为什么单独成文件**：`docx_exporter.py` 贴着 500 行预算，而"每个分区输出哪些字段"与
"导出入口 / 页数估算 / 页头图片"是两件独立的事。拆出来之后 W05 的字体族、条目间距与
正文/辅助色可以显式穿过每个分区，不必为了几行参数把主文件顶过预算。

**口径**：分区键与顺序来自 `resume_sections`（与 HTML/PDF/Markdown 共用一张表）；
段落级原语（标题 / 条目头 / 项目符号 / 副行）全部来自 `docx_blocks`；本模块只管
"这一节写哪些字段、按什么顺序写"。W21 把学术三节（论文 / 科研项目 / 专利）拆到
`docx_academic_sections`，共用原语在 `docx_section_shared`，注册表仍在这里。
"""

from __future__ import annotations

from functools import partial

from ..schemas.resume import ResumeContent
from .docx_academic_sections import (
    section_credentials,
    section_patents,
    section_publications,
    section_research_projects,
)
from .docx_blocks import (
    DocxTheme,
)
from .docx_blocks import (
    _style_color as _color,
)
from .docx_blocks import (
    _style_scale as _scale,
)
from .docx_blocks import (
    bullets as _bullets,
)
from .docx_blocks import (
    entry_head as _entry_head,
)
from .docx_blocks import (
    meta_line as _meta_line,
)
from .docx_blocks import (
    paragraph as _paragraph,
)
from .docx_blocks import (
    section_title as _section_title,
)
from .docx_blocks import (
    set_run_font as _set_run_font,
)
from .docx_rich import add_rich_runs
from .docx_section_shared import (
    _apply_break,
    _break_plan,
    _join,
    _role,
    profile_meta_lines,
)
from .pdf_exporter import _PX_TO_PT
from .resume.profile_field_lines import profile_field_lines, profile_field_text
from .resume.resume_labels import (
    experience_kind_text,
    field_labels,
    level_text,
    list_separator,
    section_titles,
)


def section_summary(
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
    if resume.summary.strip():
        labels = section_titles(language)
        body_style = _role(overrides, "body")
        _section_title(
            doc,
            labels["summary"],
            base,
            layout,
            accent,
            accent_soft,
            theme=theme,
            style=_role(overrides, "section_title"),
        )
        # W08：总结段不跨页（Word 的 w:keepLines）。
        paragraph = _paragraph(doc, keep_together=True)
        add_rich_runs(
            paragraph,
            resume.summary.strip(),
            partial(_set_run_font, font_name=theme.font_name),
            size_pt=base * _PX_TO_PT * _scale(body_style),
            color=_color(body_style, theme.body_text),
        )


def section_education(
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
    if not resume.education:
        return
    labels = section_titles(language)
    fields = field_labels(language)
    sep = list_separator(language)
    entry_gap = layout.gap_mm(layout.entry_gap)
    _section_title(
        doc,
        labels["education"],
        base,
        layout,
        accent,
        accent_soft,
        theme=theme,
        style=_role(overrides, "section_title"),
    )
    _apply_break(doc, _break_plan(overrides, "section", "education"))
    for index, edu in enumerate(resume.education):
        _object_id = edu.id
        _entry_style = _role(overrides, "entry_title", edu.id)
        _meta_style = _role(overrides, "meta", edu.id)
        _entry_head(
            doc,
            _join([edu.school, edu.major], " · "),
            _join([edu.degree, f"{edu.start_date} - {edu.end_date}"], " · "),
            base=base,
            layout=layout,
            theme=theme,
            space_before_extra_mm=entry_gap if index else 0.0,
            style=_entry_style,
            meta_style=_meta_style,
        )
        _apply_break(doc, _break_plan(overrides, "entry", _object_id))
        if edu.gpa:
            _meta_line(
                doc,
                f"{fields['gpa']}：{edu.gpa}",
                base=base,
                layout=layout,
                theme=theme,
                style=_meta_style,
            )
        if edu.courses:
            _meta_line(
                doc,
                f"{fields['courses']}：{sep.join(edu.courses)}",
                base=base,
                layout=layout,
                theme=theme,
            )
        _bullets(
            doc,
            edu.achievements,
            base=base,
            theme=theme,
            indent_mm=layout.gap_mm(layout.li_indent),
            style=_role(overrides, "body", edu.id),
        )
        profile_meta_lines(
            doc, edu, "education", base=base, layout=layout, theme=theme,
            language=language, style=_meta_style,
        )


def section_experience(
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
    if not resume.experience:
        return
    labels = section_titles(language)
    entry_gap = layout.gap_mm(layout.entry_gap)
    _section_title(
        doc,
        labels["experience"],
        base,
        layout,
        accent,
        accent_soft,
        theme=theme,
        style=_role(overrides, "section_title"),
    )
    _apply_break(doc, _break_plan(overrides, "section", "experience"))
    for index, exp in enumerate(resume.experience):
        _object_id = exp.id
        _entry_style = _role(overrides, "entry_title", exp.id)
        _meta_style = _role(overrides, "meta", exp.id)
        _entry_head(
            doc,
            _join([exp.company, exp.role], " · "),
            f"{exp.start_date} - {exp.end_date}",
            base=base,
            layout=layout,
            theme=theme,
            space_before_extra_mm=entry_gap if index else 0.0,
            style=_entry_style,
            meta_style=_meta_style,
        )
        _apply_break(doc, _break_plan(overrides, "entry", _object_id))
        # A4：实践/服务经历的关系类型（没设置就不多一行，旧产物不变）。
        kind = experience_kind_text(exp.experience_kind, language)
        if kind:
            _meta_line(
                doc,
                f"{field_labels(language)['experience_kind']}：{kind}",
                base=base,
                layout=layout,
                theme=theme,
                style=_meta_style,
            )
        _bullets(
            doc,
            exp.description,
            base=base,
            theme=theme,
            indent_mm=layout.gap_mm(layout.li_indent),
            style=_role(overrides, "body", exp.id),
        )
        profile_meta_lines(
            doc, exp, "experience", base=base, layout=layout, theme=theme,
            language=language, style=_meta_style,
        )


def section_campus(
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
    if not resume.campus_experience:
        return
    labels = section_titles(language)
    entry_gap = layout.gap_mm(layout.entry_gap)
    _section_title(
        doc,
        labels["campus_experience"],
        base=base,
        layout=layout,
        accent=accent,
        accent_soft=accent_soft,
        theme=theme,
        style=_role(overrides, "section_title"),
    )
    _apply_break(doc, _break_plan(overrides, "section", "campus_experience"))
    for index, item in enumerate(resume.campus_experience):
        _object_id = item.id
        _entry_style = _role(overrides, "entry_title", item.id)
        _meta_style = _role(overrides, "meta", item.id)
        _entry_head(
            doc,
            _join([item.organization, item.role], " · "),
            f"{item.start_date} - {item.end_date}",
            base=base,
            layout=layout,
            theme=theme,
            space_before_extra_mm=entry_gap if index else 0.0,
            style=_entry_style,
            meta_style=_meta_style,
        )
        _apply_break(doc, _break_plan(overrides, "entry", _object_id))
        _bullets(
            doc,
            item.description,
            base=base,
            theme=theme,
            indent_mm=layout.gap_mm(layout.li_indent),
            style=_role(overrides, "body", item.id),
        )
        profile_meta_lines(
            doc, item, "campus_experience", base=base, layout=layout, theme=theme,
            language=language, style=_meta_style,
        )


def section_projects(
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
    if not resume.projects:
        return
    labels = section_titles(language)
    fields = field_labels(language)
    sep = list_separator(language)
    entry_gap = layout.gap_mm(layout.entry_gap)
    _section_title(
        doc,
        labels["projects"],
        base,
        layout,
        accent,
        accent_soft,
        theme=theme,
        style=_role(overrides, "section_title"),
    )
    _apply_break(doc, _break_plan(overrides, "section", "projects"))
    for index, project in enumerate(resume.projects):
        _object_id = project.id
        _entry_style = _role(overrides, "entry_title", project.id)
        _meta_style = _role(overrides, "meta", project.id)
        _entry_head(
            doc,
            _join([project.name, project.role], " · "),
            f"{project.start_date} - {project.end_date}",
            base=base,
            layout=layout,
            theme=theme,
            space_before_extra_mm=entry_gap if index else 0.0,
            style=_entry_style,
            meta_style=_meta_style,
        )
        _apply_break(doc, _break_plan(overrides, "entry", _object_id))
        if project.tech_stack:
            _meta_line(
                doc,
                f"{fields['tech_stack']}：{sep.join(project.tech_stack)}",
                base=base,
                layout=layout,
                theme=theme,
            )
        # A4 作品项目：成果类型 + 公开链接（空值不产生空行，旧产物不变）。
        project_meta = _join(
            [
                f"{fields['artifact_type']}：{project.artifact_type}"
                if project.artifact_type
                else "",
                project.public_url,
            ]
        )
        if project_meta:
            _meta_line(doc, project_meta, base=base, layout=layout, theme=theme)
        _bullets(
            doc,
            project.description,
            base=base,
            theme=theme,
            indent_mm=layout.gap_mm(layout.li_indent),
            style=_role(overrides, "body", project.id),
        )
        _bullets(
            doc,
            project.highlights,
            base=base,
            theme=theme,
            indent_mm=layout.gap_mm(layout.li_indent),
            style=_role(overrides, "body", project.id),
        )
        profile_meta_lines(
            doc, project, "projects", base=base, layout=layout, theme=theme,
            language=language, style=_meta_style,
        )


def section_skills(
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
    if not resume.skills:
        return
    labels = section_titles(language)
    _section_title(
        doc,
        labels["skills"],
        base,
        layout,
        accent,
        accent_soft,
        theme=theme,
        style=_role(overrides, "section_title"),
    )
    _apply_break(doc, _break_plan(overrides, "section", "skills"))
    fields = field_labels(language)
    skill_labels = []
    for skill in resume.skills:
        label = level_text(skill.name, skill.level, language)
        extra = profile_field_text(skill, "skills", fields)
        skill_labels.append(f"{label} · {extra}" if extra else label)
    if skill_labels:
        # W08：技能行不跨页（与 PDF 的整行标签一致）。
        paragraph = _paragraph(doc, keep_together=True)
        set_font = partial(_set_run_font, font_name=theme.font_name)
        for index, label in enumerate(skill_labels):
            run = paragraph.add_run(("　" if index else "") + label)
            set_font(run, size_pt=base * layout.tag_font_ratio * _PX_TO_PT, color=accent)


def section_awards(
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
    if not resume.awards:
        return
    labels = section_titles(language)
    _section_title(
        doc,
        labels["awards"],
        base,
        layout,
        accent,
        accent_soft,
        theme=theme,
        style=_role(overrides, "section_title"),
    )
    _apply_break(doc, _break_plan(overrides, "section", "awards"))
    fields = field_labels(language)
    award_lines = [_join([award.name, award.date, award.description]) for award in resume.awards]
    # F8：有新增字段时逐条渲染并在该 award 行之后追加「标签：值」；无新增字段保持原
    # 一次 bullets 的调用形状（旧产物逐字节不变）。
    award_extras = [profile_field_lines(award, "awards", fields) for award in resume.awards]
    if any(award_extras):
        for line, rows in zip(award_lines, award_extras, strict=True):
            _bullets(doc, [line], base=base, theme=theme)
            for label, value in rows:
                _meta_line(doc, f"{label}：{value}", base=base, layout=layout, theme=theme)
    else:
        _bullets(doc, award_lines, base=base, theme=theme)


# 分区键 → 渲染函数。**刻意不用 if/elif 链**：链子里漏掉一个键的表现是"那个分区
# 在 Word 里默默不出现"，而字典缺键会在渲染时直接 KeyError。键名与前端、HTML 模板
# 共用 `resume_sections.py` 里的那一份。
SECTION_RENDERERS = {
    "summary": section_summary,
    "education": section_education,
    "experience": section_experience,
    "campus_experience": section_campus,
    "projects": section_projects,
    "publications": section_publications,
    "research_projects": section_research_projects,
    "patents": section_patents,
    "credentials": section_credentials,
    "skills": section_skills,
    "awards": section_awards,
}
