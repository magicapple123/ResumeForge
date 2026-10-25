# SPDX-License-Identifier: Apache-2.0
"""模型简历 JSON 的容错解析和结构化转换。

**单一职责**：把不可信的模型输出 JSON 变成一份合法的 :class:`ResumeContent`。
宽松规则只有两类——缺字段补默认值、字符串/数组形状不对尽量修正；**已在 schema 声明
的语义字段一个都不许丢**（科研三栏、稳定身份、可见性与锁字段都在这里逐项保留）。

A0 的教训（计划 §1.1-1）：旧实现只显式重建六类旧栏目，于是论文/科研项目/专利经过
一次修订就归零，条目的 ``id`` / ``point_ids`` / ``lock_content`` 也被剥掉——修订一次
就等于"锁没了、来源锚点没了"。现在条目字段从 pydantic 模型本身推导，新增栏目只要在
``_ENTRY_MODELS`` 登记就会自动获得同一套保留规则，不会再出现"schema 支持但解析层漏掉"。
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, cast

from annotated_types import MaxLen
from pydantic import BaseModel, ValidationError

from ...schemas.resume import (
    EXPERIENCE_KINDS,
    ResumeAward,
    ResumeCampusExperience,
    ResumeContent,
    ResumeCredential,
    ResumeEducation,
    ResumeExperience,
    ResumePatent,
    ResumeProject,
    ResumePublication,
    ResumeResearchProject,
    ResumeSkill,
)
from ...schemas.resume_research import ResumeAuthor
from ..profile.profile_context import split_lines

logger = logging.getLogger(__name__)

# 简历结构中的"列表字段"，宽松校验时字符串会被拆分补全（历史形状，保持 re-export 兼容）。
_LIST_FIELDS = {
    "education": {
        "str_fields": {"school", "major", "degree", "start_date", "end_date", "gpa"},
        "list_fields": {"courses", "achievements"},
    },
    "experience": {
        "str_fields": {"company", "role", "start_date", "end_date"},
        "list_fields": {"description"},
    },
    "campus_experience": {
        "str_fields": {"organization", "role", "start_date", "end_date"},
        "list_fields": {"description"},
    },
    "projects": {
        "str_fields": {"name", "role", "start_date", "end_date"},
        "list_fields": {"tech_stack", "description", "highlights"},
    },
}

# 兼容新模块内更直观的名称，同时让旧门面继续暴露 ``_LIST_FIELDS``。
LIST_FIELDS = _LIST_FIELDS

# 分区 → (条目模型, 需要把字符串按行拆成数组的字段)。
# 新增栏目在这里登记一次即可：字段类型安全由模型校验，保留规则由本模块统一负责。
_ENTRY_MODELS: dict[str, tuple[type[BaseModel], frozenset[str]]] = {
    "education": (ResumeEducation, frozenset({"courses", "achievements"})),
    "experience": (ResumeExperience, frozenset({"description"})),
    "campus_experience": (ResumeCampusExperience, frozenset({"description"})),
    "projects": (ResumeProject, frozenset({"tech_stack", "description", "highlights"})),
    "skills": (ResumeSkill, frozenset()),
    "awards": (ResumeAward, frozenset()),
    # W14 科研三栏目（空列表不序列化；见 OptionalEmptyListMixin）。
    "publications": (ResumePublication, frozenset()),
    "research_projects": (ResumeResearchProject, frozenset({"description", "outcomes"})),
    "patents": (ResumePatent, frozenset()),
    # A4 资格证照（空列表不序列化；没有 credential_number，见 schemas/resume_credentials.py）。
    "credentials": (ResumeCredential, frozenset()),
}

# 嵌套作者/发明人：字段名（列表下标即署名顺序，is_self 标本人）。
_AUTHOR_FIELDS: dict[str, str] = {"publications": "authors", "patents": "inventors"}
# 状态是事实锁字段：枚举外的值一律回落本栏目的"未认定"值，绝不猜成"已发表/已授权/
# 已取得资格"。证照的回落值是 unknown（不是 other）：A4 契约固定四态，且 unknown
# 明确表示"未经核实"，不会把待核实写成有效。
_STATUS_VALUES: dict[str, frozenset[str]] = {
    "publications": frozenset(
        {"published", "accepted", "in_press", "under_review", "preprint", "other"}
    ),
    "patents": frozenset({"filed", "pending", "granted", "expired", "other"}),
    "credentials": frozenset({"unknown", "pending", "active", "expired"}),
}
_STATUS_FALLBACK: dict[str, str] = {
    "publications": "other",
    "patents": "other",
    "credentials": "unknown",
}
# 可选身份/可见性/锁字段：不是模型"内容"，但要原样保留。
_IDENTITY_BOOL_FIELDS = ("hidden", "lock_content", "lock_layout")
_IDENTITY_FIELDS = ("id", "point_ids", "hidden_points")
# 链接只接受 http(s)：模板会渲染成可点击 <a>，javascript:/file: 一律清空而非整条丢弃。
_HTTP_URL_FIELDS = frozenset({"url", "verify_url", "public_url"})
# 实践/服务经历的关系类型：白名单外的值清空（不整条丢弃——经历本身仍是有效内容）。
_EXPERIENCE_KIND_VALUES = frozenset(EXPERIENCE_KINDS)
_MAX_AUTHORS = 50


def extract_json(text: str) -> dict | None:
    """从模型输出中提取 JSON 对象。"""
    if not text:
        return None
    cleaned = re.sub(r"```(?:json)?", "", text).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return None
    if isinstance(data, dict) and isinstance(data.get("resume"), dict):
        data = data["resume"]
    return data if isinstance(data, dict) else None


def _string_list(value) -> list[str]:
    """宽松转字符串数组：列表取字符串元素，字符串按行拆分，其他返回空。"""
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return split_lines(value)
    return []


def _entry_dicts(value) -> list[dict]:
    """把单个对象 / 数组统一成"对象列表"，非对象元素直接忽略。"""
    if isinstance(value, dict):
        value = [value]
    if not isinstance(value, list):
        return []
    return [entry for entry in value if isinstance(entry, dict)]


def _max_length(model: type[BaseModel], field: str) -> int | None:
    """从 pydantic 字段元数据取 max_length（字段没有上限时返回 None）。"""
    for meta in model.model_fields[field].metadata:
        if isinstance(meta, MaxLen):
            return meta.max_length
    return None


def _bounded_text(value, limit: int | None) -> str:
    text = value if isinstance(value, str) else ""
    return text[:limit] if limit is not None else text


def _http_url(value) -> str:
    """链接字段的协议兜底：非 http(s) 一律清空（不丢整条事实，只丢不可点的那段）。"""
    text = value.strip() if isinstance(value, str) else ""
    if not text:
        return ""
    lowered = text.lower()
    return text if lowered.startswith(("http://", "https://")) else ""


def _identity_fields(entry: dict) -> dict[str, Any]:
    """原样保留条目声明的身份/可见性/锁字段（类型不对就不传，不猜）。"""
    result: dict[str, Any] = {}
    object_id = entry.get("id")
    if isinstance(object_id, str) and object_id.strip():
        result["id"] = object_id.strip()
    point_ids = entry.get("point_ids")
    if isinstance(point_ids, dict):
        cleaned = {
            str(key): [item for item in ids if isinstance(item, str)]
            for key, ids in point_ids.items()
            if isinstance(ids, list) and all(isinstance(item, str) for item in ids)
        }
        if cleaned:
            result["point_ids"] = cleaned
    hidden_points = entry.get("hidden_points")
    if isinstance(hidden_points, list) and all(isinstance(item, str) for item in hidden_points):
        result["hidden_points"] = list(hidden_points)
    for name in _IDENTITY_BOOL_FIELDS:
        value = entry.get(name)
        if isinstance(value, bool):
            result[name] = value
    return result


def _coerce_authors(value) -> list[dict]:
    """作者/发明人归一：列表下标即署名顺序，只保留 name/is_self/corresponding。"""
    if not isinstance(value, list):
        value = [value] if isinstance(value, dict) else []
    authors: list[dict] = []
    for item in value[:_MAX_AUTHORS]:
        if not isinstance(item, dict):
            continue
        author: dict[str, Any] = {
            "name": _bounded_text(item.get("name"), _max_length(ResumeAuthor, "name")),
        }
        for name in ("is_self", "corresponding"):
            if isinstance(item.get(name), bool):
                author[name] = item[name]
        if author["name"] or author.get("is_self") or author.get("corresponding"):
            authors.append(author)
    return authors


def _coerce_entry(section: str, entry: dict) -> dict[str, Any]:
    """按条目模型把一条原始 JSON 归一化成"只含受支持字段"的 dict。"""
    model, list_fields = _ENTRY_MODELS[section]
    item: dict[str, Any] = {}
    for name, field_info in model.model_fields.items():
        if name in _IDENTITY_FIELDS or name in _IDENTITY_BOOL_FIELDS:
            continue
        if name in list_fields:
            values = _string_list(entry.get(name))
            limit = _max_length(model, name)
            item[name] = values[:limit] if limit is not None else values
            continue
        if section in _AUTHOR_FIELDS and name == _AUTHOR_FIELDS[section]:
            item[name] = _coerce_authors(entry.get(name))
            continue
        if name == "status" and section in _STATUS_VALUES:
            raw = entry.get(name)
            item[name] = raw if raw in _STATUS_VALUES[section] else _STATUS_FALLBACK[section]
            continue
        if section == "experience" and name == "experience_kind":
            raw = _bounded_text(entry.get(name), _max_length(model, name))
            item[name] = raw if raw in _EXPERIENCE_KIND_VALUES else ""
            continue
        # 其余字段在当前 schema 里全是普通字符串（含新增的 public_url 等可选字段）。
        if field_info.annotation is str:
            text = _bounded_text(entry.get(name), _max_length(model, name))
            item[name] = _http_url(text) if name in _HTTP_URL_FIELDS else text
    item.update(_identity_fields(entry))
    return item


def _validated_entries(section: str, raw) -> list[Any]:
    """逐条校验；单条不合法只丢弃该条并留日志，不拖垮整份简历。

    返回 ``list[Any]`` 而不是 ``list[BaseModel]``：结果要 ``**`` 进 ``ResumeContent``，
    而它的条目参数是 ``list[ResumeXxx]`` 这类具体列表——``list[BaseModel]`` 因列表
    不变型对不上；这里的元素已通过对应模型校验，``Any`` 只是给类型系统让路。
    """
    model, _ = _ENTRY_MODELS[section]
    entries: list[Any] = []
    for index, entry in enumerate(_entry_dicts(raw)):
        normalized = _coerce_entry(section, entry)
        try:
            entries.append(model.model_validate(normalized))
        except ValidationError as exc:
            logger.warning(
                "简历解析丢弃了不合法条目 section=%s index=%s reason=%s",
                section,
                index,
                exc.errors()[0].get("msg", "校验失败"),
            )
    return entries


def coerce_resume(data: dict | None) -> ResumeContent:
    """宽松校验：字段缺失补默认值、类型不对尽量修正，已声明的语义字段全部保留。"""
    data = data or {}

    def as_str(value) -> str:
        return value if isinstance(value, str) else ""

    sections = {
        section: _validated_entries(section, data.get(section)) for section in _ENTRY_MODELS
    }
    return ResumeContent(
        name=as_str(data.get("name")),
        gender=as_str(data.get("gender")),
        birth_year=as_str(data.get("birth_year")),
        phone=as_str(data.get("phone")),
        email=as_str(data.get("email")),
        city=as_str(data.get("city")),
        personal_website=as_str(data.get("personal_website")),
        github=as_str(data.get("github")),
        job_intent=as_str(data.get("job_intent")),
        summary=as_str(data.get("summary")),
        # **sections 的键只会是 _ENTRY_MODELS 里的分区名（都对应 ResumeContent 的
        # list 字段）；dict[str, Any] 让 pyright 不再把 list 值试到 photo: str 这类
        # 非列表参数上。运行时 pydantic 仍逐字段校验。
        **cast("dict[str, Any]", sections),
    )


def resume_has_content(resume: ResumeContent) -> bool:
    """这份简历是否有任何可交付内容。

    **唯一实现**：修订、翻译、局部改写等 AI 路径都用它判断"模型是不是返回了空简历"。
    只检查旧六栏的写法会把"只有论文/证照的有效简历"误判成空简历而拒绝（G24）。
    """
    if resume.summary.strip() or resume.job_intent.strip():
        return True
    return any(getattr(resume, section, None) for section in _ENTRY_MODELS)


__all__ = [
    "LIST_FIELDS",
    "coerce_resume",
    "extract_json",
    "resume_has_content",
]
