# SPDX-License-Identifier: Apache-2.0
"""灰字段「副行」的绘制（问题 17 从 style_blocks.py 拆出）。

为什么单独一个文件：``style_blocks.py`` 已经贴着 500 行预算，而问题 17 要给副行加
"组内首/末条"的段距语义（``first`` / ``last`` + ``ensure_space`` 同步）。按项目约定
（行数预算守卫）不再往 ``style_blocks`` 里塞，改为把这条绘制路径整体搬到这里；拆法与
W05 的 ``skill_tags``、W07 的 ``style_blocks`` 相同——几何与绘制在本模块，canvas 只保留
薄委托，对外签名向后兼容（新增两个带默认值的关键字参数）。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fpdf.enums import XPos, YPos

from .fonts import FONT_FAMILY
from .layout import _PX_TO_PT
from .style_blocks import _bold, _color, _line_height, _scale, _wrapmode_args

if TYPE_CHECKING:  # pragma: no cover - 只为类型检查，运行期不能导入 canvas（会循环导入）
    from ..resume.resume_style import RoleStyle
    from .canvas import _ResumePDF


def sub_gaps(layout, *, first: bool, last: bool) -> tuple[float, float]:
    """副行组在 PDF 里的（组前, 组后）段距（mm）：只有组内首/末条才取非零值。

    HTML 侧这对段距属于 ``.sub`` **容器**（``resume.html.j2`` 里 ``.entry .sub`` 的
    ``margin: calc(var(--fs) * 0.14) 0 calc(var(--fs) * 0.28)``），一组只加一次；PDF 侧是
    逐条调用绘制函数，所以必须由调用方声明自己是不是组的边界，否则组级段距会被按
    "每条"重复加（28 号第一页 7 条灰字段因此多出约 35px，挤掉一条实习经历）。

    Args:
        layout: 模板版式（``sub_gap_top`` / ``sub_gap_bottom`` 是模板参数，本函数不写死系数）。
        first: 是否是组内第一条（True → 返回组前段距）。
        last: 是否是组内最后一条（True → 返回组后段距）。

    Returns:
        ``(gap_top, gap_bottom)``，单位 mm；非边界一项为 0.0。
    """
    gap_top = layout.gap_mm(layout.sub_gap_top) if first else 0.0
    gap_bottom = layout.gap_mm(layout.sub_gap_bottom) if last else 0.0
    return gap_top, gap_bottom


def draw_meta_line(
    pdf: _ResumePDF,
    text: str,
    base: float,
    *,
    style: RoleStyle | None = None,
    first: bool = True,
    last: bool = True,
) -> None:
    """条目下的副行（绩点 / 课程 / 技术栈）：字号与颜色可被角色覆盖。

    Args:
        pdf: 目标画布。
        text: 这一行的纯文本（planner 已拼好「标签：值」与 flow 分隔符）。
        base: 基准字号（px，= 模板 ``--fs``）。
        style: ``meta`` 角色的样式覆盖（字号缩放 / 字色 / 加粗）。
        first: 是否是这一组的**第一条**（True 时加组前段距）；**默认 True = 旧行为**。
        last: 是否是这一组的**最后一条**（True 时加组后段距）；**默认 True = 旧行为**。

    Note:
        默认值取"首尾都加"，是为了让"一条一组"的调用点（单段副行、flow 模式一次一行）
        不改一行代码也逐像素保持不变；只有等宽多行组（``.sub-grid`` 一个容器排多行）
        才由调用方把中间行标成 ``first=False, last=False``。
    """
    if not text.strip():
        return
    layout = pdf.layout
    size = base * layout.entry_sub_ratio * _scale(style)
    line_height = _line_height(pdf, style, size)
    gap_top, gap_bottom = sub_gaps(layout, first=first, last=last)
    # 与旧实现同一份预留量口径：中间行只预留行高，否则分页点会提前一行。
    pdf.ensure_space(gap_top + line_height)
    if gap_top:
        pdf.ln(gap_top)
    # #5c：副行（绩点/课程/技术栈）的加粗同样此前被 "" 硬编码丢掉。
    pdf.set_font(FONT_FAMILY, "B" if _bold(pdf, style, False) else "", size * _PX_TO_PT)
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
    if gap_bottom:
        pdf.ln(gap_bottom)
    pdf.set_text_color(*pdf.body_text)


__all__ = ["draw_meta_line", "sub_gaps"]
