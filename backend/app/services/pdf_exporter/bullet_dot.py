# SPDX-License-Identifier: Apache-2.0
"""圆点项目符号的几何（审计 R-20）。

## 为什么单独一个模块

两件事只能同时成立：**直径要跟字号走**（0.32 × 字号，和浏览器 `list-style-type: disc`
同一量级），**圆心要落在符号槽的正中**（正文左边缘因此一个字都不动）。它们是两个纯数字
计算，却被埋在 `pdf_exporter.style_blocks` 那个已经 480 行、贴着 500 行预算的渲染函数里，
既没法单独断言，也没法在不超预算的前提下补注释。

搬出来之后：渲染侧只留一行调用，几何由 `test_pdf_exporter_pagination` 直接核对数字——
符号改成矢量圆后 PDF 文字流里读不到它（它不再是文本 run），那套"符号是一个独立 run"的
判据失效，这是替代判据。

## 单位

入参与返回值都是 **mm**（fpdf2 的单位），字号由调用方从 px 换算好再传进来，
因此这里的 `_PX_TO_MM` 换算只作用于"字号 → 直径"这一步。
"""

from __future__ import annotations

from .layout import _PX_TO_MM

# 半径与字号的比值 0.16（直径 0.32 × 字号）：与浏览器 `disc` 的直径（约 0.35em）同一量级，
# 草稿与精确预览并排看不出差别，也不会因为换字体而改变大小。
DOT_RADIUS_RATIO = 0.16


def dot_circle_geometry(
    text_left: float,
    marker_width: float,
    pad: float,
    font_size: float,
    top: float,
    line_height: float,
) -> tuple[float, float, float]:
    """圆点符号的（圆心 x, 圆心 y, 半径）。

    @param text_left 正文左边缘（已含单元格内边距）。
    @param marker_width 符号槽宽度（按原字形宽度预留，圆点不改变它）。
    @param pad 符号槽左右各留的空白。
    @param font_size 正文字号（px）。
    @param top 这一行的上沿（PDF 坐标原点在左下角，y 向下增长时由上沿加半行高得到圆心）。
    @param line_height 行高（mm）。
    """
    radius = DOT_RADIUS_RATIO * font_size * _PX_TO_MM
    slot_left = text_left - marker_width - pad
    center_x = slot_left + (marker_width + 2 * pad) / 2
    center_y = top + line_height / 2
    return center_x, center_y, radius


__all__ = ["DOT_RADIUS_RATIO", "dot_circle_geometry"]
