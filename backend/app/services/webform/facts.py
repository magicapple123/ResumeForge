# SPDX-License-Identifier: Apache-2.0
"""补充事实接入网申填表（2026-10-25）：目录条目、表单数据与自定义标签。

事实属于简历资料，网申取数时应当可用，但三条边界不能破：

1. **私密字段不外发**：资格证照编号永远不进入 data / catalog / custom_labels；
2. **隐藏字段不外发**：用户在某类事实里删掉的默认字段，其旧值仍保存在本地库，
   但网申取数不得使用；
3. **已有资料优先**：简历资料与「网申资料」里的同名字段优先于事实派生值，事实只
   setdefault 补空缺，不覆盖用户明确填过的值。

条目 key 统一用 CUSTOM_FACT_<fact_id>_<field>：以 CUSTOM_ 开头是为了复用现有
「放宽模式」的自定义标签匹配（custom_labels_from_catalog 只认这个前缀），同时与
网申自定义字段的库内 key 空间区分开。
"""

from __future__ import annotations

import unicodedata
from typing import Any

from sqlalchemy.orm import Session

from ..profile.fact_context import load_fact_context
from ..profile.fact_field_schema import (
    FACT_FIELD_LABELS,
    load_field_schemas,
    mapping_payload,
    visible_default_fields,
)
from .field_synonyms import FIELD_SYNONYMS
from .fields import FORM_FIELDS

FACT_KEY_PREFIX = "CUSTOM_FACT_"

FACT_KIND_LABELS: dict[str, str] = {
    "publication": "论文",
    "research_project": "科研项目",
    "patent": "专利",
    "credential": "资格证照",
    "work_project": "作品项目",
    "practice": "实践或服务经历",
    "award": "荣誉与获奖",
    "training": "培训与课程",
    "language": "语言能力",
}

# 永远不进入网申取数的字段（本地私密）。
PRIVATE_FIELDS: frozenset[tuple[str, str]] = frozenset({("credential", "credential_number")})

# 枚举值的中文显示：网申表里直接填英文枚举对用户没有意义。
_ENUM_LABELS: dict[str, dict[str, str]] = {
    "status": {
        "published": "已发表",
        "accepted": "已接收",
        "in_press": "排版中",
        "under_review": "在投",
        "preprint": "预印本",
        "filed": "已申请",
        "pending": "办理中",
        "granted": "已授权",
        "expired": "已过期",
        "unknown": "未标注",
        "active": "有效期内",
        "other": "其他",
    },
    "experience_kind": {
        "full_time": "全职",
        "part_time": "兼职",
        "contract": "合同",
        "self_employed": "自雇",
        "internship": "实习",
        "volunteer": "志愿服务",
        "other": "其他",
        "unset": "",
    },
}

# 组合成网申规范字段的文本（多个事实用分号连接）。
_CANONICAL_TEXT: dict[str, str] = {
    "credential": "professional_cert",
    "language": "language_other",
}

_SEPARATOR = "；"


def _text(value: Any) -> str:
    if isinstance(value, list):
        return _SEPARATOR.join(str(item).strip() for item in value if str(item).strip())
    return str(value or "").strip()


def _field_text(kind: str, field: str, value: Any) -> str:
    if field in _ENUM_LABELS:
        return _ENUM_LABELS[field].get(str(value or ""), str(value or ""))
    if field in {"authors", "inventors"}:
        if not isinstance(value, list):
            return ""
        return "、".join(
            str(item.get("name") or "").strip()
            for item in value
            if isinstance(item, dict) and str(item.get("name") or "").strip()
        )
    return _text(value)


def _schema_entries(db: Session) -> list[dict[str, Any]]:
    """事实快照 + 可见字段/自定义字段，生成网申目录条目。"""
    context = load_fact_context(db)
    schemas = load_field_schemas(db)
    entries: list[dict[str, Any]] = []
    for item in context.items:
        kind = str(item.get("kind") or "")
        payload = item.get("payload")
        schema = schemas.get(kind)
        if schema is None or not isinstance(payload, dict):
            continue
        fact_id = str(item.get("fact_id") or "")
        if not fact_id:
            continue
        labels = FACT_FIELD_LABELS.get(kind, {})
        group = "补充事实：" + FACT_KIND_LABELS.get(kind, kind)
        mapped = mapping_payload(kind, payload, schema)
        for field in visible_default_fields(kind, schema):
            if (kind, field) in PRIVATE_FIELDS:
                continue
            value = _field_text(kind, field, mapped.get(field))
            if not value:
                continue
            entries.append(
                {
                    "key": FACT_KEY_PREFIX + fact_id + "_" + field,
                    "label": labels.get(field, field),
                    "value": value,
                    "group": group,
                    "source": "extra",
                    "kind": kind,
                    "field": field,
                }
            )
        # 自定义字段只取当前定义里的项：删掉的定义不再进入任何取数路径。
        # mapping_payload 已按当前定义过滤并回填 label；这里用定义序号生成稳定 key 后缀。
        for index, field in enumerate(mapped.get("custom_fields") or []):
            label = str(field.get("label") or "").strip()
            value = _text(field.get("value"))
            if not label or not value:
                continue
            entries.append(
                {
                    "key": (FACT_KEY_PREFIX + fact_id + "_custom_" + str(index)),
                    "label": label,
                    "value": value,
                    "group": group,
                    "source": "extra",
                    "kind": kind,
                    "field": "custom_" + str(index),
                }
            )
    return entries


def fact_catalog_entries(db: Session) -> list[dict[str, str]]:
    """供「换个资料…」人工清单使用的事实条目（只保留可展示的字段）。"""
    return [
        {
            "key": item["key"],
            "label": item["label"],
            "value": item["value"],
            "group": item["group"],
            "source": "extra",
        }
        for item in _schema_entries(db)
    ]


def fact_custom_labels(db: Session) -> dict[str, str]:
    """事实条目的 key → 标签，供放宽模式匹配；不含任何值。"""
    return {item["key"]: item["label"] for item in _schema_entries(db)}


def _canonical_values(entries: list[dict[str, Any]]) -> dict[str, str]:
    grouped: dict[str, list[str]] = {}
    for entry in entries:
        field = str(entry.get("field") or "")
        kind = str(entry.get("kind") or "")
        canonical = _CANONICAL_TEXT.get(kind)
        if canonical and field != "credential_number":
            grouped.setdefault(canonical, []).append(str(entry["value"]))
    return {
        key: _SEPARATOR.join(values)
        for key, values in grouped.items()
        if values
    }


def _normalize_label(label: str) -> str:
    folded = unicodedata.normalize("NFKC", unicodedata.normalize("NFKC", label).casefold())
    return "".join(char for char in folded if char.isalnum())


def _label_to_form_fields() -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for field in FORM_FIELDS:
        for candidate in (field.label, *FIELD_SYNONYMS.get(field.key, ())):
            normalized = _normalize_label(candidate)
            if normalized:
                result.setdefault(normalized, set()).add(field.key)
    return result


def merge_fact_data(db: Session, data: dict[str, str]) -> dict[str, str]:
    """把事实派生值并入网申 data；已有值优先（只 setdefault）。"""
    entries = _schema_entries(db)
    if not entries:
        return dict(data)
    result = dict(data)
    for key, value in _canonical_values(entries).items():
        if value:
            result.setdefault(key, value)
    for entry in entries:
        result.setdefault(str(entry["key"]), str(entry["value"]))
    fields_by_label = _label_to_form_fields()
    by_label: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        normalized = _normalize_label(str(entry["label"]))
        if normalized:
            by_label.setdefault(normalized, []).append(entry)
    for normalized, items in by_label.items():
        fields = fields_by_label.get(normalized, set())
        if len(items) != 1 or len(fields) != 1:
            continue
        field_key = next(iter(fields))
        if (result.get(field_key) or "").strip():
            continue
        value = str(items[0]["value"]).strip()
        if value:
            result[field_key] = value
    # 获奖事实没有单独的规范字段时，按最近一条补 award_*（已有资料优先）。
    awards = [entry for entry in entries if entry.get("kind") == "award"]
    if awards:
        for field, key in (
            ("name", "award_name"),
            ("date", "award_date"),
            ("description", "award_description"),
        ):
            match = next((entry for entry in awards if entry.get("field") == field), None)
            if match is not None and str(match["value"]).strip():
                result.setdefault(key, str(match["value"]))
    return result


__all__ = [
    "FACT_KEY_PREFIX",
    "FACT_KIND_LABELS",
    "fact_catalog_entries",
    "fact_custom_labels",
    "merge_fact_data",
]
