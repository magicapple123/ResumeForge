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


def _template_ratios(template: str) -> dict[str, float]:
    """模板 → 角色 → 基准字号比例（与目录 ``template_role_defaults`` 同源，不另抄数字）。"""
    return {
        role: float(values.get("font_scale", 1.0))
        for role, values in template_role_defaults(template).items()
    }


def _declarations(style: RoleStyle, *, ratio: float) -> list[str]:
    """一层样式 → CSS 声明（角色规则 / 对象根规则 / 对象内部角色规则共用同一份映射）。

    语义映射（与契约 §2.2 的 HTML 列一致）：
    * ``font_scale`` 是"在模板该角色基准字号上再乘 k"：``calc(var(--fs) * k * 基准)``；
    * ``space_before/after`` 与 ``indent`` 都以基准字号为单位的 calc（和模板 CSS 同口径）；
    * ``line_height`` 直接写倍数；``letter_spacing`` 按 × 基准字号；
    * ``italic`` 只在 HTML 是真斜体；``bullet`` 通过 `list-style-type` 表达 dot/dash/none。
    """
    declarations: list[str] = []
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
    return declarations


def _rule(selector: str, declarations: list[str]) -> str:
    """一条 CSS 规则（两空格缩进，与 ``role_style_css`` 的既有产物同格式）；空声明返回空串。"""
    if not declarations:
        return ""
    return f"  {selector} {{ {' '.join(declarations)} }}"


def _role_rule(role: str, style: RoleStyle, *, base_ratios: Mapping[str, float]) -> str:
    """一个角色的属性 → 一条 CSS 规则（空规则返回空串）。"""
    return _rule(f'[data-role="{role}"]', _declarations(style, ratio=base_ratios.get(role, 1.0)))


def role_style_css(style: ResolvedStyle) -> str:
    """L4 角色覆盖 → HTML CSS（空覆盖返回空串；默认产物一个字符都不多）。"""
    if not style.roles:
        return ""
    base_ratios = _template_ratios(style.template)
    rules = [
        _role_rule(role, style.roles[role], base_ratios=base_ratios)
        for role in ROLES
        if role in style.roles
    ]
    body = "\n".join(rule for rule in rules if rule)
    return body


# 对象子树里可能出现的角色（模板契约：条目/要点内部只有标题、正文、元信息三种 data-role；
# name / section_title 在对象外面，emphasis 当前模板不使用）。
_OBJECT_ROLES: tuple[str, ...] = ("entry_title", "body", "meta")

# 对象级覆盖里的"文字外观"属性：转发到对象内部角色元素，与 PDF/Word 的
# ``role_style(role, object_id)`` 逐角色合并对等；空间属性（段距/缩进/符号/对齐）仍只落在根。
_OBJECT_TEXT_PROPS: tuple[str, ...] = ("font_scale", "color", "bold", "italic", "line_height")


def _object_descendant_selector(object_id: str, roles: tuple[str, ...]) -> str:
    """对象内部角色元素的选择器列表。

    ``[data-object-id="X"] [data-role="…"]`` 与模板自带的 ``.entry-head .title`` /
    ``.entry .sub`` 同为两个"类/属性"级（specificity 0,2,0），而本段 CSS 注入在模板
    ``<style>`` 之后，所以同权重时本段生效——不需要 ``!important``。
    """
    return ", ".join(f'[data-object-id="{object_id}"] [data-role="{role}"]' for role in roles)


def entry_style_css(style: ResolvedStyle) -> str:
    """L5 对象覆盖 → HTML CSS：对象根节点规则 + 内部角色元素规则。

    ## 为什么必须两层（W07-EP / 2026-10-27）

    PDF（``pdf_exporter.style_blocks``）与 Word（``docx_sections``）应用对象覆盖的方式都是
    ``role_style(role, object_id)``：对象层**逐角色合并**进该角色的基准，于是条目名称、
    元信息、要点各自按自己的模板基准比例放大/改色/加粗。HTML 侧原先只在对象根节点写声明，
    模板里 ``.entry-head .title`` 等选择器 specificity 更高，条目名称收不到覆盖——表现为
    "草稿/HTML 没变、精确预览/导出变了"。

    ## 两层各管什么

    * **根节点规则**：全部 12 项属性照旧落在 ``[data-object-id]`` 上。空间属性
      （段距/缩进/符号/对齐/日期位置）**只在**这一层，避免在子元素上重复外扩；对象根的
      直接文本与继承行为也与改动前一致。
    * **内部角色规则**：只转发 ``_OBJECT_TEXT_PROPS`` 五项文字外观属性；字号按**该角色
      自己的模板基准比例**展开（与 ``role_style_css`` 同一张 ratio 表），与 PDF/Word 的
      逐角色合并口径一致。基准相同的角色合并成一条选择器列表，规则数不随角色数膨胀。

    没有对象覆盖时仍返回空串（``render_overrides_css`` 因此不产出任何字节，默认产物零变化）。
    """
    if not style.objects:
        return ""
    ratios = _template_ratios(style.template)
    rules: list[str] = []
    for object_id in sorted(style.objects):
        object_style = style.objects[object_id]
        # 1) 根节点：全部属性（兼容既有行为；空间属性只落在这里）。
        rules.append(
            _rule(f'[data-object-id="{object_id}"]', _declarations(object_style, ratio=1.0))
        )
        # 2) 内部角色：文字外观属性 + 各角色自己的字号基准。
        text_style = RoleStyle(**{prop: getattr(object_style, prop) for prop in _OBJECT_TEXT_PROPS})
        if text_style.empty:
            continue
        ratio_groups: dict[float, list[str]] = {}
        for role in _OBJECT_ROLES:
            ratio_groups.setdefault(ratios.get(role, 1.0), []).append(role)
        for ratio, roles in ratio_groups.items():
            rules.append(
                _rule(
                    _object_descendant_selector(object_id, tuple(roles)),
                    _declarations(RoleStyle(font_scale=text_style.font_scale), ratio=ratio),
                )
            )
        rules.append(
            _rule(
                _object_descendant_selector(object_id, _OBJECT_ROLES),
                _declarations(
                    RoleStyle(
                        color=text_style.color,
                        bold=text_style.bold,
                        italic=text_style.italic,
                        line_height=text_style.line_height,
                    ),
                    ratio=1.0,
                ),
            )
        )
    return "\n".join(rule for rule in rules if rule)


__all__ = [
    "ResolvedStyle",
    "RoleStyle",
    "StyleSource",
    "entry_style_css",
    "resolve_style",
    "role_style_css",
]
