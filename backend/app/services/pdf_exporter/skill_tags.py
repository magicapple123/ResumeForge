# SPDX-License-Identifier: Apache-2.0
"""技能标签：几何（形状比例 / 尺寸计算 / 调色 / 折行）与五种形状的绘制。

**形状与几何全部由模板决定**：8 个内置模板的 `.skill-list li` 有 5 种形态（填充 / 描边胶囊 /
左侧色条 / 无框 + 「·」分隔 / 纯文字），标签的圆角、内边距、行内与行间间距也各不相同。这些
数字的唯一结构化来源是 `resume_templates.TEMPLATE_LAYOUT_DEFAULTS` 的 `tag_*` 键
（`test_resume_layout_templates.py` 拿模板 CSS 逐条核对），本模块**不再保留任何一份比例
副本**——此前这里写死 0.71 / 0.57 / 0.4 三个比例只对 classic 成立，于是 8 个模板的标签在
PDF 里被统一画成"带底色的圆角框 + 强调色文字"一种样子。

**等宽字族（technical）的做法与限制**：`technical` 的标签在预览里用 `Consolas` 等宽字族
（`.skill-list li { font-family: Consolas, "Cascadia Mono", Menlo, monospace; }`）。PDF 只有
一个注册字体族 `FONT_FAMILY`（中文 TTF），**不为它再引入一个字体包**——多打一份字体文件只
为让几个 ASCII 单词变等宽并不划算。做法是：注册表 `tag_mono` 为真、且**该标签文本全为
ASCII** 时，用 fpdf2 内置的 `courier` 画（真等宽、无需嵌入）；文本含中文（或其它非 ASCII）
时退回 `FONT_FAMILY`——fpdf2 **没有逐字形回退**能力（一个 `cell` 只能有一个字形来源），
而等宽对中文本来也没有意义，所以"中英混排的标签用正文字体"是这里刻意的取舍，属已知差异。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from fpdf.enums import XPos, YPos

from .fonts import FONT_FAMILY
from .layout import _PX_TO_MM, _PX_TO_PT
from .theme import _hex_to_rgb

if TYPE_CHECKING:  # pragma: no cover - 只为类型检查，运行时不能真导入 canvas（会循环导入）
    from .canvas import _ResumePDF
    from .layout import ResumeLayout

# 等宽标签用的字体：fpdf2 内置的 core font，不需要 `add_font`、也不嵌入文件。
# 只有 `tag_mono` 模板（technical）且标签文本全为 ASCII 时才用它。
_TAG_MONO_FONT = "courier"

# 标签底色 = 强调色调淡到接近白（模板里的 `--accent-soft` 就是这个思路，例如 #0f766e → #e6f4f1）。
# **只作兜底**：注册表有 `accent_soft` 时用模板写死的真实十六进制（两者有色差，见 theme 模块）。
_TAG_TINT_RATIO = 0.88

# 胶囊圆角哨兵：注册表 `tag_radius` 取这个值时，圆角画成 `height / 2`
# （对应 CSS 的 `border-radius: 999px`——浏览器会把它和到短边一半，效果同上）。
PILL_RADIUS = "pill"

# compact 模板的 `.skill-list li::after { content: "·" }`：标签之间的分隔符。
_TAG_SEPARATOR = "·"

# 多列网格（scholar）每个格子的项目符号：对应 CSS `.skill-list li::before { content: "•" }`。
_TAG_BULLET = "•"


@dataclass(frozen=True)
class SkillTagMetrics:
    """技能标签的几何尺寸（毫米 / 磅）。"""

    font_pt: float
    height: float
    padding_x: float
    gap_x: float
    gap_y: float
    radius: float
    # 单边边框宽度（mm）。0 = 无边框；标签外框的总宽度要额外算上左右（或仅左侧）这条边。
    border_mm: float


def skill_tag_metrics(
    font_size: float,
    *,
    line_height: float,
    tag_ratio: float,
    pad_x: float,
    gap_x: float,
    gap_y: float,
    radius: float | str,
    border_px: float = 0.0,
) -> SkillTagMetrics:
    """由基准字号推出标签的整套尺寸（纯函数，便于逐条验证比例）。

    所有比例系数**必须由调用方传入**（来自 `ResumeLayout` 的 `tag_*` 字段，那一份又由
    `TEMPLATE_LAYOUT_DEFAULTS` 从模板 CSS 抄过来并被守卫测试核对）。本模块不保留副本：
    以前写死的 0.71 / 0.57 / 0.4 只对 classic 成立，其余 7 个模板的标签几何全错。

    ``line_height`` 是模板的行高系数：标签高度 = 标签字号的 ``line_height`` 倍，与预览里
    `.skill-list li` 继承 body 行高同理。
    """
    tag_px = font_size * tag_ratio
    height = tag_px * _PX_TO_MM * line_height
    if isinstance(radius, str):
        # 只有 PILL_RADIUS 这一个哨兵；写错时按"无圆角"处理而不是抛错——标签画不出来比圆角
        # 不好看严重得多。
        resolved_radius = height / 2 if radius == PILL_RADIUS else 0.0
    else:
        resolved_radius = tag_px * _PX_TO_MM * float(radius)
    return SkillTagMetrics(
        font_pt=tag_px * _PX_TO_PT,
        height=height,
        padding_x=tag_px * _PX_TO_MM * pad_x,
        gap_x=tag_px * _PX_TO_MM * gap_x,
        gap_y=tag_px * _PX_TO_MM * gap_y,
        radius=resolved_radius,
        border_mm=float(border_px) * _PX_TO_MM,
    )


def soft_accent(
    color: tuple[int, int, int], ratio: float = _TAG_TINT_RATIO
) -> tuple[int, int, int]:
    """把强调色调成标签底色（**兜底用**：注册表有 `accent_soft` 时以模板的十六进制为准）。"""
    return tuple(round(channel + (255 - channel) * ratio) for channel in color)  # type: ignore[return-value]


def wrap_skill_tags(widths: list[float], *, max_width: float, gap: float) -> list[list[int]]:
    """把标签按可用宽度折行，返回**每行的下标**。

    抽成纯函数是因为折行算错**不会报错**：只会让最后一个标签悄悄跑到页面右边之外，或者把
    整行孤零零地挤到下一页——两种都很难在肉眼下发现，却能离线逐条测出来。

    单个标签本身宽于 ``max_width`` 时单独占一行（正文不可断行，只能让它略微超出），
    调用方应据此收紧标签文案，而不是在这里硬切。
    """
    rows: list[list[int]] = []
    current: list[int] = []
    used = 0.0
    for index, width in enumerate(widths):
        if not current:
            current = [index]
            used = width
            continue
        if used + gap + width <= max_width:
            current.append(index)
            used += gap + width
        else:
            rows.append(current)
            current = [index]
            used = width
    if current:
        rows.append(current)
    return rows


def _tag_text_color(
    choice: str,
    *,
    accent: tuple[int, int, int],
    body_text: tuple[int, int, int],
    muted_text: tuple[int, int, int],
) -> tuple[int, int, int]:
    """标签字色：模板 `.skill-list li` 写的是 `var(--accent)` / `var(--text)` / 没写（继承正文）。"""
    if choice == "accent":
        return accent
    if choice == "muted":
        return muted_text
    return body_text


def _tag_box_width(text_width: float, metrics: SkillTagMetrics, style: str) -> float:
    """标签外框宽度（mm）：文字宽 + 左右内边距 + 边框。

    边框**要算进外框宽度**：模板全局是 `box-sizing: border-box`，但 `.skill-list li` 没有
    显式宽度（`inline-block` 收缩包裹），所以 `border` 仍然会把外框撑宽（描边左右各一条，
    左侧色条只在左边一条）。
    """
    border_extra = 0.0
    if style == "outline":
        border_extra = 2 * metrics.border_mm
    elif style == "left_bar":
        border_extra = metrics.border_mm
    return text_width + 2 * metrics.padding_x + border_extra


def _text_offset(metrics: SkillTagMetrics, style: str) -> float:
    """文字相对外框左沿的起点：边框在内，文字要让开它。"""
    if style in ("outline", "left_bar"):
        return metrics.border_mm + metrics.padding_x
    return metrics.padding_x


def _rounded_rect(
    pdf: _ResumePDF,
    left: float,
    top: float,
    width: float,
    metrics: SkillTagMetrics,
    *,
    style: str,
) -> None:
    """画一个（可能带圆角的）标签外框，颜色由调用方先 `set_fill_color` / `set_draw_color` 定好。

    fpdf2 的 `corner_radius` 上限是短边的一半，超过会画歪——胶囊（`height/2`）在窄标签上
    正好顶到上限，所以这里自己 clamp，不指望库兜底。
    """
    if metrics.radius <= 0:
        pdf.rect(left, top, width, metrics.height, style=style)
        return
    corner = min(metrics.radius, metrics.height / 2, width / 2)
    pdf.rect(
        left,
        top,
        width,
        metrics.height,
        style=style,
        round_corners=True,
        corner_radius=corner,
    )


def _draw_tag_shape(
    pdf: _ResumePDF,
    left: float,
    top: float,
    width: float,
    metrics: SkillTagMetrics,
    *,
    style: str,
    fill: tuple[int, int, int] | None,
    accent: tuple[int, int, int],
) -> None:
    """按形状画标签的外框（文字由调用方写）。``plain`` / ``dot`` 什么都不画。"""
    if style == "fill":
        if fill is None:
            return
        pdf.set_fill_color(*fill)
        _rounded_rect(pdf, left, top, width, metrics, style="F")
    elif style == "outline":
        pdf.set_draw_color(*accent)
        pdf.set_line_width(metrics.border_mm)
        _rounded_rect(pdf, left, top, width, metrics, style="D")
    elif style == "left_bar":
        # 先铺满底色块，再在**框内**左侧画一条强调色竖条（CSS `border-left: 2px solid`）。
        if fill is not None:
            pdf.set_fill_color(*fill)
            pdf.rect(left, top, width, metrics.height, style="F")
        pdf.set_fill_color(*accent)
        pdf.rect(left, top, metrics.border_mm, metrics.height, style="F")
    # plain / dot：无背景无边框，只写字。


def _select_tag_font(pdf: _ResumePDF, metrics: SkillTagMetrics, *, mono: bool) -> None:
    """选定画**这一个**标签用的字体。

    ``mono`` 只在 `tag_mono` 模板（technical）且文本全为 ASCII 时为真：那时用内置 `courier`，
    否则用注册的中文字族。逐标签选字体是必需的——同一份简历里既有 `Python` 也有 `数据结构`。
    """
    if mono:
        pdf.set_font(_TAG_MONO_FONT, "", metrics.font_pt)
    else:
        pdf.set_font(FONT_FAMILY, "", metrics.font_pt)



def _draw_tag_grid(
    pdf: _ResumePDF,
    items: list[str],
    metrics: SkillTagMetrics,
    *,
    columns: int,
    text_color: tuple[int, int, int],
    use_mono: list[bool],
) -> None:
    """把标签铺成 `columns` 列网格（scholar 的三列项目符号列表）。

    与 CSS 的对应关系：`grid-template-columns: repeat(N, minmax(0, 1fr))` → 等宽单元格；
    `.skill-list li::before { content: "•" }` → 每个格子以「• 」开头；`column-gap` →
    `metrics.gap_x`。单元格里超宽的标签在格内折行（浏览器也是这么排的），行高取该行最高
    格，因此"多行技能"（条目数 > 列数）与"单个长标签"都不会越界或互相压住。

    **为什么量高与绘制必须同参**：折行算错不会报错，只会让最后一格压到下一行或越过右边距
    ——这两种在渲染结果里几乎看不出来。宽度、字体、行高三者必须与下面的 `multi_cell` 一致。

    只画「• 文本」而不画标签外框：当前唯一的多列模板 scholar 的 `tag_style` 是 `plain`
    （CSS 里 没有底色/边框）。若将来出现"带框 + 多列"的模板，应当在这里补形状分支，而不是
    悄悄丢掉框——`draw_skill_tags` 的多列分支只对 `plain` 生效，其余形态走原单列路径。
    """
    gap = metrics.gap_x
    cell_width = max(1.0, (pdf.frame_width - gap * (columns - 1)) / columns)
    tag_px = metrics.font_pt / _PX_TO_PT
    for start in range(0, len(items), columns):
        row = list(range(start, min(start + columns, len(items))))
        # 先量这一行每格的高度：单行标签的高度就是标签行盒，长标签按单元格宽度折行。
        heights = [
            pdf.text_block_height(
                f"{_TAG_BULLET} {items[index]}", width=cell_width, size_px=tag_px
            )
            for index in row
        ]
        row_height = max([metrics.height, *heights])
        pdf.ensure_space(row_height)
        top = pdf.get_y()
        for offset, index in enumerate(row):
            left = pdf.frame_left + offset * (cell_width + gap)
            _select_tag_font(pdf, metrics, mono=use_mono[index])
            pdf.set_text_color(*text_color)
            pdf.set_xy(left, top)
            pdf.multi_cell(
                cell_width,
                metrics.height,
                f"{_TAG_BULLET} {items[index]}",
                align="L",
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
        pdf.set_y(top + row_height)
        pdf.set_x(pdf.frame_left)


def draw_skill_tags(
    pdf: _ResumePDF,
    labels: list[str],
    base: float,
    *,
    layout: ResumeLayout,
    accent: tuple[int, int, int],
    line_color: tuple[int, int, int],
    body_text: tuple[int, int, int],
    muted_text: tuple[int, int, int],
    style=None,
) -> None:
    """把专业技能按**模板真实的标签形状**画出来（W07：可被 body 角色覆盖缩放/字色）。

    形状、圆角、内边距、行内/行间间距全部来自 ``layout`` 的 `tag_*` 字段（模板 CSS 的结构化
    映射），本函数只负责"按形状画"与折行：

    * ``fill``     —— 填充底色（classic 的硬编码浅灰、elegant 的 accent-soft）；
    * ``outline``  —— 强调色描边（modern / split 的胶囊，圆角取 `height / 2`）；
    * ``left_bar`` —— 底色块 + 左侧强调色竖条（technical）；
    * ``dot``      —— 无框，标签后跟一个「·」分隔符（compact，最后一个不加）；
    * ``plain``    —— 纯文字（minimal / editorial）。

    两个**整段排版**开关也在这里生效：

    * ``layout.tag_align == "center"``（只有 elegant）—— 每行按"该行标签总宽 + 间距之和"在
      列框内水平居中，对应 CSS 的 `.skill-list { text-align: center }`。此前 PDF 一律左对齐，
      于是 elegant 的标签在预览里居中、导出后靠左，是最容易一眼看出的偏差之一。
    * ``layout.tag_mono``（只有 technical）—— 逐标签决定用 `courier` 还是注册字族，见模块
      docstring 里"等宽字族"那一段。

    水平范围读的是 `pdf.frame_left` / `pdf.frame_width`（而不是 `layout.margin_x` /
    `pdf.content_width`）：双栏模板里技能标签画在半栏里，折行与居中都必须按半栏宽算。

    抽到本模块（而不是留在 `canvas._ResumePDF`）有两个原因：形状分支让画布类超 500 行预算，
    而且标签几何本来就是本模块的主题——放一起才看得清"注册表的比例"与"画出来的形状"对不对得上。
    """
    items = [str(label).strip() for label in labels if str(label).strip()]
    if not items:
        return
    if style is not None:
        base = base * (float(style.font_scale) if style.font_scale else 1.0)

    tag_style = layout.tag_style
    metrics = skill_tag_metrics(
        base,
        line_height=layout.line_height,
        tag_ratio=layout.tag_font_ratio,
        pad_x=layout.tag_pad_x,
        gap_x=layout.tag_gap_x,
        gap_y=layout.tag_gap_y,
        radius=layout.tag_radius,
        border_px=layout.tag_border_px,
    )

    fill = None if layout.tag_bg == "none" else _hex_to_rgb(layout.tag_bg)
    text_color = _tag_text_color(
        layout.tag_fg, accent=accent, body_text=body_text, muted_text=muted_text
    )
    if style is not None and style.color is not None:
        text_color = _hex_to_rgb(style.color) or text_color

    # 逐标签选字体后量宽度：等宽字体的字宽与正文字体不同，混着量会让折行算错。
    # `str.isascii()` 对空串也返回 True，但空标签已在上面被过滤掉。
    use_mono = [layout.tag_mono and item.isascii() for item in items]

    # ===== 多列网格（scholar 的三列技能）=====
    # 三列是模板 CSS 真实存在的排版（`grid-template-columns`），不是"预览专属效果"。
    # 只对 `plain` 形态生效：带框标签的多列模板尚未出现，出现时在 `_draw_tag_grid`
    # 里补形状分支，而不是在这里静默丢掉框。
    if layout.tag_columns > 1 and tag_style == "plain":
        _draw_tag_grid(
            pdf,
            items,
            metrics,
            columns=layout.tag_columns,
            text_color=text_color,
            use_mono=use_mono,
        )
        pdf.set_text_color(*body_text)
        return

    text_widths: list[float] = []
    for item, mono in zip(items, use_mono, strict=True):
        _select_tag_font(pdf, metrics, mono=mono)
        text_widths.append(pdf.get_string_width(item))

    # 标签外框宽度（**不含** dot 模板的分隔符）。居中对齐要按它算整行宽度。
    box_widths = [_tag_box_width(text_width, metrics, tag_style) for text_width in text_widths]
    widths = list(box_widths)
    separator_width = 0.0
    if tag_style == "dot":
        # `.skill-list li::after{ content:"·"; margin-left: .7em }` + li 的 `margin-right`：
        # 分隔符 与 它右侧的间距都算进**前一项**的宽度里，折行才会和预览同口径
        # （分隔符跟着前一项走，不会单独漂到下一行行首）。
        separator_width = pdf.get_string_width(_TAG_SEPARATOR)
        widths = [
            width + (metrics.gap_x + separator_width if index < len(items) - 1 else 0.0)
            for index, width in enumerate(widths)
        ]

    available = pdf.frame_width
    center = layout.tag_align == "center"
    for row in wrap_skill_tags(widths, max_width=available, gap=metrics.gap_x):
        pdf.ensure_space(metrics.height + metrics.gap_y)
        top = pdf.get_y()
        left = pdf.frame_left
        if center:
            # 行宽 = 各标签外框宽 + 之间的间距；超宽（单个标签比整栏还宽）时不动，保持左沿对齐，
            # 与浏览器的 `text-align: center` 在溢出时的表现一致。
            row_width = sum(box_widths[index] for index in row) + metrics.gap_x * (len(row) - 1)
            left += max(0.0, (available - row_width) / 2.0)
        for index in row:
            width = widths[index]
            _draw_tag_shape(pdf, left, top, width, metrics, style=tag_style, fill=fill, accent=accent)
            _select_tag_font(pdf, metrics, mono=use_mono[index])
            pdf.set_text_color(*text_color)
            pdf.set_xy(left + _text_offset(metrics, tag_style), top)
            pdf.cell(text_widths[index], metrics.height, items[index])

            if style == "dot" and index < len(items) - 1:
                # 分隔符用模板 `--line` 的颜色，跟着前一项的右沿走。
                pdf.set_text_color(*line_color)
                pdf.set_xy(left + box_widths[index] + metrics.gap_x, top)
                pdf.cell(separator_width, metrics.height, _TAG_SEPARATOR)

            left += width + metrics.gap_x
        pdf.set_y(top + metrics.height + metrics.gap_y)
        pdf.set_x(pdf.frame_left)

    # 标签用强调色 / 辅助色写字，用完必须把文字颜色还原，否则后面的正文也会跟着变色。
    pdf.set_text_color(*body_text)
