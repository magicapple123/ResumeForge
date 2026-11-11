# SPDX-License-Identifier: Apache-2.0
"""边际收益停止线（15E）：近 N 天按周分桶，投递数 vs 进入面试数。

**回答的问题**："我是不是已经投过头了？"——当新增投递的**边际面试率**掉到历史均值
的一半以下，继续加大投递量只是在消耗时间，该做的是跟进待回音的岗位或改简历。

三条口径，都是为了让结论"宁可不说，也不说错"：

1. **样本 < 10 条投递不出结论**（详册 15E：Huntr 的基准是 17 投 1 面，10 条以下全是
   噪声）。此时 ``status="insufficient"``、``baseline_rate`` / ``recent_rate`` 为
   ``None``、``message`` 只许说「样本不足（N 条投递）」——**不许出现任何百分比**。
2. **"投递数"与漏斗条同源**：成功 + 失败（``funnel.summary`` 的 ``applied`` 就是这个
   口径）。跳过的条目不算投递——那是"没投"。两处口径若分叉，用户会在同一个页面上看到
   两个"我这周投了几条"。
3. **"进入面试"复用 ``STATUS_RANK``**：进度 rank ≥ 面试（测评/笔试不算，Offer 算，
   已结束不算——它不在 rank 里）。面试归到**投递记录所在的那一周**，因为要算的是
   "这一周投出去的 N 条里，有几条走到了面试"，不是"这一周里有几条进度被改成面试"。

已知取舍：进度表只留**当前**状态，所以"面试后被拒"的岗位现在读作「已结束」、不计入
面试。这是报表侧的既有口径（``STATUS_REJECTED`` 在 ``STATUS_RANK`` 之外），本模块
不另造一套。
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ...models.apply import (
    ITEM_STATUS_FAILED,
    ITEM_STATUS_SUCCESS,
    TASK_KIND_APPLY,
    ApplyTask,
    ApplyTaskItem,
)
from ...models.profile import utcnow
from ...models.tracker import STATUS_INTERVIEW, STATUS_RANK, ApplicationTrack
from ...schemas.apply.insights import ApplyStoppingPointOut, ApplyStoppingWeekOut
from .. import trash

# 默认窗口：详册写的就是"近 28 天按周分桶"。
DEFAULT_DAYS = 28
# 一周 7 天（分桶粒度）。
DAYS_PER_WEEK = 7
# 结论门槛：投递数低于这个数一律不出结论。
MIN_APPLIED_FOR_CONCLUSION = 10
# "最近"看两周；与"此前各周"比。
RECENT_WEEKS = 2
# 过拐点判据：最近两周面试率 < 此前各周面试率 × 这个比例。
DROP_RATIO = 0.5
# 面试判据：与 ``funnel`` 同源，直接读 ``STATUS_RANK``（加状态不用改这里）。
_INTERVIEW_RANK = STATUS_RANK[STATUS_INTERVIEW]


def _window_start(days: int) -> datetime:
    """窗口起点：``days`` 天前的 00:00（UTC，与库里的无时区时间戳同一口径）。

    与 ``funnel._window_start`` 同一写法：用户说的"28 天"是 28 个自然日，按小时切会
    漏掉第 28 天后半天的记录。
    """
    start = utcnow() - timedelta(days=max(1, days) - 1)
    return start.replace(hour=0, minute=0, second=0, microsecond=0)


def _bucket_count(days: int) -> int:
    """窗口要切成几个周桶：向上取整（``days=28`` → 4；``days=10`` → 2，最后一个是残桶）。"""
    return max(1, math.ceil(max(1, days) / DAYS_PER_WEEK))


def _bucket_starts(start: datetime, buckets: int) -> list[datetime]:
    return [start + timedelta(days=DAYS_PER_WEEK * index) for index in range(buckets)]


def _bucket_index(applied_at: datetime, start: datetime, buckets: int) -> int:
    """记录落在第几个桶；越界（时钟漂移 / 未来时间）钳到最近的桶，绝不丢记录。

    "绝不丢"很重要：静默丢一条会让 ``applied`` 与漏斗条对不上，而用户只会认为
    这个新功能算错了。
    """
    offset = (applied_at - start).days
    if offset < 0:
        return 0
    index = offset // DAYS_PER_WEEK
    return min(index, buckets - 1)


def _rate(interviews: int, applied: int) -> float | None:
    """面试率（0–1，4 位小数）。分母为 0 时返回 ``None``——**不是 0**。"""
    if applied <= 0:
        return None
    return round(interviews / applied, 4)


def _percent(rate: float | None) -> str:
    """比率 → 展示用百分比（只在有结论的分支里用，样本不足分支绝不调用它）。"""
    return "—" if rate is None else f"{rate * 100:.0f}%"


def stopping_point(db: Session, days: int = DEFAULT_DAYS) -> ApplyStoppingPointOut:
    """近 ``days`` 天的边际面试率分析（只读）。

    ``weeks`` 永远返回**完整**分桶（含 0 投递的周）：缺口本身就是信息——"第 2 周一条都没投"
    与"第 2 周投了 8 条"是完全不同的两个故事，空桶被吞掉会让折线看起来连续。
    """
    window_days = max(1, days)
    start = _window_start(window_days)
    buckets = _bucket_count(window_days)
    starts = _bucket_starts(start, buckets)
    counts = [[0, 0] for _ in range(buckets)]  # [applied, interviews]

    rows = (
        db.query(ApplyTaskItem.job_id, ApplyTaskItem.created_at, ApplyTaskItem.finished_at)
        .join(ApplyTask, ApplyTaskItem.task_id == ApplyTask.id)
        .filter(
            ApplyTask.kind == TASK_KIND_APPLY,
            trash.live_only(ApplyTaskItem),
            ApplyTaskItem.status.in_((ITEM_STATUS_SUCCESS, ITEM_STATUS_FAILED)),
            ApplyTaskItem.created_at >= start,
        )
        .all()
    )
    job_ids = sorted({job_id for job_id, _created, _finished in rows if job_id is not None})
    ranks: dict[int, int] = {}
    if job_ids:
        track_rows = (
            db.query(ApplicationTrack.job_id, ApplicationTrack.status)
            .filter(trash.live_only(ApplicationTrack), ApplicationTrack.job_id.in_(job_ids))
            .all()
        )
        ranks = {
            int(job_id): STATUS_RANK.get(status, 0)
            for job_id, status in track_rows
            if job_id is not None
        }

    for job_id, created_at, finished_at in rows:
        applied_at = finished_at or created_at
        if applied_at is None:
            continue
        index = _bucket_index(applied_at, start, buckets)
        counts[index][0] += 1
        if job_id is not None and ranks.get(int(job_id), 0) >= _INTERVIEW_RANK:
            counts[index][1] += 1

    applied = sum(item[0] for item in counts)
    interviews = sum(item[1] for item in counts)
    weeks = [
        ApplyStoppingWeekOut(
            start=starts[index].date().isoformat(),
            applied=counts[index][0],
            interviews=counts[index][1],
        )
        for index in range(buckets)
    ]

    if applied < MIN_APPLIED_FOR_CONCLUSION:
        # 样本不足：只报条数，**不给任何百分比**（连中位数/趋势都不给）。
        return ApplyStoppingPointOut(
            status="insufficient",
            applied=applied,
            interviews=interviews,
            baseline_rate=None,
            recent_rate=None,
            weeks=weeks,
            message=(
                f"样本不足（{applied} 条投递），不给结论。"
                f"至少 {MIN_APPLIED_FOR_CONCLUSION} 条投递才看得出边际收益——"
                "这个量级以下全是噪声。"
            ),
        )

    recent_slice = counts[-RECENT_WEEKS:] if buckets > RECENT_WEEKS else counts
    baseline_slice = counts[:-RECENT_WEEKS] if buckets > RECENT_WEEKS else []
    recent_applied = sum(item[0] for item in recent_slice)
    recent_interviews = sum(item[1] for item in recent_slice)
    baseline_applied = sum(item[0] for item in baseline_slice)
    baseline_interviews = sum(item[1] for item in baseline_slice)
    recent_rate = _rate(recent_interviews, recent_applied)
    baseline_rate = _rate(baseline_interviews, baseline_applied)

    if recent_rate is None:
        message = "最近两周没有投递，暂时看不出拐点。"
        status = "ok"
    elif baseline_rate is None:
        message = (
            f"投递量还不够摊到前后两段：最近两周面试率 {_percent(recent_rate)}，"
            "再投两周才比得出趋势。"
        )
        status = "ok"
    elif recent_rate < baseline_rate * DROP_RATIO:
        status = "past"
        message = (
            f"已经过拐点：最近两周 {_percent(recent_rate)} 的投递进了面试，"
            f"不到此前各周（{_percent(baseline_rate)}）的一半。"
            "建议先停下来跟进待回音的岗位，或换一份简历再投。"
        )
    else:
        status = "ok"
        message = (
            f"还没到停止线：最近两周面试率 {_percent(recent_rate)}，"
            f"此前各周 {_percent(baseline_rate)}。"
        )

    return ApplyStoppingPointOut(
        status=status,
        applied=applied,
        interviews=interviews,
        baseline_rate=baseline_rate,
        recent_rate=recent_rate,
        weeks=weeks,
        message=message,
    )


__all__ = [
    "DAYS_PER_WEEK",
    "DEFAULT_DAYS",
    "DROP_RATIO",
    "MIN_APPLIED_FOR_CONCLUSION",
    "RECENT_WEEKS",
    "stopping_point",
]
