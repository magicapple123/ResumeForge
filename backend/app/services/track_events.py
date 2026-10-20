# SPDX-License-Identifier: Apache-2.0
"""状态变化事件（RF-18）的写入与分析指标。

写入侧是**唯一的挂钩点**：所有会改变 ``ApplicationTrack.status`` 的路径（手动编辑、
识别合并、投递台自动记录）都必须经过 :func:`record_status_change` 留痕。拒信也写——
终态是时间线上真实发生过的一步，事件是追加的，记录它不会抹掉之前到过的阶段。

分析侧只回答事件能证明的事：各阶段耗时（相邻事件的间隔）与阶段转化（到达下一阶段
的记录占比）。**历史数据不回填**：功能上线前的旧记录没有事件，指标里如实标注
覆盖率——从当前状态或 ``updated_at`` 反推"曾经到过哪一步"就是在编造历史，这里
刻意不做。特别地，**没有到过测评的面试记录不会被自动当成笔试通过**：转化只看
"事件里真的出现过那个阶段"。
"""

from __future__ import annotations

import statistics
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from ..models.tracker import (
    EVENT_SOURCE_SYSTEM,
    EVENT_SOURCE_USER,
    STATUS_INTERVIEW,
    STATUS_OFFER,
    STATUS_RANK,
    ApplicationTrack,
    ApplicationTrackEvent,
)
from . import trash

# 样本少于这个数时返回 small_sample 提示：小样本上的百分比会被一次偶然左右。
SMALL_SAMPLE_THRESHOLD = 5

# 主线阶段对（转化与耗时都按相邻对算）。「已结束」「待确认」是分支，不在主线对里。
_MAINLINE = ("applied", "screening", "assessment", "interview", "offer")

_STAGE_PAIRS = tuple(zip(_MAINLINE, _MAINLINE[1:], strict=False))


def record_status_change(
    db: Session,
    track: ApplicationTrack,
    *,
    from_status: str,
    to_status: str,
    status_date: str = "",
    source: str = EVENT_SOURCE_SYSTEM,
    user_confirmed: bool = False,
) -> None:
    """落一条状态变化事件。

    状态没变就不写（反复保存同一条记录不该刷出一堆同状态事件）；``from_status``
    为空串表示"新建时就是那个状态"。``status_date`` 存用户提供的业务日期
    （通知上写的日子），空就是空——分析侧用它判断能否参与"通知口径"的耗时计算。
    """
    if from_status == to_status:
        return
    db.add(
        ApplicationTrackEvent(
            track_id=track.id,
            from_status=from_status,
            to_status=to_status,
            status_date=status_date or "",
            source=source,
            user_confirmed=user_confirmed,
        )
    )


def write_source(*, manual: bool) -> str:
    """按写入路径选事件来源：表单手工编辑是 ``user``，程序写入是 ``system``。"""
    return EVENT_SOURCE_USER if manual else EVENT_SOURCE_SYSTEM


def _parse_date(raw: str) -> date | None:
    """严格 ``YYYY-MM-DD``；其余（空、紧凑写法、写坏的）一律 ``None``，不猜。"""
    value = (raw or "").strip()
    if len(value) != 10 or value[4] != "-" or value[7] != "-":
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


class _Timeline:
    """一条进度记录从事件里读出的真实时间线：到过哪些阶段、最早什么时候到的。"""

    def __init__(self) -> None:
        self.reached: dict[str, date] = {}
        self.undated_events = 0

    def add(self, event: Any) -> None:
        """吃一条事件：ORM 实例或只含四列的查询 Row（属性名一致即可）。"""
        # 到达日期 = 事件上的业务日期；缺了就用落库日（event_at 永远存在）——
        # "记录的日期"仍是真实数据，只是精度口径要如实标注（undated_events）。
        explicit = _parse_date(event.status_date)
        if explicit is None:
            self.undated_events += 1
            fallback = event.event_at.date() if event.event_at is not None else None
            if fallback is None:
                return
            day = fallback
        else:
            day = explicit
        status = event.to_status
        if status not in STATUS_RANK:
            return
        previous = self.reached.get(status)
        if previous is None or day < previous:
            self.reached[status] = day


def track_cohort_metrics(db: Session) -> dict:
    """基于事件表的真实 cohort 指标。

    - **阶段转化**：到过阶段 A 的记录里，也到过下一阶段 B 的占比。分子 = 同时到过
      A 与 B 的记录数，分母 = 到过 A 的记录数。到过 = 事件里出现过那个 ``to_status``
      （拒信不抹历史：面试之后被拒的记录仍然"到过面试"）。
    - **阶段耗时**：相邻阶段对之间，同一条记录两个"最早到达日期"的间隔天数，
      报中位数。只统计两个日期都可用的样本；间隔为负（乱序补录造成的）计入
      ``skipped_negative``，不硬掰成 0。
    - **覆盖率**：有多少条记录完全没有事件（早于事件记录功能的历史行），有多少
      事件缺业务日期（只能用落库日兜底）。每个转化/耗时项各自带分子分母与
      small_sample 提示，前端原样展示，不做任何"用了产品能提高 X%"式的推断。
    """
    # 只取 id（B7）：cohort 只需要 id 集合本身，整表 ORM 实例化是纯浪费。
    track_ids: list[int] = [
        row[0]
        for row in db.query(ApplicationTrack.id).filter(trash.live_only(ApplicationTrack)).all()
    ]
    events: list[Any] = []
    if track_ids:
        # 只取时间线用到的四列（track_id/to_status/status_date/event_at）：
        # 万级事件下省掉 ORM 实例化；排序键不变（track_id, event_at），
        # Row 的具名属性访问让 _Timeline 的逻辑一字不改。
        events = (
            db.query(
                ApplicationTrackEvent.track_id,
                ApplicationTrackEvent.to_status,
                ApplicationTrackEvent.status_date,
                ApplicationTrackEvent.event_at,
            )
            .filter(ApplicationTrackEvent.track_id.in_(track_ids))
            .order_by(ApplicationTrackEvent.track_id, ApplicationTrackEvent.event_at)
            .all()
        )

    timelines: dict[int, _Timeline] = {}
    for event in events:
        timeline = timelines.get(event.track_id)
        if timeline is None:
            timeline = timelines[event.track_id] = _Timeline()
        timeline.add(event)

    event_track_count = len(timelines)
    historical_track_count = len(track_ids) - event_track_count
    undated_event_count = sum(t.undated_events for t in timelines.values())

    conversions: list[dict] = []
    for stage_from, stage_to in _STAGE_PAIRS:
        denominator = sum(1 for t in timelines.values() if stage_from in t.reached)
        numerator = sum(
            1 for t in timelines.values() if stage_from in t.reached and stage_to in t.reached
        )
        conversions.append(
            {
                "from_status": stage_from,
                "to_status": stage_to,
                "numerator": numerator,
                "denominator": denominator,
                "rate": (numerator / denominator) if denominator else 0.0,
                "small_sample": denominator < SMALL_SAMPLE_THRESHOLD,
            }
        )

    durations: list[dict] = []
    for stage_from, stage_to in _STAGE_PAIRS:
        denominator = sum(1 for t in timelines.values() if stage_from in t.reached)
        gaps = [
            (t.reached[stage_to] - t.reached[stage_from]).days
            for t in timelines.values()
            if stage_from in t.reached and stage_to in t.reached
        ]
        usable = [gap for gap in gaps if gap >= 0]
        skipped_negative = len(gaps) - len(usable)
        durations.append(
            {
                "from_status": stage_from,
                "to_status": stage_to,
                "numerator": len(usable),
                "denominator": denominator,
                "median_days": round(statistics.median(usable), 1) if usable else None,
                "skipped_negative": skipped_negative,
                "small_sample": len(usable) < SMALL_SAMPLE_THRESHOLD,
            }
        )

    return {
        "event_track_count": event_track_count,
        "historical_track_count": historical_track_count,
        "undated_event_count": undated_event_count,
        # 全库一条面试事件都没有时，"笔试→面试"的分子不可能是真数据：把这条事实
        # 带出去，让前端能说明"还没有事件记录"，而不是显示一张全 0 的表。
        "has_interview_event": any(STATUS_INTERVIEW in t.reached for t in timelines.values())
        or any(STATUS_OFFER in t.reached for t in timelines.values()),
        "conversions": conversions,
        "durations": durations,
    }


__all__ = [
    "SMALL_SAMPLE_THRESHOLD",
    "record_status_change",
    "track_cohort_metrics",
    "write_source",
]
