# SPDX-License-Identifier: Apache-2.0
"""求职偏好的服务侧门面：目录渲染 + 值的人话渲染。

真源（kind 闭集、值形态、中文标签、注入优先级、枚举选项与逐 kind 归一化规则）已下沉到
词表包 :mod:`app.vocabulary.job_preference_kinds` 与
:mod:`app.vocabulary.job_preference_terms`——契约层（``app/schemas/job_preference.py``）
在 Pydantic 校验阶段就要用它们，而 schema 反向 import services 是一条架构回边
（``tests/test_import_direction.py``）。本模块因此只保留两件**服务层**的事：

- :func:`catalog_items` —— ``GET /api/job-preferences`` 的 catalog 段（接口形状）；
- :func:`describe_value` / :func:`option_label` —— 把存储值渲染成给人看的一句话
  （注入块、工具结果、确认卡共用）。

**对外符号一个都没少**：``from .job_preference_catalog import spec_for_kind`` 这类既有
导入路径不变，符号名、值、顺序与中文协议值全部沿用词表模块里的那一份（不是副本）。
"""

from __future__ import annotations

from typing import Any

from ..vocabulary.job_preference_kinds import (
    INJECTABLE_KINDS as INJECTABLE_KINDS,
)
from ..vocabulary.job_preference_kinds import (
    PREF_VALUE_KIND_LIST as PREF_VALUE_KIND_LIST,
)
from ..vocabulary.job_preference_kinds import (
    PREF_VALUE_KIND_SCALAR as PREF_VALUE_KIND_SCALAR,
)
from ..vocabulary.job_preference_kinds import (
    PREFERENCE_KINDS as PREFERENCE_KINDS,
)
from ..vocabulary.job_preference_kinds import (
    PreferenceKindSpec as PreferenceKindSpec,
)
from ..vocabulary.job_preference_kinds import (
    PreferenceValidationError as PreferenceValidationError,
)
from ..vocabulary.job_preference_kinds import (
    injectable_specs as injectable_specs,
)
from ..vocabulary.job_preference_kinds import (
    kind_specs as kind_specs,
)
from ..vocabulary.job_preference_kinds import (
    normalize_value as normalize_value,
)
from ..vocabulary.job_preference_kinds import (
    spec_for_kind as spec_for_kind,
)


def catalog_items() -> list[dict[str, Any]]:
    """GET /api/job-preferences 的 catalog 段（前端据此渲染表单/筛选）。"""
    return [
        {
            "kind": spec.kind,
            "value_kind": spec.value_kind,
            "label": spec.label,
            "inject_priority": spec.inject_priority,
            "options": [{"value": value, "label": label} for value, label in spec.options],
        }
        for spec in kind_specs()
    ]


def option_label(kind: str, value: Any) -> str:
    """枚举型 scalar 的中文展示（非枚举返回空串）。"""
    for option_value, option_text in spec_for_kind(kind).options:
        if option_value == value:
            return option_text
    return ""


def _salary_text(value: dict[str, Any]) -> str:
    unit = "月薪" if value.get("unit") == "month" else "年薪"
    return f"{unit} ≥{int(value.get('amount') or 0):,} 元"


def describe_value(kind: str, value: Any) -> str:
    """把存储值渲染成给人看的一句话（注入块、工具结果、确认卡共用）。"""
    spec = spec_for_kind(kind)
    if spec.value_kind == PREF_VALUE_KIND_LIST:
        items = value if isinstance(value, list) else [value]
        return "、".join(str(item) for item in items)
    if kind == "salary_floor" and isinstance(value, dict):
        return _salary_text(value)
    if kind == "redline_length" and isinstance(value, dict):
        return f"正文最多 {value.get('max_pages')} 页"
    if kind == "available_from":
        return "随时到岗" if value == "immediate" else f"{value} 起"
    if spec.options:
        return option_label(kind, value) or str(value)
    return str(value)


__all__ = [
    "INJECTABLE_KINDS",
    "PREFERENCE_KINDS",
    "PREF_VALUE_KIND_LIST",
    "PREF_VALUE_KIND_SCALAR",
    "PreferenceKindSpec",
    "PreferenceValidationError",
    "catalog_items",
    "describe_value",
    "injectable_specs",
    "kind_specs",
    "normalize_value",
    "option_label",
    "spec_for_kind",
]
