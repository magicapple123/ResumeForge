"""表单级标签串（"整表标签列表"）的识别与剥离。

mokahr 类页面把**整张表的标签**串进每个控件的 ``nearby_text``：每个控件的旁文都是
"自己的标签 + 同一段整表标签"。那段公共文本对匹配是毒药——它让每个控件都"看起来"
命中所有字段。2026-10-05 真机实测（鹰角 apply 页）：「游戏经历」文本框因为整表标签里
同时出现"实习经历"与"描述"，被认成"实习描述（第一条）"并准备把实习描述填进去；
同页「证件类型」框也因为公共串里的"证件号码"被判成高风险并列，整个放弃。

这里把它从旁文里减掉，只保留各控件自己的前缀（"毕业时间"、"姓名"这类真标签）。

判定刻意保守：**同一段 ≥60 字的文本出现在 ≥3 个控件的旁文里**才算公共标签串。
阈值以下的多是区块文本（"起止时间* 实习经历-1 删除经历 公司* 职位*" 那样两三个控件
共享的**局部**标签）——那是合法证据，洗掉就没法区分第几条经历了。
"""
from __future__ import annotations

from dataclasses import replace
from difflib import SequenceMatcher

from .model import Control

MIN_SHARED_LENGTH = 60
MIN_SHARED_CONTROLS = 3
# 公共标签串一定出现在最长的几条旁文里，只拿这几条两两比对即可（避免 O(n²) 全比较）。
_COMPARE_TOP = 3


def common_label_block(controls: list[Control]) -> str:
    """找出"整表标签串"本体；不存在这样的公共文本时返回空串。"""
    long_texts = sorted(
        {
            control.nearby_text
            for control in controls
            if len(control.nearby_text) >= MIN_SHARED_LENGTH
        },
        key=len,
        reverse=True,
    )[:_COMPARE_TOP]
    best = ""
    for index, left in enumerate(long_texts):
        for right in long_texts[index + 1 :]:
            match = SequenceMatcher(None, left, right).find_longest_match()
            if match.size > len(best):
                best = left[match.a : match.a + match.size]
    if len(best) < MIN_SHARED_LENGTH:
        return ""
    shared = sum(1 for control in controls if best in control.nearby_text)
    return best if shared >= MIN_SHARED_CONTROLS else ""


def strip_shared_nearby(controls: list[Control]) -> list[Control]:
    """把整表标签串从每个控件的旁文里减掉；没有公共串就原样返回。"""
    block = common_label_block(controls)
    if not block:
        return controls
    return [
        replace(
            control,
            nearby_text=" ".join(control.nearby_text.replace(block, " ").split()),
        )
        for control in controls
    ]
