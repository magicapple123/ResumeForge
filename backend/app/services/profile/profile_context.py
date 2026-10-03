"""把个人资料转换为岗位筛选和模型提示词使用的结构。"""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from ...schemas.profile import ProfileOut
from .profile_relevance_constants import (
    SECTION_LIMITS,
    _LLM_PROFILE_FIELDS,
    _REFERENCE_CONTENT_KEY,
    _REFERENCE_FILE_KEY,
)

# 公开作品链接字段（与 ``_LLM_PROFILE_FIELDS`` 中的名字保持一致）。
_LINK_FIELDS = ("github", "personal_website")
# 私密链接标记：值里出现 token（访问凭证）或 private（私密路径）即视为私密资源。
_PRIVATE_LINK_MARKER_RE = re.compile(r"private|token", re.IGNORECASE)


def split_lines(text: str) -> list[str]:
    """把换行文本拆成非空要点。"""
    if not text:
        return []
    return [line.strip() for line in text.splitlines() if line.strip()]


def split_commas(text: str) -> list[str]:
    """把中英文逗号/顿号分隔的技能拆成数组。"""
    return [item.strip() for item in re.split(r"[,，、]", text) if item.strip()]


def _reference_fields(item: Any, include_references: bool) -> dict[str, str]:
    """内部保留参考原文用于检索；最终发送前会替换为岗位相关节选。"""
    if not include_references:
        return {}
    content = getattr(item, "reference_content", "").strip()
    if not content:
        return {}
    return {
        _REFERENCE_FILE_KEY: getattr(item, "reference_file_name", "").strip(),
        _REFERENCE_CONTENT_KEY: content,
    }


def build_profile_prompt_data(
    profile: ProfileOut, *, include_references: bool = False
) -> dict[str, Any]:
    """把完整资料规范化为模型可读结构；默认不携带参考文件。"""
    return {
        "name": profile.name,
        "gender": profile.gender,
        "birth_year": profile.birth_year,
        "phone": profile.phone,
        "email": profile.email,
        "city": profile.city,
        "target_city": profile.target_city,
        "job_intent": profile.job_intent,
        "personal_website": profile.personal_website,
        "github": profile.github,
        "summary": profile.summary,
        "educations": [
            {
                "school": item.school,
                "major": item.major,
                "degree": item.degree,
                "start_date": item.start_date,
                "end_date": item.end_date,
                "gpa": item.gpa,
                "courses": split_lines(item.courses),
                "achievements": split_lines(item.achievements),
                **_reference_fields(item, include_references),
            }
            for item in profile.educations
        ],
        "experiences": [
            {
                "company": item.company,
                "role": item.role,
                "start_date": item.start_date,
                "end_date": item.end_date,
                "description": split_lines(item.description),
                **_reference_fields(item, include_references),
            }
            for item in profile.experiences
        ],
        "campus_experiences": [
            {
                "organization": item.organization,
                "role": item.role,
                "start_date": item.start_date,
                "end_date": item.end_date,
                "description": split_lines(item.description),
                **_reference_fields(item, include_references),
            }
            for item in getattr(profile, "campus_experiences", [])
        ],
        "projects": [
            {
                "name": item.name,
                "role": item.role,
                "start_date": item.start_date,
                "end_date": item.end_date,
                "tech_stack": split_commas(item.tech_stack),
                "description": split_lines(item.description),
                "highlights": split_lines(item.highlights),
                **_reference_fields(item, include_references),
            }
            for item in profile.projects
        ],
        "skills": [{"name": item.name, "level": item.level} for item in profile.skills],
        "awards": [
            {"name": item.name, "date": item.date, "description": item.description}
            for item in profile.awards
        ],
    }


def build_llm_profile_prompt_data(data: dict[str, Any]) -> dict[str, Any]:
    """只保留岗位匹配需要的资料，避免把身份和联系方式发送给模型。"""
    result = {
        key: deepcopy(data.get(key, [] if key in SECTION_LIMITS else ""))
        for key in _LLM_PROFILE_FIELDS
    }
    # 公开链接字段的私密值兜底：github / personal_website 属于用户主动填写的
    # 公开作品链接，正常值要随候选资料提供给模型；但值里出现 token 或 private
    # 标记时（如带访问凭证的地址、私有仓库路径），它实际是私密资源——发进模型
    # 上下文既无必要也有泄露风险（模型上下文只发必需资料，这是红线）。按子串
    # 大小写无关保守排除：宁可不给模型，也不能把私密链接泄漏进上下文。
    for field in _LINK_FIELDS:
        value = result.get(field)
        if isinstance(value, str) and _PRIVATE_LINK_MARKER_RE.search(value):
            result[field] = ""
    return result
