# SPDX-License-Identifier: Apache-2.0
"""把个人资料转换为岗位筛选和模型提示词使用的结构。"""

from __future__ import annotations

import re
from collections.abc import Callable
from copy import deepcopy
from typing import Any

from ...schemas.profile import ProfileOut
from ...schemas.profile_projection import ConsumedEntry, ConsumedProfile, ConsumedSection
from .profile_relevance_constants import (
    _BASIC_INFO_EXTRA,
    _BASIC_INFO_LEGACY,
    _CREDENTIAL_STATUS,
    _INCREMENT_ALIASES,
    _LEGACY_SECTION_SHAPES,
    _LLM_PROFILE_FIELDS,
    _PATENT_STATUS,
    _PUBLICATION_STATUS,
    _REFERENCE_CONTENT_KEY,
    _REFERENCE_FILE_KEY,
    _WORK_TYPE_KINDS,
    FACT_MERGE_TARGETS,
    FACT_STANDALONE_SECTIONS,
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


# ===== 消费快照（ConsumedProfile）→ 模型候选（F3 / R-28 / C1） =====
#
# 生成链路的输入是 F2 的消费 DTO（只含当前组参与分区、已剔除 hidden / 软删字段），
# 不是旧 ProfileOut。本段只做一件事：把"字段定义 + 条目值"落成**旧提示词形状**——
# 旧六分区的键名与结构逐字节沿用改造前实现（R-31/C1 的等价基线），v3 新增字段只在
# 有值时增量出现；未参与分区在消费 DTO 里根本不存在，所以不会被补成空键。

_PEOPLE_SPLIT_RE = re.compile(r"[、,，;；/|]+")
_HTTP_PREFIXES = ("http://", "https://")


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _transform(text: str, mode: str) -> Any:
    if mode == "lines":
        return split_lines(text)
    if mode == "commas":
        return split_commas(text)
    return text


def _http_only(value: str) -> str:
    """科研链接只保留 http(s)（ResumeContent 的链接字段会拒绝其它协议）。"""
    text = _clean(value)
    return text if text.lower().startswith(_HTTP_PREFIXES) else ""


def _people(value: str) -> list[dict[str, Any]]:
    """作者/发明人字符串 → 署名顺序列表；新资料没有本人/通讯标记，一律 False。"""
    return [
        {"name": part.strip(), "is_self": False, "corresponding": False}
        for part in _PEOPLE_SPLIT_RE.split(_clean(value))
        if part.strip()
    ]


def _mapped_status(value: str, mapping: dict[str, str], default: str) -> str:
    return mapping.get(_clean(value).casefold(), default)


def _field_value(section: ConsumedSection, entry: ConsumedEntry, key: str) -> str:
    return _clean(entry.values.get(f"{section.key}.{key}", ""))


def _custom_field_values(section: ConsumedSection, entry: ConsumedEntry) -> list[dict[str, str]]:
    """自定义小字段 → [{label, value}]（C5-B① 的提示词素材；空值不出现）。"""
    result: list[dict[str, str]] = []
    for spec in section.fields:
        if spec.is_builtin or not spec.llm_allowed:
            continue
        value = _clean(entry.values.get(spec.field_id, ""))
        if value:
            result.append({"label": spec.label, "value": value})
    return result


def _increments(
    section: ConsumedSection, entry: ConsumedEntry, used_keys: set[str]
) -> dict[str, Any]:
    """旧六分区里 v3 新增/改名字段的增量键（有值才出现，只增不改）。"""
    result: dict[str, Any] = {}
    for spec in section.fields:
        if not spec.is_builtin or not spec.llm_allowed or spec.key in used_keys:
            continue
        raw = _field_value(section, entry, spec.key)
        if not raw:
            continue
        if (section.key, spec.key) == ("experiences", "work_type"):
            raw = _WORK_TYPE_KINDS.get(_clean(raw), "")
            if not raw:
                continue
        output_key = _INCREMENT_ALIASES.get(section.key, {}).get(spec.key, spec.key)
        result[output_key] = split_lines(raw) if spec.field_type == "multi_line" else raw
    return result


def _legacy_entry(section: ConsumedSection, entry: ConsumedEntry) -> dict[str, Any]:
    shape = _LEGACY_SECTION_SHAPES[section.key]
    item = {
        output_key: _transform(_field_value(section, entry, source_key), mode)
        for output_key, source_key, mode in shape
    }
    item.update(_increments(section, entry, {source_key for _, source_key, _ in shape}))
    custom = _custom_field_values(section, entry)
    if custom:
        item["custom_fields"] = custom
    return item


def _publication_entry(section: ConsumedSection, entry: ConsumedEntry) -> dict[str, Any]:
    item = {
        "title": _field_value(section, entry, "title"),
        "authors": _people(_field_value(section, entry, "authors")),
        "venue": _field_value(section, entry, "venue"),
        "year": _field_value(section, entry, "year"),
        "status": _mapped_status(
            _field_value(section, entry, "status"), _PUBLICATION_STATUS, "other"
        ),
        "doi": _field_value(section, entry, "doi"),
        "url": _http_only(_field_value(section, entry, "url")),
        "volume_pages": _field_value(section, entry, "volume_pages"),
        "note": _field_value(section, entry, "note"),
    }
    used = {"title", "authors", "venue", "year", "status", "doi", "url", "volume_pages", "note"}
    item.update(_increments(section, entry, used))
    custom = _custom_field_values(section, entry)
    if custom:
        item["custom_fields"] = custom
    return item


def _research_project_entry(section: ConsumedSection, entry: ConsumedEntry) -> dict[str, Any]:
    item = {
        "name": _field_value(section, entry, "name"),
        "role": _field_value(section, entry, "role"),
        "organization": _field_value(section, entry, "institution"),
        "start_date": _field_value(section, entry, "start_date"),
        "end_date": _field_value(section, entry, "end_date"),
        "funding": _field_value(section, entry, "funding"),
        "description": split_lines(_field_value(section, entry, "description")),
        "outcomes": split_lines(_field_value(section, entry, "outcomes")),
    }
    used = {
        "name",
        "role",
        "institution",
        "start_date",
        "end_date",
        "funding",
        "description",
        "outcomes",
    }
    item.update(_increments(section, entry, used))
    custom = _custom_field_values(section, entry)
    if custom:
        item["custom_fields"] = custom
    return item


def _patent_entry(section: ConsumedSection, entry: ConsumedEntry) -> dict[str, Any]:
    item = {
        "title": _field_value(section, entry, "title"),
        "inventors": _people(_field_value(section, entry, "inventors")),
        "patent_number": _field_value(section, entry, "patent_number"),
        "country": _field_value(section, entry, "country"),
        "status": _mapped_status(_field_value(section, entry, "status"), _PATENT_STATUS, "other"),
        "filed_date": _field_value(section, entry, "application_date"),
        "granted_date": _field_value(section, entry, "grant_date"),
        "url": _http_only(_field_value(section, entry, "url")),
    }
    used = {
        "title",
        "inventors",
        "patent_number",
        "country",
        "status",
        "application_date",
        "grant_date",
        "url",
    }
    item.update(_increments(section, entry, used))
    custom = _custom_field_values(section, entry)
    if custom:
        # 知识产权自定义字段只作素材（R-43/R-76：纸面无槽位，模型不得写进输出）。
        item["custom_fields"] = custom
    return item


def _credential_entry(section: ConsumedSection, entry: ConsumedEntry) -> dict[str, Any]:
    # 值不全是 str（custom_fields 是 list），所以显式 dict[str, Any] 而不是让推导收窄成 str。
    item: dict[str, Any] = {
        "name": _field_value(section, entry, "title"),
        "issuer": _field_value(section, entry, "issuer"),
        "issue_date": _field_value(section, entry, "issued_at"),
        "expiry_date": _field_value(section, entry, "expires_at"),
        "status": _mapped_status(
            _field_value(section, entry, "status"), _CREDENTIAL_STATUS, "unknown"
        ),
        "verify_url": _http_only(_field_value(section, entry, "verify_url")),
        "note": _field_value(section, entry, "note"),
    }
    used = {"title", "issuer", "issued_at", "expires_at", "status", "note", "verify_url"}
    item.update(_increments(section, entry, used))
    custom = _custom_field_values(section, entry)
    if custom:
        item["custom_fields"] = custom
    return item


def _language_entry(section: ConsumedSection, entry: ConsumedEntry) -> dict[str, Any]:
    """语言能力素材（R-72/73）：给模型判断用的字段，纸面映射由后处理唯一实现。"""
    return {
        "language": _field_value(section, entry, "language"),
        "level": _field_value(section, entry, "level"),
        "certificate": _field_value(section, entry, "certificate"),
        "score": _field_value(section, entry, "score"),
        "obtained_at": _field_value(section, entry, "obtained_at"),
    }


_SECTION_BUILDERS: dict[str, Callable[[ConsumedSection, ConsumedEntry], dict[str, Any]]] = {
    "educations": _legacy_entry,
    "experiences": _legacy_entry,
    "campus_experiences": _legacy_entry,
    "projects": _legacy_entry,
    "skills": _legacy_entry,
    "awards": _legacy_entry,
    "publications": _publication_entry,
    "research_projects": _research_project_entry,
    "patents": _patent_entry,
    "credentials": _credential_entry,
    "languages": _language_entry,
}


def _basic_info_values(section: ConsumedSection) -> dict[str, Any]:
    values = section.entries[0].values if section.entries else {}
    data: dict[str, Any] = {
        output_key: _clean(values.get(f"basic_info.{source_key}", ""))
        for output_key, source_key in _BASIC_INFO_LEGACY
    }
    for key in _BASIC_INFO_EXTRA:
        raw = _clean(values.get(f"basic_info.{key}", ""))
        if raw:
            data[key] = raw
    return data


def _summary_value(section: ConsumedSection) -> str:
    if not section.entries:
        return ""
    return _clean(section.entries[0].values.get("summary.content", ""))


def build_consumed_data(consumed: ConsumedProfile) -> dict[str, Any]:
    """当前组消费快照 → 模型候选（旧提示词形状 + v3 增量的唯一构造入口）。

    只遍历 participating_keys（R-28 过滤最早）：未参与分区不会出现在结果里；
    参与但无数据的分区保留空数组（C1）；自建大字段不交给模型自由生成（C2）。
    """
    data: dict[str, Any] = {}
    basic = consumed.section("basic_info")
    if basic is not None:
        data.update(_basic_info_values(basic))
    summary = consumed.section("summary")
    if summary is not None:
        data["summary"] = _summary_value(summary)
    for key in consumed.participating_keys:
        if key in ("basic_info", "summary"):
            continue
        section = consumed.section(key)
        if section is None:
            continue
        builder = _SECTION_BUILDERS.get(key)
        if builder is None:
            continue
        data[key] = [builder(section, entry) for entry in section.entries]
    return data


def build_consumed_profile_prompt_data(consumed: ConsumedProfile) -> dict[str, Any]:
    """消费快照 → 已按白名单裁剪的模型提示词候选（生成链路的唯一入口）。"""
    return build_llm_profile_prompt_data(build_consumed_data(consumed))


def build_llm_profile_prompt_data(
    data: dict[str, Any], *, include_identity: bool = False
) -> dict[str, Any]:
    """只保留岗位匹配需要的资料，避免把身份和联系方式发送给模型。

    include_identity=True（助手放宽模式）时把姓名、电话、邮箱一并放行——这是用户
    在设置里知情开启后的显式扩权；私密链接兜底（token/private 标记）不受该开关影响。

    **只保留 data 里已存在的键**（R-29/C1）：未参与分区在消费 DTO 里根本不存在，
    这里不能靠默认值把它补出来（旧实现给缺失键补空数组，等于让组外分区以空键出现）。
    旧 ProfileOut 路径的 data 始终含全部旧键，所以输出与改造前逐字节一致。
    """
    keys = list(_LLM_PROFILE_FIELDS)
    if include_identity:
        # 身份字段插在最前：与用户在「我的资料」里看到的顺序一致（姓名最先）。
        keys = ["name", "gender", "birth_year", "phone", "email"] + keys
    result = {}
    for key in keys:
        if key not in data:
            continue
        result[key] = deepcopy(data[key])
    # 公开链接字段的私密值兜底：github / personal_website / portfolio_url 属于用户主动
    # 填写的公开作品链接，正常值要随候选资料提供给模型；但值里出现 token 或 private
    # 标记时（如带访问凭证的地址、私有仓库路径），它实际是私密资源——发进模型上下文
    # 既无必要也有泄露风险（模型上下文只发必需资料，这是红线）。按子串大小写无关排除。
    for field in (*_LINK_FIELDS, "portfolio_url"):
        value = result.get(field)
        if isinstance(value, str) and _PRIVATE_LINK_MARKER_RE.search(value):
            result[field] = ""
    return result
