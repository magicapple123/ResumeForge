# SPDX-License-Identifier: Apache-2.0
"""422 参数校验文案的唯一映射表（中文、不回显输入原文）。

**为什么放在 runtime 这个中立层**：同一份 Pydantic 校验错误在两处出口被翻译——全局
``application._validation_error_handler``（HTTP 出口）与 ``services.actions.spec.validate_input``
（Agent 工具 / 迁移路由出口）。两份映射表各写一遍迟早分叉：用户从界面看到的文案和助手
复述的文案会对不上。这里只依赖字符串与字典，**不 import app.api / app.services.actions**，
避免把「应用装配层」和「action 契约层」拉进同一个 import 环。

口径（逐字沿用旧实现，改文案等于改产品文案）：
- ``value_error`` / ``assertion_error`` 是自定义校验器写的文案，去掉 Pydantic 的
  ``Value error, `` 前缀后原样保留（那本来就是中文产品文案）；
- ``string_too_short`` / ``string_too_long`` / ``too_short`` / ``too_long`` 带上限制数值；
- 边界类 ``greater_than_equal`` / ``less_than_equal`` / ``greater_than`` / ``less_than``
  （pydantic v2 对 ``ge/le/gt/lt`` 的报错类型）带上限制值：「应 ≥1」「应 ≤100」；
- ``literal_error`` / ``enum`` 带上可选值；
- 其余按 :data:`VALIDATION_TYPE_MESSAGES` 查表，查不到兜底「参数格式不正确」；
- **不回显输入原文**：只说"哪里错、限制是多少"，响应体里不出现用户提交的正文。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

# Pydantic 内置英文文案 → 中文。自定义校验器的中文原样保留，不在这张表里。
VALIDATION_TYPE_MESSAGES: dict[str, str] = {
    "missing": "缺少必填字段",
    "string_type": "应为文本",
    "int_type": "应为整数",
    "float_type": "应为数字",
    "bool_type": "应为布尔值",
    "list_type": "应为列表",
    "dict_type": "应为对象",
    "string_too_short": "内容太短",
    "string_too_long": "内容过长",
    "too_short": "数量太少",
    "too_long": "数量太多",
    "literal_error": "取值不在允许范围内",
    "enum": "取值不在允许范围内",
    "extra_forbidden": "包含不支持的字段",
    "json_invalid": "请求体不是合法的 JSON",
    "bool_parsing": "布尔值格式不正确",
    "int_parsing": "整数格式不正确",
    "float_parsing": "数字格式不正确",
    "date_parsing": "日期格式不正确",
    "datetime_parsing": "日期时间格式不正确",
    "time_parsing": "时间格式不正确",
    "url_parsing": "链接格式不正确",
    "string_pattern_mismatch": "格式不符合要求",
}

# 单条文案的字符上限：限制值本身很短，但自定义校验器可能塞进长篇说明。
VALIDATION_MESSAGE_MAX_CHARS = 300

# 边界类错误（pydantic v2 的 ge/le/gt/lt，例如 ``Field(ge=1)`` 被传 0）：限制值是数值，
# **必须带出来**，否则用户只知道"参数不对"却不知道改成多少（「page: 参数格式不正确」等于没说）。
# 映射的 (ctx 键, 文案模板)：键缺失时退回兜底文案，绝不 KeyError（错型来自 pydantic 版本差异）。
BOUND_MESSAGES: dict[str, tuple[str, str]] = {
    "greater_than_equal": ("ge", "应 ≥{value}"),
    "less_than_equal": ("le", "应 ≤{value}"),
    "greater_than": ("gt", "应 >{value}"),
    "less_than": ("lt", "应 <{value}"),
}

# 无 type 信息时的兜底文案（两条出口必须一致）。
FALLBACK_VALIDATION_MESSAGE = "参数格式不正确"


def validation_message(error: Mapping[str, Any]) -> str:
    """单条校验错误的中文文案。

    ``error`` 的形状与 FastAPI ``RequestValidationError.errors()`` 的元素一致
    （``type`` / ``loc`` / ``msg`` / ``ctx``），Pydantic 的 ``ValidationError.errors()``
    返回同形结构，两条出口共用本函数。

    Args:
        error: 一条 Pydantic 校验错误字典。

    Returns:
        中文文案；自定义校验器（value_error/assertion_error）保留其原始文案。
    """
    type_ = str(error.get("type") or "")
    context = error.get("ctx") or {}
    raw_message = str(error.get("msg") or "").strip()
    if type_ in {"value_error", "assertion_error"}:
        message = raw_message.removeprefix("Value error, ").strip()
        return message or "参数不合法"
    if type_ == "string_too_short":
        minimum = context.get("min_length")
        return f"内容至少需要 {minimum} 个字符" if minimum else "内容不能为空"
    if type_ == "string_too_long":
        maximum = context.get("max_length")
        return f"内容不能超过 {maximum} 个字符" if maximum else "内容超出长度上限"
    if type_ == "too_short":
        minimum = context.get("min_length")
        return f"至少需要 {minimum} 项" if minimum else "数量太少"
    if type_ == "too_long":
        maximum = context.get("max_length")
        return f"最多允许 {maximum} 项" if maximum else "数量太多"
    if type_ in {"literal_error", "enum"}:
        expected = str(context.get("expected") or "").strip()
        return f"取值不在允许范围内（可选值：{expected}）" if expected else "取值不在允许范围内"
    bound = BOUND_MESSAGES.get(type_)
    if bound is not None:
        key, template = bound
        limit = context.get(key)
        # 0 是合法边界值（ge=0），只能用 is None 判缺失，不能用真假值。
        return template.format(value=limit) if limit is not None else FALLBACK_VALIDATION_MESSAGE
    return VALIDATION_TYPE_MESSAGES.get(type_) or FALLBACK_VALIDATION_MESSAGE


__all__ = [
    "BOUND_MESSAGES",
    "FALLBACK_VALIDATION_MESSAGE",
    "VALIDATION_MESSAGE_MAX_CHARS",
    "VALIDATION_TYPE_MESSAGES",
    "validation_message",
]
