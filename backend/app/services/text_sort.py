# SPDX-License-Identifier: Apache-2.0
"""拼音 + 数字自然序的排序键（F）：`rf_pinyin` collation 的唯一实现。

为什么需要它：SQLite 的默认 BINARY collation 按 UTF-8 **字节**比较，于是

- 所有 ASCII 标题（A-Z）都排在中文标题之前（``U`` = 0x55 < 中文首字节 0xE4），
  「UI 设计师」永远排第一；
- 数字按字符比较：``第 195 版 < 第 315 版 < 第 75 版``，而不是 75 < 195 < 315。

这里把文本切成"数字段 / 文本段"：数字段按整数比较，文本段用 ``lazy_pinyin``
逐字转成不带声调的拼音再 ``casefold``。中文因此按拼音（阿 a < 产 ch < UI ui），
英文按字母、数字按大小。

两个使用面共用同一个键，保证"SQL 里排出来的顺序"与"Python 里比较的顺序"一致：

- SQLite：``database.py`` 在连接建立时注册 ``create_collation("rf_pinyin", ...)``；
- Python：测试与排序工具直接调 :func:`sort_key` / :func:`compare_text`。

性能：整串结果进 ``lru_cache``（默认 8192）。排序一页 100 行、每行比较
O(log n) 次，缓存命中率很高；10k 库上的实测见交付说明。**不要**在比较函数里
做任何 IO 或重新构造 pypinyin 对象。
"""

from __future__ import annotations

import re
from functools import lru_cache

from pypinyin import Style, lazy_pinyin

# 数字段：连续的 ASCII 数字。用捕获组切分，split 结果里数字与非数字交替出现。
_DIGITS = re.compile(r"(\d+)")

# 排序键的分段：`(kind, number, text)`。
# kind=0 → 文本段（number 固定 0，text 是拼音）；kind=1 → 数字段（number 是整数）。
# 这样同位置的"文本 vs 数字"也有确定次序（文本段在前），不会因类型不同而报错。
Segment = tuple[int, int, str]
SortKey = tuple[Segment, ...]


def _text_segment(text: str) -> Segment:
    # `errors="default"`：非中文（含 ASCII、标点、emoji）原样返回，不丢字符。
    pinyin = "".join(lazy_pinyin(text, style=Style.NORMAL, errors="default"))
    return (0, 0, pinyin.casefold())


@lru_cache(maxsize=8192)
def sort_key(text: str) -> SortKey:
    """把一段文本转成可比较的键；``None`` 按空串处理（调用方负责 NULL 语义）。"""
    if not text:
        return ()
    segments: list[Segment] = []
    for piece in _DIGITS.split(text):
        if not piece:
            continue
        if piece.isascii() and piece.isdigit():
            segments.append((1, int(piece), ""))
        else:
            segments.append(_text_segment(piece))
    return tuple(segments)


def compare_text(left: str, right: str) -> int:
    """等价于 ``(left > right) - (left < right)``，供 SQLite collation 使用。"""
    left_key = sort_key(left or "")
    right_key = sort_key(right or "")
    if left_key == right_key:
        return 0
    return 1 if left_key > right_key else -1


__all__ = ["compare_text", "sort_key"]
