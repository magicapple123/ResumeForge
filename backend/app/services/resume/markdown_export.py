# SPDX-License-Identifier: Apache-2.0
"""Markdown 正文导出（A4 从 exporter.py 拆出：主文件贴着 500 行硬预算）。

**口径没有变**：Markdown 是 TXT 的正文来源（txt_exporter 剥标记复用本模块），七个
分区的标题、顺序与字段文案必须与 HTML / PDF / Word 同源——标题来自
resume_labels.section_titles，顺序来自 resume_sections.DEFAULT_SECTION_ORDER，
隐藏条目在正文里一处都不出现（visible_resume 在排版前过滤一次）。

A4 扩展：资格证照（credentials）、作品项目的 public_url/artifact_type、实践经历的
experience_kind 都按分区顺序输出；空值不产生空行，旧产物逐字节不变。
"""

from __future__ import annotations

from collections.abc import Iterable

from ...schemas.resume import ResumeContent
from .resume_labels import (
    DEFAULT_RESUME_LANGUAGE,
    authors_text,
    credential_detail,
    credential_status_text,
    date_range,
    experience_kind_text,
    field_labels,
    gender_text,
    level_text,
    list_separator,
    patent_status_text,
    publication_status_text,
    section_titles,
)
from .resume_sections import DEFAULT_SECTION_ORDER
from .resume_visibility import visible_resume


def _join_bullets(items: Iterable[str]) -> str:
    return "\n".join(f"- {item}" for item in items)


def export_markdown(
    resume: ResumeContent,
    *,
    section_order: list[str] | None = None,
    language: str = DEFAULT_RESUME_LANGUAGE,
) -> str:
    """导出不包含照片的 Markdown 文本。

    照片是**唯一**的例外（内嵌 data URL，放进文本导出没有意义）。除此之外，凡是预览里会
    出现的内容这里都要有——以前漏掉了性别与出生年：预览页眉显示它们、md 里却查无此项，
    属于"同一份简历两个输出说得不一样"（用户报告的正是这类差异，只是发生在别的输出上）。

    ``language`` 决定七个分区标题与字段前缀的文案，与 PDF / Word / HTML 同源
    （``resume_labels``）；缺省 ``zh-CN``，与历史输出**逐字一致**。语言只换词与分隔符，
    **不换标点风格**：英文产物里仍是 `Objective：…` 这种全角冒号，这是附录 A 已明确接受
    的已知瑕疵（本批不做标点本地化）。
    """
    # 投递视角（W06）：隐藏条目在正文里一处都不出现。过滤在排版前做一次，
    # 后面的 writers 只认过滤后的 resume（md 与 txt 共用本函数）。
    resume = visible_resume(resume)
    lines: list[str] = []
    titles = section_titles(language)
    fields = field_labels(language)
    sep = list_separator(language)
    header = resume.name
    # 性别在预览里是姓名后缀（与 `_resume_sections.j2` 的位置一致）。
    if resume.gender:
        header += gender_text(resume.gender, language)
    if resume.job_intent:
        header += f" · {resume.job_intent}"
    lines.append(f"# {header}")
    contacts = " | ".join(
        item
        for item in [
            resume.phone,
            resume.email,
            resume.city,
            resume.birth_year,
            # 主页与 GitHub 在预览/PDF/Word 的页眉里都带字段名前缀印出来，md 少这两项就是
            # "同一份简历两个输出说得不一样"（与性别/出生年那次漏字段同一类问题）。
            f"{fields['github']}：{resume.github}" if resume.github else "",
            f"{fields['website']}：{resume.personal_website}" if resume.personal_website else "",
        ]
        if item
    )
    if contacts:
        lines.append(f"{contacts}\n")

    def write_summary() -> None:
        if resume.summary:
            lines.append(f"## {titles['summary']}\n")
            lines.append(f"{resume.summary}\n")

    def write_education() -> None:
        if resume.education:
            lines.append(f"## {titles['education']}\n")
            for edu in resume.education:
                lines.append(
                    f"### {edu.school} · {edu.major} · {edu.degree}（{edu.start_date} - {edu.end_date}）\n"
                )
                if edu.gpa:
                    lines.append(f"- {fields['gpa']}：{edu.gpa}")
                if edu.courses:
                    lines.append(f"- {fields['courses']}：{sep.join(edu.courses)}")
                lines.append(_join_bullets(edu.achievements))
                lines.append("")

    def write_experience() -> None:
        if resume.experience:
            lines.append(f"## {titles['experience']}\n")
            for exp in resume.experience:
                lines.append(
                    f"### {exp.company} · {exp.role}（{exp.start_date} - {exp.end_date}）\n"
                )
                # A4：实践/服务经历的关系类型（全职/合同/自雇…）；没设置就不多一行。
                kind = experience_kind_text(exp.experience_kind, language)
                if kind:
                    lines.append(f"- {fields['experience_kind']}：{kind}")
                lines.append(_join_bullets(exp.description))
                lines.append("")

    def write_campus_experience() -> None:
        if resume.campus_experience:
            lines.append(f"## {titles['campus_experience']}\n")
            for item in resume.campus_experience:
                lines.append(
                    f"### {item.organization} · {item.role}（{item.start_date} - {item.end_date}）\n"
                )
                lines.append(_join_bullets(item.description))
                lines.append("")

    def write_projects() -> None:
        if resume.projects:
            lines.append(f"## {titles['projects']}\n")
            for project in resume.projects:
                lines.append(
                    f"### {project.name} · {project.role}（{project.start_date} - {project.end_date}）\n"
                )
                if project.tech_stack:
                    lines.append(f"**{fields['tech_stack']}**：{sep.join(project.tech_stack)}")
                # A4 作品项目：成果类型 + 一个公开链接（链接不会被自动抓取）。
                project_meta = " · ".join(
                    item
                    for item in (
                        f"{fields['artifact_type']}：{project.artifact_type}"
                        if project.artifact_type
                        else "",
                        project.public_url,
                    )
                    if item
                )
                if project_meta:
                    lines.append(f"- {project_meta}")
                lines.append(_join_bullets(project.description))
                lines.append(_join_bullets(project.highlights))
                lines.append("")

    def write_skills() -> None:
        if resume.skills:
            lines.append(f"## {titles['skills']}\n")
            lines.append(
                _join_bullets(
                    level_text(skill.name, skill.level, language) for skill in resume.skills
                )
            )
            lines.append("")

    def write_publications() -> None:
        if resume.publications:
            lines.append(f"## {titles['publications']}\n")
            for publication in resume.publications:
                lines.append(f"### {publication.title}\n")
                authors = authors_text(publication.authors, language)
                if authors:
                    lines.append(f"- {authors}")
                meta = " · ".join(
                    item
                    for item in (
                        publication.venue,
                        publication.year,
                        publication_status_text(publication.status, language),
                        publication.volume_pages,
                    )
                    if item
                )
                if meta:
                    lines.append(f"- {meta}")
                if publication.doi:
                    lines.append(f"- {fields['doi']}：{publication.doi}")
                if publication.url:
                    lines.append(f"- {publication.url}")
                if publication.note:
                    lines.append(f"- {publication.note}")
                lines.append("")

    def write_research_projects() -> None:
        if resume.research_projects:
            lines.append(f"## {titles['research_projects']}\n")
            for project in resume.research_projects:
                head = " · ".join(
                    item for item in (project.name, project.role, project.organization) if item
                )
                span = date_range(project.start_date, project.end_date)
                lines.append(f"### {head}" + (f"（{span}）" if span else "") + "\n")
                if project.funding:
                    lines.append(f"- {fields['funding']}：{project.funding}")
                lines.append(_join_bullets(project.description))
                lines.append(_join_bullets(project.outcomes))
                lines.append("")

    def write_patents() -> None:
        if resume.patents:
            lines.append(f"## {titles['patents']}\n")
            for patent in resume.patents:
                lines.append(f"### {patent.title}\n")
                inventors = authors_text(patent.inventors, language)
                if inventors:
                    lines.append(f"- {inventors}")
                meta = " · ".join(
                    item
                    for item in (
                        patent.patent_number,
                        patent.country,
                        patent_status_text(patent.status, language),
                        f"{fields['filed']} {patent.filed_date}" if patent.filed_date else "",
                        f"{fields['granted']} {patent.granted_date}" if patent.granted_date else "",
                    )
                    if item
                )
                if meta:
                    lines.append(f"- {meta}")
                if patent.url:
                    lines.append(f"- {patent.url}")
                lines.append("")

    def write_credentials() -> None:
        if resume.credentials:
            lines.append(f"## {titles['credentials']}\n")
            for credential in resume.credentials:
                lines.append(f"### {credential.name}\n")
                meta = " · ".join(
                    item
                    for item in (
                        credential.issuer,
                        credential_status_text(credential.status, language)
                        if credential.status != "unknown"
                        else "",
                    )
                    if item
                )
                if meta:
                    lines.append(f"- {meta}")
                detail = credential_detail(credential, language)
                if detail:
                    lines.append(f"- {detail}")
                lines.append("")

    def write_awards() -> None:
        if resume.awards:
            lines.append(f"## {titles['awards']}\n")
            lines.append(
                _join_bullets(
                    f"{award.name} · {award.date}"
                    + (f" · {award.description}" if award.description else "")
                    for award in resume.awards
                )
            )
            lines.append("")

    writers = {
        "summary": write_summary,
        "education": write_education,
        "experience": write_experience,
        "campus_experience": write_campus_experience,
        "projects": write_projects,
        "publications": write_publications,
        "research_projects": write_research_projects,
        "patents": write_patents,
        "credentials": write_credentials,
        "skills": write_skills,
        "awards": write_awards,
    }

    # 分区顺序与预览 / PDF / Word 共用同一份定义（见 services/resume/resume_sections.py）。
    # Markdown 与 txt 都从这里出，所以两者的顺序天然一致。
    for section_key in section_order or DEFAULT_SECTION_ORDER:
        writers[section_key]()

    return "\n".join(lines).strip() + "\n"
