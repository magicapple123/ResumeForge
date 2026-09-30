"""网申资料可重复记录的读写与填表展开。"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy.orm import Session

from ...models.web_form_profile_record import WebFormProfileRecord
from ..date_format import normalize_partial_date
from .repeated_fields import field_key_for_block, field_label_for_key
from .repeated_profile_catalog import (
    REPEATED_PROFILE_GROUPS,
    RepeatedProfileGroup,
    group_for_key,
)

MAX_REPEAT_RECORDS = 50
MAX_REPEAT_VALUE_CHARS = 2000


def _clean_values(group: RepeatedProfileGroup, raw: Mapping[str, Any] | None) -> dict[str, str]:
    """只保留目录内字段，并统一空白与长度。"""
    if not isinstance(raw, Mapping):
        return {}
    cleaned: dict[str, str] = {}
    for field in group.fields:
        value = str(raw.get(field.key) or "").strip()[:MAX_REPEAT_VALUE_CHARS]
        if field.kind == "date":
            value = normalize_partial_date(value)
        if value:
            cleaned[field.key] = value
    return cleaned


def _records_by_group(db: Session) -> dict[str, list[dict[str, Any]]]:
    """按目录顺序读取每组记录。未知组或空记录不进入对外结果。"""
    result: dict[str, list[dict[str, Any]]] = {group.key: [] for group in REPEATED_PROFILE_GROUPS}
    rows = (
        db.query(WebFormProfileRecord)
        .order_by(WebFormProfileRecord.group_key, WebFormProfileRecord.sort_order, WebFormProfileRecord.id)
        .all()
    )
    for row in rows:
        group = group_for_key(row.group_key)
        values = _clean_values(group, row.values) if group else {}
        if group is None or not values:
            continue
        result[group.key].append({"id": row.id, "values": values})
    return result


def list_groups(db: Session) -> list[dict[str, Any]]:
    """返回前端编辑器需要的目录、字段和当前记录。"""
    records = _records_by_group(db)
    return [
        {
            "key": group.key,
            "label": group.label,
            "family": group.family,
            "fields": [
                {
                    "key": field.key,
                    "label": field.label,
                    "kind": field.kind,
                    "options": list(field.options),
                    "sensitive": field.sensitive,
                }
                for field in group.fields
            ],
            "records": records[group.key],
        }
        for group in REPEATED_PROFILE_GROUPS
    ]


def save_groups(
    db: Session,
    payload: Mapping[str, Sequence[Mapping[str, Any]]],
    *,
    commit: bool = True,
) -> None:
    """整份覆盖保存重复记录。

    新版前端每次提交全部分组，因此删除某一条就是不再提交那一条。旧客户端不传
    ``repeated`` 时由 API 路由跳过本函数，避免旧版本误删新数据。
    """
    normalized: dict[str, list[dict[str, str]]] = {}
    for group in REPEATED_PROFILE_GROUPS:
        raw_records = payload.get(group.key, [])
        if not isinstance(raw_records, Sequence) or isinstance(raw_records, (str, bytes)):
            raise ValueError(f"重复资料组 {group.key} 的记录格式不正确")
        if len(raw_records) > MAX_REPEAT_RECORDS:
            raise ValueError(f"每组重复资料最多保存 {MAX_REPEAT_RECORDS} 条")
        records: list[dict[str, str]] = []
        for raw_record in raw_records:
            if not isinstance(raw_record, Mapping):
                raise ValueError(f"重复资料组 {group.key} 的记录格式不正确")
            values = _clean_values(group, raw_record.get("values"))
            if values:
                records.append(values)
        normalized[group.key] = records

    existing = (
        db.query(WebFormProfileRecord)
        .filter(WebFormProfileRecord.group_key.in_(normalized))
        .all()
    )
    for row in existing:
        db.delete(row)

    for group in REPEATED_PROFILE_GROUPS:
        for sort_order, values in enumerate(normalized[group.key]):
            db.add(
                WebFormProfileRecord(
                    group_key=group.key,
                    sort_order=sort_order,
                    values=values,
                )
            )
    if commit:
        db.commit()


def expand_form_data(db: Session) -> dict[str, str]:
    """把重复网申补充资料展开为带序号的填表字段。"""
    data: dict[str, str] = {}
    records = _records_by_group(db)
    for group in REPEATED_PROFILE_GROUPS:
        for index, record in enumerate(records[group.key], start=1):
            values = record["values"]
            for field in group.fields:
                value = values.get(field.key, "")
                if not value:
                    continue
                key = field_key_for_block(field.key, group.family, index)
                data[key] = value
    return data


def catalog_entries(db: Session) -> list[dict[str, str]]:
    """把重复网申资料加入「换个资料…」和「记住这条」的人工清单。"""
    entries: list[dict[str, str]] = []
    records = _records_by_group(db)
    for group in REPEATED_PROFILE_GROUPS:
        for index, record in enumerate(records[group.key], start=1):
            group_label = f"{group.label} {index}"
            for field in group.fields:
                value = record["values"].get(field.key, "")
                if not value:
                    continue
                key = field_key_for_block(field.key, group.family, index)
                entries.append(
                    {
                        "group": group_label,
                        "label": field_label_for_key(key, field.label),
                        "value": value,
                        "key": key,
                        "source": "extra",
                    }
                )
    return entries


__all__ = [
    "MAX_REPEAT_RECORDS",
    "MAX_REPEAT_VALUE_CHARS",
    "catalog_entries",
    "expand_form_data",
    "list_groups",
    "save_groups",
]
