# SPDX-License-Identifier: Apache-2.0
"""守护出生年月正则的多项式回溯（ReDoS）修复。

CodeQL py/polynomial-redos 曾在
``app/services/profile_parser/basic_fields.py`` 的出生年月正则上报出 high 告警：
年份之后与可选月份组之后的两个 ``\\s*`` 可以被一个整体可选分组隔开，
「1998」+ n 个空白且无后缀的输入会让空白段产生 O(n) 种分割方式，
每种分割后都要做一次后缀字面量匹配失败，回溯代价 O(n²)。

修复把两处歧义的 ``\\s*`` 改成原子组 ``(?>\\s*)``。本文件钉住的是**行为等价**：
原子化前后匹配语义不变——大段空白后无后缀的输入不崩溃、不误提取，
带空白间隔的「1998 年 7 月 生」仍能提取出月份。这里刻意用 1000 字符级别
的空白而不是 20000（后者足以区分 O(n²)/O(n)，但会拖慢全量测试；
性能差异由临时验证脚本单独确认，不入库）。
"""

from app.services.profile_text_parser import parse_profile_text


def test_birth_year_with_large_whitespace_and_no_suffix_is_not_extracted():
    """年份后跟大段空白、无「年/生/出生」后缀时：不崩溃，也不把年份误当出生年月。"""
    result = parse_profile_text("1998" + " " * 1000)

    assert result.birth_year == ""


def test_birth_year_with_whitespace_spaced_chinese_month_is_still_extracted():
    """「1998 年 7 月 生」这类字与字之间带空白的写法仍要提取出年+月。"""
    result = parse_profile_text("1998 年 7 月 生")

    assert result.birth_year == "1998-07"


def test_birth_year_month_match_followed_by_large_whitespace():
    """「1998年7」与后缀「生」之间隔着大段空白：月份仍应完整提取。"""
    result = parse_profile_text("1998年7" + " " * 1000 + "生")

    assert result.birth_year == "1998-07"
