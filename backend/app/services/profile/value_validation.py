# SPDX-License-Identifier: Apache-2.0
"""资料值校验的纯函数与上限常量（契约 §3.4）：写库前把输入收口到可存储形态。

**为什么单独成模块**：同一批规则要被自建分区、自建小字段、条目值三条写路径复用
（Task C 的 definition_store / entry_store），放一处才能保证"一处逻辑一份实现"；
本模块不 import models、不读库、不联网，便于离线单测。

**宽松优先**：日期走既有的 normalize_partial_date，无法识别的原文保留而不报错
（R-10：宽松、不强制合法）；枚举建议只是输入提示，校验层不拒绝枚举外的值（§3.3）。
真正报错的只有：空/超长名称、非法字段类型、超长值、未知 field_id。

**错误文案**：ValidationFailure.detail 必须说清"发生了什么 + 怎么办"（AGENTS 文案
硬约束），code 供 API 组装机器可读错误（Task D 的错误映射直接带上它）。
"""

from __future__ import annotations

from collections.abc import Mapping

from ...schemas.date_format import normalize_partial_date
from ...schemas.profile import MAX_PROFILE_PHOTO_BYTES
from .definition_catalog import get_field

MAX_SINGLE_LINE_CHARS = 200
MAX_MULTI_LINE_CHARS = 2000
# 照片值同时承载两种形态：资源引用（`profile_photo:<id>`）与 data URL（纸面投影原样
# 透传、AI 生成直接把 resume.photo 当 img src 用）。上限必须覆盖上传侧
# MAX_PROFILE_PHOTO_BYTES 的 base64 膨胀（5 MB → 约 6.99 M 字符，见
# schemas.profile 的 _encoded_char_limit）；2048 只够存引用，照片一旦真的进了条目值，
# 保存就会被拒——比"照片不显示"更糟。
MAX_PHOTO_REFERENCE_CHARS = 7_000_000
MAX_FIELD_LABEL_CHARS = 40
MAX_SECTION_NAME_CHARS = 40
MAX_CUSTOM_FIELDS_PER_SECTION = 20
MAX_ENTRIES_PER_SECTION = 200
MAX_GROUPS = 20
TEXT_FIELD_TYPES = ("single_line", "multi_line", "date_text")
PHOTO_FIELD_TYPE = "photo"
_FIELD_TYPES = (*TEXT_FIELD_TYPES, PHOTO_FIELD_TYPE)

_ASCII_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_NAME_KEY_TRANSLATION = str.maketrans(_ASCII_UPPER, _ASCII_UPPER.lower())


class ValidationFailure(ValueError):
    """定义或值不合法：code 给机器判断，detail 给人看（含下一步怎么做）。"""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


def normalize_name_key(value: str) -> str:
    """strip 后仅 ASCII A-Z→a-z；不折叠全角、不做 Unicode casefold（契约 §1.4）。"""
    return str(value or "").strip().translate(_NAME_KEY_TRANSLATION)


def validate_section_name(raw: str) -> str:
    """自定义大字段名称：trim 后 1–40 个字符（需求 R-04）。"""
    name = str(raw or "").strip()
    if not name:
        raise ValidationFailure(
            "section_name_empty", "大字段名称不能为空：请填写 1–40 个字符的名称后重试"
        )
    if len(name) > MAX_SECTION_NAME_CHARS:
        raise ValidationFailure(
            "section_name_too_long",
            f"大字段名称不能超过 {MAX_SECTION_NAME_CHARS} 个字符（当前 {len(name)}），请缩短后重试",
        )
    return name


def validate_field_label(raw: str) -> str:
    """自定义小字段名称：trim 后 1–40 个字符（需求 R-11）。"""
    label = str(raw or "").strip()
    if not label:
        raise ValidationFailure(
            "field_label_empty", "字段名称不能为空：请填写 1–40 个字符的名称后重试"
        )
    if len(label) > MAX_FIELD_LABEL_CHARS:
        raise ValidationFailure(
            "field_label_too_long",
            f"字段名称不能超过 {MAX_FIELD_LABEL_CHARS} 个字符（当前 {len(label)}），请缩短后重试",
        )
    return label


def validate_field_type(raw: str) -> str:
    """自定义小字段只允许三种文本类型（R-10）；照片等专用类型不可自定义。"""
    field_type = str(raw or "").strip()
    if field_type not in TEXT_FIELD_TYPES:
        raise ValidationFailure(
            "field_type_unsupported",
            "暂不支持这个字段类型：自定义小字段只能是单行文本、多行文本或日期文本，请重新选择",
        )
    return field_type


def _as_text(raw: object) -> str:
    """把 JSON 值收口成文本：None→空串、数字→十进制文本，其余类型拒绝。"""
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ValidationFailure(
            "value_type_invalid",
            "字段值必须是文本：请只填写一段文字（或清空该字段）后重新保存",
        )
    return str(raw)


def validate_value(field_type: str, raw: object) -> str:
    """按字段类型收口一个值；空串保留为空串（表示清空），不把 None 当成错误。"""
    normalized_type = str(field_type or "").strip()
    if normalized_type not in _FIELD_TYPES:
        raise ValidationFailure(
            "field_type_unsupported",
            f"字段类型「{normalized_type or '空'}」无法识别：请刷新页面后重新保存",
        )
    text = _as_text(raw)
    if normalized_type == PHOTO_FIELD_TYPE:
        reference = text.strip()
        if len(reference) > MAX_PHOTO_REFERENCE_CHARS:
            # 文案不再报"字符数"：用户看不懂 7 位数字，他要的是"照片太大，换一张小的"。
            raise ValidationFailure(
                "photo_reference_too_long",
                f"照片太大（超过 {MAX_PROFILE_PHOTO_BYTES // (1024 * 1024)} MB），"
                "请换一张更小的照片后重试",
            )
        return reference
    if normalized_type == "date_text":
        # 日期内容宽松（识别不了保留原文），但仍要限长，避免超长输入占满条目 JSON。
        date_text = text.strip()
        if len(date_text) > MAX_SINGLE_LINE_CHARS:
            raise ValidationFailure(
                "value_too_long",
                f"日期文本不能超过 {MAX_SINGLE_LINE_CHARS} 个字符（当前 {len(date_text)}），"
                "请精简后重试",
            )
        return normalize_partial_date(date_text)
    value = text.strip()
    limit = MAX_SINGLE_LINE_CHARS if normalized_type == "single_line" else MAX_MULTI_LINE_CHARS
    if len(value) > limit:
        kind = "单行文本" if normalized_type == "single_line" else "多行文本"
        raise ValidationFailure(
            "value_too_long",
            f"{kind}不能超过 {limit} 个字符（当前 {len(value)}），请精简内容后重试",
        )
    return value


def _field_type_of(field_id: str) -> str:
    spec = get_field(field_id)
    return spec.field_type if spec is not None else "multi_line"


def _validate_values(
    section_key: str,
    values: Mapping[str, object],
    allowed_field_ids: set[str],
    field_types: Mapping[str, str] | None = None,
) -> dict[str, str]:
    if not isinstance(values, Mapping):
        raise ValidationFailure(
            "invalid_values",
            "字段值必须是「字段 id → 文本」的对象：请刷新页面后重新保存",
        )
    result: dict[str, str] = {}
    for raw_field_id, raw_value in values.items():
        field_id = str(raw_field_id)
        if field_id not in allowed_field_ids:
            raise ValidationFailure(
                "unknown_field",
                f"字段「{field_id}」不属于大字段「{section_key}」（可能已被删除）："
                "请刷新页面后重新填写",
            )
        field_type = field_types[field_id] if field_types is not None else _field_type_of(field_id)
        result[field_id] = validate_value(field_type, raw_value)
    return result


def validate_values(
    section_key: str, values: Mapping[str, object], allowed_field_ids: set[str]
) -> dict[str, str]:
    """校验一个条目的全部字段值（契约 §3.4 签名；未知 field_id 直接拒绝）。

    内置字段按目录里的真实类型校验；自定义字段不在代码目录里、类型来自库中定义，
    这里按最宽松的多行文本处理，需要精确校验时用 validate_values_with_types。
    显式空字符串保留为 ""——那是"清空"，不是"没有提交"。
    """
    return _validate_values(section_key, values, {str(item) for item in allowed_field_ids})


def validate_values_with_types(
    section_key: str, values: Mapping[str, object], field_types: Mapping[str, str]
) -> dict[str, str]:
    """按调用方给的真实字段类型校验（条目保存用：自定义字段类型来自 DB 定义）。"""
    return _validate_values(
        section_key,
        values,
        {str(item) for item in field_types},
        {str(key): str(value) for key, value in field_types.items()},
    )


__all__ = [
    "MAX_CUSTOM_FIELDS_PER_SECTION",
    "MAX_ENTRIES_PER_SECTION",
    "MAX_FIELD_LABEL_CHARS",
    "MAX_GROUPS",
    "MAX_MULTI_LINE_CHARS",
    "MAX_PHOTO_REFERENCE_CHARS",
    "MAX_SECTION_NAME_CHARS",
    "MAX_SINGLE_LINE_CHARS",
    "PHOTO_FIELD_TYPE",
    "TEXT_FIELD_TYPES",
    "ValidationFailure",
    "normalize_name_key",
    "validate_field_label",
    "validate_field_type",
    "validate_section_name",
    "validate_value",
    "validate_values",
    "validate_values_with_types",
]
