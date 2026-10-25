# SPDX-License-Identifier: Apache-2.0
"""W14 科研三栏目的 ATS 可检索文本（从 ats_keywords.py 拆出：主文件贴着 500 行预算）。

只回答"这三个板块里哪些字可以参与关键词匹配"，不参与匹配算法本身；分区键从
``ats_keywords._SECTION_ORDER`` 的同一份命名（publications / research_projects / patents）。
"""

from __future__ import annotations

from typing import Any


def _join(*parts: str) -> str:
    return " ".join(part for part in parts if part and part.strip())


def _authors(authors) -> str:
    return _join(*(author.name for author in authors))


def research_section_texts(resume: Any) -> dict[str, str]:
    """三个科研分区各自的全部可检索文本（题目/作者/期刊/状态/DOI/专利号等）。"""
    return {
        "publications": _join(
            *(
                _join(
                    publication.title,
                    _authors(publication.authors),
                    publication.venue,
                    publication.year,
                    publication.doi,
                    publication.volume_pages,
                    publication.note,
                )
                for publication in resume.publications
            )
        ),
        "research_projects": _join(
            *(
                _join(
                    project.name,
                    project.role,
                    project.organization,
                    project.funding,
                    " ".join(project.description),
                    " ".join(project.outcomes),
                )
                for project in resume.research_projects
            )
        ),
        "patents": _join(
            *(
                _join(
                    patent.title,
                    _authors(patent.inventors),
                    patent.patent_number,
                    patent.country,
                    patent.url,
                )
                for patent in resume.patents
            )
        ),
    }


def credential_section_texts(resume: Any) -> dict[str, str]:
    """A4 资格证照的可检索文本（名称/颁发机构/日期/状态/说明）。

    **不含 credential_number**：模型与导出里都没有这个字段（见
    schemas/resume_credentials.py），ATS 文本自然也不该凭空找它。
    """
    return {
        "credentials": _join(
            *(
                _join(
                    credential.name,
                    credential.issuer,
                    credential.issue_date,
                    credential.expiry_date,
                    credential.verify_url,
                    credential.note,
                )
                for credential in resume.credentials
            )
        )
    }


__all__ = ["credential_section_texts", "research_section_texts"]
