# SPDX-License-Identifier: Apache-2.0
"""拼音 + 数字自然序的排序键（F）。

`rf_pinyin` collation 的行为完全由 :func:`sort_key` 决定，所以这里按"用户看得见的
顺序"钉死：中文按拼音、英文按字母、数字按大小，大小写不敏感，空串最前。
"""

from __future__ import annotations

import pytest
from app.services.text_sort import compare_text, sort_key


def _sorted(items: list[str]) -> list[str]:
    return sorted(items, key=sort_key)


def test_chinese_sorts_by_pinyin():
    assert _sorted(["产品经理", "阿里巴巴", "字节跳动"]) == ["阿里巴巴", "产品经理", "字节跳动"]


def test_ascii_and_chinese_are_interleaved_by_pronunciation():
    # 旧行为（BINARY）会把所有 ASCII 排在中文前："UI 设计师"永远第一。
    assert _sorted(["UI设计师", "阿里巴巴", "产品经理"]) == ["阿里巴巴", "产品经理", "UI设计师"]


def test_numbers_sort_numerically_not_lexically():
    # 旧行为（BINARY）：195 < 315 < 75，因为逐字符比较。
    assert _sorted(["第75版", "第195版", "第315版", "第2版", "第10版"]) == [
        "第2版",
        "第10版",
        "第75版",
        "第195版",
        "第315版",
    ]


def test_case_insensitive():
    assert _sorted(["beta", "Alpha", "gamma"]) == ["Alpha", "beta", "gamma"]


def test_empty_string_sorts_first():
    # 空串 → ()；"阿" 的拼音 "a" 在 "z" 之前。
    assert _sorted(["阿", "", "z"]) == ["", "阿", "z"]


def test_compare_text_contract():
    assert compare_text("阿里巴巴", "阿里巴巴") == 0
    assert compare_text("阿里巴巴", "产品经理") == -1
    assert compare_text("产品经理", "阿里巴巴") == 1
    # None 语义由调用方处理，这里按空串兜底而不是抛错。
    assert compare_text(None, "") == 0  # type: ignore[arg-type]


def test_sort_key_is_cached():
    """整串结果进 lru_cache：排序一页 100 行会反复问同一批标题。"""
    sort_key.cache_clear()
    sort_key("缓存命中测试")
    before = sort_key.cache_info()
    sort_key("缓存命中测试")
    after = sort_key.cache_info()
    assert after.hits == before.hits + 1
    assert after.misses == before.misses


@pytest.mark.parametrize("text", ["", "A", "第2版", "UI设计师", " 前后空格 "])
def test_sort_key_is_stable(text: str):
    assert sort_key(text) == sort_key(text)
