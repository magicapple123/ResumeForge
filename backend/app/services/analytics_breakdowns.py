# SPDX-License-Identifier: Apache-2.0
"""看板里的几组**明细聚合**（从 analytics.py 拆出，2026-11-10 第 17 条）。

analytics.py 已到 356 行，而本轮要补 P1-P3 五块指标（渠道转化、投递→当前阶段耗时、
同公司多投、简历版本效果、生成成本），单文件会顶穿 500 行预算。这里只放**纯函数**：
入参是 build_dashboard 已经查出来的只读行（Row）与少量常量，不碰 Session，也不另立
统计口径——口径说明唯一写在 analytics.py 的模块 docstring 里。

三条与第 17 条直接相关的纪律：

1. **样本只有 12 条**：任何比率都带分子/分母，样本低于阈值必须亮 small_sample
   （阈值沿用 track_events.SMALL_SAMPLE_THRESHOLD，全库一处定义）。
2. **渠道（channel）与内推（referral 表）是两套口径**，这里只做渠道字段的聚合，绝不
   把两张表相加；来源写在各函数的 docstring 与前端口径提示里。
3. **不从 updated_at 反推历史**：耗时只用 applied_at 与 status_date 两个用户填过的
   业务日期，缺一个就不参与（sample_count 如实减少）。
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from datetime import date
from typing import Any

from ..models.tracker import (
    CHANNEL_LABELS,
    CHANNELS,
    STATUS_INTERVIEW,
    STATUS_LABELS,
    STATUS_RANK,
    STATUSES,
)
from .ratios import rate
from .track_events import SMALL_SAMPLE_THRESHOLD

# 与 analytics.TrackRow 同一理由：只读行（Row / ORM 实例都能按属性名读）。
TrackRow = Any

# 「同公司多投」的两个门槛��与清单 §17.3-A3 一致）：>=2 次算"多投"；>=3 次且 0 面试
# 才是"最该止损"的清单——只投了 2 次全挂还很常见，3 次还没进面才说明方向可能有问题。
REPEAT_MIN_APPLICATIONS = 2
NO_INTERVIEW_MIN_APPLICATIONS = 3


def parse_iso_date(raw: str) -> date | None:
    """严格 YYYY-MM-DD；空串/紧凑写法/写坏的都返回 None，不猜。

    与 analytics._applied_date、track_events._parse_date 同一判据（三处都要求十字形状）
    ——这样"有没有可用日期"在趋势、耗时、缺口三处不会互相矛盾。
    """
    value = (raw or "").strip()
    if len(value) != 10 or value[4] != "-" or value[7] != "-":
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def applied_date(track: TrackRow) -> date | None:
    """该记录的权威"投递日期"；解析不出返回 None。"""
    return parse_iso_date(track.applied_at)


def channel_stats(tracks: Sequence[TrackRow]) -> list[dict]:
    """各投递渠道的投递数 / 面试率 / Offer 率（口径来自 ApplicationTrack.channel）。

    - **面试** = 当前状态达到 interview 及以上（含 Offer），与顶部的面试率同口径；
    - **Offer** = 当前状态为 offer；
    - 分母是该渠道的**投递数**（渠道字段是用户自己选的，未知也单独成行，不偷偷归并）。

    与「内推」模块**不是同一套数据**：渠道里的"内推"是记录字段（用户手选），内推模块
    是独立对象；两者不能相加，前端口径提示里必须写清。
    """
    counts: dict[str, int] = {channel: 0 for channel in CHANNELS}
    interview_counts: dict[str, int] = {channel: 0 for channel in CHANNELS}
    offer_counts: dict[str, int] = {channel: 0 for channel in CHANNELS}
    interview_rank = STATUS_RANK[STATUS_INTERVIEW]
    for track in tracks:
        channel = track.channel if track.channel in counts else "unknown"
        counts[channel] = counts.get(channel, 0) + 1
        rank = STATUS_RANK.get(track.status, -1)
        if rank >= interview_rank:
            interview_counts[channel] += 1
        if track.status == "offer":
            offer_counts[channel] += 1
    return [
        {
            "channel": channel,
            "label": CHANNEL_LABELS.get(channel, channel),
            "total": counts[channel],
            "interview_count": interview_counts[channel],
            "interview_rate": rate(interview_counts[channel], counts[channel]),
            "offer_count": offer_counts[channel],
            "offer_rate": rate(offer_counts[channel], counts[channel]),
            "small_sample": 0 < counts[channel] < SMALL_SAMPLE_THRESHOLD,
        }
        for channel in CHANNELS
    ]


def status_durations(tracks: Sequence[TrackRow]) -> list[dict]:
    """「投递 → 当前状态」的耗时中位数，按**当前状态**分组。

    数据源只有 applied_at（投递日期）与 status_date（当前状态对应日期）两个用户填过的
    业务日期——**不依赖事件表**，也不拿 updated_at 反推（那会把"改备注的日期"当成
    "状态变化的日期"）。两个日期缺一个、或解析不出，就不参与中位数，sample_count 会
    如实比 denominator 小；status_date 早于 applied_at（乱序补录）计入 skipped_negative，
    不硬掰成 0。
    """
    totals: dict[str, int] = {status: 0 for status in STATUSES}
    skipped: dict[str, int] = {status: 0 for status in STATUSES}
    gaps: dict[str, list[int]] = {status: [] for status in STATUSES}
    for track in tracks:
        status = track.status
        if status not in totals:
            continue
        totals[status] += 1
        applied = parse_iso_date(track.applied_at)
        changed = parse_iso_date(track.status_date)
        if applied is None or changed is None:
            continue
        gap = (changed - applied).days
        if gap < 0:
            skipped[status] += 1
            continue
        gaps[status].append(gap)
    result: list[dict] = []
    for status in STATUSES:
        samples = gaps[status]
        result.append(
            {
                "status": status,
                "label": STATUS_LABELS.get(status, status),
                "sample_count": len(samples),
                "denominator": totals[status],
                "median_days": round(statistics.median(samples), 1) if samples else None,
                "skipped_negative": skipped[status],
                "small_sample": 0 < len(samples) < SMALL_SAMPLE_THRESHOLD,
            }
        )
    return result


def _repeat_groups(tracks: Sequence[TrackRow]) -> list[dict]:
    """按 company_key 归并出**同一公司投了多个岗位**的记录组（只收 >=2 次的）。"""
    grouped: dict[str, dict] = {}
    interview_rank = STATUS_RANK[STATUS_INTERVIEW]
    for track in tracks:
        key = (track.company_key or "").strip()
        if not key:
            continue
        entry = grouped.get(key)
        if entry is None:
            entry = grouped[key] = {
                "company_key": key,
                "company": (track.company or "").strip(),
                "total": 0,
                "interview_count": 0,
                "offer_count": 0,
            }
        entry["total"] += 1
        if STATUS_RANK.get(track.status, -1) >= interview_rank:
            entry["interview_count"] += 1
        if track.status == "offer":
            entry["offer_count"] += 1
    repeats = [entry for entry in grouped.values() if entry["total"] >= REPEAT_MIN_APPLICATIONS]
    repeats.sort(key=lambda item: (-item["total"], item["company_key"]))
    return repeats


def company_repeats(tracks: Sequence[TrackRow]) -> dict:
    """同公司多投的两份清单（清单 §17.3-A3）。

    - repeats：同一公司投了 >=2 个岗位，带面试/Offer 次数——"广撒网"有没有换来机会；
    - no_interview：投了 >=3 次但一次面试都没有——最该停下来复盘方向的清单。

    空 company_key 不参与——没有合并键就没有"同一家公司"这个事实；公司名原样带回，
    清洗垃圾名的规则只属于公司排行榜，这里不重复一份。
    """
    repeats = _repeat_groups(tracks)
    return {
        "repeats": repeats,
        "no_interview": [
            entry
            for entry in repeats
            if entry["total"] >= NO_INTERVIEW_MIN_APPLICATIONS and entry["interview_count"] == 0
        ],
    }


def resume_effects(tracks: Sequence[TrackRow]) -> list[dict]:
    """按关联简历分组的投递结果（清单 §17.3-B4，**结构先做、样本量必须亮出来**）。

    resume_id 的关联入口在录入界面已有（RF-17），但当前真实库里只有极少数记录有关联
    ——所以每个分组都必须带 small_sample，前端要显示徽标。**不做因果归因**：这组数字
    只描述"关联到这份简历的投递走到了哪一步"，不承诺"用了某版简历能提高 X%"。
    """
    grouped: dict[int, dict] = {}
    interview_rank = STATUS_RANK[STATUS_INTERVIEW]
    for track in tracks:
        resume_id = track.resume_id
        if resume_id is None:
            continue
        entry = grouped.get(resume_id)
        if entry is None:
            entry = grouped[resume_id] = {
                "resume_id": int(resume_id),
                "resume_title": "",
                "total": 0,
                "interview_count": 0,
            }
        title = (getattr(track, "resume_title", "") or "").strip()
        if title:
            entry["resume_title"] = title
        entry["total"] += 1
        if STATUS_RANK.get(track.status, -1) >= interview_rank:
            entry["interview_count"] += 1
    result = []
    for entry in grouped.values():
        entry["interview_rate"] = rate(entry["interview_count"], entry["total"])
        entry["small_sample"] = entry["total"] < SMALL_SAMPLE_THRESHOLD
        result.append(entry)
    result.sort(key=lambda item: (-item["total"], item["resume_id"]))
    return result


__all__ = [
    "NO_INTERVIEW_MIN_APPLICATIONS",
    "REPEAT_MIN_APPLICATIONS",
    "applied_date",
    "channel_stats",
    "company_repeats",
    "parse_iso_date",
    "resume_effects",
    "status_durations",
]
