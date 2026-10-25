# SPDX-License-Identifier: Apache-2.0
"""补充事实的生成候选快照：只读、去私密、按固定 section 输出。

**只读**：生成路径不写任何业务数据；快照在生成开始时取一次，之后资料被编辑/删除
不影响本次生成。

**去私密**：credential_number 在映射层剔除（见 fact_mapping），本模块保证
prompt_sections 的输出里不会出现它。证号只留在用户本地库与本地 CRUD 响应里。

**隐藏字段**：字段设置（profile_fact_field_pref）里被隐藏的默认字段，在 prompt_sections
里先剔除再映射；事实 payload 本身保留旧值（items 里是完整原始 payload），这样
"字段设置改回可见"时旧值立刻回来。

**顺序稳定**：事实按 sort_order、id 排序取用，与列表接口一致；同一份资料在不同
时间读取得到同一顺序，候选结果可复现。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...models.profile_fact import PROFILE_FACT_KINDS, ProfileFact
from .. import trash
from . import fact_store
from .fact_field_schema import KindFieldSchema, load_field_schemas, mapping_payload
from .fact_mapping import FACT_SECTION_BY_KIND, FACT_SECTION_KEYS, map_fact_payload


class ProfileFactContext(BaseModel):
    """一次生成使用的事实快照（只读，不写库）。

    hidden_by_kind / custom_by_kind 是字段设置快照，和 items 一起取一次：
    生成路径不能中途重读当前设置（否则同一次生成的前后段可能用两套定义）。
    items 里的 payload 是**完整原始 payload**（含被隐藏字段的旧值），由 prompt_sections
    在映射前剔除。
    """

    items: list[dict[str, Any]] = Field(default_factory=list)
    hidden_by_kind: dict[str, tuple[str, ...]] = Field(default_factory=dict)
    custom_by_kind: dict[str, tuple[dict[str, str], ...]] = Field(default_factory=dict)


def load_fact_context(db: Session) -> ProfileFactContext:
    """读取当前数据集全部未删事实 + 字段设置，按展示顺序返回快照。

    还没有资料主表行时返回空快照（**不创建** profile 行）：读取不许产生写入。
    """
    hidden_by_kind: dict[str, tuple[str, ...]] = {kind: () for kind in PROFILE_FACT_KINDS}
    custom_by_kind: dict[str, tuple[dict[str, str], ...]] = {
        kind: () for kind in PROFILE_FACT_KINDS
    }
    profile_id = fact_store.current_profile_id(db)
    if profile_id is None:
        return ProfileFactContext(
            items=[], hidden_by_kind=hidden_by_kind, custom_by_kind=custom_by_kind
        )
    for kind, schema in load_field_schemas(db).items():
        hidden_by_kind[kind] = schema.hidden_fields
        custom_by_kind[kind] = schema.custom_fields
    rows = (
        db.query(ProfileFact)
        .filter(ProfileFact.profile_id == profile_id, trash.live_only(ProfileFact))
        .order_by(ProfileFact.sort_order.asc(), ProfileFact.id.asc())
        .all()
    )
    return ProfileFactContext(
        items=[
            {
                "fact_id": row.fact_id,
                "kind": row.kind,
                "revision": row.revision,
                "payload": row.payload or {},
            }
            for row in rows
        ],
        hidden_by_kind=hidden_by_kind,
        custom_by_kind=custom_by_kind,
    )


def prompt_sections(ctx: ProfileFactContext) -> dict[str, list[dict[str, Any]]]:
    """把事实快照转成九个候选 section（灵活化契约 §5）。

    永远返回九个键（没有事实时是空列表），调用方据此决定是否扩展提示词结构；
    隐藏的默认字段先剔除；自定义字段只保留当前定义里的项。未知 kind 跳过而不是
    报错——旧数据/未来类型不应该阻断本次生成。
    """
    sections: dict[str, list[dict[str, Any]]] = {key: [] for key in FACT_SECTION_KEYS}
    for item in ctx.items:
        kind = str(item.get("kind") or "")
        section = FACT_SECTION_BY_KIND.get(kind)
        if section is None:
            # 未知 kind 直接跳过：旧数据/未来类型不能阻断本次生成，也不该触发映射层的
            # "未知类型"校验错误。
            continue
        payload = item.get("payload")
        schema = KindFieldSchema(
            kind=kind,
            revision=0,
            hidden_fields=ctx.hidden_by_kind.get(kind, ()),
            custom_fields=ctx.custom_by_kind.get(kind, ()),
        )
        effective = mapping_payload(kind, payload if isinstance(payload, dict) else {}, schema)
        mapped = map_fact_payload(kind, effective)
        if mapped is None:
            continue
        sections[section].append(mapped)
    return sections


def build_fact_sections(ctx: ProfileFactContext) -> dict[str, list[dict[str, Any]]]:
    """生成入口的便捷函数：快照 → 可直接传给 build_profile_prompt_data 的 fact_sections。

    与 prompt_sections 是同一份实现的别名语义——生成链路只需认这一个名字（Lead 接线约定）。
    """
    return prompt_sections(ctx)


__all__ = ["ProfileFactContext", "build_fact_sections", "load_fact_context", "prompt_sections"]
