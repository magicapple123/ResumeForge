# SPDX-License-Identifier: Apache-2.0
"""PDF 的断行边界：量高与绘制共用同一套判定（从 ``text_fit`` 拆出的正文部分）。

为什么必须共用：``draw_paragraph`` 先按这套边界算"要几行、多高"，再按同一套边界真正
画出来。两边只要差一个字符，就会出现"预留了 3 行、实际画了 4 行"——分页、页脚、条目
间距全跟着错位，而且只在特定文案上复现。

三条中文排版约束（改之前先看）：

* ``_NO_START``：这些标点**不能出现在行首**（中文排版的"行首禁则"）——所以断点要往前
  挪一个字，宁可这一行短一点；
* ``_NO_END``：这些标点**不能留在行尾**（"行尾禁则"），开引号/开括号要跟着后文走；
* ASCII 词（URL、邮箱、百分比）整段算一个单位：按字断开会把 ``100%`` 劈成 ``100`` / ``%``，
  也会让 ``a@b.com`` 在 ``@`` 处换行。``cjk_gap_indices`` 同样排除 ASCII 词内部，避免
  在单词中间插字距。

纯英文段落仍按词断行（见 :func:`_ranges`），否则英文单词会被劈成两行——既有英文产物的
观感会跟着变。
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence

from ..resume.resume_rich_text import RichSpan

_ASCII_WORD = re.compile(r"[A-Za-z0-9.,%+_/:@#-]+")
# 行首禁则：这些字符不许顶到下一行行首（句读、右括号、右引号、百分号等）。
_NO_START = frozenset("，。、；：？！）］｝〉》」』】〕·…—%")
# 行尾禁则：这些字符不许留在行尾（左括号、左引号、货币符号），必须带一个后文一起走。
_NO_END = frozenset("（［｛〈《「『【〔$￥")


def cjk_gap_indices(text: str) -> frozenset[int]:
    """可以作为字距伸缩点的位置：CJK 相邻处，且不碰标点禁则与 ASCII 词内部。"""

    def cjk(char: str) -> bool:
        return (
            "\u2e80" <= char <= "\u9fff"
            or "\uf900" <= char <= "\ufaff"
            or "\uff00" <= char <= "\uffef"
        )

    return frozenset(
        index
        for index, (left, right) in enumerate(zip(text, text[1:], strict=False))
        if (cjk(left) or cjk(right))
        and left not in _NO_END
        and right not in _NO_START
        and not (_ASCII_WORD.fullmatch(left) and _ASCII_WORD.fullmatch(right))
    )


def soft_line_flags(runs: Sequence[RichSpan], lines: Sequence[Sequence[RichSpan]]) -> list[bool]:
    """Identify inserted breaks without treating explicit newlines as justified rows."""
    visible = "".join(run.readable(with_link=True) if run.link else run.text for run in runs)
    cursor = 0
    flags = []
    for line in lines:
        cursor += sum(len(run.text) for run in line)
        explicit = cursor < len(visible) and visible[cursor] == "\n"
        flags.append(cursor < len(visible) and not explicit)
        if explicit:
            cursor += 1
    return flags


def _ranges(text: str, width: float, widths: Sequence[float]) -> list[tuple[int, int]]:
    prefix = [0.0]
    for value in widths:
        prefix.append(prefix[-1] + value)

    def fits(start: int, end: int) -> bool:
        return prefix[end] - prefix[start] <= width + 1e-8

    result: list[tuple[int, int]] = []
    offset = 0
    for paragraph in text.split("\n"):
        stop = offset + len(paragraph)
        units: list[int] = []
        cursor = offset
        while cursor < stop:
            match = _ASCII_WORD.match(text, cursor, stop)
            end = match.end() if match else cursor + 1
            # An oversized token must still progress in a very narrow column.
            if not fits(cursor, end):
                units.extend(range(cursor + 1, end + 1))
            else:
                units.append(end)
            cursor = end
        if not units:
            result.append((offset, offset))
        index = 0
        start = offset
        while index < len(units):
            last = index
            while last < len(units) and fits(start, units[last]):
                last += 1
            # Even a single glyph can exceed a zero/narrow budget. Never lose it.
            last = max(index + 1, last)
            chosen = last
            while chosen > index + 1 and units[chosen - 1] < stop:
                boundary = units[chosen - 1]
                left = text[start:boundary].rstrip()
                right = text[boundary:stop].lstrip()
                if (not left or left[-1] not in _NO_END) and (
                    not right or right[0] not in _NO_START
                ):
                    break
                chosen -= 1
            end = units[chosen - 1]
            result.append((start, end))
            start, index = end, chosen
        offset = stop + 1
    return result


def break_lines(text: str, width: float, width_of: Callable[[str], float]) -> list[str]:
    """Greedily fill CJK lines, preserving ASCII words and every visible glyph."""
    return [
        text[start:end]
        for start, end in _ranges(text, max(0.0, width), [width_of(char) for char in text])
    ]


def break_rich_runs(
    runs: Sequence[RichSpan],
    width: float,
    width_of: Callable[[str, bool], float],
) -> list[list[RichSpan]]:
    """Break visible characters, then rebuild independently closed style runs."""
    text_parts: list[str] = []
    bold: list[bool] = []
    for run in runs:
        body = run.readable(with_link=True) if run.link else run.text
        text_parts.append(body)
        bold.extend([run.bold] * len(body))
    text = "".join(text_parts)
    widths = [width_of(char, weight) for char, weight in zip(text, bold, strict=True)]
    lines: list[list[RichSpan]] = []
    for start, end in _ranges(text, max(0.0, width), widths):
        pieces: list[RichSpan] = []
        cursor = start
        while cursor < end:
            boundary = cursor + 1
            while boundary < end and bold[boundary] == bold[cursor]:
                boundary += 1
            pieces.append(RichSpan(text[cursor:boundary], bold=bold[cursor]))
            cursor = boundary
        lines.append(pieces)
    return lines
