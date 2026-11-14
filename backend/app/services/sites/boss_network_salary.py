# SPDX-License-Identifier: Apache-2.0
"""从 ``boss_network`` 拆出：薪资的格式化与展示文本解析（纯函数，无 I/O）。

接口返回的薪资有两种形态：数字字段（``lowSalary`` / ``highSalary``，单位元/月）与
展示文本（``salaryDesc``，如 ``12-24K·14薪``、``500-1000元/天``、``1.5-2.5万``）。
两条路都要能折成同一套可读写法与 ``(下限, 上限)``，读不出时如实返回空/None。
"""

from __future__ import annotations

import re
from typing import Any

# 接口里的薪资是数字（单位：元/月，或天）。超过这个数就当作"按天"而不是"按月"，
# 因为月薪几十万在实习与校招场景里几乎不存在，而日薪 300~800 很常见。
_DAILY_SALARY_THRESHOLD = 3000


def format_salary(low: Any, high: Any, months: Any = None) -> str:
    """把接口里的薪资数字格式化成界面上那种可读写法。

    接口给的是月薪元数（``20000``）或日薪（``300``）。这里输出 ``20-40K`` /
    ``300-500元/天`` / ``20-40K·16薪``，与站点上显示的口径一致——用户能一眼对上自己
    在页面上看到的那一条。拿不到数字时返回空串，**不要编一个**。
    """
    try:
        low_value = int(low) if low is not None else 0
        high_value = int(high) if high is not None else 0
    except (TypeError, ValueError):
        return ""
    if low_value <= 0 and high_value <= 0:
        return ""
    if low_value <= 0:
        low_value = high_value
    if high_value <= 0:
        high_value = low_value

    if high_value <= _DAILY_SALARY_THRESHOLD:
        base = f"{low_value}-{high_value}元/天"
    else:
        low_k = round(low_value / 1000)
        high_k = round(high_value / 1000)
        base = f"{low_k}K" if low_k == high_k else f"{low_k}-{high_k}K"
        try:
            month_count = int(months) if months is not None else 0
        except (TypeError, ValueError):
            month_count = 0
        if 12 < month_count <= 24:
            base = f"{base}·{month_count}薪"
    return base


# 从接口展示文本（``salaryDesc``）里解析月薪区间的正则。真实接口（2026-09-20 实测抓包）
# **只有文本没有数字字段**：形如 "12-24K·14薪"、"500-1000元/天"、"1.5-2.5万"。若只认数字
# 字段（``lowSalary`` 等），薪资筛选会在真实数据下**全程落进"未能判断"而从不生效**。
_SALARY_TEXT_K = re.compile(r"(\d+(?:\.\d+)?)\s*[-~–—至]\s*(\d+(?:\.\d+)?)\s*[Kk千]")
_SALARY_TEXT_WAN = re.compile(r"(\d+(?:\.\d+)?)\s*[-~–—至]\s*(\d+(?:\.\d+)?)\s*万")
_SALARY_TEXT_YUAN_DAY = re.compile(r"(\d+)\s*[-~–—至]\s*(\d+)\s*元/天")


def parse_salary_text(value: Any) -> tuple[int, int] | None:
    """把薪资展示文本折成 (下限, 上限)（单位：元/月）。

    **按月返回**：K 与"万"都是月薪口径；"元/天"按字面数字返回（日薪在几百的量级，
    ``collect_filters.salary_band`` 据此识别为"单位不同、判断不了"，不会被当成月薪）。
    读不出的写法（含"万/年"这类年薪口径）返回 ``None``，由调用方按"未能判断"处理——
    **绝不猜**。
    """
    text = str(value or "").strip()
    if not text:
        return None
    if "/年" in text or "年薪" in text:
        return None
    match = _SALARY_TEXT_K.search(text)
    if match is not None:
        low = int(float(match.group(1)) * 1000)
        high = int(float(match.group(2)) * 1000)
        return (min(low, high), max(low, high))
    match = _SALARY_TEXT_WAN.search(text)
    if match is not None:
        low = int(float(match.group(1)) * 10000)
        high = int(float(match.group(2)) * 10000)
        return (min(low, high), max(low, high))
    match = _SALARY_TEXT_YUAN_DAY.search(text)
    if match is not None:
        low, high = int(match.group(1)), int(match.group(2))
        return (min(low, high), max(low, high))
    return None
