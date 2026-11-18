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
from typing import overload

from .field_style_target import is_field_path
from .resume_style_schema import (
    ROLES,
    template_role_defaults,
)
from .resume_style_types import ResolvedStyle, RoleStyle


def _css_number(value: float) -> str:
    return f"{value:g}"


#: 字距（em，× 基准字号）的下限：再负下去相邻字形会互相压字。
#: **一处分界，三个出口共用**：HTML（此处 `_declarations`）、PDF
#: （`pdf_exporter.name_gender`）、Word（`docx_document_header`）都调
#: :func:`clamp_letter_spacing`，否则同一份简历在纸面上比草稿里宽/窄一截（I-41 验收 1）。
MIN_LETTER_SPACING: float = -0.1


@overload
def clamp_letter_spacing(value: None) -> None: ...


@overload
def clamp_letter_spacing(value: float) -> float: ...


def clamp_letter_spacing(value: float | None) -> float | None:
    """字距夹取：只夹下限，``None`` 原样返回（= 未设置，调用方沿用模板默认）。

    两个 ``@overload`` 不是为了好看：调用方判过 ``style.letter_spacing is not None``
    之后拿到的必须是 ``float``，否则每一处 ``_css_number(clamp_letter_spacing(...))``
    都会被 pyright 判成 ``float | None`` 不可赋值。收窄写在重载上，比在每个调用点
    ``assert`` 更省事，也不会在 ``python -O`` 下消失。
    """
    if value is None:
        return None
    return max(MIN_LETTER_SPACING, float(value))


def _template_ratios(template: str) -> dict[str, float]:
    """模板 → 角色 → 基准字号比例（与目录 ``template_role_defaults`` 同源，不另抄数字）。"""
    return {
        role: float(values.get("font_scale", 1.0))
        for role, values in template_role_defaults(template).items()
    }


def _list_indent_base(template: str) -> float:
    """模板 ``ul`` 抬起的基准（= PDF ``layout.li_indent``），字段级缩进做差值用（DF-8）。"""
    return float(template_role_defaults(template).get("body", {}).get("indent", 0.0))


#: 落在**文字元素**上的属性。角色规则 / 对象根规则 / 对象内部角色规则共用这一份。
#: 三类"必须换目标元素才生效"的属性（项目符号 / 缩进 / 日期位置）走下面的定向选择器。
_TEXT_PROPS: tuple[str, ...] = (
    "font_scale",
    "color",
    "bold",
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
    * 斜体已整体移除（#5d）。项目符号 / 缩进 / 日期位置见下面三个定向函数。
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
    if "space_before" in wanted and style.space_before is not None:
        declarations.append(f"margin-top: calc(var(--fs) * {_css_number(style.space_before)});")
    if "space_after" in wanted and style.space_after is not None:
        declarations.append(f"margin-bottom: calc(var(--fs) * {_css_number(style.space_after)});")
    if "line_height" in wanted and style.line_height is not None:
        declarations.append(f"line-height: {_css_number(style.line_height)};")
    if "align" in wanted and style.align is not None:
        declarations.append(f"text-align: {style.align};")
    if "letter_spacing" in wanted and style.letter_spacing is not None:
        # I-41：三端同一条夹取（下限 -0.1em），见 `clamp_letter_spacing` 的注释。
        spacing = clamp_letter_spacing(style.letter_spacing)
        declarations.append(f"letter-spacing: calc(var(--fs) * {_css_number(spacing)});")
    return declarations


def _bullet_declarations(style: RoleStyle) -> list[str]:
    """项目符号 → list-style-type。

    圆点用 **`disc`（实心圆）** 而不是「·」字形：PDF 侧改成画实心圆之后（审计 R-20），
    字形的「·」在纸面上比它小一圈，草稿与精确预览并排就能看出"草稿的点儿更小"。
    `disc` 的直径由浏览器按字号算，与 PDF 的 0.32×字号直径同一量级。
    短横 / 不显示与 PDF、Word 逐字一致。
    """
    if style.bullet is None:
        return []
    bullet_css = {"dot": "disc", "dash": "'–'", "none": "none"}[style.bullet]
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


#: 字段级覆盖里"承载这个字段"的块（DF-8）。正文块自己就带 ``data-resume-path``
#: （``li`` / ``p.body-paragraph``），所以不需要 ``:has()``：字段路径只会命中它自己那一行，
#: 不会连带同一条目里的兄弟字段（相邻要点在 HTML 里共用一个 ``ul``，写 ``ul:has(…)``
#: 会改掉整段符号）。
def _field_block_selector(path: str, tag: str) -> str:
    return f'{tag}[data-resume-path="{path}"]'


def _field_indent_declarations(style: RoleStyle, *, list_base: float) -> list[str]:
    """字段缩进 → 承载块的``padding-left`` / ``margin-left``，值是与列表基准的**有符号差**。

    PDF（``pdf_exporter/style_blocks.py::draw_bullets``）把字段 ``indent`` 当**绝对**行首
    偏移：``text_left = frame_left + gap_mm(indent)``，**不设下限**。HTML 的 ``li`` 已经被
    模板 ``ul`` 的 ``padding-left``（= ``li_indent``）抬起，所以这里只写差值，两边纸面上
    的正文左缘才是同一个位置：

    * ``indent >= li_indent`` → ``padding-left: +(indent - li_indent)``：正差用 padding，
      承载块的可排宽度同步收窄，与 PDF 的 ``width = frame_width - indent`` 一致（折行点相同）。
    * ``indent < li_indent`` → ``margin-left: (indent - li_indent)``（负）：**不夹到 0**。
      夹 0 会让滑杆 0—``li_indent`` 这一整段"拖了没反应"——正是 DF-8 要修的症状；PDF 在
      这一段是把正文推到基准左侧（符号悬挂进页边距），草稿必须同样动。用 margin 而非
      padding 是因为 padding 不能为负。

    ``list_base`` 从 ``template_role_defaults`` 取（与面板显示的"模板基准"同源），
    读不到时为 0（= 退回绝对值，仍与 PDF 一致）。

    残留差异（已知、未修）：PDF 里 ``document_body.py`` 的"带样式字段标签"分支取
    ``max(indent, li_indent)``，与上面这条批量路径在 ``indent < li_indent`` 时不一致。
    本函数对齐的是**批量路径**（正文要点的默认出口，覆盖绝大多数条目）。
    """
    if style.indent is None:
        return []
    delta = round(float(style.indent) - list_base, 3)
    if delta >= 0:
        return [f"padding-left: calc(var(--fs) * {_css_number(delta)});"]
    return [f"margin-left: calc(var(--fs) * {_css_number(delta)});"]


def _field_block_rules(path: str, style: RoleStyle, *, list_base: float) -> list[str]:
    """字段级"换目标元素才生效"的两项（DF-8）。

    * 缩进 → 承载块的 ``padding-left``：``li`` 写差值（见 ``_field_indent_declarations``），
      ``p.body-paragraph`` 写绝对值（PDF 段落块就是绝对值）。
    * 项目符号 → ``li`` 的 ``list-style-type``：``::marker`` 用 li 自己的
      ``list-style-type``，所以只换这一行；写在 ``ul`` 上会把同段其它要点一起改掉。

    为什么不给 span 加 ``display: inline-block`` 或直接写 span：那只推文字、不动符号
    （``list-style-position: outside`` 的 marker 挂在内容边缘），与 PDF 逐像素对不上。
    内联板块（技能 / 语言的胶囊 ``li``）没有独立的正文块，也没有 ``data-resume-path``，
    这里不命中——PDF 侧同样只对正文块应用字段缩进（``document_body`` 按块渲染）。
    """
    indent_declarations = _field_indent_declarations(style, list_base=list_base)
    return [
        _rule(
            _field_block_selector(path, "li"),
            _bullet_declarations(style) + indent_declarations,
        ),
        _rule(_field_block_selector(path, "p"), _indent_declarations(style)),
    ]


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
_OBJECT_TEXT_PROPS: tuple[str, ...] = ("font_scale", "color", "bold", "line_height")

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
    list_base = _list_indent_base(style.template)
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
        if is_field_path(object_id):
            field_style = style.object_roles[key]
            prefix = f'[data-resume-path="{object_id}"]:not([data-resume-path] [data-resume-path])'
            if role == "field_label":
                prefix = f'[data-resume-path="{object_id}"][data-role="field_label"]'
            else:
                prefix += ':not([data-role="field_label"])'
            rules.append(_rule(prefix, _declarations(field_style, ratio=ratios.get(role, 1.0))))
            # DF-8：缩进 / 项目符号必须落在承载字段的块上（li / p），否则草稿里"拖了没反应"。
            rules.extend(_field_block_rules(object_id, field_style, list_base=list_base))
            # Paragraph spacing belongs on the block carrying this exact path.
            if field_style.space_before is not None or field_style.space_after is not None:
                rules.append(_rule(prefix + ":is(span,strong,em)", ["display: inline-block;"]))
            continue
        if role not in (*_OBJECT_ROLES, "field_label"):
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


# 拆分后的 re-export（document_html 旧 import 路径不断）。
from .resume_meta_align_css import meta_align_css  # noqa: E402,F401

# 拆分后的 re-export（style 类型与解析函数的旧 import 路径不断）。
from .resume_style_types import StyleSource, resolve_style  # noqa: E402,F401
