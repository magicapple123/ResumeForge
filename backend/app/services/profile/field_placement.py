# SPDX-License-Identifier: Apache-2.0
"""自定义字段的纸面位置与"仅素材"属性（v2 文档模型 D6，迁移 0069）。

**为什么需要这个模块**：v2 文档模型里每个字段是一条 item，位置（title/meta/lead/trail/
body/hidden）是 item 上的数据；资料页与制作台必须共用**同一份**"自定义字段第一次落进
哪个抽屉"的规则，否则会出现"资料页说在正文后灰字、制作台塞进正文"的分裂。所以：

- 默认值规则只写一次：单行/日期 → trail（灰色短字段），多行 → body（正文）；
- material_only（仅素材）字段**永不上纸面**，有效位置恒为 hidden（D6/验收 2）；
- 用户显式选的 default_placement 优先于类型默认；null = 跟随类型默认。

本模块只做纯规则 + 一次只读查询，不写库、不 import API 层。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ...models.profile_definition import ProfileCustomField
from .errors import ValidationError

# 允许的纸面位置（D1）。顺序用于错误提示，别改成 set 的迭代顺序。
PLACEMENT_ORDER: tuple[str, ...] = ("title", "meta", "lead", "trail", "body", "hidden")
PLACEMENTS: frozenset[str] = frozenset(PLACEMENT_ORDER)

# 未显式选择时按字段类型取默认（D6）：短字段是灰色短字段，长文本是正文块。
DEFAULT_PLACEMENT_BY_TYPE: dict[str, str] = {
    "single_line": "trail",
    "date_text": "trail",
    "multi_line": "body",
}


def default_placement_for_type(field_type: str) -> str:
    """字段类型 → 默认纸面位置（未知类型按短字段处理，绝不默认 hidden 吞内容）。"""
    return DEFAULT_PLACEMENT_BY_TYPE.get(str(field_type or "").strip(), "trail")


def normalize_default_placement(field_type: str, value: str | None) -> str | None:
    """校验用户传入的默认位置；None/空串 = 恢复"按类型自动"（返回 None）。"""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text not in PLACEMENTS:
        options = "、".join(PLACEMENT_ORDER)
        raise ValidationError(f"纸面位置不合法（可选：{options}）：请重新选择后保存")
    return text


def effective_placement(field_type: str, default_placement: str | None, material_only: bool) -> str:
    """一条字段真正会落到的位置：仅素材恒 hidden；否则显式值优先、再按类型默认。"""
    if material_only:
        return "hidden"
    if default_placement in PLACEMENTS:
        return str(default_placement)
    return default_placement_for_type(field_type)


def field_definition(row: ProfileCustomField) -> dict[str, Any]:
    """一个自定义字段的 v2 转换器元数据（document_converter.custom_fields 的元素形状）。"""
    material_only = bool(row.material_only)
    return {
        "section_key": row.section_key,
        "field_id": row.field_id,
        "label": row.label,
        "field_type": row.field_type,
        # 转换器直接用这个"有效位置"，不必再实现一遍 D6 的默认规则。
        "default_placement": effective_placement(
            row.field_type, row.default_placement, material_only
        ),
        "material_only": material_only,
    }


def custom_field_definitions(db: Session) -> dict[str, list[dict[str, Any]]]:
    """当前方案的活动自定义字段，按资料分区 key 归组（转换器/生成/投影共用）。

    只含自建字段：内置字段的位置来自代码里的文档字段目录，不在这里复制第二份。
    """
    from .field_preferences import custom_field_rows  # 延迟导入：避免定义层循环 import

    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in custom_field_rows(db):
        grouped.setdefault(row.section_key, []).append(field_definition(row))
    return grouped


__all__ = [
    "DEFAULT_PLACEMENT_BY_TYPE",
    "PLACEMENTS",
    "PLACEMENT_ORDER",
    "custom_field_definitions",
    "default_placement_for_type",
    "effective_placement",
    "field_definition",
    "normalize_default_placement",
]
