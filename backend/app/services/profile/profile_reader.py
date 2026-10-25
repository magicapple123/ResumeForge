# SPDX-License-Identifier: Apache-2.0
"""资料消费层读取：scope + 库内数据 → 无折叠态的 ConsumedProfile（F2 契约 §2.2）。

**为什么裁剪必须在这里一次做完**（R-29/R-31/R-66/R-67、§6 铁律 8/11）：hidden、已删除
自定义字段、未参与分区如果留给每个消费者自己过滤，漏一处就是"隐藏字段进了模型/上了
纸面"或"组外分区泄露给模型"。本模块只产出**允许参与的定义与值**：

- C1：sections 的键集合恒等于 scope.participating_keys —— 在组里就出现（entries 为空
  元组表示没数据），未参与整键不出现；
- 字段定义 = 默认字段（目录顺序）在前 + 活动自定义字段（定义顺序）在后；hidden 字段
  既不出现在 fields 也不出现在 values；已软删自定义字段整条不出现（旧值仍在库）；
- 条目值只保留未隐藏且定义仍活动的字段，空白值剔除；剔除后没有任何值的"空壳条目"
  不出现（与"在组里但没数据"同一语义）；软删条目不出现；单例至多一条；
- 消费 DTO 类型里根本没有 collapsed / collapsed_override / hidden，任何折叠态都不可能
  被下游读走（R-66：内容是否为空只看值，不看折叠）。

**不写库**：本模块只读；scope 解析阶段的 ensure_workspace 幂等修复是唯一例外。所以
load_consumed_profile(db, scope) 的返回值可以在请求 Session 关闭后继续使用（F3 把
scope/消费快照冻结进 profile_usage_snapshot 正是这么用的）。

**照片**：消费层只保留 basic_info.photo 的原始引用（data URL 或资源 id），能否落成可用
图片由纸面投影的 resolve_photo 回调决定；本层不理解图片格式，也不去解析资源 id。
"""

from __future__ import annotations

from dataclasses import replace

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...models.profile_definition import ProfileCustomField, ProfileCustomSection
from ...schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from . import entry_store, field_preferences, legacy_status, workspace_bootstrap
from .definition_catalog import SECTION_BY_KEY
from .errors import Conflict
from .group_scope import ProfileScope, all_sections_scope

# 新模型里是否存在"实际非空条目值"（R-47 的第二个布尔）。用 json_each 让数据库自己回答，
# 不把条目 JSON 全读进 Python：资料最多 13×200 条 + 自建，逐行解析在每次打开资料页都做
# 一遍没有意义，而这里只关心"有没有一个非空文本值"。
_ENTRY_VALUE_EXISTS_SQL = text(
    # values 是 SQLite 关键字：列名必须加引号，否则整条 SQL 语法错。
    'SELECT 1 FROM profile_entry, json_each(profile_entry."values") '
    "WHERE profile_entry.deleted_at IS NULL "
    "AND json_each.type = 'text' AND trim(json_each.value) <> '' "
    "LIMIT 1"
)


def _hidden_field_ids(db: Session) -> frozenset[str]:
    """用户隐藏的字段：R-67 让它们既不参与取数也不上纸面（值仍留在库内）。"""
    return frozenset(
        field_id
        for field_id, preference in field_preferences.load_preferences(db).items()
        if preference.hidden
    )


def _custom_fields_by_section(db: Session) -> dict[str, list[ProfileCustomField]]:
    """活动自定义字段按分区归组；custom_field_rows 已按 (sort_order, id) 稳定排序。"""
    grouped: dict[str, list[ProfileCustomField]] = {}
    for row in field_preferences.custom_field_rows(db):
        grouped.setdefault(row.section_key, []).append(row)
    return grouped


def _custom_specs(
    custom_fields: list[ProfileCustomField], hidden: frozenset[str], *, start_order: int
) -> tuple[ConsumedFieldSpec, ...]:
    """活动自定义小字段的消费定义（R-11：13 个内置分区也允许自建字段）。

    hidden 的整条不出现（定义与值一起裁掉）；order 接在该分区默认字段之后，
    与编辑 DTO 的"默认字段在前、自建字段在后"保持同一口径。
    """
    return tuple(
        ConsumedFieldSpec(
            field_id=field.field_id,
            key=field.field_id,
            label=field.label,
            field_type=field.field_type,
            order=start_order + index,
            llm_allowed=True,
            webform_allowed=True,
            private=False,
            is_builtin=False,
        )
        for index, field in enumerate(
            field for field in custom_fields if field.field_id not in hidden
        )
    )


def _builtin_section(
    key: str, hidden: frozenset[str], custom_fields: list[ProfileCustomField]
) -> ConsumedSection:
    """13 个系统分区：目录默认字段在前，该分区上的自定义字段按定义顺序在后。"""
    spec = SECTION_BY_KEY[key]
    fields = tuple(
        ConsumedFieldSpec(
            field_id=field.field_id,
            key=field.key,
            label=field.label,
            field_type=field.field_type,
            order=field.order,
            llm_allowed=field.llm_allowed,
            webform_allowed=field.webform_allowed,
            private=field.private,
            is_builtin=True,
        )
        for field in spec.fields
        if field.field_id not in hidden
    ) + _custom_specs(custom_fields, hidden, start_order=len(spec.fields) + 1)
    return ConsumedSection(
        key=spec.key,
        name=spec.name,
        form=spec.form,
        carrier_field_id=spec.carrier_field_id,
        material_only=spec.material_only,
        primary_field_id=None,
        fields=fields,
        entries=(),
    )


def _custom_section(
    row: ProfileCustomSection, hidden: frozenset[str], custom_fields: list[ProfileCustomField]
) -> ConsumedSection:
    """自建大字段：形态恒为多条；主文本字段（primary_field_id）随定义带入纸面策略。"""
    return ConsumedSection(
        key=row.key,
        name=row.name,
        form="multi",
        carrier_field_id=None,
        material_only=False,
        primary_field_id=row.primary_field_id,
        fields=_custom_specs(custom_fields, hidden, start_order=1),
        entries=(),
        revision=int(row.revision or 1),
    )


def _sections(db: Session, scope: ProfileScope) -> dict[str, ConsumedSection]:
    """按 scope 顺序建分区骨架：每个参与 key 都有 ConsumedSection（C1）。"""
    hidden = _hidden_field_ids(db)
    custom_rows = {row.key: row for row in workspace_bootstrap.active_custom_sections(db)}
    custom_fields = _custom_fields_by_section(db)
    sections: dict[str, ConsumedSection] = {}
    for key in scope.participating_keys:
        if key in SECTION_BY_KEY:
            sections[key] = _builtin_section(key, hidden, custom_fields.get(key, []))
            continue
        row = custom_rows.get(key)
        if row is None:
            # scope 来自 repair_group_members（只会给活动 key），走到这里说明定义在读的
            # 间隙被删掉；如实报"定义变了"，不静默少一节（否则 C1 的键集合会破）。
            raise Conflict("大字段定义已变化：请刷新页面后重试")
        sections[key] = _custom_section(row, hidden, custom_fields.get(key, []))
    return sections


def _consume_entries(
    db: Session, sections: dict[str, ConsumedSection]
) -> dict[str, tuple[ConsumedEntry, ...]]:
    """参与分区里的活动条目；字段裁剪 + 空值剔除 + 稳定排序（sort_order, id）。"""
    grouped: dict[str, list[ConsumedEntry]] = {key: [] for key in sections}
    if not sections:
        return {key: () for key in sections}
    rows = entry_store.list_entries(db, section_keys=set(sections))
    for row in rows:
        section = sections.get(row.section_key)
        if section is None:
            continue
        allowed = {field.field_id for field in section.fields}
        values = {
            str(field_id): str(value)
            for field_id, value in (row.values or {}).items()
            if str(field_id) in allowed and str(value or "").strip()
        }
        if not values:
            # 空壳条目 = 没有可见值：按"没数据"处理，不让它成为候选或占位。
            continue
        grouped[row.section_key].append(
            ConsumedEntry(
                entry_id=row.entry_id,
                sort_order=int(row.sort_order or 0),
                values=values,
            )
        )
    result: dict[str, tuple[ConsumedEntry, ...]] = {}
    for key in sections:
        entries = tuple(grouped[key])
        if sections[key].form == "singleton":
            entries = entries[:1]  # 数据库已约束，这里只是把"至多一条"写进消费契约
        result[key] = entries
    return result


def load_consumed_profile(db: Session, scope: ProfileScope) -> ConsumedProfile:
    """按冻结的 scope 读取消费快照（C1：sections 键集合 == participating_keys）。"""
    sections = _sections(db, scope)
    entries = _consume_entries(db, sections)
    for key, section in sections.items():
        sections[key] = replace(section, entries=entries[key])
    return ConsumedProfile(
        group_id=scope.group_id,
        group_name=scope.group_name,
        is_default=scope.is_default,
        participating_keys=scope.participating_keys,
        section_order=scope.section_order,
        workspace_revision=scope.workspace_revision,
        sections=sections,
    )


def load_all_consumed_profile(db: Session) -> ConsumedProfile:
    """三链外全量读：不按当前组裁剪（R-64 非目标：助手/评分/审阅仍读全部资料）。"""
    return load_consumed_profile(db, all_sections_scope(db))


def workspace_has_entry_values(db: Session) -> bool:
    """新模型是否有实际非空条目值（R-47 的 new_profile_has_entries）。"""
    return db.execute(_ENTRY_VALUE_EXISTS_SQL).first() is not None


def load_workspace_upgrade_status(db: Session) -> tuple[bool, bool]:
    """R-47 升级状态 (has_legacy_data, new_profile_has_entries)。

    新模型已经有实际内容时不再探测旧表：升级提示的前提是"新模型为空"，此时旧表探测
    只会白白多查几轮；同时这也让"首次有效保存后提示自然消失"不需要任何失效通知。
    """
    if workspace_has_entry_values(db):
        return False, True
    return legacy_status.has_legacy_data(db), False


__all__ = [
    "load_all_consumed_profile",
    "load_consumed_profile",
    "load_workspace_upgrade_status",
    "workspace_has_entry_values",
]
