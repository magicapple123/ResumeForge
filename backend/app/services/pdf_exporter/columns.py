# SPDX-License-Identifier: Apache-2.0
"""双栏正文的行级排布与分页（``column_count == 2`` 的模板，目前只有 ``split``）。

**为什么要单独一层**：草稿侧的分栏是 CSS 网格——``.resume-sections`` 用
``grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr)`` 把七个分区**两两一行**并排，
``grid-auto-flow`` 是默认的 ``row``，所以顺序是「第 1、2 个分区一行、第 3、4 个一行……」；
一行的高度取两格中较**高**者，``align-items: start`` 让较矮的那格顶部对齐。PDF 侧此前完全
没有分栏，七个分区顺序单栏排下来，于是同一份简历在草稿里 227.5mm、在 PDF 里 270.75mm——
页数虽然一致，版式却明显不同。

**这里只做三件事**，绘制逻辑一概不碰（两条路径共用 `render._draw_resume` 里的同一批
drawer 函数，绝不复制一份）：

1. ``plan_rows``：把分区键切成"两两一行"；
2. **量高**：用一份 ``measuring=True`` 的孪生画布（`canvas._ResumePDF.measuring_twin`），
   把列框设成半栏宽度后调用同一个 drawer，`y` 的增量就是该分区在半栏宽度下的高度。
   测量模式下 `ensure_space` 是 no-op，量到的正是**连续高度**——分栏要的正是它；
3. **按行绘制**：行高取两格较高者；放不下就换页；画完把 `y` 落到 `max(左右底)`。

**降级条件（必须有）**：某个分区单独就高于一页（``row_h > usable_height_per_page``）时，
并排已经没有意义——半栏更窄，只会溢出页面。此时该行改走**顺序渲染**：两个分区各占整页
宽度、依次排下来，让 ``multi_cell`` 自然分页。这条兜底保证不丢内容（分区一定被画出来）、
不死循环（每次迭代都推进到下一行，且顺序渲染不会反向要求"先量再画"）。
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import TYPE_CHECKING

from .layout import _PX_TO_MM

if TYPE_CHECKING:  # pragma: no cover - 只为类型检查，运行时不能真导入 canvas（会循环导入）
    from .canvas import _ResumePDF
    from .layout import ResumeLayout

# 一个分区（区块）的绘制函数：给它画布与"本区块之前应留多少间距"（× 基准字号），
# 返回它是否真的画了东西（空分区返回 False，用于"第一段用 header_gap"的判定）。
SectionDrawer = Callable[["_ResumePDF", float], bool]

# 模板 CSS 的两条网格轨道：`minmax(0, .9fr) minmax(0, 1.1fr)`。左窄右宽，和注册表的
# `column_count` / `column_gap` 一起构成"PDF 也这么切"的全部依据，本模块不另存一份模板取值。
COLUMN_FRACTIONS: tuple[float, float] = (0.9, 1.1)


def plan_rows(keys: Sequence[str]) -> list[list[str]]:
    """把分区键按"两两一行"切成行：``[k1, k2] [k3, k4] ...``。

    奇数个分区时最后一行只有一格（草稿的网格里那一格只占左列，右列留空——高度仍按左列算）。
    顺序完全沿用传入的 ``keys``（即 ``resolved_section_order(format_config)`` 的结果），
    本函数只负责"切"，不重排。
    """
    items = [key for key in keys if key]
    return [items[index : index + 2] for index in range(0, len(items), 2)]


def column_frames(layout: ResumeLayout) -> list[tuple[float, float]]:
    """两栏的 ``(left, width)``（mm）。

    栏间距 = ``base_px × 0.2646 × column_gap``（与 CSS ``column-gap: calc(var(--fs) * 1.2)``
    同口径），从正文宽度里先扣掉，再按 0.9 : 1.1 切两栏——与草稿的 ``fr`` 语义一致
    （``fr`` 分的是"扣掉 gap 之后的剩余空间"）。
    """
    gap_mm = layout.base_px * _PX_TO_MM * layout.column_gap
    usable = layout.usable_width_mm - gap_mm
    total = sum(COLUMN_FRACTIONS)
    left_width = usable * COLUMN_FRACTIONS[0] / total
    return [
        (layout.margin_x, left_width),
        (layout.margin_x + left_width + gap_mm, usable - left_width),
    ]


def _section_height(
    probe: _ResumePDF, drawer: SectionDrawer, frame: tuple[float, float], *, leading: float
) -> float:
    """某个分区在半栏（``frame``）下有多高（mm）：画一遍、量 `y` 的增量。

    ``probe`` 必须是 ``measuring=True`` 的画布（`ensure_space` 为 no-op、不自动分页），
    所以量到的是连续高度，且每次量都从 ``layout.margin_top`` 起算——高度与起点无关，
    但固定起点能让"量的"与"画的"两趟的浮点误差同源。
    """
    probe.set_frame(*frame)
    probe.set_xy(frame[0], probe.layout.margin_top)
    drawer(probe, leading)
    return probe.get_y() - probe.layout.margin_top


def _draw_row(
    pdf: _ResumePDF,
    row: Sequence[str],
    drawers: dict[str, SectionDrawer],
    frames: Sequence[tuple[float, float]],
    *,
    row_height: float,
    leading: float,
) -> None:
    """把一行（两个分区）并排画在同一个行首 y 上，画完把 y 落到左右两侧的较下者。"""
    # 行级分页：整行一起走 / 一起留。分页仍按**整页**高度判（双栏不是两个独立的流）。
    if not pdf.measuring and pdf.get_y() + row_height > pdf.page_break_trigger:
        pdf.add_page()
    row_top = pdf.get_y()
    bottoms: list[float] = []
    for slot, key in enumerate(row):
        frame = frames[slot]
        pdf.set_frame(*frame)
        # 每个分区都从**行首**开始画：右栏若不重置 y，就会接着左栏的底部往下排，
        # 变成"斜着"的两栏（`align-items: start` 的等价物就是这一行）。
        pdf.set_xy(frame[0], row_top)
        drawers[key](pdf, leading)
        bottoms.append(pdf.get_y())
    pdf.set_y(max(bottoms) if bottoms else row_top)
    pdf.reset_frame()


def _draw_row_sequentially(
    pdf: _ResumePDF, row: Sequence[str], drawers: dict[str, SectionDrawer], *, leading: float
) -> None:
    """降级路径：一行里的分区各占**整页宽度**、依次排下来（允许自然分页）。

    只在"某个分区单独就高于一页"时走这里。整页宽度下 ``multi_cell`` 会按行自然分页，
    所以内容不会丢；两个分区之间的行内间距仍由各自的 section_title 带出（同一个 ``leading``）。
    """
    pdf.reset_frame()
    for key in row:
        drawers[key](pdf, leading)


def render_sections(
    pdf: _ResumePDF, keys: Sequence[str], drawers: dict[str, SectionDrawer]
) -> None:
    """按两栏网格把 ``keys`` 里的分区画出来（``split`` 模板的正文）。

    ``drawers`` 是 ``键 → 绘制函数``，与单栏路径**同一份**（`render._draw_resume` 里定义，
    两条路径共用），所以"量的就是画的、画的与单栏是同一段代码"。

    流程：切行 → 逐行「量高（半栏宽）→ 行级分页 → 并排画 → y 落到较下者」。
    行高取两格较高者，较矮的那格顶部对齐（草稿的 ``align-items: start``）；
    若某行任一格高于一页，该行降级为顺序渲染（见 `_draw_row_sequentially`）。

    ``leading``（区块之前那段留白）按**行**给：第一行是页头之后的 ``header_gap``，其后每一行
    都是上一段 ``.section`` 的 ``section_gap``——与草稿网格一致（网格没有行间距，行间留白全部
    来自每一格自己的 ``margin-bottom``）。同行的两格共用一个值，否则并排的两段会错开半行。
    """
    layout = pdf.layout
    rows = plan_rows(keys)
    if not rows:
        return
    frames = column_frames(layout)
    probe = pdf.measuring_twin()
    for index, row in enumerate(rows):
        leading = layout.header_gap if index == 0 else layout.section_gap
        heights = (
            [
                _section_height(probe, drawers[key], frame, leading=leading)
                for key, frame in zip(row, frames, strict=False)
            ]
            if probe is not None
            else []
        )
        row_height = max(heights) if heights else 0.0
        if probe is None or row_height > layout.usable_height_per_page:
            # 量不了高（字体未注册）或单分区高于一页：退回顺序渲染。宁可版式退回单栏，
            # 也不能画出叠在一起的两栏，更不能丢内容。
            _draw_row_sequentially(pdf, row, drawers, leading=leading)
            continue
        _draw_row(pdf, row, drawers, frames, row_height=row_height, leading=leading)


__all__ = ["COLUMN_FRACTIONS", "column_frames", "plan_rows", "render_sections"]
