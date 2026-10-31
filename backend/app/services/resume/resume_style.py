# SPDX-License-Identifier: Apache-2.0
"""W07 局部排版：L4 角色 / L5 对象覆盖的**唯一解析实现**（Wave2 第 1 册 §2.4）。

只做两件事：

1. **合成** ``format_config["roles"]`` / ``format_config["objects"]`` /
   ``format_config["object_roles"]`` 成 ``ResolvedStyle``（RoleStyle 只承载用户显式
   设过的值；None = 该属性未覆盖，由渲染器回落到模板值）。``object_roles`` 的键是
   ``"<object_id>:<role>"``——W3 起「文字级别」可以只作用于选中的字段/角色。
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
    validate_object_roles_domain,
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
    # 键为 ``"<object_id>:<role>"``：该对象该角色的最高优先覆盖（W3）。
    object_roles: Mapping[str, RoleStyle] = field(default_factory=dict)
    flat: Mapping[str, object] = field(default_factory=dict)

    def role(self, role: str) -> RoleStyle:
        return self.roles.get(role, _EMPTY_ROLE)

    def entry(self, object_id: str | None) -> RoleStyle:
        """该对象的 L5 覆盖；未命中返回空 RoleStyle（调用方再用角色层/模板值）。"""
        return self.objects.get(object_id or "", _EMPTY_ROLE)

    def entry_role(self, role: str, object_id: str | None) -> RoleStyle:
        """该对象该角色的 L5.5 覆盖（W3）；未命中返回空 RoleStyle。"""
        return self.object_roles.get(f"{object_id or ''}:{role}", _EMPTY_ROLE)

    def effective(self, role: str, *, object_id: str | None = None) -> RoleStyle:
        """角色层 → 对象层 → 对象角色层合成后的显式值（越具体越优先）。

        ``obj:<role>`` 是 W3 新增的最高层：用户把「文字级别」限定到某个字段后，
        同一条目其它角色仍走对象层/角色层，互不污染。
        """
        return (
            self.role(role)
            .merged_with(self.entry(object_id))
            .merged_with(self.entry_role(role, object_id))
        )

    def source_of(
        self, prop: str, *, role: str | None = None, object_id: str | None = None
    ) -> StyleSource:
        """某属性当前生效值的来源：object > role > resume(扁平键) > template。

        L2（具名版式）与 L3（简历覆盖）在调用方已经合成进同一份 format_config，这里
        无法再区分——两者都报 ``resume``，属性面板文案按"已调整"处理（契约 §2.5 三态）。
        """
        if (
            object_id
            and role
            and getattr(self.entry_role(role, object_id), prop, None) is not None
        ):
            return "object"
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
            or any(not style.empty for style in self.object_roles.values())
        )


def resolve_style(*, template: str, format_config: dict | None) -> ResolvedStyle:
    """L4/L5/L5.5 合成。纯函数：不读 DB / 不读文件 / 不抛异常（畸形输入按"未设置"）。"""
    config = format_config if isinstance(format_config, dict) else {}
    roles_domain = validate_roles_domain(config.get("roles")) or {}
    objects_domain = validate_objects_domain(config.get("objects")) or {}
    object_roles_domain = validate_object_roles_domain(config.get("object_roles")) or {}
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
    # 键已由校验器归一成 ``"<object_id>:<role>"``，这里原样保留（不重新拼）。
    object_roles = {
        str(key): _role_style(payload)
        for key, payload in object_roles_domain.items()
        if str(key) != "version" and isinstance(payload, dict)
    }
    return ResolvedStyle(
        template=template,
        roles=roles,
        objects=objects,
        object_roles=object_roles,
        flat=config,
    )


def _css_number(value: float) -> str:
    return f"{value:g}"


def _template_ratios(template: str) -> dict[str, float]:
    """模板 → 角色 → 基准字号比例（与目录 ``template_role_defaults`` 同源，不另抄数字）。"""
    return {
        role: float(values.get("font_scale", 1.0))
        for role, values in template_role_defaults(template).items()
    }


#: 落在**文字元素**上的属性。角色规则 / 对象根规则 / 对象内部角色规则共用这一份。
#: 三类"必须换目标元素才生效"的属性（项目符号 / 缩进 / 日期位置）走下面的定向选择器。
_TEXT_PROPS: tuple[str, ...] = (
    "font_scale",
    "color",
    "bold",
    "italic",
    "space_before",
    "space_after",
    "line_height",
    "align",
    "letter_spacing",
)

#: 项目符号的目标：列表容器。写在 li 上只换文字，符号本身不动。
_BULLET_SELECTOR = "ul"
#: 缩进的目标：列表容器 + 段落块。写在 li / 条目根上会"文字右移、符号不动"或整条平移。
_INDENT_SELECTOR = "ul, .body-paragraph"
#: 日期位置的目标：条目头的 flex 容器（justify-content 必须写在容器上）。
_ENTRY_HEAD_SELECTOR = ".entry-head"


def _declarations(
    style: RoleStyle, *, ratio: float, props: tuple[str, ...] = _TEXT_PROPS
) -> list[str]:
    """一层样式 → 文字元素上的 CSS 声明（props 决定这份规则带哪些属性）。

    语义映射（与契约 §2.2 的 HTML 列一致）：
    * font_scale 是"在模板该角色基准字号上再乘 k"：calc(var(--fs) * k * 基准)；
    * space_before/after 以基准字号为单位的 calc（和模板 CSS 同口径）；
    * line_height 直接写倍数；letter_spacing 按 × 基准字号；
    * italic 只在 HTML 是真斜体。项目符号 / 缩进 / 日期位置见下面三个定向函数。
    """
    wanted = set(props)
    declarations: list[str] = []
    if "font_scale" in wanted and style.font_scale is not None:
        declarations.append(
            f"font-size: calc(var(--fs) * {_css_number(style.font_scale)} * {_css_number(ratio)});"
        )
    if "color" in wanted and style.color is not None:
        declarations.append(f"color: {style.color};")
    if "bold" in wanted and style.bold is not None:
        declarations.append(f"font-weight: {'700' if style.bold else '400'};")
    if "italic" in wanted and style.italic is not None:
        declarations.append(f"font-style: {'italic' if style.italic else 'normal'};")
    if "space_before" in wanted and style.space_before is not None:
        declarations.append(f"margin-top: calc(var(--fs) * {_css_number(style.space_before)});")
    if "space_after" in wanted and style.space_after is not None:
        declarations.append(f"margin-bottom: calc(var(--fs) * {_css_number(style.space_after)});")
    if "line_height" in wanted and style.line_height is not None:
        declarations.append(f"line-height: {_css_number(style.line_height)};")
    if "align" in wanted and style.align is not None:
        declarations.append(f"text-align: {style.align};")
    if "letter_spacing" in wanted and style.letter_spacing is not None:
        declarations.append(
            f"letter-spacing: calc(var(--fs) * {_css_number(style.letter_spacing)});"
        )
    return declarations


def _bullet_declarations(style: RoleStyle) -> list[str]:
    """项目符号 → list-style-type。三种字形与 PDF/Word 逐字一致：圆点 / 短横 / 不显示。"""
    if style.bullet is None:
        return []
    # HTML 的 disc 是"实心圆点"，与 PDF/Word 的「·」字形不一致；三出口统一用「·」。
    bullet_css = {"dot": "'·'", "dash": "'–'", "none": "none"}[style.bullet]
    return [f"list-style-type: {bullet_css};"]


def _indent_declarations(style: RoleStyle) -> list[str]:
    """缩进 → padding-left，作用在列表容器 / 段落块上（不是 li、不是条目根）。"""
    if style.indent is None:
        return []
    return [f"padding-left: calc(var(--fs) * {_css_number(style.indent)});"]


def _meta_align_declarations(style: RoleStyle) -> list[str]:
    """日期位置 → 条目头容器的 justify-content（right = 靠右、inline = 紧随标题）。"""
    if style.meta_align is None:
        return []
    strategy = "space-between" if style.meta_align == "right" else "flex-start"
    return [f"justify-content: {strategy};"]


def _rule(selector: str, declarations: list[str]) -> str:
    """一条 CSS 规则（两空格缩进，与 role_style_css 的既有产物同格式）；空声明返回空串。"""
    if not declarations:
        return ""
    return f"  {selector} {{ {' '.join(declarations)} }}"


def _role_rules(role: str, style: RoleStyle, *, base_ratios: Mapping[str, float]) -> list[str]:
    """一个角色的属性 → 若干条 CSS 规则（文字元素 + 三个定向选择器；空规则跳过）。

    Q11：项目符号 / 缩进 / 日期位置以前和文字属性写在同一选择器上，导致"调了缩进只有
    文字动、符号不动"（li 的 padding-left 不移动 outside 的 marker）、"调日期位置没反应"
    （justify-content 必须写在 flex 容器上）。这里按目标元素拆开：
    * 文字属性 → [data-role=…]；
    * 项目符号 → ul；缩进 → ul 与 .body-paragraph；日期位置 → .entry-head。
    """
    ratio = base_ratios.get(role, 1.0)
    candidates = [
        _rule(f'[data-role="{role}"]', _declarations(style, ratio=ratio)),
        _rule(_BULLET_SELECTOR, _bullet_declarations(style)),
        _rule(_INDENT_SELECTOR, _indent_declarations(style)),
        _rule(_ENTRY_HEAD_SELECTOR, _meta_align_declarations(style)),
    ]
    return [rule for rule in candidates if rule]


def role_style_css(style: ResolvedStyle) -> str:
    """L4 角色覆盖 → HTML CSS（空覆盖返回空串；默认产物一个字符都不多）。"""
    if not style.roles:
        return ""
    base_ratios = _template_ratios(style.template)
    rules: list[str] = []
    for role in ROLES:
        if role in style.roles:
            rules.extend(_role_rules(role, style.roles[role], base_ratios=base_ratios))
    return "\n".join(rules)


# 对象子树里可能出现的角色（模板契约：条目/要点内部只有标题、正文、元信息三种 data-role；
# name / section_title 在对象外面）。
_OBJECT_ROLES: tuple[str, ...] = ("entry_title", "body", "meta")

# 对象级覆盖里的"文字外观"属性：转发到对象内部角色元素，与 PDF/Word 的
# role_style(role, object_id) 逐角色合并对等；空间属性（段距/符号/对齐）仍只落在根。
_OBJECT_TEXT_PROPS: tuple[str, ...] = ("font_scale", "color", "bold", "italic", "line_height")

# 对象**角色**级（Q12「条目头 / 正文 / 灰字」作用范围）：比对象级多转发对齐与字距——
# 它们只作用于该角色的文字，放回对象根会把整条一起改（字距只允许 body / entry_title）。
_OBJECT_ROLE_TEXT_PROPS: tuple[str, ...] = _OBJECT_TEXT_PROPS + ("align", "letter_spacing")


def _object_descendant_selector(object_id: str, roles: tuple[str, ...]) -> str:
    """对象内部角色元素的选择器列表。

    ``[data-object-id="X"] [data-role="…"]`` 与模板自带的 ``.entry-head .title`` /
    ``.entry .sub`` 同为两个"类/属性"级（specificity 0,2,0），而本段 CSS 注入在模板
    ``<style>`` 之后，所以同权重时本段生效——不需要 ``!important``。
    """
    return ", ".join(f'[data-object-id="{object_id}"] [data-role="{role}"]' for role in roles)


def _object_spatial_rules(prefix: str, style: RoleStyle) -> list[str]:
    """条目内部三个"换目标元素才生效"的属性规则（Q11 定向选择器）。

    * 项目符号 → 该条目的 ul（写在条目根/li 上管不到列表容器的 marker 字形）；
    * 缩进 → 该条目的 ul 与 .body-paragraph（不动标题与日期）；
    * 日期位置 → 该条目的 .entry-head（justify-content 只对 flex 容器生效）。
    """
    candidates = [
        _rule(f"{prefix} ul", _bullet_declarations(style)),
        _rule(f"{prefix} ul, {prefix} .body-paragraph", _indent_declarations(style)),
        _rule(f"{prefix} .entry-head", _meta_align_declarations(style)),
    ]
    return [rule for rule in candidates if rule]


def entry_style_css(style: ResolvedStyle) -> str:
    """L5 对象覆盖 → HTML CSS：根节点规则 + 定向规则 + 内部角色元素规则。

    ## 为什么必须两层（W07-EP / 2026-10-27）

    PDF（``pdf_exporter.style_blocks``）与 Word（``docx_sections``）应用对象覆盖的方式都是
    ``role_style(role, object_id)``：对象层**逐角色合并**进该角色的基准，于是条目名称、
    元信息、要点各自按自己的模板基准比例放大/改色/加粗。HTML 侧原先只在对象根节点写声明，
    模板里 ``.entry-head .title`` 等选择器 specificity 更高，条目名称收不到覆盖——表现为
    "草稿/HTML 没变、精确预览/导出变了"。

    ## 每一层各管什么

    * **根节点规则**：文字元素属性（字号 / 颜色 / 字重 / 斜体 / 段距 / 行高 / 对齐 / 字距）。
      这些属性靠继承或"写在条目根上"就对整条生效，与改动前一致。
    * **定向规则（Q11）**：项目符号 → ``[data-object-id] ul``；缩进 →
      ``[data-object-id] ul`` 与 ``[data-object-id] .body-paragraph``；日期位置 →
      ``[data-object-id] .entry-head``。写在根节点上管不到这三处（模板 ul 的 UA disc
      会覆盖 list-style-type、li 的 padding 不移动 outside marker、justify-content 只对
      flex 容器生效）。
    * **内部角色规则**：只转发 ``_OBJECT_TEXT_PROPS`` 五项文字外观属性；字号按**该角色
      自己的模板基准比例**展开（与 ``role_style_css`` 同一张 ratio 表），与 PDF/Word 的
      逐角色合并口径一致。基准相同的角色合并成一条选择器列表，规则数不随角色数膨胀。

    W3 追加第三层：``object_roles``（``"<object_id>:<role>"``）命中的角色再输出一条
    ``[data-object-id] [data-role]`` 规则，只含**文字外观**属性（Q12 起含对齐与字距）、
    字号按该角色自己的模板基准展开；项目符号 / 缩进 / 日期位置仍走定向规则（body →
    ul 与 .body-paragraph，meta → .entry-head），与 PDF/Word 的
    ``effective(role, object_id)`` 逐角色合并对等。

    没有任何对象/对象角色覆盖时仍返回空串（``render_overrides_css`` 因此不产出任何
    字节，默认产物零变化）。
    """
    if not style.objects and not style.object_roles:
        return ""
    ratios = _template_ratios(style.template)
    rules: list[str] = []
    for object_id in sorted(style.objects):
        object_style = style.objects[object_id]
        prefix = f'[data-object-id="{object_id}"]'
        # 1) 根节点：文字元素属性（段距 / 对齐 / 字距靠继承对整条生效；兼容既有行为）。
        rules.append(_rule(prefix, _declarations(object_style, ratio=1.0)))
        # 2) 定向规则（Q11）：项目符号 / 缩进 / 日期位置写到真正承载它们的元素上。
        rules.extend(_object_spatial_rules(prefix, object_style))
        # 3) 内部角色：文字外观属性 + 各角色自己的字号基准。
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
    # 4) 对象**角色**级（W3 + Q12）：该角色被允许的文字外观属性（含对齐 / 字距）。
    #    段距 / 缩进 / 符号仍只走对象根与定向规则（重复写到子元素会把段距/缩进放大好几倍）。
    #    选择器与第 3 步同权重（0,2,0）且注入在其后：同权重时本段生效，不需要 !important。
    for key in sorted(style.object_roles):
        object_id, _, role = key.partition(":")
        if role not in _OBJECT_ROLES:
            # name / section_title 不在对象子树里出现（模板契约），跳过而不是写一条永远
            # 匹配不到的选择器。
            continue
        role_style = style.object_roles[key]
        prefix = f'[data-object-id="{object_id}"]'
        text_style = RoleStyle(
            **{prop: getattr(role_style, prop) for prop in _OBJECT_ROLE_TEXT_PROPS}
        )
        if not text_style.empty:
            rules.append(
                _rule(
                    f'{prefix} [data-role="{role}"]',
                    _declarations(text_style, ratio=ratios.get(role, 1.0)),
                )
            )
        # 角色级定向规则：正文范围才允许符号/缩进，灰字范围才允许日期位置。
        if role in ("body", "meta"):
            rules.extend(_object_spatial_rules(prefix, role_style))
    return "\n".join(rule for rule in rules if rule)


__all__ = [
    "ResolvedStyle",
    "RoleStyle",
    "StyleSource",
    "entry_style_css",
    "resolve_style",
    "role_style_css",
]
