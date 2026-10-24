# SPDX-License-Identifier: Apache-2.0
"""W14 科研三栏目的 PDF 绘制（从 render.py 拆出：主文件贴着 500 行预算）。

只消费 canvas 的四个公共绘制原语（section_title / entry_head / meta_line / bullets），
不读原始 format_config：角色/分页/可见性过滤都在上层 ``_draw_resume`` 已处理完。
作者顺序即署名顺序；本人用加粗（``**`` 标记沿既有 rich text 收口）；状态用正名表
（under_review 绝不显示成"已发表"）。
"""

from __future__ import annotations

from ..resume.resume_labels import (
    authors_text,
    date_range,
    field_labels,
    patent_detail,
    patent_status_text,
    publication_detail,
    publication_status_text,
)


def _join(values, separator: str = " · ") -> str:
    return separator.join(str(item).strip() for item in values if str(item).strip())


def draw_publications(pdf, resume, *, base: float, leading: float, labels, language: str) -> bool:
    """论文发表：题目加粗 + 期刊/年份/状态；作者行（本人加粗）+ DOI/链接。"""
    if not resume.publications:
        return False
    pdf.section_title(labels["publications"], base, leading_gap=leading, section="publications")
    for publication in resume.publications:
        pdf.entry_head(
            publication.title,
            _join(
                [
                    publication.venue,
                    publication.year,
                    publication_status_text(publication.status, language),
                ]
            ),
            base,
            section="publications",
            object_id=publication.id,
        )
        authors = authors_text(publication.authors, language)
        if authors:
            pdf.meta_line(authors, base)
        detail = publication_detail(publication, language)
        if detail:
            pdf.meta_line(detail, base)
    return True


def draw_research_projects(
    pdf, resume, *, base: float, leading: float, labels, language: str
) -> bool:
    """科研项目：名称/角色/机构/周期 + 经费 + 描述与成果列表。"""
    if not resume.research_projects:
        return False
    pdf.section_title(
        labels["research_projects"], base, leading_gap=leading, section="research_projects"
    )
    for project in resume.research_projects:
        pdf.entry_head(
            _join([project.name, project.role]),
            _join([project.organization, date_range(project.start_date, project.end_date)]),
            base,
            section="research_projects",
            object_id=project.id,
        )
        if project.funding:
            pdf.meta_line(f"{field_labels(language)['funding']}：{project.funding}", base)
        pdf.bullets(project.description, base, section="research_projects", object_id=project.id)
        pdf.bullets(project.outcomes, base, section="research_projects", object_id=project.id)
    return True


def draw_patents(pdf, resume, *, base: float, leading: float, labels, language: str) -> bool:
    """专利：名称 + 专利号/国家/状态；发明人行 + 申请/授权日期与链接。"""
    if not resume.patents:
        return False
    pdf.section_title(labels["patents"], base, leading_gap=leading, section="patents")
    for patent in resume.patents:
        pdf.entry_head(
            patent.title,
            _join(
                [
                    patent.patent_number,
                    patent.country,
                    patent_status_text(patent.status, language),
                ]
            ),
            base,
            section="patents",
            object_id=patent.id,
        )
        inventors = authors_text(patent.inventors, language)
        if inventors:
            pdf.meta_line(inventors, base)
        detail = patent_detail(patent, language)
        if detail:
            pdf.meta_line(detail, base)
    return True


__all__ = ["draw_patents", "draw_publications", "draw_research_projects"]
