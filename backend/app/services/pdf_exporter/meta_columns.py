# SPDX-License-Identifier: Apache-2.0
"""W4 条目字段多列：把一行里的多个「标签：值」单元格**并排**画出来（PDF 精确预览）。

**为什么单独成文件**：``canvas.py`` 贴着 500 行硬预算（见 ``tests/test_file_size_budget.py``），
而"一行画成 N 列"的几何与 ``style_blocks.draw_meta_line`` **同源不同形**——字号
（``base × entry_sub_ratio × style.font_scale``）、颜色、``sub_gap_top`` / ``sub_gap_bottom``、
``ensure_space``、画完复位字色，全都要与那条单段副行**逐项一致**；唯一差别是把一段文本
拆成 N 列并排。两处各写一份必然漂移，表现就是"1 列与 2 列的副行行距 / 字号不一样"。

**列宽按内容预算，不平分**（2026-10 用户反馈"精确模式与预览观感不一致"）：此前这里把
``frame_width`` **平分**给 N 列，于是间距变大时列宽同步变窄、第二列只右移 ``gap/2``；而 HTML
侧是"列宽自适应内容 + 真实 ``column-gap``"，第二列右移**整个** gap。现在列宽由
``column_widths`` 按「每列最宽内容」预算（与 HTML 的 ``minmax(0, auto)`` 同口径），总宽超出
可用宽度时才按比例压缩，因此"第二列起点 = 第一列内容宽 + gap"，两种渲染模式观感一致。
跨行列宽必须一致（HTML 靠一个共享 grid 解决同一件事）：调用方每个 entry 只算一次。

**为什么 gap 是字号倍数**：用户在面板上调的是 ``--fs`` 的倍数（HTML 侧
``column-gap: calc(var(--fs) * N)``），而 PDF 的 ``base`` 就是模板 ``:root`` 里的 ``--fs``
（px），所以调用方按 ``gap = base × gap_ratio × _PX_TO_MM`` 换算成毫米传进来，与预览同口径；
写死毫米会在改字号 / 换模板后错位（这也是整个 W4 域把 gap 存成倍数的原因）。

**单位**：画布是 ``unit="mm"``，所以 ``widths`` / ``gap`` / ``max_width`` 全部是**毫米**，
``base`` 仍是 px 字号（与 ``draw_meta_line`` 同口径）。

**无配置时一行代码都不进**：调用方（``profile_fields``）只在"该分区配了多列、且这一行确实
多于一个 cell"时才走这里；默认配置仍走 ``meta_line``，默认 PDF 产物逐字节不变
（``tests/test_export_golden.py`` 守着）。
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING

from fpdf.enums import XPos, YPos

from ..resume.column_geometry import resolved_column_geometry
from .fonts import FONT_FAMILY
from .layout import _PX_TO_PT
from .meta_lines import draw_meta_line, sub_gaps
from .style_blocks import _color, _line_height, _scale, _wrapmode_args

if TYPE_CHECKING:  # pragma: no cover - 只为类型检查，运行期不能导入 canvas（会循环导入）
    from ..resume.resume_style import RoleStyle
    from .canvas import _ResumePDF

# 一行里多个 cell 退回单段绘制时的连接符（与 v1 profile_field_lines.ROW_SEPARATOR 同值；
# v1 排版模块已删除，常量内联在这里，少一个跨模块依赖）。
_ROW_SEPARATOR = " · "
# 列数防御性上限：解析层已夹取 1–3，这里再兜一次，绝不因坏数据画出负宽度。
_MAX_COLUMNS = 3
# 列宽小于这个值（mm）就没有排字的意义了：整行退回单段绘制（宁可少一列，也不能画成竖排）。
_MIN_COLUMN_WIDTH = 4.0


def _cell_texts(cells: Sequence[Sequence[str]]) -> list[str]:
    """``[(标签, 值), ...]`` → ``["标签：值", ...]``（与 HTML 的「标签全角冒号」一致）。

    元组长度不足 / 值不是字符串的脏数据不会炸：缺的部分当空串，与 ``profile_row_text``
    同口径（导出宁可变丑也不要 500）。
    """
    texts: list[str] = []
    for cell in cells:
        if isinstance(cell, str):
            # v2：planner 已把「标签：值」写进 Inline 段，调用方直接传成品字符串。
            texts.append(cell)
            continue
        parts = list(cell)
        label = str(parts[0]) if len(parts) > 0 else ""
        value = str(parts[1]) if len(parts) > 1 else ""
        texts.append(f"{label}：{value}")
    return texts


def set_meta_font(pdf: _ResumePDF, base: float, style: RoleStyle | None = None) -> None:
    """把画布字体切到**副行字号**（pt），供 ``column_widths`` 量宽用。

    字号表达式与 ``draw_meta_line`` / ``draw_meta_columns`` 逐项相同
    （``base × entry_sub_ratio × style.font_scale`` → pt）：量宽与最终绘制必须是同一个字体，
    否则预算出来的列宽与真实排版会悄悄差几个百分点。
    """
    pdf.set_font(FONT_FAMILY, "", base * pdf.layout.entry_sub_ratio * _scale(style) * _PX_TO_PT)


def column_widths(
    pdf: _ResumePDF,
    rows: Sequence[Sequence[Sequence[str]]],
    columns: int,
    gap: float,
    max_width: float,
) -> list[float]:
    """按「每列最宽内容」预算列宽；总宽超 ``max_width`` 时按比例压缩。

    **前置条件**：调用前必须已经 ``set_font``（字号 = 最终绘制时的副行字号），因为
    ``get_string_width`` 用的是**当前**字体的字形宽度。``profile_fields`` 用
    ``set_meta_font`` 统一这一步；自己拼别的入口时务必保证两边字号一致。

    Args:
        pdf: 已 ``set_font`` 的画布（只用它的 ``get_string_width`` 与 ``c_margin``）。
        rows: ``profile_field_rows`` 的行列表（每行是 ``[(标签, 值), ...]``）。
        columns: 配置的列数（1–3）；返回值长度**恒等于**它（末行不满时后面的列宽照样保留，
            否则同一 entry 里跨行的第二列起点会跳动）。
        gap: 列间距（mm）。
        max_width: 可用总宽（mm），通常是 ``pdf.frame_width``。

    Returns:
        长度恰为 ``columns`` 的列宽列表（mm）。某列在该 entry 的所有行里都没有内容时为
        ``0.0``——调用方按该行实际 cell 数取前缀（``widths[:count]``），不会画出 0 宽栏。
        间距本身已经吃掉全部可用宽度时全部为 ``0.0``：调用方据此退回单段绘制（内容不丢）。
    """
    count = max(1, min(int(columns), _MAX_COLUMNS))
    # `multi_cell` 的可用文本宽度是 `width - 2 × c_margin`（fpdf2 每侧默认 1mm 的内边距，
    # 见 `FPDF.multi_cell` 的 clearance）。预算必须把这两侧内边距算进列宽，否则"刚好等于
    # 内容宽"的列会把最后几个字折到下一行——实测 gap=1.6 时第一列就折成「学习形式：全日 / 制」。
    pad = 2.0 * float(pdf.c_margin)
    widths = [0.0] * count
    for row in rows:
        # 与某行 cell 数不一致时按 `min(columns, len(row))` 取前缀。
        texts = _cell_texts(list(row)[:count])
        for index, text in enumerate(texts):
            width = float(pdf.get_string_width(text)) + pad
            if width > widths[index]:
                widths[index] = width
    content_width = sum(widths)
    if content_width + gap * (count - 1) > max_width and content_width > 0:
        # 按比例压缩：间距优先保留（否则列会被压成竖排），剩余宽度按内容比例分配。
        available = max(0.0, max_width - gap * (count - 1))
        factor = available / content_width
        widths = [width * factor for width in widths]
    return widths


def resolve_cell_widths(
    pdf: _ResumePDF,
    rows: Sequence[Sequence[Sequence[str]]],
    columns: int,
    layout,
    gap_mm: float,
) -> tuple[list[float], float | Sequence[float]]:
    """任务 13：把「逐列宽度 / 逐间隔」翻译成 PDF 的 (列宽列表, 间距)。

    与 HTML 的 `grid-template-columns` 共用 `resolved_column_geometry` 的判据（长度对不上
    就整体作废）。三种情况：

    * 有逐列宽度：按百分比切**扣掉间距后的可用宽**（与 CSS 百分比相对网格内容宽同口径）；
    * 只有逐间隔：等分剩余宽度（间距之和已变，再按内容量宽的口径对不上）；
    * 都没有：沿用 `column_widths` 的"按内容量宽"，旧产物逐字节不变。
    """
    explicit_widths, explicit_gaps = resolved_column_geometry(
        columns, layout.column_widths, layout.column_gaps
    )
    gap_list = [pdf.layout.gap_mm(ratio) for ratio in explicit_gaps] if explicit_gaps else None
    total_gap = sum(gap_list) if gap_list else gap_mm * (columns - 1)
    available = max(0.0, pdf.frame_width - total_gap)
    if explicit_widths is not None:
        widths = [available * share / 100.0 for share in explicit_widths]
    elif gap_list is not None:
        widths = [available / columns for _ in range(columns)]
    else:
        widths = column_widths(pdf, rows, columns, gap_mm, pdf.frame_width)
    return widths, (gap_list if gap_list is not None else gap_mm)


def draw_meta_columns(
    pdf: _ResumePDF,
    cells: Sequence[Sequence[str]],
    widths: Sequence[float],
    gap: float | Sequence[float],
    base: float,
    *,
    style: RoleStyle | None = None,
    first: bool = True,
    last: bool = True,
) -> None:
    """一行 ``cells`` 按预算好的 ``widths`` 并排绘制（几何与 ``draw_meta_line`` 同口径）。

    Args:
        pdf: 目标画布。
        cells: 该行的 ``[(标签, 值), ...]``（``profile_field_rows`` 的一行）。
        widths: 该 entry **共用**的列宽预算（``column_widths`` 的返回值，mm）；本行按自己
            的 cell 数取前缀，因此同一 entry 里每行的列起点一致。
        gap: 列间距（mm）。
        base: 基准字号（px，= 模板 ``--fs``）。
        style: ``meta`` 角色的样式覆盖（字号缩放 / 字色），与 ``meta_line`` 同一份语义。
        first: 是否是这一组的**第一行**（问题 17：True 时加组前段距）。
        last: 是否是这一组的**最后一行**（问题 17：True 时加组后段距）。

    Note:
        「一行多个 cell」本身属于**同一行**，组语义落在"行"上，不要把同一个 ``first``
        分给行里的每个 cell（那等于按 cell 重复加段距，正是问题 17 的老毛病）。
    """
    texts = _cell_texts(cells)
    if not texts:
        return
    layout = pdf.layout
    count = min(len(texts), len(widths), _MAX_COLUMNS)
    used = [float(width) for width in widths[:count]]
    if count <= 1 or count < len(texts) or any(width < _MIN_COLUMN_WIDTH for width in used):
        # 只剩一栏 / 栏数不够放完 / 栏太窄（间距过大或压缩后）：整行退回单段绘制，
        # 内容一个都不丢（宁可少一列，也不能把正文画成竖排或裁掉）。
        draw_meta_line(pdf, _ROW_SEPARATOR.join(texts), base, style=style, first=first, last=last)
        return

    size = base * layout.entry_sub_ratio * _scale(style)
    line_height = _line_height(pdf, style, size)
    # 问题 17：段距只在组的两端出现（与 draw_meta_line 共用 `sub_gaps` 一份判据）。
    gap_top, gap_bottom = sub_gaps(layout, first=first, last=last)
    # 量宽与绘制同一个字体（见 `set_meta_font` 的 docstring）。
    set_meta_font(pdf, base, style)
    # 整行高度取各列折行后的最大值：否则高的一列会压到下一行（行距由最高的列决定）。
    row_height = max(
        # 量高与绘制用同一个 `multi_cell` 口径（canvas 在那一层统一投影行内标记）。
        pdf._dry_run_height(width, line_height, text)
        for width, text in zip(used, texts, strict=True)
    )
    pdf.ensure_space(gap_top + row_height)
    if gap_top:
        pdf.ln(gap_top)
    pdf.set_text_color(*_color(style, pdf.muted_text))
    y_top = pdf.get_y()
    # 逐列起点 = 前面各列预算宽度之和 + 各 gap：第二列因此是"第一列内容宽之后 + gap"，
    # 而不是"容器一半"（后者会让 gap 变化时只有半个位移，与预览观感对不上）。
    x = pdf.frame_left
    for position, (text, width) in enumerate(zip(texts, used, strict=True)):
        pdf.set_xy(x, y_top)
        pdf.multi_cell(
            width,
            line_height,
            text,
            align="L",
            new_x=XPos.RIGHT,
            new_y=YPos.TOP,
            **_wrapmode_args(pdf, text, width, size * _PX_TO_PT),
        )
        # 逐间隔（任务 13）：给了标量就所有列共用一个间距，否则取第 position 个。
        # 正向 isinstance 收窄（pyright 无法从「非 list/tuple」排除任意 Sequence[float]）。
        step = float(gap) if isinstance(gap, (int, float)) else float(gap[position])
        x += width + step
    # 行高按"最高列"落定，光标的 y 才是下一行的起点（multi_cell 的 TOP 定位不改 y）。
    pdf.set_y(y_top + row_height)
    pdf.set_x(pdf.frame_left)
    if gap_bottom:
        pdf.ln(gap_bottom)
    pdf.set_text_color(*pdf.body_text)


def justify_gap(
    pdf: _ResumePDF,
    widths: Sequence[float],
    gap: float | Sequence[float],
    justify: str | None,
) -> float | Sequence[float]:
    """分布 = 两端时把剩余空白均分进列间；其余情况原样返回（问题 4）。

    与 HTML 的 `justify-content: space-between` 对齐：列宽**仍按内容**，只是把
    「版心宽 − Σ列宽 − 原间距」平均加到每段间距上，于是最后一列的右缘正好落在内容区
    右边界。以下情况不生效（与模板挂 class 的判据逐条对应）：

    * ``justify != "between"``（默认「靠左」）；
    * 只有一列（没有"之间"可言）；
    * 给了**逐间隔**列表（间隔已由用户逐段设定，再摊剩余空间会把它改掉）；
    * 给了逐列宽度（合计 100%，本就没有剩余空间；此时 remaining ≤ 0 自然跳过）。
    """
    # 正向收窄：gap 是标量才继续摊剩余空间（逐间隔列表原样返回）。
    if justify != "between" or len(widths) <= 1 or not isinstance(gap, (int, float)):
        return gap
    base_gap = float(gap)
    remaining = pdf.frame_width - sum(widths) - base_gap * (len(widths) - 1)
    if remaining <= 0:
        return gap
    return base_gap + remaining / (len(widths) - 1)


__all__ = ["column_widths", "draw_meta_columns", "justify_gap", "set_meta_font"]
