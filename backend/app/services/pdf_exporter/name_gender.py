"""页头「姓名（+ 性别）」的测量与绘制（量画互逆）。"""
from __future__ import annotations

from dataclasses import dataclass

from fpdf.enums import XPos, YPos

from .canvas import _ResumePDF
from .fonts import FONT_FAMILY
from .layout import _BODY_TEXT, _MUTED_TEXT, _PX_TO_MM, _PX_TO_PT

# fpdf2 在 cell 内放文字基线的规则：基线 = 单元格顶 + 0.5×行高 + 0.3×字号（见其
# `_render_styled_text_line` 的 `Td` 定位）。同一行画两种字号时若不给性别那半格补偿，
# 小字号会被抬得比姓名的基线高约 1mm——预览里两个 span 是 inline、基线对齐的，照做。
_CELL_BASELINE_FONT_FACTOR = 0.3


@dataclass(frozen=True)
class NameGenderPlan:
    """页头"姓名（+ 性别）"这一块的绘制计划（只含几何，不含文字样式）。

    预览里性别是 `.name` 内独立的 `<span class="name-extra">`：常规字重、muted 灰、
    `name_extra_ratio` 倍字号，与姓名**同行**（放不下就折到下一行）。PDF 此前把性别
    拼进姓名字符串、整行用姓名的字号/粗体/强调色渲染——"性别和姓名一样大"即来源于此。
    计划与绘制（`draw_name_gender`）是同一逻辑的两半：先量后排，块高严格等于
    ``height``，保证测量路径（`measure_content_height`）与渲染路径"量的就是画的"。
    """

    same_line: bool    # 性别是否与姓名同一行（无性别时为 False）
    gender_text: str   # 同行时含前导空格；独占一行时为纯文本；无性别为空串
    gender_width: float  # gender_text 的宽度（mm，按 extra 字号量出）
    height: float      # 整块高度（mm）：同行 = 两种字号行高中较大者；换行 = 姓名 + 性别两段


def plan_name_gender(
    pdf: _ResumePDF,
    name: str,
    gender: str,
    *,
    width: float,
    name_size: float,
    extra_size: float,
) -> NameGenderPlan:
    """量出"姓名（+ 性别）"块的排法（只量不画），与 `draw_name_gender` 严格互逆。

    ``name_size`` / ``extra_size`` 是字号（px），分别乘 `name_ratio` / `name_extra_ratio`
    得到（调用方从 `ResumeLayout` 取，本函数不碰注册表）。
    """
    name_height = pdf.text_block_height(name, width=width, size_px=name_size, bold=True)
    gender_text = (gender or "").strip()
    if not gender_text:
        return NameGenderPlan(same_line=False, gender_text="", gender_width=0.0, height=name_height)

    pdf.set_font(FONT_FAMILY, "B", name_size * _PX_TO_PT)
    name_width = pdf.get_string_width(name)
    pdf.set_font(FONT_FAMILY, "", extra_size * _PX_TO_PT)
    # 与预览一致：两个 span 之间就是一个空格，间隔算进性别那段的宽度里。
    inline_text = f" {gender_text}"
    inline_width = pdf.get_string_width(inline_text)
    # 同行条件：姓名本身单行、且"姓名 + 性别"放得下（cell 内左右各有一段内边距要一并算）。
    name_single_line = name_height <= pdf.line_advance(name_size) + 1e-6
    if name_single_line and name_width + inline_width + 2 * pdf.c_margin <= width:
        row_height = max(pdf.line_advance(name_size), pdf.line_advance(extra_size))
        return NameGenderPlan(same_line=True, gender_text=inline_text, gender_width=inline_width, height=row_height)
    # 放不下：性别折到姓名下一行（预览的 inline 折行行为），各按各的字号计高。
    own_height = pdf.text_block_height(gender_text, width=width, size_px=extra_size)
    return NameGenderPlan(same_line=False, gender_text=gender_text, gender_width=inline_width, height=name_height + own_height)


def draw_name_gender(
    pdf: _ResumePDF,
    name: str,
    plan: NameGenderPlan,
    *,
    width: float,
    name_size: float,
    extra_size: float,
) -> None:
    """按 `plan` 画"姓名（+ 性别）"块：姓名用姓名字号/粗体/强调色，性别用 extra 口径。

    画完把光标放回块左下角（x 回到起笔处、y 前进 ``plan.height``），与 multi_cell 的
    收尾行为一致，调用方不必知道这块是几个 cell 画出来的。
    """
    left = pdf.get_x()
    top = pdf.get_y()
    pdf.set_text_color(*pdf.accent)
    if plan.same_line:
        pdf.set_font(FONT_FAMILY, "B", name_size * _PX_TO_PT)
        name_width = pdf.get_string_width(name)
        pdf.cell(name_width, plan.height, name, new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.set_font(FONT_FAMILY, "", extra_size * _PX_TO_PT)
        pdf.set_text_color(*_MUTED_TEXT)
        # 基线对齐补偿：把性别那格加高 2×0.3×字号差，两种字号的基线即重合
        # （cell 文字起点还各带一段左右内边距，两种字号下正好互相抵消，不另补）。
        baseline_gap = _CELL_BASELINE_FONT_FACTOR * (name_size - extra_size) * _PX_TO_MM
        pdf.cell(
            plan.gender_width,
            plan.height + 2 * baseline_gap,
            plan.gender_text,
            new_x=XPos.LMARGIN,
            new_y=YPos.TOP,
        )
    else:
        pdf.set_font(FONT_FAMILY, "B", name_size * _PX_TO_PT)
        pdf.multi_cell(
            width,
            pdf.line_advance(name_size),
            name,
            align="L",
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )
        if plan.gender_text:
            pdf.set_font(FONT_FAMILY, "", extra_size * _PX_TO_PT)
            pdf.set_text_color(*_MUTED_TEXT)
            pdf.set_x(left)
            pdf.multi_cell(
                width,
                pdf.line_advance(extra_size),
                plan.gender_text,
                align="L",
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
    pdf.set_xy(left, top + plan.height)
    pdf.set_text_color(*_BODY_TEXT)
