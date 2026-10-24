# SPDX-License-Identifier: Apache-2.0
"""W07 局部排版：L4 角色 / L5 对象覆盖的**唯一解析实现**（Wave2 第 1 册 §2.4）。

只做两件事：

1. **合成** ``format_config["roles"]`` 与 ``format_config["objects"]`` 成
   ``ResolvedStyle``（RoleStyle 只承载用户显式设过的值；None = 该属性未覆盖，
   由渲染器回落到模板值）。
2. 产出 **HTML 的唯一 CSS**（``role_style_css`` / ``entry_style_css``）与"属性来源"查询
   （``source_of``，供属性面板三态胶囊）。

**为什么 L1–L3 不在这里重算**：调用方已把"模板默认 + 具名版式 + 记录覆盖 + 草稿覆盖"
合成为一份 ``format_config`` 传进渲染器（export_routes / layout_render_routes）；本模块只
额外解析 L4/L5。任何"在渲染器里再 merge 一次版式预设"的写法都会重现"预览与导出各排一套"。

依赖方向：config_domains ← style_schema ← **本模块**；不 import 渲染器 / exporter。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

from .resume_style_schema import (
    PROP_KEYS,
    ROLES,
    template_role_defaults,
    validate_objects_domain,
    validate_roles_domain,
)

StyleSource = Literal["template", "format", "resume", "role", "object"]

# 扁平键 → 角色属性：用于 ``source_of`` 判断"这份属性是不是在更低层被设过"。
# 只有确实存在对应关系的键才列（颜色/字号/行高/间距），不硬凑。
_FLAT_PROP_KEYS: dict[str, str] = {
    "text_color": "color",
    "accent": "color",
    "line_height": "line_height",
    "section_gap": "space_after",
    "font_scale_adjust": "font_scale",
}


@dataclass(frozen=True)
class RoleStyle:
    """一层合成后的角色样式（只保存显式值；None = 未覆盖）。"""

    font_scale: float | None = None
    color: str | None = None
    bold: bool | None = None
    italic: bool | None = None
    space_before: float | None = None
    space_after: float | None = None
    line_height: float | None = None
    indent: float | None = None
    bullet: str | None = None
    align: str | None = None
    meta_align: str | None = None
    letter_spacing: float | None = None

    def get(self, prop: str) -> object:
        return getattr(self, prop, None)

    @property
    def empty(self) -> bool:
        return all(getattr(self, prop) is None for prop in PROP_KEYS)

    def merged_with(self, other: RoleStyle) -> RoleStyle:
        """``other`` 的非 None 值覆盖本层（L4 → L5 的合成规则）。"""
        return RoleStyle(
            **{
                prop: getattr(other, prop)
                if getattr(other, prop) is not None
                else getattr(self, prop)
                for prop in PROP_KEYS
            }
        )


_EMPTY_ROLE = RoleStyle()


def _role_style(raw: Mapping[str, object] | None) -> RoleStyle:
    if not raw:
        return _EMPTY_ROLE
    values = {prop: raw.get(prop) for prop in PROP_KEYS if raw.get(prop) is not None}
    return RoleStyle(**values)  # type: ignore[arg-type]


@dataclass(frozen=True)
class ResolvedStyle:
    template: str
    roles: Mapping[str, RoleStyle]
    objects: Mapping[str, RoleStyle]
    flat: Mapping[str, object] = field(default_factory=dict)

    def role(self, role: str) -> RoleStyle:
        return self.roles.get(role, _EMPTY_ROLE)

    def entry(self, object_id: str | None) -> RoleStyle:
        """该对象的 L5 覆盖；未命中返回空 RoleStyle（调用方再用角色层/模板值）。"""
        return self.objects.get(object_id or "", _EMPTY_ROLE)

    def effective(self, role: str, *, object_id: str | None = None) -> RoleStyle:
        """角色层 + 对象层合成后的显式值（对象层优先）。"""
        return self.role(role).merged_with(self.entry(object_id))

    def source_of(
        self, prop: str, *, role: str | None = None, object_id: str | None = None
    ) -> StyleSource:
        """某属性当前生效值的来源：object > role > resume(扁平键) > template。

        L2（具名版式）与 L3（简历覆盖）在调用方已经合成进同一份 format_config，这里
        无法再区分——两者都报 ``resume``，属性面板文案按"已调整"处理（契约 §2.5 三态）。
        """
        if object_id and getattr(self.entry(object_id), prop, None) is not None:
            return "object"
        if role and getattr(self.role(role), prop, None) is not None:
            return "role"
        flat_keys = [key for key, mapped in _FLAT_PROP_KEYS.items() if mapped == prop]
        if any(key in self.flat for key in flat_keys):
            return "resume"
        return "template"

    @property
    def empty(self) -> bool:
        return not (
            any(not style.empty for style in self.roles.values())
            or any(not style.empty for style in self.objects.values())
        )


def resolve_style(*, template: str, format_config: dict | None) -> ResolvedStyle:
    """L4/L5 合成。纯函数：不读 DB / 不读文件 / 不抛异常（畸形输入按"未设置"）。"""
    config = format_config if isinstance(format_config, dict) else {}
    roles_domain = validate_roles_domain(config.get("roles")) or {}
    objects_domain = validate_objects_domain(config.get("objects")) or {}
    roles = {
        role: _role_style(roles_domain.get(role))
        for role in ROLES
        if isinstance(roles_domain.get(role), dict)
    }
    objects = {
        str(object_id): _role_style(payload)
        for object_id, payload in objects_domain.items()
        if str(object_id) != "version" and isinstance(payload, dict)
    }
    return ResolvedStyle(template=template, roles=roles, objects=objects, flat=config)


def _css_number(value: float) -> str:
    return f"{value:g}"


def _role_rule(role: str, style: RoleStyle, *, base_ratios: Mapping[str, float]) -> str:
    """一个角色的属性 → 一条 CSS 规则（空规则返回空串）。

    语义映射（与契约 §2.2 的 HTML 列一致）：
    * ``font_scale`` 是"在模板该角色基准字号上再乘 k"：``calc(var(--fs) * k * 基准)``；
    * ``space_before/after`` 与 ``indent`` 都以基准字号为单位的 calc（和模板 CSS 同口径）；
    * ``line_height`` 直接写倍数；``letter_spacing`` 按 × 基准字号；
    * ``italic`` 只在 HTML 是真斜体；``bullet`` 通过 `list-style-type` 表达 dot/dash/none。
    """
    declarations: list[str] = []
    ratio = base_ratios.get(role, 1.0)
    if style.font_scale is not None:
        declarations.append(
            f"font-size: calc(var(--fs) * {_css_number(style.font_scale)} * {_css_number(ratio)});"
        )
    if style.color is not None:
        declarations.append(f"color: {style.color};")
    if style.bold is not None:
        declarations.append(f"font-weight: {'700' if style.bold else '400'};")
    if style.italic is not None:
        declarations.append(f"font-style: {'italic' if style.italic else 'normal'};")
    if style.space_before is not None:
        declarations.append(f"margin-top: calc(var(--fs) * {_css_number(style.space_before)});")
    if style.space_after is not None:
        declarations.append(f"margin-bottom: calc(var(--fs) * {_css_number(style.space_after)});")
    if style.line_height is not None:
        declarations.append(f"line-height: {_css_number(style.line_height)};")
    if style.indent is not None:
        declarations.append(f"padding-left: calc(var(--fs) * {_css_number(style.indent)});")
    if style.bullet is not None:
        bullet_css = {"dot": "disc", "dash": "'–'", "none": "none"}[style.bullet]
        declarations.append(f"list-style-type: {bullet_css};")
    if style.align is not None:
        declarations.append(f"text-align: {style.align};")
    if style.meta_align is not None:
        strategy = "space-between" if style.meta_align == "right" else "flex-start"
        declarations.append(f"justify-content: {strategy};")
    if style.letter_spacing is not None:
        declarations.append(
            f"letter-spacing: calc(var(--fs) * {_css_number(style.letter_spacing)});"
        )
    return f'  [data-role="{role}"] {{ {" ".join(declarations)} }}' if declarations else ""


def role_style_css(style: ResolvedStyle) -> str:
    """L4 角色覆盖 → HTML CSS（空覆盖返回空串；默认产物一个字符都不多）。"""
    if not style.roles:
        return ""
    base_ratios = {
        role: float(values.get("font_scale", 1.0))
        for role, values in template_role_defaults(style.template).items()
    }
    rules = [
        _role_rule(role, style.roles[role], base_ratios=base_ratios)
        for role in ROLES
        if role in style.roles
    ]
    body = "\n".join(rule for rule in rules if rule)
    return body


def entry_style_css(style: ResolvedStyle) -> str:
    """L5 对象覆盖 → HTML CSS：按 ``[data-object-id]`` 命中对象根节点。

    对象级属性在 HTML 上落在对象根（条目/要点容器），子元素继承颜色/行高/字号；
    ``space_before/after`` 与 ``indent/bullet`` 对对象的直接子文本生效。
    """
    if not style.objects:
        return ""
    base_ratios = {
        "body": 1.0,
        "entry_title": 1.0,
        "meta": 1.0,
    }
    rules: list[str] = []
    for object_id in sorted(style.objects):
        role_style = style.objects[object_id]
        rule = _role_rule("object", role_style, base_ratios=base_ratios).replace(
            '[data-role="object"]', f'[data-object-id="{object_id}"]'
        )
        if rule:
            rules.append(rule)
    return "\n".join(rules)


__all__ = [
    "ResolvedStyle",
    "RoleStyle",
    "StyleSource",
    "entry_style_css",
    "resolve_style",
    "role_style_css",
]
