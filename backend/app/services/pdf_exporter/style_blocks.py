# SPDX-License-Identifier: Apache-2.0
"""PDF 的四个"角色级"绘制原语（W07 从 canvas.py 拆出，消费 ResolvedStyle）。

为什么拆出来：canvas.py 贴着 500 行预算，而 W07 要给区块标题 / 列表 / 条目头 / 副行
四条绘制路径加"角色 + 对象覆盖"的取值，直接内联会超线。拆法与 W05 的 skill_tags 相同：
几何与绘制在本模块，canvas 只保留**薄委托**，对外方法与签名不变。

风格来源只有 ``ResolvedStyle``（经 RenderOverrides 传入）：本模块不读 format_config、
不解析 CSS，只把 RoleStyle 里显式的值映射成绘制参数；None = 用模板值（默认路径零变化）。

PDF 的能力边界（W05 矩阵已冻结）：没有真斜体字形（italic 忽略）、无字距 API
（letter_spacing 忽略）；这两项不伪造，其它属性按值生效。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fpdf.enums import XPos, YPos

from .fonts import FONT_FAMILY
from .layout import _PX_TO_MM, _PX_TO_PT
from .rich_text import drawn_text
from .text_fit import entry_head_columns, truncate_to_width

if TYPE_CHECKING:  # pragma: no cover - 只为类型检查，运行期不能导入 canvas（会循环导入）
    from ..resume.resume_style import RoleStyle
    from .canvas import _ResumePDF

# 列表项符号（与 canvas 之前的值逐字一致；canvas 仍 re-export 给既有测试/调用方）。
_BULLET_MARK = "· "
_BULLET_CHARS = {"dot": "· ", "dash": "– ", "none": ""}
# 圆点符号与正文同号时在纸面上几乎看不见（2026-10-29 用户截图：精确预览里的点"快看不清"）：
# 只把「圆点」类符号放大到正文的 1.35 倍；破折号 / 无符号保持原样（改字形大小，不改项目内容）。
_BULLET_SIZE_SCALE = 1.35


def _bullet_font_size(font_size: float, bullet: str) -> float:
    """项目符号自身的字号：圆点放大，其它符号（破折号等）沿用正文。"""
    return font_size * _BULLET_SIZE_SCALE if bullet.strip() == "·" else font_size

# 条目头左右两栏之间要留出的间距（mm）：左栏 cell 只包到"实测标题宽 + 这一段"，右栏
# 从它后面开始并占满剩余宽度。右栏文字预算再扣掉 cell 的左右内边距（各 1mm），所以两段
# 文字之间的实际留白不小于 2.5mm——日期/会议名再长也不会贴到标题上。
_ENTRY_HEAD_GAP_MM = 2.5


def parse_color(value: str | None) -> tuple[int, int, int] | None:
    """#rrggbb / #rgb → RGB；非法返回 None（调用方回落到模板色）。"""
    if not isinstance(value, str):
        return None
    text = value.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    if len(text) != 6:
        return None
    try:
        return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))
    except ValueError:
        return None


def _color(style: RoleStyle | None, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
    if style is None or style.color is None:
        return fallback
    return parse_color(style.color) or fallback


def _scale(style: RoleStyle | None) -> float:
    return float(style.font_scale) if style is not None and style.font_scale else 1.0


def _line_height(pdf: _ResumePDF, style: RoleStyle | None, px: float) -> float:
    ratio = style.line_height if style is not None and style.line_height else pdf.layout.line_height
    return px * _PX_TO_MM * float(ratio)


def _bold(pdf: _ResumePDF, style: RoleStyle | None, default: bool) -> bool:
    if style is not None and style.bold is not None:
        return bool(style.bold)
    return default


def _letter_spacing_mm(base: float, style: RoleStyle | None) -> float:
    """角色/对象覆盖的字距（× 基准字号）→ 文档单位 mm；未设置返回 0。

    Q11：fpdf2 2.8.9 的 set_char_spacing 以**文档单位**收值（本画布 unit=mm），而
    HTML 的 letter-spacing 是 px × 基准字号；两处都从 base_px 派生，不会出现第二套数字。
    """
    value = style.letter_spacing if style is not None else None
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return 0.0
    return float(base) * float(value) * _PX_TO_MM


def _wrapmode_args(pdf: _ResumePDF, text: str, width: float, size_pt: float) -> dict:
    """超长不可断词（长 URL / 长英文词）时启用 CHAR 断行；普通文本保持默认断行。

    fpdf2 默认只按空格断行，一个比栏宽还长的 token 会**越过右边距**（W08 契约要求长链接
    断行）。只在确实存在超宽 token 时切换 wrapmode，避免改变普通文本的既有折行。
    """
    saved = (pdf.font_family, pdf.font_style, pdf.font_size_pt)
    pdf.set_font(FONT_FAMILY, "", size_pt)
    try:
        # 按**纸面上真正出现**的字符判断（斜体/链接标记不占宽度，链接的 URL 会展成文字）。
        for token in drawn_text(str(text)).split():
            if pdf.get_string_width(token) > width:
                return {"wrapmode": "CHAR"}
    finally:
        pdf.set_font(saved[0], saved[1], saved[2])
    return {}


def start_forced_page(pdf: _ResumePDF, plan, *, margin_top: float) -> None:
    """强制新页（W08）：只在当前页已有内容时换页，测量模式不换页。

    连续两条 break_before 不会吐出空白页（契约终止规则 1）；测量模式要的是"不限页数
    连续排下来多高"，换页会毁掉这个口径。
    """
    forced = getattr(plan, "break_before_page", False)
    if forced and not pdf.measuring and pdf.get_y() > margin_top + 0.5:
        pdf.add_page()


def _title_metrics(
    pdf: _ResumePDF, base: float, *, leading_gap: float, style: RoleStyle | None = None
) -> tuple[float, float, float, float, float, float]:
    """区块标题的几何量：(字号, 标题行高, 纵向内边距, 与正文间距, 标题块高, 前导留白)。

    抽出来是为了让"画标题"与"W08 预告标题+正文的总高"用**同一份算式**——两处各写一遍
    迟早漂移，而漂移的表现是"预留 10mm、实际画了 12mm"，页尾正好差一行。
    """
    layout = pdf.layout
    size = base * layout.section_title_ratio * _scale(style)
    title_height = pdf.line_advance(size)
    pad_y = layout.gap_mm(layout.section_title_pad_y)
    gap_after = (
        layout.gap_mm(float(style.space_after))
        if style is not None and style.space_after is not None
        else layout.gap_mm(layout.section_title_gap)
    )
    shape = layout.section_title_style
    if shape in ("soft_box", "accent_box"):
        block_height = title_height + 2 * pad_y
    elif shape == "underline":
        block_height = title_height + pad_y
    else:
        block_height = title_height
    return size, title_height, pad_y, gap_after, block_height, layout.gap_mm(leading_gap)


def section_title_total_height(
    pdf: _ResumePDF,
    base: float,
    *,
    leading_gap: float,
    style: RoleStyle | None = None,
    keep_lines: int = 0,
) -> float:
    """区块标题占用的总高度（前导留白 + 标题块 + 与正文间距 + 预留正文行）。

    W08 的"标题跟随后续内容"与"标题+整段正文保持同页"都从这一个数出发：前者在
    draw_section_title 里自用，后者由 render 的摘要分支在落笔前调用。
    """
    _, _, _, gap_after, block_height, gap_before = _title_metrics(
        pdf, base, leading_gap=leading_gap, style=style
    )
    return (
        gap_before
        + block_height
        + gap_after
        + pdf.line_advance(base)
        + max(0, keep_lines) * pdf.line_advance(base)
    )


def draw_section_title(
    pdf: _ResumePDF,
    text: str,
    base: float,
    *,
    leading_gap: float,
    style: RoleStyle | None = None,
    section: str = "",
    keep_lines: int = 0,
) -> None:
    """区块标题：形状/颜色由模板决定；角色覆盖可改字号、字色、下边距与对齐。"""
    layout = pdf.layout
    size, title_height, pad_y, gap_after, block_height, gap_before = _title_metrics(
        pdf, base, leading_gap=leading_gap, style=style
    )
    pad_x = layout.gap_mm(layout.section_title_pad_x)
    shape = layout.section_title_style
    bar_w = 4 * _PX_TO_MM
    pdf.ensure_space(
        section_title_total_height(pdf, base, leading_gap=leading_gap, style=style, keep_lines=keep_lines)
    )
    pdf.ln(gap_before)
    top = pdf.get_y()

    pdf.set_font(FONT_FAMILY, "B", size * _PX_TO_PT)
    # 宽度按**投影后**的正文量：斜体/链接标记不占纸面宽度，加粗字形可能更宽。
    text_width = pdf.rich_text_width(text)
    text_x = pdf.frame_left + pad_x

    if shape == "left_bar":
        text_x = pdf.frame_left + bar_w + pad_x
        pdf.set_fill_color(*pdf.accent)
        pdf.rect(pdf.frame_left, top, bar_w, title_height, style="F")
    elif shape == "soft_box":
        pdf.set_fill_color(*pdf.accent_soft)
        pdf.rect(
            pdf.frame_left,
            top,
            pdf.frame_width,
            block_height,
            style="F",
            round_corners=True,
            corner_radius=base * _PX_TO_MM * 0.4,
        )
    elif shape == "accent_box":
        pdf.set_fill_color(*pdf.accent)
        pdf.rect(pdf.frame_left, top, pdf.frame_width, block_height, style="F")

    align = (
        style.align if style is not None and style.align else None
    ) or layout.section_title_align
    if align == "center":
        text_x = pdf.frame_left + max(0.0, (pdf.frame_width - text_width) / 2)
    elif align == "right":
        text_x = pdf.frame_left + max(0.0, pdf.frame_width - text_width - pad_x)

    pdf.set_text_color(*_color(style, pdf._section_title_color()))
    pdf.set_xy(text_x, top + pad_y)
    pdf.cell(0, title_height, text, new_x=XPos.RIGHT, new_y=YPos.TOP)

    if shape == "underline":
        line_y = top + title_height + pad_y
        pdf.set_draw_color(*pdf.line_color)
        pdf.set_line_width(0.3)
        pdf.line(pdf.frame_left, line_y, pdf.frame_left + pdf.frame_width, line_y)

    pdf.set_y(top + block_height + gap_after)
    pdf.set_x(pdf.frame_left)
    pdf.set_text_color(*pdf.body_text)
    if section:
        pdf.record(kind="section", section=section, y_top=top, text=text)


def draw_bullets(
    pdf: _ResumePDF,
    items: list[str],
    base: float,
    *,
    style: RoleStyle | None = None,
    section: str = "",
    object_id: str | None = None,
    split_ok: bool = False,
) -> None:
    """列表项：缩进/符号/行高/对齐可被角色（或对象）覆盖；分页口径与既有实现一致。"""
    layout = pdf.layout
    font_size = base * _scale(style)
    line_height = _line_height(pdf, style, font_size)
    indent = (
        layout.gap_mm(float(style.indent))
        if style is not None and style.indent is not None
        else layout.gap_mm(layout.li_indent)
    )
    bullet = (
        _BULLET_CHARS.get(style.bullet, _BULLET_MARK) if style and style.bullet else _BULLET_MARK
    )
    align = (style.align if style is not None and style.align else None) or "L"
    color = _color(style, pdf.body_text)
    # Q11：正文加粗用 B 字重；字距用 fpdf2 的 set_char_spacing（文档单位 mm，用完复位）。
    bold = _bold(pdf, style, False)
    letter_spacing = _letter_spacing_mm(base, style)
    if letter_spacing:
        pdf.set_char_spacing(letter_spacing)
    li_gap = layout.gap_mm(layout.li_gap)
    marker_size = _bullet_font_size(font_size, bullet)
    pdf.set_font(FONT_FAMILY, "", marker_size * _PX_TO_PT)
    marker_width = float(pdf.get_string_width(bullet)) if bullet else 0.0
    text_left = pdf.frame_left + indent
    width = max(1.0, pdf.frame_width - indent)
    pad = float(pdf.c_margin)
    max_fit = layout.usable_height_per_page - 2 * line_height
    first = True
    for item_index, item in enumerate(items):
        text = str(item).strip()
        if not text:
            continue
        height = pdf._dry_run_height(width, line_height, text)
        gap = 0.0 if first else li_gap
        if split_ok:
            # allow_split=True：只预留一行，让 multi_cell 按行自然劈开（长要点可以跨页）。
            pdf.ensure_space(gap + line_height)
        elif height <= max_fit:
            pdf.ensure_space(gap + height)
        else:
            pdf.ensure_space(gap + line_height)
        if gap:
            pdf.ln(gap)
        first = False
        top = pdf.get_y()
        pdf.set_text_color(*color)
        if bullet:
            pdf.set_font(FONT_FAMILY, "", marker_size * _PX_TO_PT)
            # 圆点放大后（_BULLET_SIZE_SCALE）它与正文的基线会差 0.3×字号差：把符号那格
            # 上移这么多，符号基线与首行正文基线重合（与 CSS list-style 的视觉对齐一致）。
            marker_baseline_gap = 0.3 * (marker_size - font_size) * _PX_TO_MM
            pdf.set_xy(text_left - marker_width - pad, top - marker_baseline_gap)
            pdf.cell(marker_width + 2 * pad, line_height, bullet, new_x=XPos.LEFT, new_y=YPos.TOP)
            pdf.set_font(FONT_FAMILY, "B" if bold else "", font_size * _PX_TO_PT)
            # 上移只作用在符号那一格：正文仍从行首 top 起排（否则整条要点跟着抬高）。
            pdf.set_y(top)
        pdf.set_x(text_left)
        item_top = pdf.get_y()
        pdf.multi_cell(
            width,
            line_height,
            text,
            align=align,
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
            **_wrapmode_args(pdf, text, width, font_size * _PX_TO_PT),
        )
        if section:
            pdf.record(
                kind="point",
                section=section,
                y_top=item_top,
                object_id=object_id,
                point_index=item_index,
                text=text,
            )
    if letter_spacing:
        pdf.set_char_spacing(0)
    pdf.set_text_color(*pdf.body_text)


def draw_entry_head(
    pdf: _ResumePDF,
    left: str,
    right: str,
    base: float,
    *,
    style: RoleStyle | None = None,
    meta_style: RoleStyle | None = None,
    section: str = "",
    object_id: str | None = None,
    keep_lines: int = 0,
) -> None:
    """条目头：左侧标题 + 右侧时间；可覆盖字号/颜色/粗体/对齐/段前距/日期形态。"""
    layout = pdf.layout
    size = base * layout.entry_title_ratio * _scale(style)
    line_height = _line_height(pdf, style, size)
    entry_top = pdf.get_y()
    if style is not None and style.space_before is not None:
        pdf.ln(layout.gap_mm(float(style.space_before)))
    pdf.ensure_space(
        line_height + pdf.line_advance(base) + max(0, keep_lines) * pdf.line_advance(base)
    )
    available = pdf.frame_width
    inline_meta = meta_style is not None and meta_style.meta_align == "inline"
    title_width = available if inline_meta else available * 0.68
    pdf.set_font(FONT_FAMILY, "B" if _bold(pdf, style, True) else "", size * _PX_TO_PT)
    pdf.set_text_color(*_color(style, pdf.body_text))
    # 左栏标题：cell 不会折行也不会缩略，超宽会盖到右栏（没有右栏时则越过右边距）。
    # 先按栏宽量宽截断；放得下时原样返回，所以常规标题不受影响。
    left_budget = available if not right else title_width
    left_text = truncate_to_width(
        left, max(0.0, left_budget - _ENTRY_HEAD_GAP_MM), pdf.get_string_width
    )
    # 非 inline 时左 cell 只包住"实测标题宽 + 栏间距"，右栏从它后面开始、占满剩余宽度：
    # 左标题短时右栏自动变宽（固定 68/32 会把正常长度的日期/期刊名/专利状态误截掉）。
    left_width = float(pdf.get_string_width(left_text))
    left_cell_width = (
        title_width
        if inline_meta
        else entry_head_columns(available, left_width, _ENTRY_HEAD_GAP_MM)[0]
    )
    pdf.set_x(pdf.frame_left)
    pdf.cell(
        left_cell_width,
        line_height,
        left_text,
        new_x=XPos.RIGHT,
        new_y=YPos.TOP,
    )
    if not right:
        pdf.ln(line_height)
        pdf.set_text_color(*pdf.body_text)
        return
    meta_size = (
        base
        * layout.entry_meta_ratio
        * (_scale(meta_style) if meta_style is not None and meta_style.font_scale else 1.0)
    )
    pdf.set_font(FONT_FAMILY, "", meta_size * _PX_TO_PT)
    pdf.set_text_color(*_color(meta_style, pdf.muted_text))
    if inline_meta:
        pdf.cell(0, line_height, right, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    else:
        # 右栏从"左栏 cell 的右缘"开始、宽 = 版心剩余宽度；右对齐的文字因此仍停在版心
        # 右缘。只有超过"右栏宽 - cell 左右内边距"才截断——正常长度的日期/期刊名/状态
        # 在左标题较短时不会被误砍。
        meta_width = available - left_cell_width
        right_text = truncate_to_width(
            right, max(0.0, meta_width - 2 * float(pdf.c_margin)), pdf.get_string_width
        )
        pdf.cell(
            meta_width,
            line_height,
            right_text,
            align="R",
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )
    pdf.set_text_color(*pdf.body_text)
    if section:
        pdf.record(kind="entry", section=section, y_top=entry_top, object_id=object_id, text=left)


def draw_meta_line(
    pdf: _ResumePDF, text: str, base: float, *, style: RoleStyle | None = None
) -> None:
    """条目下的副行（绩点 / 课程 / 技术栈）：字号与颜色可被角色覆盖。"""
    if not text.strip():
        return
    layout = pdf.layout
    size = base * layout.entry_sub_ratio * _scale(style)
    line_height = _line_height(pdf, style, size)
    pdf.ensure_space(layout.gap_mm(layout.sub_gap_top) + line_height)
    pdf.ln(layout.gap_mm(layout.sub_gap_top))
    pdf.set_font(FONT_FAMILY, "", size * _PX_TO_PT)
    pdf.set_text_color(*_color(style, pdf.muted_text))
    pdf.set_x(pdf.frame_left)
    pdf.multi_cell(
        pdf.frame_width,
        line_height,
        text,
        align="L",
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
        **_wrapmode_args(pdf, text, pdf.frame_width, size * _PX_TO_PT),
    )
    pdf.ln(layout.gap_mm(layout.sub_gap_bottom))
    pdf.set_text_color(*pdf.body_text)





__all__ = [
    "_BULLET_MARK",
    "parse_color",
    "draw_bullets",
    "draw_entry_head",
    "draw_meta_line",
    "draw_section_title",
]
