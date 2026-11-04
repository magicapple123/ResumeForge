# SPDX-License-Identifier: Apache-2.0
"""读取侧字段上限：写入校验与读取投影共用同一套约束的唯一来源。

**为什么要有它**（2026-11 用户报告）：写入侧只按字段类型给上限（单行 200 / 多行
2000），而读取投影用 ``*Out`` 模型逐字段建模、字段上有更紧的 ``max_length``（如
``AwardOut.name`` 128）。于是 160 字的奖项名称能写进库，``GET /api/profile`` 的投影
当场 ``ValidationError``，资料页整页 500——写入时没人拦。

这里的唯一职责：把**读取模型本身的 max_length** 变成 ``field_id → 上限`` 映射，供写入
收口（``entry_store``）使用。上限取自模型注解而不是抄数字：读取侧改约束，写入侧自动
跟上，两侧永远不会漂。没有读取模型的自建分区不在映射里，继续走类型上限（宽松优先）。
"""

from __future__ import annotations

from pydantic.fields import FieldInfo

from ...schemas import profile as profile_schemas
from .definition_catalog import get_field

# 旧协议字段 → 新模型 field_id 的映射唯一来源在 profile_service（_ITEM_FIELD_MAP /
# _BASIC_FIELD_MAP）；这里只 import 不复制——两边各写一份迟早漂。
from .profile_service import _BASIC_FIELD_MAP, _ITEM_FIELD_MAP

# 分区 key → 读取投影用的模型（与 profile_service._build_profile_out 的 out_models
# 逐字一致；该函数是旧协议读取的唯一实现）。
_SECTION_OUT_MODELS: tuple[tuple[str, type], ...] = (
    ("educations", profile_schemas.EducationOut),
    ("experiences", profile_schemas.ExperienceOut),
    ("campus_experiences", profile_schemas.CampusExperienceOut),
    ("projects", profile_schemas.ProjectOut),
    ("skills", profile_schemas.SkillOut),
    ("awards", profile_schemas.AwardOut),
)


def _max_length_of(field: FieldInfo) -> int | None:
    """取 pydantic 字段上的 ``max_length`` 约束（``Field(max_length=…)`` → metadata）。"""
    for meta in field.metadata:
        limit = getattr(meta, "max_length", None)
        if isinstance(limit, int) and limit > 0:
            return limit
    return None


def _item_limits() -> dict[str, int]:
    """子表分区：读取模型字段的 max_length → ``<section>.<key>`` 上限。"""
    limits: dict[str, int] = {}
    for section_key, model in _SECTION_OUT_MODELS:
        fields = model.model_fields
        for legacy_key, field_id in _ITEM_FIELD_MAP.get(section_key, {}).items():
            if field_id is None:
                continue  # 旧字段在新模型没有位置，读取投影根本不读它
            info = fields.get(legacy_key)
            if info is None:
                continue
            limit = _max_length_of(info)
            if limit is not None:
                limits[field_id] = limit
    return limits


def _basic_limits() -> dict[str, int]:
    """基本信息与个人总结：旧标量的 max_length → 单例 field_id 上限。"""
    fields = profile_schemas.ProfileOut.model_fields
    limits: dict[str, int] = {}
    for legacy_key, field_id in _BASIC_FIELD_MAP.items():
        info = fields.get(legacy_key)
        if info is None:
            continue
        limit = _max_length_of(info)
        if limit is not None:
            limits[field_id] = limit
    summary = fields.get("summary")
    if summary is not None:
        limit = _max_length_of(summary)
        if limit is not None:
            limits["summary.content"] = limit
    return limits


# field_id → 读取侧允许的最大字符数（导入期构建一次；读取模型是代码常量）。
READ_SIDE_LIMITS: dict[str, int] = {**_item_limits(), **_basic_limits()}


def limit_of(field_id: str) -> int | None:
    """某字段在读取侧的上限；没有读取模型（自建字段等）返回 None = 不额外限制。"""
    return READ_SIDE_LIMITS.get(str(field_id))


def too_long_detail(field_id: str, length: int, limit: int) -> str:
    """超限文案：只写原因（下一步由前端 errorGuidance 给），字段名用目录里的标签。"""
    spec = get_field(field_id)
    label = spec.label if spec is not None else field_id
    return f"「{label}」最多 {limit} 个字符，当前 {length} 个字符，超出部分无法被资料页读出"


__all__ = ["READ_SIDE_LIMITS", "limit_of", "too_long_detail"]
