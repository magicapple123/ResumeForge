# SPDX-License-Identifier: Apache-2.0
"""外部用量的**单位折算**：把"一句话 / 一段音频"换成账本认的计费数量。

为什么单独一个文件：`usage_counters.py` 正好贴着 500 行预算，而折算口径要供**多个
生产方**（TTS 合成、ASR 转写）共用。放回 `usage_counters` 会让那个文件既管存储
又管单位换算，下次加一类外部服务必然先撞行数墙。

折算规则只写在这里：上游按"一个汉字算 2 字符"给 TTS 计费，生产者各自算一遍迟早
出现"同一个界面上两处字符数不一样"。
"""

from __future__ import annotations


def tts_billable_chars(text: str) -> int:
    """TTS 的**计费字符数**：一个汉字算 2，其余字符各算 1。空文本算 0。"""
    return sum(2 if "\u4e00" <= char <= "\u9fff" else 1 for char in text)


__all__ = ["tts_billable_chars"]
