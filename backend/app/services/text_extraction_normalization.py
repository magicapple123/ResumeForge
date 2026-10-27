# SPDX-License-Identifier: Apache-2.0
"""岗位与个人资料 AI 抽取结果的字段边界、事实锚定和合并。"""

import re
import unicodedata
from typing import Any
from urllib.parse import urlsplit

from ..schemas.extraction import MAX_RECOGNIZED_TEXT_CHARS
from ..schemas.job import JobTextParseResult
from ..schemas.profile import ProfileTextParseResult
from .llm.base import LLMError
from .profile_entry_merge import (
    IDENTITY_FIELDS,
    is_usable_anchor,
    merge_entries,
    normalized_key,
)
from .profile_parser.normalization import _normalize_lines
from .profile_parser.section_detection import _split_sections

_JOB_FIELDS = (
    "title",
    "company",
    "location",
    "salary",
    "job_type",
    "description",
    "requirements",
    "additional_info",
    "source_url",
    "posted_at",
    "status",
)
_JOB_TEXT_LIMITS = {
    "title": 128,
    "company": 128,
    "location": 64,
    "salary": 64,
    "job_type": 32,
    "description": 200_000,
    "requirements": 200_000,
    "additional_info": 200_000,
    "source_url": 512,
    "posted_at": 32,
    "status": 16,
}
_JOB_TYPES = {"校招", "实习", "社招", "其他"}

_PROFILE_BASIC_LIMITS = {
    "name": 64,
    "gender": 64,
    "birth_year": 32,
    "phone": 32,
    "email": 128,
    "city": 64,
    "target_city": 64,
    "job_intent": 128,
    "personal_website": 256,
    "github": 256,
    "summary": 200_000,
}
_PROFILE_ENTRY_LIMITS = {
    "educations": {
        "school": 128,
        "major": 128,
        "degree": 32,
        "start_date": 32,
        "end_date": 32,
        "gpa": 64,
        "courses": 200_000,
        "achievements": 200_000,
    },
    "experiences": {
        "company": 128,
        "role": 128,
        "start_date": 32,
        "end_date": 32,
        "description": 200_000,
    },
    "campus_experiences": {
        "organization": 128,
        "role": 128,
        "start_date": 32,
        "end_date": 32,
        "description": 200_000,
    },
    "projects": {
        "name": 128,
        "role": 64,
        "start_date": 32,
        "end_date": 32,
        "tech_stack": 10_000,
        "description": 200_000,
        "highlights": 200_000,
    },
    "skills": {"name": 64, "level": 32},
    "awards": {"name": 128, "date": 32, "description": 2_000},
}
_TOKEN_SPLIT_RE = re.compile(r"[,，、;；/|]+")
# 日期类字段：接地校验走"数字组序列"比对，其余字段仍是字面比对（见 `_is_grounded`）。
_DATE_FIELDS = frozenset({"start_date", "end_date", "date", "birth_year"})
_DIGITS_RE = re.compile(r"\d+")


def _bounded_text(value: Any, limit: int, state: dict[str, bool]) -> str:
    if isinstance(value, bool) or value is None:
        return ""
    if not isinstance(value, (str, int, float)):
        return ""
    text = str(value).strip()
    if len(text) > limit:
        state["truncated"] = True
        return text[:limit]
    return text


def _digit_groups(value: str) -> list[str]:
    """抽出全部数字组（日期比对只看数字，忽略 `.` `/` `-` `年月日` 与空格）。

    前导零归一：`09` 与 `9` 是同一个月份，`2014/09` 与 `2014年9月` 必须判等。
    """
    return [str(int(group)) for group in _DIGITS_RE.findall(unicodedata.normalize("NFKC", value))]


def _is_date_grounded(value: str, source_normalized: str) -> bool:
    """日期类值的接地判定：数字组按顺序**连续**出现在原文里即算有出处。"""
    groups = _digit_groups(value)
    if not groups:
        return False
    source_groups = _digit_groups(source_normalized)
    width = len(groups)
    for start in range(len(source_groups) - width + 1):
        if source_groups[start : start + width] == groups:
            return True
    return False


def _is_grounded(value: str, source_text: str, field: str = "") -> bool:
    """值是否出自原文。

    日期字段放宽成"数字组序列一致"：抄录写 ``2014.09``、模型写 ``2014-09`` 是同一件事，
    字面比对会把它判成幻觉并清空（图片通路没有任何本地兜底，用户看到的就是"日期全空"）。
    其余字段仍是**字面**比对——放宽整体校验会让模型凭空写的学校/公司也留下来。
    """
    normalized = normalized_key(value)
    if not normalized:
        return False
    if field in _DATE_FIELDS:
        if _is_date_grounded(value, normalized_key(source_text)):
            return True
        # 日期字段里也可能出现「至今」这类无数字的值：退回字面比对。
        return normalized in normalized_key(source_text)
    return normalized in normalized_key(source_text)


def transcription_of(data: dict[str, Any]) -> str:
    """取出模型抄录的图片文字，兼容包在 profile 键里的写法。"""
    value: Any = data.get("transcription")
    if value is None and isinstance(data.get("profile"), dict):
        value = data["profile"].get("transcription")
    return value.strip() if isinstance(value, str) else ""


def _recognized_text(data: dict[str, Any]) -> str:
    """回传给用户核对的抄录内容。

    直接切片而不是走 ``_bounded_text``：后者会置 ``truncated``，让一条只用于展示的
    辅助信息触发"字段已截断"的警告，而那警告说的是保存字段。
    """
    return transcription_of(data)[:MAX_RECOGNIZED_TEXT_CHARS]


def _pick_grounded(value: str, fallback: str, source_text: str) -> str:
    if value and _is_grounded(value, source_text):
        return value
    return fallback


# 出生年月：模型常常只回四位年份（`1998`），而这个资料字段叫**出生年月**。原文里同一年
# 只出现过**一个**月份时把它补回去；出现多个（简历里同年的入学/毕业/入职日期）就保持原样，
# 宁可不猜也不把一个日期安到生日上。
_BIRTH_YEAR_ONLY_RE = re.compile(r"^(?:19|20)\d{2}$")
_YEAR_MONTH_IN_SOURCE_RE = re.compile(r"((?:19|20)\d{2})\s*[年./-]\s*(\d{1,2})(?!\d)")


def _refine_birth_month(value: str, source_text: str) -> str:
    """把「只有年份」的出生年月补成 ``YYYY-MM``，补不出来就原样返回。"""
    if not _BIRTH_YEAR_ONLY_RE.fullmatch(value):
        return value
    source = unicodedata.normalize("NFKC", source_text)
    months = {
        int(match.group(2))
        for match in _YEAR_MONTH_IN_SOURCE_RE.finditer(source)
        if match.group(1) == value
    }
    valid = {month for month in months if 1 <= month <= 12}
    if len(valid) != 1:
        return value
    return f"{value}-{valid.pop():02d}"


def _safe_source_url(value: str, source_text: str) -> str:
    if not value or not _is_grounded(value, source_text):
        return ""
    try:
        parsed = urlsplit(value)
    except ValueError:
        return ""
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        return ""
    return value


def normalize_job_result(
    data: dict[str, Any],
    local: JobTextParseResult,
    source_text: str,
    *,
    recognized_text: str | None = None,
) -> JobTextParseResult:
    """``recognized_text`` 传给调用方自带的一份原文（多份识别时是这一份的摘录）。"""
    state = {"truncated": False}
    values = {
        field: _bounded_text(data.get(field), _JOB_TEXT_LIMITS[field], state)
        for field in _JOB_FIELDS
    }
    for field in ("title", "company", "location", "salary"):
        values[field] = _pick_grounded(values[field], getattr(local, field), source_text)
    values["job_type"] = values["job_type"] if values["job_type"] in _JOB_TYPES else local.job_type
    values["source_url"] = local.source_url or _safe_source_url(values["source_url"], source_text)
    values["posted_at"] = _pick_grounded(values["posted_at"], local.posted_at, source_text)
    values["status"] = local.status
    for field in ("description", "requirements", "additional_info"):
        values[field] = _pick_grounded(values[field], getattr(local, field), source_text)
    if not any(values[field] for field in ("title", "company", "description", "requirements")):
        raise LLMError("模型未识别到有效岗位字段，请重试")
    warnings = ["AI 结果已通过字段和来源校验，请核对后保存。"]
    if state["truncated"]:
        warnings.append("部分 AI 识别字段超过可保存长度，已截断，请核对。")
    return JobTextParseResult.model_validate(
        {
            **values,
            "warnings": warnings,
            "parse_engine": "ai",
            "recognized_text": (
                recognized_text if recognized_text is not None else _recognized_text(data)
            ),
        }
    )


# 需要"条目必须长在自己分区里"这条结构校验的分区：它们的身份锚点（校名 / 公司 /
# 组织 / 项目名）是具体实体，跨板块串用就是可见的错误。技能与奖项不在此列：技能名
# 本来就会在项目正文里出现（"技术栈：Python"），拿分区范围卡它会误杀。
_SCOPED_SECTIONS = frozenset({"educations", "experiences", "campus_experiences", "projects"})


def _section_scopes(source_text: str) -> dict[str, str]:
    """原文按标题切成 分区 → 正文；没有可识别标题的原文返回空字典（跳过结构校验）。

    复用本地解析的切分器而不是另写一套：模型与本地规则必须对"这一行属于谁"有同一个
    答案，两套边界迟早会对不上。
    """
    if not source_text.strip():
        return {}
    sections = _split_sections(_normalize_lines(source_text))
    if not any(sections.values()):
        return {}
    return {key: "\n".join(lines) for key, lines in sections.items() if lines}


def _entry_values(section: str, value: Any, state: dict[str, bool]) -> list[dict[str, str]]:
    if isinstance(value, dict):
        raw_items = [value]
    elif isinstance(value, list):
        raw_items = value[:200]
        if len(value) > 200:
            state["truncated"] = True
    elif section == "skills" and isinstance(value, str):
        raw_items = [
            {"name": token.strip()} for token in _TOKEN_SPLIT_RE.split(value) if token.strip()
        ]
    else:
        raw_items = []

    limits = _PROFILE_ENTRY_LIMITS[section]
    result = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        normalized = {
            field: _bounded_text(item.get(field), limit, state) for field, limit in limits.items()
        }
        if any(normalized.values()):
            result.append(normalized)
    return result


def _ground_entries(
    section: str,
    entries: list[dict[str, str]],
    source_text: str,
    scope: str = "",
) -> list[dict[str, str]]:
    """丢弃无身份锚点条目，并移除未被原文支持的单个字段。

    ``scope`` 是这个分区在原文里**自己的**正文（标题到下一个标题之间，见
    `_section_scopes`）。条目锚点必须落在它里面：否则「工作经历」那一段会被同时算进
    「教育经历」——用户实测双语模板下 `Microsoft / Software Engineer` 在教育里也出现
    一次，学校/公司两栏都填了同一家公司。scope 为空（原文这首区没有可识别边界）时
    跳过这道检查，不能因为"认不出标题"就把条目全杀掉。
    """
    grounded = []
    for item in entries:
        anchors = [item.get(field, "") for field in IDENTITY_FIELDS[section]]
        if any(
            _is_grounded(anchor, source_text)
            for anchor in anchors
            if is_usable_anchor(section, anchor)
        ):
            grounded.append(
                {
                    field: value if _is_grounded(value, source_text, field) else ""
                    for field, value in item.items()
                }
            )
    if not scope.strip():
        return grounded
    return [
        item
        for item in grounded
        if any(_is_grounded(item.get(field, ""), scope) for field in IDENTITY_FIELDS[section])
    ]


# 模型偶尔无视提示词里的规范分区键，用同义别名输出（practice / campus /
# work_experience…）。这里宽容映射回规范键，映射不了的原样保留——锚定校验
# 与合并逻辑对无法归类的键本来就不会采信。
_SECTION_KEY_ALIASES = {
    "practice": "projects",
    "practices": "projects",
    "project": "projects",
    "project_experience": "projects",
    "projects_experience": "projects",
    "experience": "experiences",
    "experiences_and_practice": "experiences",
    "work": "experiences",
    "work_experience": "experiences",
    "internship": "experiences",
    "internships": "experiences",
    "employment": "experiences",
    "campus": "campus_experiences",
    "campus_experience": "campus_experiences",
    "student_experience": "campus_experiences",
    "education": "educations",
    "award": "awards",
    "awards_and_honors": "awards",
    "honors": "awards",
    "skill": "skills",
}


def _canonical_section_keys(data: dict[str, Any]) -> dict[str, Any]:
    """把模型输出的分区别名键映射回规范键；规范键已有值时不动。"""
    canonical = dict(data)
    for alias, section in _SECTION_KEY_ALIASES.items():
        if alias in data and not data.get(section):
            canonical[section] = data[alias]
    return canonical


def normalize_profile_result(
    data: dict[str, Any], local: ProfileTextParseResult, source_text: str
) -> ProfileTextParseResult:
    """把模型抽取的资料 JSON 规范化成可落库结果：字段截断、来源锚定、与本地结果合并。"""
    if isinstance(data.get("profile"), dict):
        data = data["profile"]
    data = _canonical_section_keys(data)
    state = {"truncated": False}
    local_data = local.model_dump()
    # 基础字段是 str，子表是 list[dict]：这张草稿字典生来就是混装的，之后整体交给
    # `ProfileTextParseResult` 校验，所以这里显式声明成 Any。
    values: dict[str, Any] = {
        field: _bounded_text(data.get(field), limit, state)
        for field, limit in _PROFILE_BASIC_LIMITS.items()
    }
    for field in _PROFILE_BASIC_LIMITS:
        values[field] = _pick_grounded(values[field], getattr(local, field), source_text)
    values["birth_year"] = _refine_birth_month(values["birth_year"], source_text)
    if not values["summary"]:
        values["summary"] = local.summary

    scopes = _section_scopes(source_text)
    for section in _PROFILE_ENTRY_LIMITS:
        ai_entries = _ground_entries(
            section,
            _entry_values(section, data.get(section), state),
            source_text,
            scopes.get(section, "") if section in _SCOPED_SECTIONS else "",
        )
        values[section] = merge_entries(section, ai_entries, local_data.get(section, []))

    if not any(
        [values["name"], values["summary"], *(values[section] for section in _PROFILE_ENTRY_LIMITS)]
    ):
        raise LLMError("模型未识别到有效个人资料字段，请重试")
    warnings = ["AI 结果已通过字段和来源校验，请核对后保存。"]
    if state["truncated"]:
        warnings.append("部分 AI 识别字段超过可保存长度，已截断，请核对。")
    return ProfileTextParseResult.model_validate(
        {
            **values,
            "photo": "",
            "section_order": list(local.section_order),
            "warnings": warnings,
            "parse_engine": "ai",
            "recognized_text": _recognized_text(data),
        }
    )
