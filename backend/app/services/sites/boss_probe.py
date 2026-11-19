# SPDX-License-Identifier: Apache-2.0
"""BOSS 采集的"字体反爬"探针：只统计、只记日志，不改变任何输出。

**为什么需要它**：2026-11 合入的 ``job_hunt.sites.boss_font`` 有三条动态路径，但其中
约束求解在真实页面上定不出映射——拿 9 月真实采集的 15 条薪资复测，耗时 13.86 秒、
``certain`` 为空（每个符号仍有 2~7 种可能）。同时，135 份 9/19–10/9 的真实响应里
私用区字符是 **0 个**。也就是说，这个失效模式至今**没有被观察到**。

所以现在不接线，先回答一个事实问题：**真实采集里到底会不会出现私用区字符**。
- 有 → 再按 ``boss_font`` 的明文对照路径建管线（那时有真实样本，能验证）；
- 没有 → 就别为一个没出现的场景去改采集主链路。

两条纪律：
1. **不改变任何输出**：只读文本、只写日志，不参与解析、不影响落库；
2. **只在真的出现时记**：一页最多一条 INFO，没有私用区字符的页面零噪音。
"""

from __future__ import annotations

import logging
from collections.abc import Iterable

from ..job_hunt.sites.boss_font import PUA_MAX, PUA_MIN

logger = logging.getLogger(__name__)

#: 一条日志里最多带几个样本——够定位"是标题还是薪资"，又不至于把日志刷满。
_SAMPLE_LIMIT = 3
#: 单条样本的截断长度（岗位名/薪资都很短，这里只是防超长 JD 混进来）。
_SAMPLE_CHARS = 60


def scan(values: Iterable[str]) -> tuple[int, set[str], list[str]]:
    """统计一批文本里的私用区字符 → ``(出现次数, 不同符号, 样本)``。

    纯读：不改传入的字符串，也不做任何解码——需要的是"有没有"，不是"是什么"。
    """
    count = 0
    symbols: set[str] = set()
    samples: list[str] = []
    for value in values:
        text = str(value or "")
        hits = [char for char in text if PUA_MIN <= ord(char) <= PUA_MAX]
        if not hits:
            continue
        count += len(hits)
        symbols.update(hits)
        if len(samples) < _SAMPLE_LIMIT:
            samples.append(text[:_SAMPLE_CHARS])
    return count, symbols, samples


def note_encoded_digits(surface: str, values: Iterable[str], *, url: str = "") -> None:
    """出现私用区字符时记一条 INFO；没有就什么都不做（这是绝大多数情况）。

    **只记码位，不记原文**：`values` 是抓取到的页面文本，可能夹带岗位名、公司名、
    薪资等具体内容，原样落盘等于把抓取结果写进日志（CodeQL
    `py/clear-text-logging-sensitive-data` 就是这么判的）。码位足够定位"哪个区段被打乱"，
    而排查时本来也不需要看到原文。
    """
    count, symbols, samples = scan(values)
    if not count:
        return
    codepoints = " ".join(f"U+{ord(char):04X}" for char in sorted(symbols))
    logger.info(
        "BOSS %s 出现私用区字符：%d 处 / %d 个符号 %s；样本数=%d；url=%s",
        surface,
        count,
        len(symbols),
        codepoints,
        len(samples),
        url or "-",
    )


__all__ = ["note_encoded_digits", "scan"]
