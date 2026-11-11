# SPDX-License-Identifier: Apache-2.0
"""15A 僵尸岗雷达：分档、证据、"宁可不报"的出口，以及 14A 体检里的那条 warning。

判据表（``services/apply/lifecycle.ghost_score``）：

==========================  ======  ==================================================
证据                          分值    判据
==========================  ======  ==================================================
首见至今天数                  +25     ≥30 天（≥60 天再 +15，合计 40）
复采次数                      +20     ≥3 次采样
薪资从未变过                  +15     有薪资的采样 ≥2 条且取值全同
HR 活跃时间全部 ≥7 天前       +25     **有**该字段的采样全部命中（缺字段不参与）
==========================  ======  ==================================================

本文件同时钉住四条"不报"的出口，它们和加分同样重要——一个爱报警的功能会被整体无视：

- 采样 < 2 条 → ``score=None`` + 证据「历史不足」（不是 0 分，0 分是"看不出问题"）；
- 分数 **≤70** 不进体检（只有严格 >70 才报）；
- 岗位被显式忽略（``Job.ghost_ignored``）→ 不报；
- 没有采样 / 岗位已删除 → 不报。

「现在」在全部用例里是固定常量 ``NOW``，不读系统时钟：否则"首见 45 天前"会在不同机器、
不同日期上变成 44 或 46。
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta

from app.models.apply import QUEUE_STATUS_PENDING, ApplyQueueItem
from app.models.job import JOB_STATUS_OPEN, Job
from app.models.job_seen import JobSeen
from app.models.profile import utcnow
from app.services.apply._queue import list_queue
from app.services.apply.lifecycle import (
    EVIDENCE_INSUFFICIENT,
    GHOST_ALERT_THRESHOLD,
    GHOST_SCORE_CAP,
    ghost_score,
    hr_stale_days,
)
from app.services.apply.preflight import CODE_GHOST_JOB, SEVERITY_WARNING, check_item, preflight

# 固定的"现在"：所有 days_ago 都相对它算。
NOW = datetime(2026, 11, 11, 12, 0, 0)
GOOD_GREETING = "您好，我有三年 Python 后端经验，做过高并发订单系统，想聊聊这个岗位。"


def _job(db_session, **overrides) -> Job:
    data = {
        "title": "后端开发",
        "company": "A公司",
        "source": "BOSS直聘",
        "source_url": "https://www.zhipin.com/job/1",
        "status": JOB_STATUS_OPEN,
        "created_at": NOW,
    }
    data.update(overrides)
    job = Job(**data)
    db_session.add(job)
    db_session.commit()
    return job


def _seen(
    db_session,
    job: Job | None,
    *,
    days_ago: int = 0,
    salary: str = "",
    hr_active: str = "",
    hr_active_time: str = "",
    description: str = "",
) -> JobSeen:
    digest = hashlib.sha256(description.encode()).hexdigest() if description else ""
    row = JobSeen(
        job_id=job.id if job is not None else None,
        title="后端开发",
        company="A公司",
        source_url="https://www.zhipin.com/job/1",
        seen_at=NOW - timedelta(days=days_ago),
        salary_text=salary,
        hr_active=hr_active,
        hr_active_time=hr_active_time,
        description_hash=digest,
        description_text=description[:2000],
    )
    db_session.add(row)
    db_session.commit()
    return row


def _seens_of(db_session, job: Job) -> list[JobSeen]:
    return (
        db_session.query(JobSeen)
        .filter(JobSeen.job_id == job.id)
        .order_by(JobSeen.seen_at, JobSeen.id)
        .all()
    )


def _ghost(db_session, job: Job | None) -> dict:
    seens = _seens_of(db_session, job) if job is not None else []
    return ghost_score(job, seens, NOW)


def _ghost_issues(db_session, item: ApplyQueueItem) -> list:
    return [issue for issue in check_item(db_session, item) if issue.code == CODE_GHOST_JOB]


def _queue_item(db_session, job: Job, greeting: str = GOOD_GREETING) -> ApplyQueueItem:
    item = ApplyQueueItem(
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        greeting=greeting,
        sort_order=1,
        status=QUEUE_STATUS_PENDING,
    )
    db_session.add(item)
    db_session.commit()
    return item


# ===== 分档：四条证据各自一例 =====


def test_single_sighting_gives_no_score_but_says_history_is_thin(db_session):
    """冷启动期只有一条采样：``None`` + 「历史不足」，绝不拿一条采样下结论。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=1, salary="20-30K")

    verdict = _ghost(db_session, job)

    assert verdict["score"] is None
    assert verdict["evidence"] == [EVIDENCE_INSUFFICIENT]


def test_no_sightings_at_all_is_the_same_answer(db_session):
    """一条采样都没有（手动录入的岗位）：同样「历史不足」，不是 0 分。"""
    job = _job(db_session)

    verdict = _ghost(db_session, job)

    assert verdict["score"] is None
    assert verdict["evidence"] == [EVIDENCE_INSUFFICIENT]


def test_first_seen_thirty_days_scores_twenty_five(db_session):
    """首见 ≥30 天 +25，证据写成「首见 45 天前」。"""
    job = _job(db_session, created_at=NOW - timedelta(days=45))
    _seen(db_session, job, days_ago=5)
    _seen(db_session, job, days_ago=1)

    verdict = _ghost(db_session, job)

    assert verdict["score"] == 25
    assert verdict["evidence"] == ["首见 45 天前"]


def test_first_seen_sixty_days_adds_the_long_bonus(db_session):
    """≥60 天再加 15（合计 40）——同一个证据，两档权重。"""
    job = _job(db_session, created_at=NOW - timedelta(days=75))
    _seen(db_session, job, days_ago=5)
    _seen(db_session, job, days_ago=1)

    assert _ghost(db_session, job)["score"] == 40


def test_first_seen_uses_the_earlier_of_job_and_sighting(db_session):
    """岗位先导入、后开采集：``created_at`` 更早，首见要按它算（否则会低估挂了多久）。"""
    job = _job(db_session, created_at=NOW - timedelta(days=50))
    _seen(db_session, job, days_ago=2)
    _seen(db_session, job, days_ago=1)

    verdict = _ghost(db_session, job)

    assert verdict["evidence"] == ["首见 50 天前"]


def test_three_sightings_score_twenty_for_resighting(db_session):
    """复采 ≥3 次 +20，证据写成「复采 3 次」。"""
    job = _job(db_session)
    for days_ago in (9, 5, 1):
        _seen(db_session, job, days_ago=days_ago)

    verdict = _ghost(db_session, job)

    assert verdict["score"] == 20
    assert verdict["evidence"] == ["复采 3 次"]


def test_unchanged_salary_scores_fifteen(db_session):
    """两次采到的薪资一模一样 +15（常年同一口价是"挂而不招"的典型特征）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=5, salary="20-30K·14薪")
    _seen(db_session, job, days_ago=1, salary="20-30K·14薪")

    verdict = _ghost(db_session, job)

    assert verdict["score"] == 15
    assert verdict["evidence"] == ["薪资 2 次未变"]


def test_changed_salary_scores_nothing(db_session):
    """薪资改过 → 这项零分且**不出现**在证据里（没发生的事不许写成证据）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=5, salary="20-30K")
    _seen(db_session, job, days_ago=1, salary="25-35K")

    verdict = _ghost(db_session, job)

    assert verdict["score"] == 0
    assert verdict["evidence"] == []


def test_missing_salary_does_not_count_as_unchanged(db_session):
    """两次都没采到薪资 → 不参与（"我们没采到"不是"它没变过"）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=5)
    _seen(db_session, job, days_ago=1)

    assert _ghost(db_session, job)["evidence"] == []


def test_hr_inactive_for_two_weeks_scores_twenty_five(db_session):
    """HR 活跃时间全部 ≥7 天前 +25（唯一由站点直接给出的证据）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=20, hr_active_time="2周内活跃")
    _seen(db_session, job, days_ago=1, hr_active_time="3周内活跃")

    verdict = _ghost(db_session, job)

    assert verdict["score"] == 25
    assert verdict["evidence"] == ["HR 7 天未活跃"]


def test_recently_active_hr_blocks_the_hr_bonus(db_session):
    """有一次采样显示 HR 刚活跃过 → 这项零分（"最近还在"是对僵尸判定的反证）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=20, hr_active_time="2周内活跃")
    _seen(db_session, job, days_ago=1, hr_active_time="刚刚活跃")

    assert _ghost(db_session, job)["evidence"] == []


def test_missing_hr_signal_is_not_treated_as_inactive(db_session):
    """没有 HR 活跃字段 → 不参与（不误伤：老数据、其他站点都拿不到这个字段）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=20)
    _seen(db_session, job, days_ago=1)

    assert _ghost(db_session, job)["evidence"] == []


def test_all_four_evidences_add_up_to_full_marks(db_session):
    """四条全中 = 100（40 + 20 + 15 + 25），且证据按"首见 → 复采 → 薪资 → HR"排列。"""
    job = _job(db_session, created_at=NOW - timedelta(days=90))
    for days_ago in (60, 30, 1):
        _seen(db_session, job, days_ago=days_ago, salary="20-30K", hr_active_time="1个月前活跃")

    verdict = _ghost(db_session, job)

    assert verdict["score"] == GHOST_SCORE_CAP == 100
    assert verdict["evidence"] == [
        "首见 90 天前",
        "复采 3 次",
        "薪资 3 次未变",
        "HR 7 天未活跃",
    ]


# ===== HR 活跃时间文本的解析（"读不懂就不参与"）=====


def test_hr_stale_days_reads_the_common_site_phrasings():
    assert hr_stale_days("刚刚活跃") == 0
    assert hr_stale_days("今日活跃") == 0
    assert hr_stale_days("3日内活跃") == 3
    assert hr_stale_days("2周内活跃") == 14
    assert hr_stale_days("1个月") == 30
    assert hr_stale_days("15天前活跃") == 15


def test_hr_stale_days_falls_back_to_the_second_field():
    """``hr_active_time`` 为空时退到 ``hr_active``（列表接口那条路只有后者）。"""
    assert hr_stale_days("", "3日内活跃") == 3
    assert hr_stale_days("", "true") == 0


def test_hr_stale_days_refuses_ambiguous_or_missing_text():
    """读不懂 / 没有 / 粒度不明（「本月活跃」可能是一小时前）→ ``None`` = 不参与。"""
    assert hr_stale_days("") is None
    assert hr_stale_days() is None
    assert hr_stale_days("本月活跃") is None
    assert hr_stale_days("false") is None


# ===== 14A 体检：>70 才报，忽略即静默 =====


def test_score_over_seventy_adds_a_preflight_warning(db_session):
    """75 分（首见 ≥75 天 + 复采 3 次 + 薪资未变）→ 体检报一条 warning，理由写在文案里。

    这里的时间锚点用真实 ``utcnow()``（体检链路内部按"现在"算），所以只断言**分档**与
    "哪几项证据"，不断言"首见第几天"的具体数字——那是纯函数用例的职责（见上）。
    """
    job = _job(db_session, created_at=utcnow() - timedelta(days=75, hours=2))
    for days_ago in (30, 10, 1):
        _seen(db_session, job, days_ago=days_ago, salary="20-30K")
    item = _queue_item(db_session, job)

    issues = _ghost_issues(db_session, item)

    assert len(issues) == 1
    assert issues[0].severity == SEVERITY_WARNING
    assert "僵尸分 75" in issues[0].message
    assert "复采 3 次" in issues[0].message and "薪资 3 次未变" in issues[0].message
    assert "首见 7" in issues[0].message  # 具体天数由纯函数用例钉住
    assert issues[0].fix == "仍要投 / 忽略此岗位的僵尸提示"


def test_exactly_seventy_points_stays_below_the_alert(db_session):
    """恰好 70 分（25 + 20 + 25）→ **不报**。门槛是"严格大于"，不是"大于等于"。"""
    job = _job(db_session, created_at=NOW - timedelta(days=30))
    for days_ago in (30, 10, 1):
        _seen(db_session, job, days_ago=days_ago, hr_active_time="2周内活跃")
    item = _queue_item(db_session, job)

    assert _ghost(db_session, job)["score"] == GHOST_ALERT_THRESHOLD == 70
    assert _ghost_issues(db_session, item) == []


def test_ignored_ghost_stays_quiet(db_session):
    """用户点了忽略（``ghost_ignored``）→ 体检不再报，但采样照旧（历史不因忽略而断）。"""
    job = _job(db_session, created_at=NOW - timedelta(days=75), ghost_ignored=True)
    for days_ago in (30, 10, 1):
        _seen(db_session, job, days_ago=days_ago, salary="20-30K")
    item = _queue_item(db_session, job)

    assert _ghost_issues(db_session, item) == []
    assert db_session.query(JobSeen).filter(JobSeen.job_id == job.id).count() == 3


def test_job_without_history_never_triggers_the_ghost_warning(db_session):
    """没有采样 → 不报（避免"刚录进来的岗位"被诬告）。"""
    job = _job(db_session)
    item = _queue_item(db_session, job)

    assert _ghost_issues(db_session, item) == []


def test_preflight_end_to_end_reports_the_ghost_warning(db_session):
    """整轮体检里也能看到它（不是只有单条调用才生效）。"""
    job = _job(db_session, created_at=NOW - timedelta(days=75))
    for days_ago in (30, 10, 1):
        _seen(db_session, job, days_ago=days_ago, salary="20-30K")
    item = _queue_item(db_session, job)

    result = preflight(db_session)

    codes = {issue.code for row in result.items if row.queue_id == item.id for issue in row.issues}
    assert CODE_GHOST_JOB in codes
    assert result.summary.warnings >= 1


# ===== 队列出口：分数与证据一起下发 =====


def test_queue_item_exposes_score_and_evidence(db_session):
    """队列行要能直接显示「僵尸 75」+ 证据，不必再单独请求一次。"""
    job = _job(db_session, created_at=utcnow() - timedelta(days=75, hours=2))
    for days_ago in (30, 10, 1):
        _seen(db_session, job, days_ago=days_ago, salary="20-30K")
    _queue_item(db_session, job)

    (row,) = list_queue(db_session)

    assert row.ghost_score == 75
    assert row.ghost_evidence[1:] == ["复采 3 次", "薪资 3 次未变"]
    assert row.ghost_evidence[0].startswith("首见 7")


def test_queue_item_without_history_says_insufficient(db_session):
    """没有历史时下发 ``None`` + 「历史不足」——界面据此显示"历史不足"而不是 0 分。"""
    job = _job(db_session)
    _queue_item(db_session, job)

    (row,) = list_queue(db_session)

    assert row.ghost_score is None
    assert row.ghost_evidence == [EVIDENCE_INSUFFICIENT]
