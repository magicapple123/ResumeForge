# SPDX-License-Identifier: Apache-2.0
"""条目的字段类型 / 值校验 / 历史快照（从 entry_store.py 拆出：单文件 500 行预算）。

一次拆分只为回到单文件行数预算：三个私有 helper 原样搬迁，行为、异常类型与函数签名
均不变。entry_store 在文件顶部把它们 import 回来，模块内名字与既有 monkeypatch 落点
不受影响。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from . import value_validation
from .definition_catalog import SECTION_BY_KEY
from .errors import ValidationError
from .field_preferences import custom_field_rows
from .read_field_limits import limit_of, too_long_detail


def _field_types(db: Session, section_key: str) -> dict[str, str]:
    """该分区当前允许写入的字段类型：默认字段（目录）+ 活动自定义字段（DB）。"""
    types: dict[str, str] = {}
    spec = SECTION_BY_KEY.get(section_key)
    if spec is not None:
        types.update({field.field_id: field.field_type for field in spec.fields})
    for row in custom_field_rows(db, section_key=section_key):
        types[row.field_id] = row.field_type
    return types


def _validated_values(db: Session, section_key: str, values: dict[str, Any]) -> dict[str, str]:
    try:
        checked = value_validation.validate_values_with_types(
            section_key, values, _field_types(db, section_key)
        )
    except value_validation.ValidationFailure as failure:
        raise ValidationError(failure.detail, code=failure.code) from failure
    # 最后一道（2026-11 用户报告）：值必须能被读取投影原样读出来。读取模型上的
    # max_length（如 AwardOut.name 128）比类型上限（单行 200）紧，此前只按类型校验，
    # 160 字的奖项标题能写进库、资料页读取时当场 ValidationError 500。
    # 上限来自 read_field_limits（读取模型注解本身），不是又抄了一份数字。
    for field_id, value in checked.items():
        limit = limit_of(field_id)
        if limit is not None and len(value) > limit:
            raise ValidationError(
                too_long_detail(field_id, len(value), limit),
                code="value_too_long",
            )
    return checked


def _field_snapshot(
    db: Session, section_key: str, previous: Any, values: dict[str, str]
) -> list[dict[str, str]]:
    """保存时同步历史快照：当前定义顺序在前，已删除字段沿用旧快照里的标签/类型。"""
    ordered: list[tuple[str, str, str]] = []
    spec = SECTION_BY_KEY.get(section_key)
    if spec is not None:
        ordered += [(f.field_id, f.label, f.field_type) for f in spec.fields]
    ordered += [
        (row.field_id, row.label, row.field_type)
        for row in custom_field_rows(db, section_key=section_key)
    ]
    snapshot: list[dict[str, str]] = []
    known: set[str] = set()
    for field_id, label, field_type in ordered:
        if field_id in values:
            snapshot.append({"field_id": field_id, "label": label, "field_type": field_type})
            known.add(field_id)
    for item in previous if isinstance(previous, list) else []:
        if not isinstance(item, dict):
            continue
        field_id = str(item.get("field_id") or "")
        if field_id and field_id not in known and field_id in values:
            snapshot.append(
                {
                    "field_id": field_id,
                    "label": str(item.get("label") or field_id),
                    "field_type": str(item.get("field_type") or "multi_line"),
                }
            )
            known.add(field_id)
    return snapshot
