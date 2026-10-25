# SPDX-License-Identifier: Apache-2.0
"""把个人资料转换为岗位筛选和模型提示词使用的结构。"""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from ...schemas.profile import ProfileOut
from .profile_relevance_constants import (
    _LLM_PROFILE_FIELDS,
    _REFERENCE_CONTENT_KEY,
    _REFERENCE_FILE_KEY,
    FACT_MERGE_TARGETS,
    FACT_STANDALONE_SECTIONS,
    SECTION_LIMITS,
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


def _merge_fact_sections(data: dict[str, Any], fact_sections: dict[str, Any]) -> None:
    """把补充事实的九个 section 并入候选资料（灵活化契约 §5）。

    只在 section 非空时才加键：没有任何事实时输出必须与改动前逐字节一致
    （旧请求/旧备份/旧提示词契约不变）。四个独立事实 section 原样加新键；
    其余按 FACT_MERGE_TARGETS 追加到既有栏目（作品/培训进 projects、实践进
    experiences、荣誉进 awards、语言进 skills）——复用既有输出 schema，不新增栏目。
    """
    for section in FACT_STANDALONE_SECTIONS:
        items = fact_sections.get(section)
        if isinstance(items, list) and items:
            data[section] = list(items)
    for section, target in FACT_MERGE_TARGETS.items():
        items = fact_sections.get(section)
        if isinstance(items, list) and items:
            data[target] = [*data.get(target, []), *items]


def build_profile_prompt_data(
    profile: ProfileOut,
    *,
    include_references: bool = False,
    fact_sections: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """把完整资料规范化为模型可读结构；默认不携带参考文件。

    fact_sections 是 fact_context.prompt_sections 的输出；None/空时返回结构与历史
    行为完全一致，非空时按契约 §3.3 合并六个补充事实 section。
    """
    data = {
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
    if fact_sections:
        _merge_fact_sections(data, fact_sections)
    return data


def build_llm_profile_prompt_data(
    data: dict[str, Any], *, include_identity: bool = False
) -> dict[str, Any]:
    """只保留岗位匹配需要的资料，避免把身份和联系方式发送给模型。

    ``include_identity=True``（助手放宽模式）时把姓名、电话、邮箱一并放行——这是
    用户在设置里知情开启后的显式扩权；私密链接兜底（token/private 标记）不受该
    开关影响，任何模式下都会拦。
    """
    keys = list(_LLM_PROFILE_FIELDS)
    if include_identity:
        # 身份字段插在最前：与用户在「我的资料」里看到的顺序一致（姓名最先）。
        keys = ["name", "gender", "birth_year", "phone", "email"] + keys
    result = {}
    for key in keys:
        # 补充事实的独立 section 只在**本次候选真的有这个键**时才出现：没有新事实时
        # 提示词结构与改动前逐字节一致（旧请求/旧备份不受影响），而不是多出四个空数组。
        if key in FACT_STANDALONE_SECTIONS and key not in data:
            continue
        result[key] = deepcopy(data.get(key, [] if key in SECTION_LIMITS else ""))
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
