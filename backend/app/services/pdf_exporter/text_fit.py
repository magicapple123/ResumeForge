# SPDX-License-Identifier: Apache-2.0
"""PDF 条目头的宽度预算与截断纯函数。

为什么单独一层：这两件事此前都没有"名字"——

* **条目头**用两个 cell 并排画标题与日期。cell 不折行也不缩略，超宽的文字会直接
  画出格子：左标题溢出会盖住右栏，右栏（右对齐）溢出会向左压到标题上。修法只能是
  "先量宽、放不下就截断 + 省略号"，而量宽必须用 pdf.get_string_width 的量纲
  （mm/pt 都行，只要与传入的 max_width 同一单位）。
正文折行由 line_break 统一处理；这里不持有排版状态，宽度函数可注入。
"""

from __future__ import annotations

from collections.abc import Callable

# 截断后补的省略号（U+2026）。用单字符而不是三个点：宽度固定、不会被当成句号。
ELLIPSIS = "…"


def truncate_to_width(
    text: str,
    max_width: float,
    width_of_fn: Callable[[str], float],
    *,
    ellipsis: str = ELLIPSIS,
) -> str:
    """把 text 截到 max_width 以内；放不下时以省略号结尾。

    - **放得下就原样返回**（不做 strip/规范化）：不溢出就不该有第二个结果，否则每条
      "刚好放下"的文字都会被改一遍；
    - 放不下时返回"能放下的最长前缀 + ellipsis"，且结果宽度仍 ≤ max_width；前缀末尾
      的空格会先去掉，避免出现"标题 …"这种省略号前的空洞；
    - 连省略号都放不下（超窄栏）时返回空串——调用方拿到空串就不落笔，好过画出一个
      从格子里溢出去的省略号；
    - width_of_fn 是量宽函数（生产里是 pdf.get_string_width，单测可注入 len 这类假
      实现）。**必须与 max_width 同一单位**。

    用二分查找而不是逐字符试：量宽在 fpdf2 里要遍历字形度量表，长标题从尾往头试
    最多要几百次调用；二分是 O(log n)。
    """
    text = str(text)
    if not text or max_width <= 0:
        return ""

    def width_of(candidate: str) -> float:
        return float(width_of_fn(candidate))

    if width_of(text) <= max_width:
        return text
    # 前缀长度（不含省略号）的可行区间；放不下时至少要砍掉一个字符。
    low, high = 0, len(text) - 1
    best = ""
    while low <= high:
        middle = (low + high) // 2
        candidate = text[:middle].rstrip() + ellipsis
        if width_of(candidate) <= max_width:
            best = candidate
            low = middle + 1
        else:
            high = middle - 1
    if best:
        return best
    return ellipsis if width_of(ellipsis) <= max_width else ""


def entry_head_columns(available: float, left_text_width: float, gap: float) -> tuple[float, float]:
    """把条目头的一行宽度分成左右两栏：(左栏 cell 宽, 右栏 cell 宽)。

    左栏只包住"实测左标题宽 + 栏间距"，剩下的全给右栏——**左标题短时右栏自动变宽**，
    不再固定 32%。固定比例会把正常长度的日期/期刊名/专利状态误截掉；而左标题被截断到
    68% 上限时，这里算出的右栏恰好还剩 32%，长标题+长右栏也不会互相压盖。

    返回值之和恒等于 available（负数/非有限值按 0 收口）：绘制方拿左栏宽决定右栏
    起点与宽度，两者必须来自同一个函数，否则"分栏"与"画在哪"会各写一份。
    """
    usable = max(0.0, float(available))
    space = max(0.0, float(gap))
    left_cell = min(usable, max(0.0, float(left_text_width)) + space)
    return left_cell, usable - left_cell


__all__ = [
    "ELLIPSIS",
    "entry_head_columns",
    "truncate_to_width",
]
