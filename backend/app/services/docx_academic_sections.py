# SPDX-License-Identifier: Apache-2.0
"""Word 导出的学术分区渲染：论文发表 / 科研项目 / 专利（W21 从 `docx_sections` 拆出）。

**为什么单独成文件**：`docx_sections.py` 在 W14 接入这三个栏目后贴住 500 行预算
（`tests/test_file_size_budget.py` 的硬线），而"科研三节写哪些字段"与其余七个
正文分区是两件独立的事。拆出来之后两边共用 `docx_section_shared` 的原语，
不互相 import，避免循环依赖。

**口径**：与其余分区完全一致——分区键与标题来自 `resume_sections` / `resume_labels`；
段落原语来自 `docx_blocks`；`overrides` 为 `None` 时不写任何属性，旧产物逐字节不变。
"""

from __future__ import annotations

from .docx_blocks import DocxTheme
from .docx_blocks import bullets as _bullets
from .docx_blocks import entry_head as _entry_head
from .docx_blocks import meta_line as _meta_line
from .docx_blocks import section_title as _section_title
from .docx_section_shared import _apply_break, _break_plan, _join, _role
from .resume.resume_labels import (
    authors_text,
    field_labels,
    patent_status_text,
    publication_status_text,
    section_titles,
)


def section_publications(
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
    """论文发表（W14）：题目/作者顺序/期刊年份/状态/DOI/链接全部落 Word。"""
    if not resume.publications:
        return
    labels = section_titles(language)
    _section_title(
        doc,
        labels["publications"],
        base,
        layout,
        accent,
        accent_soft,
        theme=theme,
        style=_role(overrides, "section_title"),
    )
    _apply_break(doc, _break_plan(overrides, "section", "publications"))
    for _index, publication in enumerate(resume.publications):
        _object_id = publication.id
        _entry_head(
            doc,
            publication.title,
            _join(
                [
                    publication.venue,
                    publication.year,
                    publication_status_text(publication.status, language),
                ]
            ),
            base=base,
            layout=layout,
            theme=theme,
        )
        _apply_break(doc, _break_plan(overrides, "entry", _object_id))
        authors = authors_text(publication.authors, language)
        if authors:
            _meta_line(doc, authors, base=base, layout=layout, theme=theme)
        detail = _join(
            [
                publication.volume_pages,
                f"{field_labels(language)['doi']}：{publication.doi}" if publication.doi else "",
                publication.url,
                publication.note,
            ]
        )
        if detail:
            _meta_line(doc, detail, base=base, layout=layout, theme=theme)


def section_research_projects(
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
    """科研项目（W14）：机构/周期/经费 + 描述与成果。"""
    if not resume.research_projects:
        return
    labels = section_titles(language)
    _section_title(
        doc,
        labels["research_projects"],
        base,
        layout,
        accent,
        accent_soft,
        theme=theme,
        style=_role(overrides, "section_title"),
    )
    _apply_break(doc, _break_plan(overrides, "section", "research_projects"))
    for _index, project in enumerate(resume.research_projects):
        _object_id = project.id
        _entry_head(
            doc,
            _join([project.name, project.role]),
            _join(
                [
                    project.organization,
                    _join([project.start_date, project.end_date], " - "),
                ]
            ),
            base=base,
            layout=layout,
            theme=theme,
        )
        _apply_break(doc, _break_plan(overrides, "entry", _object_id))
        if project.funding:
            funding = f"{field_labels(language)['funding']}：{project.funding}"
            _meta_line(doc, funding, base=base, layout=layout, theme=theme)
        _bullets(doc, project.description, base=base, theme=theme)
        _bullets(doc, project.outcomes, base=base, theme=theme)


def section_patents(
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
    """专利（W14）：名称/专利号/国家/状态/发明人/日期/链接。"""
    if not resume.patents:
        return
    labels = section_titles(language)
    _section_title(
        doc,
        labels["patents"],
        base,
        layout,
        accent,
        accent_soft,
        theme=theme,
        style=_role(overrides, "section_title"),
    )
    _apply_break(doc, _break_plan(overrides, "section", "patents"))
    for _index, patent in enumerate(resume.patents):
        _object_id = patent.id
        _entry_head(
            doc,
            patent.title,
            _join(
                [patent.patent_number, patent.country, patent_status_text(patent.status, language)]
            ),
            base=base,
            layout=layout,
            theme=theme,
        )
        _apply_break(doc, _break_plan(overrides, "entry", _object_id))
        inventors = authors_text(patent.inventors, language)
        if inventors:
            _meta_line(doc, inventors, base=base, layout=layout, theme=theme)
        detail = _join(
            [
                f"{field_labels(language)['filed']} {patent.filed_date}"
                if patent.filed_date
                else "",
                f"{field_labels(language)['granted']} {patent.granted_date}"
                if patent.granted_date
                else "",
                patent.url,
            ]
        )
        if detail:
            _meta_line(doc, detail, base=base, layout=layout, theme=theme)
