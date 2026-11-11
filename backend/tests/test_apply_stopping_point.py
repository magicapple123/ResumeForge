# SPDX-License-Identifier: Apache-2.0
"""15E 边际收益停止线：近 28 天按周分桶，投递数 vs 进入面试数。

钉住三条**门槛**（比数字本身重要）：

1. 投递 < 10 条 → ``insufficient``，两条 rate 都是 ``null``，``message`` 里只有
   「样本不足（N 条投递）」——**一个百分号都不许出现**。
2. 最近 2 周合并面试率 < 此前各周合并面试率的一半 → ``past``。
3. 窗口边界：恰好落在 28 天前的记录算进来，早一秒的不算；空桶也如实返回（缺口是信息）。
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.models.apply import (
    ITEM_STATUS_FAILED,
    ITEM_STATUS_SKIPPED,
    ITEM_STATUS_SUCCESS,
    TASK_KIND_APPLY,
    ApplyTask,
    ApplyTaskItem,
)
from app.models.job import JOB_STATUS_OPEN, Job
from app.models.profile import utcnow
from app.models.tracker import (
    STATUS_INTERVIEW,
    STATUS_REJECTED,
    ApplicationTrack,
    normalize_key,
)
from app.services.apply.stopping import DEFAULT_DAYS, MIN_APPLIED_FOR_CONCLUSION, stopping_point

WINDOW = DEFAULT_DAYS  # 28 → 4 个周桶


def _window_start(days: int = WINDOW) -> datetime:
    """与 ``stopping._window_start`` 同一写成：窗口起点（自然日 00:00）。"""
    start = utcnow() - timedelta(days=days - 1)
    return start.replace(hour=0, minute=0, second=0, microsecond=0)


def _in_bucket(index: int, days: int = WINDOW) -> datetime:
    """第 ``index`` 个桶里的一个时间点（桶宽 7 天，避开边界取 +1 天）。"""
    return _window_start(days) + timedelta(days=7 * index + 1)


def _task(db_session) -> ApplyTask:
    task = ApplyTask(kind=TASK_KIND_APPLY, status="completed", config={})
    db_session.add(task)
    db_session.commit()
    return task


def _job(db_session, *, suffix: int) -> Job:
    job = Job(
        title=f"后端开发{suffix}",
        company="A公司",
        location="北京",
        salary="20-30K",
        status=JOB_STATUS_OPEN,
    )
    db_session.add(job)
    db_session.commit()
    return job


def _track(db_session, job: Job, status: str) -> ApplicationTrack:
    track = ApplicationTrack(
        company=job.company,
        title=job.title,
        company_key=normalize_key(job.company),
        title_key=normalize_key(job.title),
        status=status,
        job_id=job.id,
    )
    db_session.add(track)
    db_session.commit()
    return track


def _applied(
    db_session,
    task: ApplyTask,
    when: datetime,
    *,
    status: str = ITEM_STATUS_SUCCESS,
    interview: bool = False,
    track_status: str = STATUS_INTERVIEW,
) -> ApplyTaskItem:
    """造一条投递记录（``created_at`` / ``finished_at`` 都钉在 ``when``），可选造进度。"""
    job = _job(db_session, suffix=db_session.query(Job).count() + 1)
    if interview:
        _track(db_session, job, track_status)
    item = ApplyTaskItem(
        task_id=task.id,
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        status=status,
        created_at=when,
        finished_at=when,
    )
    db_session.add(item)
    db_session.commit()
    return item


def _fill(db_session, task: ApplyTask, index: int, count: int, *, interviews: int = 0) -> None:
    """往第 ``index`` 个桶里塞 ``count`` 条投递，其中 ``interviews`` 条进了面试。"""
    when = _in_bucket(index)
    for offset in range(count):
        _applied(db_session, task, when, interview=offset < interviews)


# ===== 样本门槛 =====


def test_below_ten_applications_gives_no_conclusion(db_session):
    """**9 条投递 = 样本不足**：不给 rate、message 里没有百分号。"""
    task = _task(db_session)
    _fill(db_session, task, 0, 5, interviews=5)
    _fill(db_session, task, 1, 4, interviews=4)

    result = stopping_point(db_session, WINDOW)

    assert result.status == "insufficient"
    assert result.applied == 9
    assert result.baseline_rate is None
    assert result.recent_rate is None
    assert result.interviews == 9
    assert "样本不足（9 条投递）" in result.message
    assert "%" not in result.message


def test_zero_applications_still_reports_full_bucket_shape(db_session):
    """一条记录都没有：仍然返回完整的 4 个空桶（缺口本身是信息）。"""
    result = stopping_point(db_session, WINDOW)

    assert result.status == "insufficient"
    assert result.applied == 0
    assert len(result.weeks) == 4
    assert all(week.applied == 0 for week in result.weeks)
    assert result.baseline_rate is None and result.recent_rate is None


def test_threshold_constant_is_ten():
    """门槛就是 10（Huntr 基准 17 投 1 面，10 条以下全是噪声）。"""
    assert MIN_APPLIED_FOR_CONCLUSION == 10


# ===== 过拐点 =====


def test_past_turning_point_when_recent_rate_halves(db_session):
    """前两周 10 投 10 面（100%），最近两周 2 投 0 面（0%）→ 过拐点。"""
    task = _task(db_session)
    _fill(db_session, task, 0, 5, interviews=5)
    _fill(db_session, task, 1, 5, interviews=5)
    _fill(db_session, task, 2, 2)

    result = stopping_point(db_session, WINDOW)

    assert result.status == "past"
    assert result.applied == 12
    assert result.interviews == 10
    assert result.baseline_rate == 1.0
    assert result.recent_rate == 0.0
    assert "过拐点" in result.message


def test_past_turning_point_uses_merged_rates_not_single_weeks(db_session):
    """判据是"最近两周**合并**" vs "此前各周**合并**"，不是逐周比较。

    逐周看：第 0 周 100%、第 1 周 0%、第 2 周 0%——若按周比较会漏判；
    合并后：此前 4/8=50%、最近 3/6=50%，**没有**掉到一半以下 → 不是 past。
    """
    task = _task(db_session)
    _fill(db_session, task, 0, 4, interviews=4)
    _fill(db_session, task, 1, 4, interviews=0)
    _fill(db_session, task, 2, 3, interviews=2)
    _fill(db_session, task, 3, 3, interviews=1)

    result = stopping_point(db_session, WINDOW)

    assert result.baseline_rate == 0.5
    assert round(result.recent_rate, 4) == 0.5
    assert result.status == "ok"


def test_ok_when_recent_rate_holds(db_session):
    """最近两周面试率没有掉到一半以下 → 还没到停止线。"""
    task = _task(db_session)
    _fill(db_session, task, 0, 10, interviews=2)  # 此前 20%
    _fill(db_session, task, 2, 2, interviews=1)  # 最近 50%

    result = stopping_point(db_session, WINDOW)

    assert result.status == "ok"
    assert result.baseline_rate == 0.2
    assert result.recent_rate == 0.5
    assert "还没到停止线" in result.message


def test_no_recent_applications_is_not_a_conclusion(db_session):
    """最近两周一条都没投：``recent_rate=None``（不是 0%），也不判过拐点。"""
    task = _task(db_session)
    _fill(db_session, task, 0, 12, interviews=2)

    result = stopping_point(db_session, WINDOW)

    assert result.applied == 12
    assert result.recent_rate is None
    assert result.status == "ok"
    assert "最近两周没有投递" in result.message


def test_only_recent_applications_has_no_baseline(db_session):
    """10 条全在最近两周 → 没有"此前各周"可比的基线，``baseline_rate=None``。"""
    task = _task(db_session)
    _fill(db_session, task, 2, 5, interviews=1)
    _fill(db_session, task, 3, 5, interviews=1)

    result = stopping_point(db_session, WINDOW)

    assert result.applied == 10
    assert result.baseline_rate is None
    assert result.recent_rate == 0.2
    assert result.status == "ok"


# ===== 口径与边界 =====


def test_window_boundary_includes_exact_start_and_excludes_earlier(db_session):
    """恰好落在窗口起点的记录算进来；早一秒的不算（自然日边界，不是 now-N*24h）。"""
    task = _task(db_session)
    start = _window_start()
    _applied(db_session, task, start)
    _applied(db_session, task, start - timedelta(seconds=1))

    result = stopping_point(db_session, WINDOW)

    assert result.applied == 1


def test_failed_records_count_as_applied_but_never_as_interview(db_session):
    """失败也算"投过"（与漏斗条同口径），但绝不进面试计数。"""
    task = _task(db_session)
    for _ in range(4):
        _applied(db_session, task, _in_bucket(0), status=ITEM_STATUS_FAILED)
    for offset in range(6):
        _applied(db_session, task, _in_bucket(0), status=ITEM_STATUS_SUCCESS, interview=offset < 3)

    result = stopping_point(db_session, WINDOW)

    assert result.applied == 10
    assert result.interviews == 3


def test_skipped_records_are_not_applications(db_session):
    """跳过的条目不投递，不计入 applied（否则样本门槛会被"没投"的记录灌满）。"""
    task = _task(db_session)
    for _ in range(10):
        _applied(db_session, task, _in_bucket(0), status=ITEM_STATUS_SKIPPED)

    result = stopping_point(db_session, WINDOW)

    assert result.applied == 0
    assert result.status == "insufficient"


def test_rejected_progress_is_not_an_interview(db_session):
    """「已结束」不在 ``STATUS_RANK`` 里 → 不算进面试（报表侧既有口径，不另造一套）。"""
    task = _task(db_session)
    for _ in range(10):
        _applied(db_session, task, _in_bucket(0), interview=True, track_status=STATUS_REJECTED)

    result = stopping_point(db_session, WINDOW)

    assert result.applied == 10
    assert result.interviews == 0


def test_weeks_are_consecutive_seven_day_buckets(db_session):
    """周桶从窗口起点开始，每桶 7 天，共 4 个（28 天）。"""
    result = stopping_point(db_session, WINDOW)
    starts = [datetime.fromisoformat(week.start).date() for week in result.weeks]

    assert len(starts) == 4
    assert starts[0] == _window_start().date()
    assert all((starts[index + 1] - starts[index]).days == 7 for index in range(3))


def test_bucket_assignment_puts_records_in_the_week_they_were_applied(db_session):
    """每条记录落在它**投出去的那一周**（面试也归到那一周，不按进度更新时间）。"""
    task = _task(db_session)
    _fill(db_session, task, 0, 2, interviews=1)
    _fill(db_session, task, 1, 3, interviews=2)
    _fill(db_session, task, 3, 4, interviews=0)

    result = stopping_point(db_session, WINDOW)

    assert [(week.applied, week.interviews) for week in result.weeks] == [
        (2, 1),
        (3, 2),
        (0, 0),
        (4, 0),
    ]


def test_shorter_window_still_buckets_by_week(db_session):
    """``days=10`` → 2 个桶（第二个是残桶），仍按 7 天切。"""
    result = stopping_point(db_session, 10)

    assert len(result.weeks) == 2


# ===== 端点契约 =====


def test_stopping_point_endpoint_returns_agreed_shape(client, db_session):
    """GET /api/apply/stopping-point?days=28 的字段名（前端按这些名字取值）。"""
    task = _task(db_session)
    _fill(db_session, task, 0, 6, interviews=6)
    _fill(db_session, task, 1, 4, interviews=4)
    _fill(db_session, task, 2, 2)

    response = client.get("/api/apply/stopping-point?days=28")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "status",
        "applied",
        "interviews",
        "baseline_rate",
        "recent_rate",
        "weeks",
        "message",
    }
    assert set(body["weeks"][0]) == {"start", "applied", "interviews"}
    assert body["status"] == "past"
    assert body["applied"] == 12
    assert body["baseline_rate"] == 1.0
    assert body["recent_rate"] == 0.0


def test_stopping_point_endpoint_insufficient_has_no_rates(client, db_session):
    """样本不足时端点返回的 rate 全是 null，message 里没有百分号。"""
    task = _task(db_session)
    _fill(db_session, task, 0, 3, interviews=3)

    body = client.get("/api/apply/stopping-point").json()

    assert body["status"] == "insufficient"
    assert body["baseline_rate"] is None
    assert body["recent_rate"] is None
    assert "%" not in body["message"]


def test_stopping_point_endpoint_rejects_out_of_range_days(client):
    """``days`` 有上下界（1–90）：窗口太大等于把"最近"两个字的语义抹掉。"""
    assert client.get("/api/apply/stopping-point?days=0").status_code == 422
    assert client.get("/api/apply/stopping-point?days=91").status_code == 422
