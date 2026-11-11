# SPDX-License-Identifier: Apache-2.0
"""搜索结果的发布时间（P4-04）：解析、归一成 ISO，并给出"时效加权"。

## 为什么要它

用户的原话是「不要引入过时东西」。旧链路里 Bing RSS 的 ``pubDate`` 被直接丢掉，
模型拿到的上下文里没有任何时间信息，于是"2021 年的招聘公告"和"上周的岗位"看起来
一模一样。

## 解析口径

各来源的日期字段形态不一（RSS 的 RFC 822、DeepSeek/Tavily 的 ISO、国内站点的
``2025年11月2日``），统一收口成 :func:`parse_published_at`：**能解析到日就返回
``YYYY-MM-DD``，能解析到时刻就返回带 ``Z`` 的 ISO 串，解析不了返回空串**。
空串在下游一律显示「日期未知」——不猜、不用抓取时间顶替（那会把旧文伪装成新文）。

## 加权口径（不丢弃）

查询里出现「最新 / 目前 / 今年 / 版本」这类时效词时，12 个月内的结果加权、
超过 3 年的降权，但**一条都不丢**：降权只是排序信号，丢掉就是在替用户决定
"这条旧资料对他没用"，而对"某系统 2021 版怎么配"这种问题，旧资料恰恰是对的。
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime

# 时效词：查询命中这些词才启用时间加权（其余查询只展示日期，不改排序）。
_RECENCY_MARKERS = (
    "最新",
    "最近",
    "目前",
    "当前",
    "今年",
    "本月",
    "本周",
    "现在",
    "最新版",
    "版本",
    "新版",
    "更新",
    "latest",
    "current",
    "release",
    "changelog",
)
# 加权幅度：RRF 单源首位约 0.0164、三源首位合计约 0.049，
# 所以 ±0.006 足够把"同分"的排序掰过来，又不会让时间压过相关性。
RECENCY_BONUS = 0.004
_FRESH_DAYS = 365
_STALE_DAYS = 365 * 3
_CN_DATE_RE = re.compile(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日")
_DATE_PREFIX_RE = re.compile(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})")


def _iso(value: date) -> str:
    return value.isoformat()


def parse_published_at(value: str) -> str:
    """把一个来源给的日期字段统一成 ISO 串；解析不出来返回空串（= 日期未知）。"""
    text = " ".join(str(value or "").split())
    if not text:
        return ""

    # 1) RFC 822（RSS `pubDate` 的标准形态，形如 `Sun, 02 Nov 2025 08:30:00 GMT`）。
    lowered = text.casefold()
    if "," in text[:12] or lowered.endswith("gmt") or " +0000" in lowered:
        try:
            parsed = parsedate_to_datetime(text)
        except (TypeError, ValueError, IndexError):
            parsed = None
        if parsed is not None:
            if parsed.tzinfo is None:
                return parsed.date().isoformat()
            return parsed.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    # 2) ISO 8601（`2025-11-02`、`2025-11-02T08:30:00Z`、`2025-11-02 08:30:00`）。
    candidate = text.replace("/", "-")
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    try:
        parsed_iso = datetime.fromisoformat(candidate)
    except ValueError:
        parsed_iso = None
    if parsed_iso is not None:
        if parsed_iso.tzinfo is None and " " not in text.strip() and "T" not in text:
            return parsed_iso.date().isoformat()
        if parsed_iso.tzinfo is None:
            return parsed_iso.strftime("%Y-%m-%dT%H:%M:%S")
        return parsed_iso.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    # 3) 中文日期（`2025年11月2日`）。
    match = _CN_DATE_RE.search(text)
    if match:
        try:
            return _iso(date(int(match.group(1)), int(match.group(2)), int(match.group(3))))
        except ValueError:
            return ""

    # 4) 只取前缀日期（`2025-11-02 更新`）。
    match = _DATE_PREFIX_RE.match(text)
    if match:
        try:
            return _iso(date(int(match.group(1)), int(match.group(2)), int(match.group(3))))
        except ValueError:
            return ""
    return ""


def published_date(value: str) -> date | None:
    """把 ISO 串取成 ``date``（只用于比较新旧）；空串/坏值返回 None。"""
    text = (value or "").strip()
    if not text:
        return None
    head = text[:10]
    try:
        return date.fromisoformat(head)
    except ValueError:
        return None


def is_recency_query(query: str) -> bool:
    """查询里是否带时效词（决定要不要按时间加权）。"""
    lowered = (query or "").casefold()
    return any(marker.casefold() in lowered for marker in _RECENCY_MARKERS)


def recency_bonus(published_at: str, *, today: date | None = None) -> float:
    """时效加权分量：12 个月内 +1 档、3 年内 0、超过 3 年 −1 档、日期未知 0。

    返回已经乘好 :data:`RECENCY_BONUS` 的分值（可直接加到 RRF 分上）。
    """
    parsed = published_date(published_at)
    if parsed is None:
        return 0.0
    reference = today or datetime.now(UTC).date()
    age_days = (reference - parsed).days
    if age_days < -_FRESH_DAYS:
        # 明显来自未来的日期（站点时区/年份写错）：不给加权，避免把脏数据顶到前面。
        return 0.0
    if age_days <= _FRESH_DAYS:
        return RECENCY_BONUS
    if age_days > _STALE_DAYS:
        return -RECENCY_BONUS
    return 0.0


def format_context_date(published_at: str, *, unknown_label: str = "日期未知") -> str:
    """上下文里那一行日期：``2025-11-02`` 或「日期未知」。"""
    parsed = published_date(published_at)
    return _iso(parsed) if parsed is not None else unknown_label


__all__ = [
    "RECENCY_BONUS",
    "format_context_date",
    "is_recency_query",
    "parse_published_at",
    "published_date",
    "recency_bonus",
]
