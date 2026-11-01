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

import re
from typing import Any

from .resume_config_domains import HEX_COLOR_RE, is_object_id
from .resume_template_scalars import template_float

# 五个固定角色。顺序就是契约 §2.2 的顺序，也是 catalog role_fields 的下发顺序。
# 「重点文字」（emphasis）在 Q15 删除：planner 从不产出该角色、模板也没有对应
# data-role，PDF/Word 从不查询它——留着只会让用户在面板里调一个永不生效的项。
ROLES: tuple[str, ...] = (
    "name",
    "section_title",
    "entry_title",
    "body",
    "meta",
)

# 属性表：key → 类型 + 区间/枚举 + 可用角色。前端同名表必须逐键相等（测试钉住）。
STYLE_PROPS: tuple[dict[str, Any], ...] = (
    {"key": "font_scale", "type": "number", "min": 0.70, "max": 2.40, "step": 0.02, "roles": ROLES},
    {"key": "color", "type": "color", "roles": ROLES},
    {"key": "bold", "type": "bool", "roles": ROLES},
    # #5d：italic 已整体移除（PDF 无斜体字形、Word/HTML 行为不一，详见 CHANGELOG）；
    # 旧数据里的 italic 键留在库中不清洗，但下一次保存版式时会被这里过滤掉。
    {
        "key": "space_before",
        "type": "number",
        "min": 0.0,
        "max": 3.0,
        "step": 0.05,
        "roles": ("section_title", "entry_title", "body"),
    },
    {
        "key": "space_after",
        "type": "number",
        "min": 0.0,
        "max": 3.0,
        "step": 0.05,
        "roles": ("section_title", "entry_title", "body"),
    },
    {
        "key": "line_height",
        "type": "number",
        "min": 1.0,
        "max": 2.6,
        "step": 0.01,
        "roles": ("body", "entry_title"),
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
        # Q11：字距放开到正文 / 条目头——四出口都能表达（HTML letter-spacing / Word
        # w:spacing / PDF set_char_spacing）；此前只允许姓名与板块标题，用户调不到。
        "roles": ("name", "section_title", "body", "entry_title"),
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
# ``object_roles`` 域的条目上限（键是"对象 id:角色"，比 objects 更细，仍按同一数量级
# 封顶，避免畸形 payload 把 format_config 撑爆 32 KiB）。
MAX_OBJECT_ROLES = 400


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


def validate_object_roles_domain(raw: object) -> dict | None:
    """§1.2 的 ``object_roles`` 域校验（W3：文字级别按选中字段/角色生效）。

    键形如 ``"<object_id>:<role>"``：对象 id 必须过 ``is_object_id``、角色必须是
    ``ROLES`` 之一，属性按该角色的 ``ROLE_PROPS[role]`` 收窄（meta 不允许段距等）。
    ≤400 条；空域返回 ``None``（R3：不落库）。畸形键**整条丢弃**，不猜语义。
    """
    if not isinstance(raw, dict):
        return None
    result: dict[str, object] = {}
    for key, payload in raw.items():
        name = str(key)
        if name == "version":
            continue
        object_id, sep, role = name.rpartition(":")
        if not sep or not is_object_id(object_id) or role not in ROLES:
            continue
        cleaned = _validate_style_payload(payload, allowed=ROLE_PROPS[role])
        if cleaned:
            result[f"{object_id}:{role}"] = cleaned
        if len(result) >= MAX_OBJECT_ROLES:
            break
    if not result:
        return None
    return {"version": 1, **result}


def _list_indent_ratio(template_file: str) -> float | None:
    """从模板 CSS 读 `ul { padding-left: calc(var(--fs) * X) }` 里的 X（审计 R-34A）。

    为什么不把它抄成一张常量表：模板一改缩进，常量表就悄悄漂移，而面板上的"模板基准"
    会指着一个纸面上已经不存在的值。解析源文件是唯一不会漂移的来源（先例：
    `pdf_exporter/layout.py` 读 `entry_gap`、`test_resume_layout.py` 用同一手法核对注册表）。

    读不到就返回 None（调用方不写这个键）：宁可让面板显示中性值，也不要编一个数。
    """
    from .resume_template_catalog import TEMPLATES_DIR, template_spec

    path = TEMPLATES_DIR / template_spec(template_file)["file"]
    try:
        css = path.read_text(encoding="utf-8")
    except OSError:
        return None
    match = _LIST_INDENT_RE.search(css)
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


_LIST_INDENT_RE = re.compile(
    r"ul\s*\{\s*padding-left:\s*calc\(\s*var\(--fs\)\s*\*\s*([0-9.]+)\s*\)"
)


def template_role_defaults(template: str) -> dict[str, dict[str, float]]:
    """模板的角色基准值（从 ``TEMPLATE_LAYOUT_DEFAULTS`` 既有比例字段投影，不新增数字）。

    投影关系（契约 §2.8）：``name_ratio → name.font_scale``、``section_title_ratio →
    section_title.font_scale``、``entry_title_ratio → entry_title.font_scale``、
    ``entry_meta_ratio → meta.font_scale``、``line_height → body.line_height``；
    body 的基准字号是 1.0（正文就是基准）。

    R-34A 追加两项**间距基准**（只有这两项在模板 CSS 里有独立来源，其余不编）：
    · ``body.indent`` ← 模板 ``ul`` 的 ``padding-left`` 系数（解析 .j2 的 CSS）；
    · ``section_title.space_after`` ← 注册表里的 ``section_title_gap``（块标题与正文的留白）。
      `space_before` 没有对应来源：模板用 `.section` 的**下**外边距表达板块之间的间隔，
      没有"段前"这个概念，所以不写这个键（缺键 = 面板显示中性值，不是假的 0）。
    """
    from .resume_template_layout import template_layout_defaults
    from .resume_templates import template_spec

    spec = template_spec(template)
    defaults = template_layout_defaults(spec["name"])
    # 五个角色的 font_scale 一律写成**一行字面量**：`styleParity.test.ts` 用源码文本
    # 断言"每个角色都投影出了 font_scale"（它拿不到 Python 运行时），多行展开会让那条
    # 判据失效。新增的间距基准在下面单独补键，不挤进这一行。
    result: dict[str, dict[str, float]] = {
        "name": {"font_scale": template_float(defaults["name_ratio"])},
        "section_title": {"font_scale": template_float(defaults["section_title_ratio"])},
        "entry_title": {"font_scale": template_float(defaults["entry_title_ratio"])},
        "body": {"font_scale": 1.0, "line_height": template_float(defaults["line_height"])},
        "meta": {"font_scale": template_float(defaults["entry_meta_ratio"])},
    }
    # R-34A：两项有模板来源的间距基准（其余不编，见函数 docstring）。
    result["section_title"]["space_after"] = template_float(defaults["section_title_gap"])
    indent = _list_indent_ratio(spec["name"])
    if indent is not None:
        result["body"]["indent"] = indent
    return result


def role_fields_catalog() -> list[dict]:
    """``GET /api/resumes/templates`` 的 ``role_fields``：角色 → 可用属性（label_key 不下发中文）。"""
    return [
        {"role": role, "label_key": f"resume.role.{role}", "props": list(ROLE_PROPS[role])}
        for role in ROLES
    ]


__all__ = [
    "MAX_OBJECTS",
    "MAX_OBJECT_ROLES",
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
    "validate_object_roles_domain",
    "validate_objects_domain",
    "validate_roles_domain",
]
