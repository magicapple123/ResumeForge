# SPDX-License-Identifier: Apache-2.0
"""补充事实的字段定义（唯一真相）：九类事实的默认字段、中文标签、隐藏/自定义字段设置。

**三层数据**：

- 默认字段 key/中文标签：本模块常量（唯一真相；前端从 GET /api/profile/facts/schema
  读取，不在前端维护第二份，避免漂移）；
- 字段定义（按类型）：profile_fact_field_pref 表——隐藏了哪些默认字段、有哪些自定义
  字段；每种类型一行，revision 条件写（两个窗口同时改设置时后提交方拿 409）；
- 值快照：事实 payload 里的 custom_fields（key+label+value）与各默认字段的值。
  定义删除后值仍留在 payload（本地数据不删），只是界面/AI/导出/网申不再使用；
  同名重建不会自动关联旧值。

**为什么定义表没有 deleted_at**：它是行为偏好而不是用户内容，恢复默认 = 清空
hidden+custom，不存在"从回收站找回一条字段设置"的场景；真正的事实值从不在这里。

**依赖方向**：schemas 不能反向 import services，所以 payload 结构校验里没有
"自定义字段名不能与默认字段中文标签重名"这一条；由本模块的
validate_custom_payload 在创建/更新事实时补查（失败仍是 422）。
"""

from __future__ import annotations

import copy
import re
import uuid
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from ...models.profile import utcnow
from ...models.profile_fact import PROFILE_FACT_KINDS
from ...models.profile_fact_field_pref import ProfileFactFieldPref
from ...schemas.profile_facts import (
    FACT_CUSTOM_FIELD_KEY_PATTERN,
    FACT_CUSTOM_FIELD_LABEL_MAX,
    FACT_CUSTOM_FIELD_LIMIT,
    KIND_TO_PAYLOAD_MODEL,
)
from .fact_field_catalog import FACT_DEFAULT_FIELDS, FACT_FIELD_LABELS

# 字段设置的 409 业务码（响应体顶层 code）：与事实 revision 冲突同一形状。
PROFILE_FACT_SCHEMA_CONFLICT_CODE = "profile_fact_schema_revision_conflict"

# 自定义字段 key 的生成重试次数（uuid 碰撞概率极低，但不信任"不会撞"）。
_CUSTOM_FIELD_KEY_ATTEMPTS = 50
_CUSTOM_FIELD_KEY_PREFIX = "cf_"


@dataclass
class KindFieldSchema:
    """一种事实类型的字段设置快照（只读视图；写入走 update/reset）。"""

    kind: str
    revision: int
    hidden_fields: tuple[str, ...]
    custom_fields: tuple[dict[str, str], ...]


class SchemaRevisionConflict(Exception):
    """字段设置的条件写没命中：调用方手里那一版已经不存在。"""

    def __init__(self, current_revision: int) -> None:
        super().__init__(
            f"{PROFILE_FACT_SCHEMA_CONFLICT_CODE}: current_revision={current_revision}"
        )
        self.current_revision = current_revision


def _assert_kind(kind: str) -> str:
    text = str(kind or "").strip()
    if text not in FACT_DEFAULT_FIELDS:
        raise ValueError(f"不支持的补充事实类型：{kind}")
    return text


def _is_custom_key(value: Any) -> bool:
    return bool(re.fullmatch(FACT_CUSTOM_FIELD_KEY_PATTERN, str(value or "")))


def _normalize_custom_definitions(raw: Any) -> tuple[dict[str, str], ...]:
    """读库时宽容清洗：坏条目静默丢弃（旧数据/未来字段不能阻断读取）。"""
    if not isinstance(raw, list):
        return ()
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw[:FACT_CUSTOM_FIELD_LIMIT]:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        label = str(item.get("label") or "").strip()
        if not _is_custom_key(key) or not label or len(label) > FACT_CUSTOM_FIELD_LABEL_MAX:
            continue
        if key in seen:
            continue
        seen.add(key)
        result.append({"key": key, "label": label})
    return tuple(result)


def _normalize_hidden(kind: str, raw: Any) -> tuple[str, ...]:
    if not isinstance(raw, list):
        return ()
    allowed = FACT_DEFAULT_FIELDS[kind]
    seen: set[str] = set()
    result: list[str] = []
    for item in raw:
        key = str(item or "").strip()
        if key in allowed and key not in seen:
            seen.add(key)
            result.append(key)
    return tuple(result)


def _schema_from_row(row: ProfileFactFieldPref | None, kind: str) -> KindFieldSchema:
    if row is None:
        return KindFieldSchema(kind=kind, revision=0, hidden_fields=(), custom_fields=())
    return KindFieldSchema(
        kind=kind,
        revision=int(row.revision or 1),
        hidden_fields=_normalize_hidden(kind, row.hidden_fields),
        custom_fields=_normalize_custom_definitions(row.custom_fields),
    )


def load_field_schemas(db: Session) -> dict[str, KindFieldSchema]:
    """读取九类事实的字段设置；没有 prefs 行时返回默认（revision=0/hidden=()/custom=()）。"""
    rows = {row.kind: row for row in db.query(ProfileFactFieldPref).all()}
    return {kind: _schema_from_row(rows.get(kind), kind) for kind in PROFILE_FACT_KINDS}


def visible_default_fields(kind: str, schema: KindFieldSchema) -> tuple[str, ...]:
    """可见默认字段 = 默认字段全集 - 隐藏项（保持默认顺序）。"""
    normalized = _assert_kind(kind)
    hidden = set(schema.hidden_fields)
    return tuple(field for field in FACT_DEFAULT_FIELDS[normalized] if field not in hidden)


def visible_payload(kind: str, payload: dict[str, Any], schema: KindFieldSchema) -> dict:
    """剔除隐藏默认字段后的 payload 副本；其余键（含 custom_fields）原样返回。

    credential_number 在本地 payload 里保留；是否外发由调用方决定（生成候选另有剔除）。
    """
    _assert_kind(kind)
    hidden = set(schema.hidden_fields)
    source = payload if isinstance(payload, dict) else {}
    return {key: copy.deepcopy(value) for key, value in source.items() if key not in hidden}


def custom_fields_of(payload: dict[str, Any]) -> list[dict[str, str]]:
    """payload 里的自定义字段值快照：规范化 [{label, value}]，丢弃空值，忽略未知项。"""
    source = payload if isinstance(payload, dict) else {}
    result: list[dict[str, str]] = []
    for item in source.get("custom_fields") or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        value = str(item.get("value") or "").strip()
        if not label or not value:
            continue
        result.append({"label": label, "value": value})
    return result


def _custom_values_by_key(payload: dict[str, Any]) -> dict[str, str]:
    source = payload if isinstance(payload, dict) else {}
    result: dict[str, str] = {}
    for item in source.get("custom_fields") or []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        if key:
            result[key] = str(item.get("value") or "").strip()
    return result


def mapping_payload(kind: str, payload: dict[str, Any], schema: KindFieldSchema) -> dict[str, Any]:
    """生成候选/映射用 payload：剔除隐藏默认字段，自定义字段只保留**当前定义**里的项。

    定义已被删除的旧值继续留在本地 payload（不丢数据），但不进候选；label 用当前
    定义（改过名则用新名），按定义的顺序输出，空值跳过。
    """
    visible = visible_payload(kind, payload, schema)
    values = _custom_values_by_key(visible)
    lines: list[dict[str, str]] = []
    for definition in schema.custom_fields:
        value = values.get(definition["key"], "")
        if not value:
            continue
        lines.append({"label": definition["label"], "value": value})
    visible["custom_fields"] = lines
    return visible


def validate_custom_payload(kind: str, payload: dict[str, Any]) -> None:
    """补充 schemas 层做不了的校验：自定义字段名不得与默认字段中文标签完全相同。"""
    normalized = _assert_kind(kind)
    default_labels = set(FACT_FIELD_LABELS[normalized].values())
    for item in payload.get("custom_fields") or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        if label in default_labels:
            raise ValueError(f"自定义字段名「{label}」与默认字段重名，请换一个名字")


def _default_payload(kind: str) -> dict[str, Any]:
    return KIND_TO_PAYLOAD_MODEL[kind]().model_dump(mode="json")


def neutralize_hidden_fields(
    kind: str, payload: dict[str, Any], hidden_fields: tuple[str, ...]
) -> dict[str, Any]:
    """创建事实时忽略隐藏字段的客户端值：落成该字段的默认值（不报错）。"""
    if not hidden_fields:
        return payload
    defaults = _default_payload(_assert_kind(kind))
    result = dict(payload)
    for key in hidden_fields:
        if key in defaults:
            result[key] = copy.deepcopy(defaults[key])
    return result


def preserve_hidden_fields(
    kind: str,
    payload: dict[str, Any],
    previous_payload: dict[str, Any],
    hidden_fields: tuple[str, ...],
) -> dict[str, Any]:
    """更新事实时隐藏字段保留旧值：绝不因为隐藏而在用户保存后被清空。"""
    if not hidden_fields:
        return payload
    defaults = _default_payload(_assert_kind(kind))
    previous = previous_payload if isinstance(previous_payload, dict) else {}
    result = dict(payload)
    for key in hidden_fields:
        if key in previous:
            result[key] = copy.deepcopy(previous[key])
        elif key in defaults:
            result[key] = copy.deepcopy(defaults[key])
    return result


def _generate_custom_field_key(taken: set[str]) -> str:
    for _ in range(_CUSTOM_FIELD_KEY_ATTEMPTS):
        candidate = _CUSTOM_FIELD_KEY_PREFIX + uuid.uuid4().hex[:12]
        if candidate not in taken:
            return candidate
    raise ValueError("无法生成唯一的自定义字段 key，请重试")


def _validate_hidden_fields(kind: str, raw: Any) -> tuple[str, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ValueError("hidden_fields 必须是默认字段 key 的数组")
    allowed = FACT_DEFAULT_FIELDS[kind]
    seen: set[str] = set()
    result: list[str] = []
    for item in raw:
        key = str(item or "").strip()
        if key not in allowed:
            labels = FACT_FIELD_LABELS[kind]
            shown = labels.get(key, key)
            raise ValueError(f"未知的默认字段：{shown}")
        if key not in seen:
            seen.add(key)
            result.append(key)
    return tuple(result)


def _validate_custom_fields(kind: str, raw: Any) -> tuple[dict[str, str], ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ValueError("custom_fields 必须是字段定义数组")
    if len(raw) > FACT_CUSTOM_FIELD_LIMIT:
        raise ValueError(f"自定义字段不能超过 {FACT_CUSTOM_FIELD_LIMIT} 个")
    default_labels = set(FACT_FIELD_LABELS[kind].values())
    seen_keys: set[str] = set()
    seen_labels: set[str] = set()
    result: list[dict[str, str]] = []
    for item in raw:
        if isinstance(item, str):
            label = item.strip()
            key = None
        elif isinstance(item, dict):
            label = str(item.get("label") or "").strip()
            key = str(item.get("key") or "").strip() or None
        else:
            raise ValueError("自定义字段定义格式不正确")
        if not label:
            raise ValueError("自定义字段名不能为空")
        if len(label) > FACT_CUSTOM_FIELD_LABEL_MAX:
            raise ValueError(f"自定义字段名不能超过 {FACT_CUSTOM_FIELD_LABEL_MAX} 个字符：{label}")
        if label in default_labels:
            raise ValueError(f"自定义字段名「{label}」与默认字段重名，请换一个名字")
        if label in seen_labels:
            raise ValueError(f"自定义字段名重复：{label}")
        if key is not None:
            if not _is_custom_key(key):
                raise ValueError(f"自定义字段 key 格式不正确：{key}")
            if key in seen_keys:
                raise ValueError(f"自定义字段 key 重复：{key}")
        else:
            key = _generate_custom_field_key(seen_keys)
        seen_keys.add(key)
        seen_labels.add(label)
        result.append({"key": key, "label": label})
    return tuple(result)


def _pref_row(db: Session, kind: str) -> ProfileFactFieldPref | None:
    return db.query(ProfileFactFieldPref).filter(ProfileFactFieldPref.kind == kind).first()


def _current_pref_revision(db: Session, row: ProfileFactFieldPref | None) -> int:
    if row is None:
        return 0
    value = (
        db.query(ProfileFactFieldPref.revision).filter(ProfileFactFieldPref.id == row.id).scalar()
    )
    return int(value or 0)


def update_field_schema(
    db: Session,
    kind: str,
    *,
    hidden_fields: Any,
    custom_fields: Any,
    expected_revision: int,
) -> KindFieldSchema:
    """按条件写更新一种类型的字段设置（revision 不匹配 → SchemaRevisionConflict）。"""
    normalized = _assert_kind(kind)
    hidden = _validate_hidden_fields(normalized, hidden_fields)
    custom = _validate_custom_fields(normalized, custom_fields)
    row = _pref_row(db, normalized)
    current = int(row.revision) if row is not None else 0
    if int(expected_revision) != current:
        raise SchemaRevisionConflict(current)
    try:
        if row is None:
            row = ProfileFactFieldPref(
                kind=normalized,
                hidden_fields=list(hidden),
                custom_fields=[dict(item) for item in custom],
                revision=1,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
        else:
            # 条件写必须读 `rowcount`；显式收窄成 DML 的运行时真实类型（同 document_save.py）。
            result = cast(
                "CursorResult[Any]",
                db.execute(
                    update(ProfileFactFieldPref)
                    .where(
                        ProfileFactFieldPref.id == row.id,
                        ProfileFactFieldPref.revision == current,
                    )
                    .values(
                        hidden_fields=list(hidden),
                        custom_fields=[dict(item) for item in custom],
                        revision=current + 1,
                        updated_at=utcnow(),
                    )
                    .execution_options(synchronize_session=False)
                ),
            )
            if result.rowcount != 1:
                db.rollback()
                raise SchemaRevisionConflict(_current_pref_revision(db, row))
            db.commit()
            db.refresh(row)
    except SchemaRevisionConflict:
        raise
    except Exception:
        db.rollback()
        raise
    return _schema_from_row(row, normalized)


def reset_field_schema(db: Session, kind: str, *, expected_revision: int) -> KindFieldSchema:
    """恢复默认：清空 hidden+custom 并 revision+1；从未配置过则等价于默认（不写库）。

    保留 prefs 行而不是直接删除：revision 继续前进，另一个窗口手里的旧 revision
    下次条件写会拿到 409，而不是因为行消失而"看起来像从未设置过"。
    """
    normalized = _assert_kind(kind)
    row = _pref_row(db, normalized)
    current = int(row.revision) if row is not None else 0
    if int(expected_revision) != current:
        raise SchemaRevisionConflict(current)
    if row is None:
        return KindFieldSchema(kind=normalized, revision=0, hidden_fields=(), custom_fields=())
    result = cast(
        "CursorResult[Any]",
        db.execute(
            update(ProfileFactFieldPref)
            .where(ProfileFactFieldPref.id == row.id, ProfileFactFieldPref.revision == current)
            .values(
                hidden_fields=[],
                custom_fields=[],
                revision=current + 1,
                updated_at=utcnow(),
            )
            .execution_options(synchronize_session=False)
        ),
    )
    if result.rowcount != 1:
        db.rollback()
        raise SchemaRevisionConflict(_current_pref_revision(db, row))
    db.commit()
    db.refresh(row)
    return _schema_from_row(row, normalized)


# 供 API/测试引用的上限常量（与 schemas 层同一份定义，避免第二套数字）。
CUSTOM_FIELD_LIMIT = FACT_CUSTOM_FIELD_LIMIT

__all__ = [
    "CUSTOM_FIELD_LIMIT",
    "FACT_DEFAULT_FIELDS",
    "FACT_FIELD_LABELS",
    "KindFieldSchema",
    "PROFILE_FACT_SCHEMA_CONFLICT_CODE",
    "SchemaRevisionConflict",
    "custom_fields_of",
    "load_field_schemas",
    "mapping_payload",
    "neutralize_hidden_fields",
    "preserve_hidden_fields",
    "reset_field_schema",
    "update_field_schema",
    "validate_custom_payload",
    "visible_default_fields",
    "visible_payload",
]
