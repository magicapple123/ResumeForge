# SPDX-License-Identifier: Apache-2.0
"""上下文 token 估算（RF-14 §2.5）：纯字符启发式，**仅遥测**。

**估计值，禁止用于计费或精确展示**：不同 tokenizer 的结果差异可达两位数百分比，
这里只提供"量级正确"的遥测信号。常数集中在这一处。

估算不改任何请求体、不因 provider 不同改变上下文内容，也**不作为截断依据**——
按 token 截断会改变用户可见的资料取舍结果，属于 RF-13/RF-17 的产品决策（本批明确
不做，诊断报告 §10.10 精神：不以口径更换掩盖问题）。用户资料选择的 ``max_chars``
字符口径维持现状，与本模块无关。
"""
from __future__ import annotations

import math

# 混合估计常数：CJK ≈ 1 token/字，ASCII ≈ 4 字符/token（主流 BPE tokenizer 的量级）。
_TOKENS_PER_CJK_CHAR = 1.0
_ASCII_CHARS_PER_TOKEN = 4.0


def _is_cjk_char(char: str) -> bool:
    """是否 CJK 字符（含中文标点与全角形式——它们的 token 密度接近汉字）。"""
    code = ord(char)
    return (
        0x4E00 <= code <= 0x9FFF  # CJK 统一表意文字
        or 0x3400 <= code <= 0x4DBF  # 扩展 A
        or 0x3000 <= code <= 0x303F  # CJK 标点
        or 0xFF00 <= code <= 0xFFEF  # 全角形式
    )


def estimate_tokens(text: str) -> int:
    """估计一段文本的 token 数。

    空文本返回 0；超长文本也只是线性扫描，不会抛异常。结果是**估计值**：
    禁止用于计费或精确展示，只做遥测。
    """
    if not text:
        return 0
    cjk_count = sum(1 for char in text if _is_cjk_char(char))
    other_count = len(text) - cjk_count
    estimated = (
        cjk_count * _TOKENS_PER_CJK_CHAR + other_count / _ASCII_CHARS_PER_TOKEN
    )
    # 短文本（如单个 ASCII 字符）按 1 token 起算：它至少消耗一个 token。
    return max(1, math.ceil(estimated))


__all__ = ["estimate_tokens"]
