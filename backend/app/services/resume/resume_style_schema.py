# SPDX-License-Identifier: Apache-2.0
"""W07 角色 / 对象覆盖的**唯一属性表与域校验**（Wave2 契约第 1 册 §2.2）。

本模块只回答三件事，不碰渲染：

1. **有哪些属性、各自是什么类型 / 区间 / 枚举、能用在哪个角色**（``STYLE_PROPS``）——
   前端 ``utils/resumeStyleParams.ts`` 的区间表由测试与这里逐键相等，两边不许各写一份
   却只改一边。
2. **域的合法形状**：``validate_roles_domain`` / ``validate_objects_domain``，严格白名单、
   越界丢弃（不夹紧，与 ``validated_format_config`` 既有口径一致）、空域返回 None
   （契约 R3：空域不落库）。
3. **模板角色的默认基准**：``template_role_defaults(template)`` 从 ``TEMPLATE_LAYOUT_DEFAULTS``
   既有比例字段**投影**而成（``name_ratio → name.font_scale`` 等），不新增第二份数字。

依赖方向：``resume_config_domains``（叶子）← 本模块；本模块不 import 渲染器、exporter。
"""

from __future__ import annotations

from typing import Any

from .resume_config_domains import HEX_COLOR_RE, is_object_id

# 六个固定角色。顺序就是契约 §2.2 的顺序，也是 catalog role_fields 的下发顺序。
ROLES: tuple[str, ...] = (
    "name",
    "section_title",
    "entry_title",
    "body",
    "meta",
    "emphasis",
)

# 属性表：key → 类型 + 区间/枚举 + 可用角色。前端同名表必须逐键相等（测试钉住）。
STYLE_PROPS: tuple[dict[str, Any], ...] = (
    {"key": "font_scale", "type": "number", "min": 0.70, "max": 2.40, "step": 0.02, "roles": ROLES},
    {"key": "color", "type": "color", "roles": ROLES},
    {"key": "bold", "type": "bool", "roles": ROLES},
    {"key": "italic", "type": "bool", "roles": ROLES},
    {
        "key": "space_before",
        "type": "number",
        "min": 0.0,
        "max": 3.0,
        "step": 0.05,
        "roles": ("section_title", "entry_title", "body", "emphasis"),
    },
    {
        "key": "space_after",
        "type": "number",
        "min": 0.0,
        "max": 3.0,
        "step": 0.05,
        "roles": ("section_title", "entry_title", "body", "emphasis"),
    },
    {
        "key": "line_height",
        "type": "number",
        "min": 1.0,
        "max": 2.6,
        "step": 0.01,
        "roles": ("body", "entry_title", "emphasis"),
    },
    {"key": "indent", "type": "number", "min": 0.0, "max": 4.0, "step": 0.05, "roles": ("body",)},
    {
        "key": "bullet",
        "type": "enum",
        "options": ("dot", "dash", "none"),
        "roles": ("body",),
    },
    {
        "key": "align",
        "type": "enum",
        "options": ("left", "center", "right", "justify"),
        "roles": ("body", "entry_title", "section_title"),
    },
    {
        "key": "meta_align",
        "type": "enum",
        "options": ("right", "inline"),
        "roles": ("meta",),
    },
    {
        "key": "letter_spacing",
        "type": "number",
        "min": -0.10,
        "max": 0.30,
        "step": 0.01,
        "roles": ("name", "section_title"),
    },
)

PROP_KEYS: tuple[str, ...] = tuple(prop["key"] for prop in STYLE_PROPS)
_PROP_BY_KEY: dict[str, dict[str, Any]] = {prop["key"]: prop for prop in STYLE_PROPS}

# 每个角色可用的属性（顺序同 STYLE_PROPS）；对象级覆盖允许全部属性。
ROLE_PROPS: dict[str, tuple[str, ...]] = {
    role: tuple(prop["key"] for prop in STYLE_PROPS if role in prop["roles"]) for role in ROLES
}
OBJECT_PROPS: tuple[str, ...] = PROP_KEYS

# 区间与步长单独暴露一份：前端区间表校验、输入控件的步进都读它（不重复抄数字）。
PROP_BOUNDS: dict[str, tuple[float, float]] = {
    prop["key"]: (float(prop["min"]), float(prop["max"]))
    for prop in STYLE_PROPS
    if prop["type"] == "number"
}
PROP_STEPS: dict[str, float] = {
    prop["key"]: float(prop["step"]) for prop in STYLE_PROPS if prop["type"] == "number"
}

# 单角色/单对象最多 12 个属性（契约 §1.3）；STYLE_PROPS 一共 12 个，正好封顶。
MAX_ROLE_PROPS = 12
MAX_OBJECTS = 400


def _as_float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _valid_value(prop: dict[str, Any], value: object) -> object | None:
    """按属性类型校验；不合法返回 None（调用方丢弃该属性，不夹紧）。"""
    kind = prop["type"]
    if kind == "bool":
        return value if isinstance(value, bool) else None
    if kind == "color":
        if isinstance(value, str) and HEX_COLOR_RE.fullmatch(value.strip()):
            return value.strip().lower()
        return None
    if kind == "enum":
        return value if isinstance(value, str) and value in prop["options"] else None
    number = _as_float(value)
    if number is None:
        return None
    low, high = float(prop["min"]), float(prop["max"])
    return round(number, 3) if low <= number <= high else None


def _validate_style_payload(
    raw: object, *, allowed: tuple[str, ...], props_pool: tuple[str, ...] = PROP_KEYS
) -> dict[str, object] | None:
    """校验单个角色 / 单个对象覆盖里的属性集合；全不合法返回 None。"""
    if not isinstance(raw, dict):
        return None
    result: dict[str, object] = {}
    for key, value in raw.items():
        name = str(key)
        if name not in props_pool or name not in allowed:
            continue
        prop = _PROP_BY_KEY.get(name)
        if prop is None:
            continue
        validated = _valid_value(prop, value)
        if validated is not None:
            result[name] = validated
        if len(result) >= MAX_ROLE_PROPS:
            break
    return result or None


def validate_roles_domain(raw: object) -> dict | None:
    """§1.2 的 ``roles`` 域校验：严格白名单；空域返回 None（R3：不落库）。"""
    if not isinstance(raw, dict):
        return None
    result: dict[str, object] = {}
    for role, payload in raw.items():
        name = str(role)
        if name == "version" or name not in ROLES:
            continue
        cleaned = _validate_style_payload(payload, allowed=ROLE_PROPS[name])
        if cleaned:
            result[name] = cleaned
    if not result:
        return None
    return {"version": 1, **result}


def validate_objects_domain(raw: object) -> dict | None:
    """§1.2 的 ``objects`` 域校验：键必须是稳定对象 id；≤400 条；空域返回 None。"""
    if not isinstance(raw, dict):
        return None
    result: dict[str, object] = {}
    for object_id, payload in raw.items():
        if str(object_id) == "version":
            continue
        if not is_object_id(object_id):
            continue
        cleaned = _validate_style_payload(payload, allowed=OBJECT_PROPS)
        if cleaned:
            result[str(object_id)] = cleaned
        if len(result) >= MAX_OBJECTS:
            break
    if not result:
        return None
    return {"version": 1, **result}


def template_role_defaults(template: str) -> dict[str, dict[str, float]]:
    """模板的角色基准值（从 ``TEMPLATE_LAYOUT_DEFAULTS`` 既有比例字段投影，不新增数字）。

    投影关系（契约 §2.8）：``name_ratio → name.font_scale``、``section_title_ratio →
    section_title.font_scale``、``entry_title_ratio → entry_title.font_scale``、
    ``entry_meta_ratio → meta.font_scale``、``line_height → body.line_height``；
    body/emphasis 的基准字号是 1.0（正文就是基准）。
    """
    from .resume_template_layout import template_layout_defaults
    from .resume_templates import template_spec

    defaults = template_layout_defaults(template_spec(template)["name"])
    return {
        "name": {"font_scale": float(defaults["name_ratio"])},
        "section_title": {"font_scale": float(defaults["section_title_ratio"])},
        "entry_title": {"font_scale": float(defaults["entry_title_ratio"])},
        "body": {"font_scale": 1.0, "line_height": float(defaults["line_height"])},
        "meta": {"font_scale": float(defaults["entry_meta_ratio"])},
        "emphasis": {"font_scale": 1.0},
    }


def role_fields_catalog() -> list[dict]:
    """``GET /api/resumes/templates`` 的 ``role_fields``：角色 → 可用属性（label_key 不下发中文）。"""
    return [
        {"role": role, "label_key": f"resume.role.{role}", "props": list(ROLE_PROPS[role])}
        for role in ROLES
    ]


__all__ = [
    "MAX_OBJECTS",
    "MAX_ROLE_PROPS",
    "OBJECT_PROPS",
    "PROP_BOUNDS",
    "PROP_KEYS",
    "PROP_STEPS",
    "ROLES",
    "ROLE_PROPS",
    "STYLE_PROPS",
    "role_fields_catalog",
    "template_role_defaults",
    "validate_objects_domain",
    "validate_roles_domain",
]
