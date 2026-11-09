# SPDX-License-Identifier: Apache-2.0
"""求职偏好 13 类闭集目录 + 逐 kind 值校验器（计划 §6.3.2 / §6.3.5 约束 1）。

**唯一真源**：kind 的闭集、值形态（list / scalar）、中文目录标签（注入块与工具结果用）、
注入优先级、枚举选项与每个 kind 的规范化/校验规则都只写在本模块。写入路径
（pydantic schema）与注入路径（job_preference_prompt）都从这里取，不复制第二份目录。

为什么必须有逐 kind 校验器（而不是只靠提示词）：提示词只给语义边界，模型照样会
把"我带过 5 人团队"写成偏好。闭集 + 参数校验让这类输入在**参数校验阶段（422）**就不
存在；同时也挡住"城市=杭州某公司"这类把经历混进意图的值。

约定：
- value 的存储形态由 value_kind 决定：list 存数组，scalar 存小对象或协议串；
- 规范化是**幂等**的：已规范化的值再进一次校验返回等价值（审批路径会对同一份原始参数
  重复校验，预览指纹因此稳定）；
- 校验失败抛 PreferenceValidationError（ValueError 子类），由 pydantic 转 422。
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from .job_preference_taxonomy import (
    CHINESE_NUMBERS,
    EMPLOYMENT_TYPE_MAP,
    EMPLOYMENT_TYPE_OPTIONS,
    OVERTIME_MAP,
    OVERTIME_OPTIONS,
    REDLINE_TONE_OPTIONS,
    TONE_MAP,
    WORK_MODE_MAP,
    WORK_MODE_OPTIONS,
)


class PreferenceValidationError(ValueError):
    """偏好值不合法（中文可读消息；pydantic 校验器里原样转成 422）。"""


# ===== value_kind =====

PREF_VALUE_KIND_LIST = "list"
PREF_VALUE_KIND_SCALAR = "scalar"


@dataclass(frozen=True)
class PreferenceKindSpec:
    """一类偏好的完整定义（目录即数据，不落库）。"""

    kind: str
    label: str
    value_kind: str
    # 注入块内排序：越小越重要；降级裁尾时先丢大的。session_note 不注入，给最大值。
    inject_priority: int
    normalize: Callable[[Any], Any]
    inject: bool = True
    # 枚举型 scalar 的 (协议值, 中文展示) 列表；空表示自由值。
    options: tuple[tuple[str, str], ...] = field(default_factory=tuple)


# ===== 通用清洗 =====

# 列表元素的公共分隔符：用户/模型常见写法「杭州、上海」「杭州,上海」。
_LIST_SPLIT_RE = re.compile(r"[、,，;；/|]+")
# 履历名词：城市字段里出现这些词，说明用户把"经历/单位"写进了意图，必须挡下。
_RESUME_NOUN_RE = re.compile(
    r"(公司|集团|企业|单位|学校|大学|学院|研究所|项目|实习|任职|职位|岗位|证书|绩点|GPA)",
    re.IGNORECASE,
)
_DIGIT_RE = re.compile(r"[0-9０-９]")
_SALARY_RE = re.compile(
    r"^(?:(月薪|月|年薪|年|底薪)\s*)?([0-9]+(?:\.[0-9]+)?)\s*(k|K|千|万|元)?\s*(?:/?\s*(月|年))?$"
)
_PAGES_RE = re.compile(r"^(?:(?:正文|最多|不超过|限制)\s*)?([0-9]+|[一二三四五六七八九十])\s*页?$")


def _clean_text(value: Any, *, label: str, max_chars: int) -> str:
    if not isinstance(value, str):
        raise PreferenceValidationError(f"{label}的每一项必须是文本")
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", value).strip()
    if not text:
        raise PreferenceValidationError(f"{label}不能有空项")
    if len(text) > max_chars:
        raise PreferenceValidationError(f"{label}的单项不能超过 {max_chars} 个字符")
    return text


def _as_items(value: Any, *, label: str) -> list[Any]:
    """把 list kind 的输入规范成条目序列（字符串按常见分隔符切开）。"""
    if isinstance(value, str):
        return [item for item in _LIST_SPLIT_RE.split(value) if item.strip()]
    if isinstance(value, (list, tuple)):
        return list(value)
    raise PreferenceValidationError(f'{label}必须是列表（如 ["杭州", "上海"]）')


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


# ===== 逐 kind 校验器 =====


def _normalize_target_role_family(value: Any) -> list[str]:
    items = [
        _clean_text(item, label="期望岗位方向", max_chars=40)
        for item in _as_items(value, label="期望岗位方向")
    ]
    if not items:
        raise PreferenceValidationError("期望岗位方向不能为空")
    if any(_DIGIT_RE.search(item) for item in items):
        raise PreferenceValidationError("期望岗位方向是岗位类别（如「产品运营」），不要填数字/年限")
    return _dedupe(items)


def _normalize_target_city(value: Any) -> list[str]:
    items = [
        _clean_text(item, label="期望城市", max_chars=20)
        for item in _as_items(value, label="期望城市")
    ]
    if not items:
        raise PreferenceValidationError("期望城市不能为空")
    for item in items:
        if _DIGIT_RE.search(item):
            raise PreferenceValidationError(f"城市名不能包含数字：{item}")
        if _RESUME_NOUN_RE.search(item):
            raise PreferenceValidationError(
                f"「{item}」像经历或单位名称，不是城市；城市只填城市名（如「杭州」）"
            )
    return _dedupe(items)


def _normalize_exclude_company(value: Any) -> list[str]:
    items = [
        _clean_text(item, label="排除公司", max_chars=60)
        for item in _as_items(value, label="排除公司")
    ]
    if not items:
        raise PreferenceValidationError("排除公司不能为空")
    return _dedupe(items)


def _normalize_exclude_industry(value: Any) -> list[str]:
    items = [
        _clean_text(item, label="排除行业", max_chars=40)
        for item in _as_items(value, label="排除行业")
    ]
    if not items:
        raise PreferenceValidationError("排除行业不能为空")
    return _dedupe(items)


def _normalize_salary_floor(value: Any) -> dict[str, Any]:
    """薪资底线：统一解析成 {amount, unit, currency}（amount 是元，unit=month/year）。"""
    if isinstance(value, dict):
        amount = value.get("amount")
        unit = str(value.get("unit") or "month").strip()
        currency = str(value.get("currency") or "CNY").strip().upper()
        if unit in ("月", "monthly", "month", "月薪"):
            unit = "month"
        elif unit in ("年", "yearly", "year", "年薪"):
            unit = "year"
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        amount, unit, currency = value, "month", "CNY"
    elif isinstance(value, str):
        text = value.strip().replace(" ", "")
        match = _SALARY_RE.match(text)
        if match is None:
            raise PreferenceValidationError(
                "薪资底线解析不了；请写成「月薪 15k」「年薪 30 万」或 {amount, unit, currency}"
            )
        prefix, number, scale, suffix = match.groups()
        unit = "year" if (prefix in ("年薪", "年") or suffix == "年") else "month"
        amount = float(number)
        if scale in ("k", "K", "千"):
            amount *= 1_000
        elif scale == "万":
            amount *= 10_000
        currency = "CNY"
    else:
        raise PreferenceValidationError(
            "薪资底线必须是数字、字符串或 {amount, unit, currency} 对象"
        )
    if isinstance(amount, bool) or not isinstance(amount, (int, float)):
        raise PreferenceValidationError("薪资底线的 amount 必须是数字")
    amount_int = int(amount)
    if amount_int <= 0:
        raise PreferenceValidationError("薪资底线必须大于 0")
    if amount_int > 10_000_000:
        raise PreferenceValidationError("薪资底线数值过大，请检查单位（k / 万 / 元）")
    if currency not in ("CNY",):
        raise PreferenceValidationError("目前只支持人民币（CNY）薪资底线")
    return {"amount": amount_int, "unit": unit, "currency": currency}


def _normalize_enum(
    value: Any,
    *,
    mapping: dict[str, str],
    label: str,
    options: tuple[tuple[str, str], ...],
) -> str:
    if not isinstance(value, str):
        raise PreferenceValidationError(f"{label}必须是文本")
    cleaned = value.strip()
    normalized = mapping.get(cleaned) or mapping.get(cleaned.lower())
    if normalized is None:
        allowed = "、".join(name for _, name in options)
        raise PreferenceValidationError(f"{label}只能是：{allowed}")
    return normalized


def _normalize_work_mode(value: Any) -> str:
    return _normalize_enum(
        value, mapping=WORK_MODE_MAP, label="工作方式", options=WORK_MODE_OPTIONS
    )


def _normalize_employment_type(value: Any) -> list[str]:
    """用工形式：列表，但每一项都必须是闭集里的一个（正职/实习/外包/兼职/劳务派遣）。"""
    items: list[str] = []
    allowed = "、".join(name for _, name in EMPLOYMENT_TYPE_OPTIONS)
    for item in _as_items(value, label="用工形式"):
        text = _clean_text(item, label="用工形式", max_chars=20)
        normalized = EMPLOYMENT_TYPE_MAP.get(text) or EMPLOYMENT_TYPE_MAP.get(text.lower())
        if normalized is None:
            raise PreferenceValidationError(f"用工形式只能是：{allowed}")
        items.append(normalized)
    if not items:
        raise PreferenceValidationError("用工形式不能为空")
    return _dedupe(items)


def _normalize_overtime(value: Any) -> str:
    return _normalize_enum(
        value, mapping=OVERTIME_MAP, label="加班接受度", options=OVERTIME_OPTIONS
    )


def _normalize_redline_banned_word(value: Any) -> list[str]:
    items = [
        _clean_text(item, label="写作红线禁用词", max_chars=20)
        for item in _as_items(value, label="写作红线禁用词")
    ]
    if not items:
        raise PreferenceValidationError("写作红线禁用词不能为空")
    if len(items) > 20:
        raise PreferenceValidationError("写作红线禁用词一次最多 20 个")
    return _dedupe(items)


def _normalize_redline_length(value: Any) -> dict[str, Any]:
    pages: Any = value.get("max_pages") if isinstance(value, dict) else value
    if isinstance(pages, str):
        match = _PAGES_RE.match(pages.strip())
        if match is None:
            raise PreferenceValidationError('篇幅限制解析不了；请写成「1 页」或 {"max_pages": 1}')
        raw = match.group(1)
        pages = CHINESE_NUMBERS.get(raw) or int(raw)
    if isinstance(pages, bool) or not isinstance(pages, int):
        raise PreferenceValidationError("篇幅限制的页数必须是整数")
    if not 1 <= pages <= 10:
        raise PreferenceValidationError("篇幅限制的页数必须在 1–10 之间")
    return {"max_pages": pages}


def _normalize_redline_tone(value: Any) -> str:
    return _normalize_enum(
        value, mapping=TONE_MAP, label="写作红线语气", options=REDLINE_TONE_OPTIONS
    )


def _normalize_available_from(value: Any) -> str:
    """到岗时间：ISO 日期字符串，或协议值 immediate（随时到岗）。"""
    if isinstance(value, date):
        return value.isoformat()
    if not isinstance(value, str):
        raise PreferenceValidationError("到岗时间必须是日期字符串或「随时」")
    text = value.strip()
    if text in ("随时", "随时到岗", "立即", "马上", "immediate"):
        return "immediate"
    normalized = text.replace("/", "-").replace(".", "-")
    try:
        if re.fullmatch(r"\d{4}-\d{1,2}", normalized):
            year, month = (int(part) for part in normalized.split("-"))
            return date(year, month, 1).isoformat()
        return date.fromisoformat(normalized).isoformat()
    except ValueError as exc:
        raise PreferenceValidationError(
            "到岗时间解析不了；请写成 2026-12-01 / 2026-12 或「随时」"
        ) from exc


def _normalize_session_note(value: Any) -> str:
    if not isinstance(value, str):
        raise PreferenceValidationError("仅本次对话的说明必须是文本")
    text = re.sub(r"\s+", " ", value).strip()
    if not text:
        raise PreferenceValidationError("仅本次对话的说明不能为空")
    if len(text) > 200:
        raise PreferenceValidationError("仅本次对话的说明不能超过 200 个字符")
    return text


# 顺序是**渲染与列表顺序**的行为契约（也决定降级裁尾的先后）：越靠前越重要。
_KIND_SPECS: tuple[PreferenceKindSpec, ...] = (
    PreferenceKindSpec(
        "target_role_family", "期望岗位方向", PREF_VALUE_KIND_LIST, 1, _normalize_target_role_family
    ),
    PreferenceKindSpec("target_city", "城市", PREF_VALUE_KIND_LIST, 2, _normalize_target_city),
    PreferenceKindSpec(
        "salary_floor", "薪资底线", PREF_VALUE_KIND_SCALAR, 3, _normalize_salary_floor
    ),
    PreferenceKindSpec(
        "work_mode",
        "工作方式",
        PREF_VALUE_KIND_SCALAR,
        4,
        _normalize_work_mode,
        options=WORK_MODE_OPTIONS,
    ),
    PreferenceKindSpec(
        "employment_type", "用工形式", PREF_VALUE_KIND_LIST, 5, _normalize_employment_type
    ),
    PreferenceKindSpec(
        "exclude_company", "排除公司", PREF_VALUE_KIND_LIST, 6, _normalize_exclude_company
    ),
    PreferenceKindSpec(
        "exclude_industry", "排除行业", PREF_VALUE_KIND_LIST, 7, _normalize_exclude_industry
    ),
    PreferenceKindSpec(
        "overtime",
        "加班接受度",
        PREF_VALUE_KIND_SCALAR,
        8,
        _normalize_overtime,
        options=OVERTIME_OPTIONS,
    ),
    PreferenceKindSpec(
        "available_from", "到岗时间", PREF_VALUE_KIND_SCALAR, 9, _normalize_available_from
    ),
    PreferenceKindSpec(
        "redline_banned_word",
        "写作红线（禁用词）",
        PREF_VALUE_KIND_LIST,
        10,
        _normalize_redline_banned_word,
    ),
    PreferenceKindSpec(
        "redline_length", "写作红线（篇幅）", PREF_VALUE_KIND_SCALAR, 11, _normalize_redline_length
    ),
    PreferenceKindSpec(
        "redline_tone",
        "写作红线（语气）",
        PREF_VALUE_KIND_SCALAR,
        12,
        _normalize_redline_tone,
        options=REDLINE_TONE_OPTIONS,
    ),
    # session_note 只服务「只在这次对话」按钮：前端可见，但**永不进系统提示注入块**
    # （计划 §6.3.2；注入块只放对"下一轮仍生效"的约束，一次性说明进块会污染长期行为）。
    PreferenceKindSpec(
        "session_note",
        "仅本次对话",
        PREF_VALUE_KIND_SCALAR,
        99,
        _normalize_session_note,
        inject=False,
    ),
)

PREFERENCE_KINDS: tuple[str, ...] = tuple(spec.kind for spec in _KIND_SPECS)
INJECTABLE_KINDS: tuple[str, ...] = tuple(spec.kind for spec in _KIND_SPECS if spec.inject)
_SPEC_BY_KIND: dict[str, PreferenceKindSpec] = {spec.kind: spec for spec in _KIND_SPECS}


# ===== 对外函数 =====


def kind_specs() -> tuple[PreferenceKindSpec, ...]:
    """全部 13 类（顺序即列表顺序）。"""
    return _KIND_SPECS


def injectable_specs() -> tuple[PreferenceKindSpec, ...]:
    """会进注入块的 11 类（session_note 除外）。"""
    return tuple(spec for spec in _KIND_SPECS if spec.inject)


def spec_for_kind(kind: str) -> PreferenceKindSpec:
    spec = _SPEC_BY_KIND.get((kind or "").strip())
    if spec is None:
        raise PreferenceValidationError(
            f"未知的偏好类别「{kind}」；可选：{'、'.join(PREFERENCE_KINDS)}"
        )
    return spec


def normalize_value(kind: str, value: Any) -> Any:
    """按 kind 规范化取值；非法值抛 PreferenceValidationError。"""
    return spec_for_kind(kind).normalize(value)


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
        for spec in _KIND_SPECS
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
