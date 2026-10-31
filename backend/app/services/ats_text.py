# SPDX-License-Identifier: Apache-2.0
"""ATS searchable text, shared by keyword matching and rule callers."""

from ..schemas.resume import ResumeContent
from .ats_research import credential_section_texts, research_section_texts
from .resume.resume_rich_text import strip_markers

_SECTION_ORDER = (
    "summary",
    "education",
    "experience",
    "campus_experience",
    "projects",
    "publications",
    "research_projects",
    "patents",
    "credentials",
    "skills",
    "languages",
    "awards",
)


def _join_parts(*parts: str) -> str:
    """拼接可检索文本；**先剥字符级加粗标记**。

    关键词匹配比的是用户读到的字。``**Python**`` 里的标记会让 ``Python`` 与
    ``**Python**`` 变成两个不同的串，词库命中率凭空下降——同一个词在预览里加粗一次，
    ATS 分数就掉一档，这种"看不见的扣分"最难解释。
    """
    return strip_markers(" ".join(part for part in parts if part and part.strip()))


def _section_texts(resume: ResumeContent | dict) -> dict[str, str]:
    """十个分区的可检索文本（保持字段原貌，匹配时再转小写）。

    分区的划分与简历模板一致：``sections`` 字段就是按这份清单报出来的，前端据此
    告诉用户"这个词出现在技能区"而不是笼统说"出现在简历里"。
    """
    if isinstance(resume, dict):
        from .resume.document_view import section_texts

        return {
            key: strip_markers(value)
            for key, value in {**dict.fromkeys(_SECTION_ORDER, ""), **section_texts(resume)}.items()
        }
    return {
        "summary": strip_markers(resume.summary),
        "education": _join_parts(
            *[
                _join_parts(
                    item.school,
                    item.major,
                    item.degree,
                    item.gpa,
                    " ".join(item.courses),
                    " ".join(item.achievements),
                )
                for item in resume.education
            ]
        ),
        "experience": _join_parts(
            *[
                _join_parts(item.company, item.role, " ".join(item.description))
                for item in resume.experience
            ]
        ),
        "campus_experience": _join_parts(
            *[
                _join_parts(item.organization, item.role, " ".join(item.description))
                for item in resume.campus_experience
            ]
        ),
        "projects": _join_parts(
            *[
                _join_parts(
                    item.name,
                    item.role,
                    " ".join(item.tech_stack),
                    " ".join(item.description),
                    " ".join(item.highlights),
                )
                for item in resume.projects
            ]
        ),
        **research_section_texts(resume),
        **credential_section_texts(resume),
        "skills": _join_parts(*[_join_parts(item.name, item.level) for item in resume.skills]),
        "languages": _join_parts(
            *[
                _join_parts(item.name, item.level, item.certificate, item.score)
                for item in resume.languages
            ]
        ),
        "awards": _join_parts(
            *[_join_parts(item.name, item.description) for item in resume.awards]
        ),
    }


def _header_text(resume: ResumeContent | dict) -> str:
    """页头字段（姓名/求职意向/联系方式/主页）：不含 photo，且不参与分区归属判断。"""
    if isinstance(resume, dict):
        from .resume.document_view import header_text

        return _join_parts(
            *(
                header_text(resume, key)
                for key in (
                    "name",
                    "job_intent",
                    "intent",
                    "city",
                    "phone",
                    "email",
                    "personal_website",
                    "github",
                )
            )
        )
    return _join_parts(
        resume.name,
        resume.job_intent,
        resume.city,
        resume.phone,
        resume.email,
        resume.personal_website,
        resume.github,
    )


def _resume_text(resume: ResumeContent | dict) -> str:
    """简历全量可检索文本（小写，排除 photo）。"""
    sections = _section_texts(resume)
    return f"{_header_text(resume)} {' '.join(sections.values())}".lower()
