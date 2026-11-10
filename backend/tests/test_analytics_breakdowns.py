# SPDX-License-Identifier: Apache-2.0
"""第 17 条新增指标（P1-P3）的口径守卫：渠道转化 / 投递→当前阶段耗时 / 同公司多投 /
简历版本效果 / 周目标 / 生成成本，以及"停滞"口径改为**最后一次状态变化**。

样本只有 12 条真实数据，所以这里刻意覆盖：

1. **每个比率都带分子/分母**（small_sample 在阈值内必须为真）；
2. **渠道与内推是两套口径**（渠道只数 channel 字段，不与 referral 表相加）；
3. **停滞以事件 > status_date > updated_at 为证据优先级**，并与 /api/stats 同源；
4. 空库时每一项都是明确的零/空列表（不是 None）。
"""

from datetime import date, timedelta

from app.models.llm_usage import LLMUsageRecord
from app.models.profile import utcnow
from app.models.resume import ResumeRecord
from app.models.tracker import (
    CHANNEL_HEADHUNTER,
    CHANNEL_LABELS,
    CHANNEL_PLATFORM,
    CHANNEL_REFERRAL,
    CHANNEL_UNKNOWN,
    CHANNELS,
    STATUS_APPLIED,
    STATUS_INTERVIEW,
    STATUS_OFFER,
    STATUS_REJECTED,
    STATUSES,
    ApplicationTrack,
    ApplicationTrackEvent,
    normalize_key,
)
from app.services.analytics import build_dashboard, dashboard_brief


def _track(db_session, company, title, status, **kwargs):
    track = ApplicationTrack(
        company=company,
        title=title,
        company_key=normalize_key(company),
        title_key=normalize_key(title),
        status=status,
        **kwargs,
    )
    db_session.add(track)
    db_session.commit()
    db_session.refresh(track)
    return track


# ===== P1：渠道转化率 =====


def test_channel_stats_counts_rates_and_labels(client, db_session):
    """渠道转化按 channel 字段分桶；分母是该渠道投递数，分子是面试/Offer。"""
    _track(db_session, "甲", "后端", STATUS_APPLIED, channel=CHANNEL_PLATFORM)
    _track(db_session, "乙", "后端", STATUS_REJECTED, channel=CHANNEL_PLATFORM)
    _track(db_session, "丙", "后端", STATUS_INTERVIEW, channel=CHANNEL_REFERRAL)
    _track(db_session, "丁", "后端", STATUS_OFFER, channel=CHANNEL_REFERRAL)
    _track(db_session, "戊", "后端", STATUS_APPLIED, channel=CHANNEL_HEADHUNTER)
    # 没填渠道的记录（默认 unknown）单独成行，不丢出统计、也不偷偷并进别的渠道。
    _track(db_session, "己", "后端", STATUS_APPLIED)

    stats = {
        item["channel"]: item
        for item in client.get("/api/analytics/dashboard").json()["channel_stats"]
    }

    assert list(stats) == list(CHANNELS)
    assert {item["label"] for item in stats.values()} == {CHANNEL_LABELS[c] for c in CHANNELS}
    platform = stats[CHANNEL_PLATFORM]
    assert (platform["total"], platform["interview_count"], platform["offer_count"]) == (2, 0, 0)
    assert platform["interview_rate"] == 0.0
    referral = stats[CHANNEL_REFERRAL]
    # Offer 也算"到过面试"（与顶部面试率同口径）。
    assert (referral["total"], referral["interview_count"], referral["offer_count"]) == (2, 2, 1)
    assert referral["interview_rate"] == 1.0
    assert referral["offer_rate"] == 0.5
    # 样本只有个位数：每个渠道都必须亮小样本徽标。
    assert all(item["small_sample"] for item in stats.values() if item["total"] > 0)
    assert stats[CHANNEL_UNKNOWN]["total"] == 1


def test_channel_stats_are_independent_of_the_referral_table(client, db_session):
    """两套口径不许相加：内推表有 3 条，而 channel=referral 只有 1 条记录。"""
    for index in range(3):
        client.post("/api/referrals", json={"company": f"内推{index}", "job_title": "后端"})
    _track(db_session, "甲", "后端", STATUS_APPLIED, channel=CHANNEL_REFERRAL)

    data = client.get("/api/analytics/dashboard").json()

    channel_referral = next(
        item for item in data["channel_stats"] if item["channel"] == CHANNEL_REFERRAL
    )
    assert channel_referral["total"] == 1  # 只数 channel 字段
    assert data["referral"]["total"] == 3  # 内推模块自己的口径


# ===== P1：投递 → 当前阶段耗时中位数 =====


def test_status_durations_use_applied_at_and_status_date_only(client, db_session):
    """中位数按当前状态分组；缺一个日期不参与，负数不硬掰成 0。"""
    # interview × 3：10 天 / 20 天 / 缺 status_date（不参与）→ 中位数 15。
    _track(
        db_session,
        "甲",
        "后端",
        STATUS_INTERVIEW,
        applied_at="2026-09-01",
        status_date="2026-09-11",
    )
    _track(
        db_session,
        "乙",
        "后端",
        STATUS_INTERVIEW,
        applied_at="2026-09-01",
        status_date="2026-09-21",
    )
    _track(db_session, "丙", "后端", STATUS_INTERVIEW, applied_at="2026-09-01", status_date="")
    # applied × 1：status_date 早于 applied_at → skipped_negative，不参与中位数。
    _track(
        db_session, "丁", "后端", STATUS_APPLIED, applied_at="2026-09-10", status_date="2026-09-01"
    )

    groups = {
        item["status"]: item
        for item in client.get("/api/analytics/dashboard").json()["status_durations"]
    }

    interview = groups[STATUS_INTERVIEW]
    assert interview["denominator"] == 3
    assert interview["sample_count"] == 2
    assert interview["median_days"] == 15.0
    assert interview["small_sample"] is True
    applied = groups[STATUS_APPLIED]
    assert applied["sample_count"] == 0
    assert applied["median_days"] is None
    assert applied["skipped_negative"] == 1


def test_status_durations_are_grouped_in_status_order(client, db_session):
    data = client.get("/api/analytics/dashboard").json()
    assert [item["status"] for item in data["status_durations"]] == list(STATUSES)


# ===== P2：同公司多投 =====


def test_company_repeats_and_the_no_interview_list(client, db_session):
    """同一公司 >=2 个岗位进清单；>=3 个且 0 面试进"最该止损"清单。"""
    _track(db_session, "反复投的公司", "岗位一", STATUS_APPLIED)
    _track(db_session, "反复投的公司", "岗位二", STATUS_REJECTED)
    _track(db_session, "反复投的公司", "岗位三", STATUS_REJECTED)
    _track(db_session, "进了面的公司", "岗位一", STATUS_INTERVIEW)
    _track(db_session, "进了面的公司", "岗位二", STATUS_APPLIED)
    _track(db_session, "只投一次", "岗位一", STATUS_APPLIED)

    block = client.get("/api/analytics/dashboard").json()["company_repeats"]

    by_name = {item["company"]: item for item in block["repeats"]}
    assert set(by_name) == {"反复投的公司", "进了面的公司"}
    assert by_name["反复投的公司"]["total"] == 3
    assert by_name["反复投的公司"]["interview_count"] == 0
    assert by_name["进了面的公司"]["interview_count"] == 1
    # 只投了 2 次的公司即便 0 面试也不进"最该止损"清单（3 次才是门槛）。
    assert [item["company"] for item in block["no_interview"]] == ["反复投的公司"]


# ===== P2：简历版本效果（带样本量） =====


def test_resume_effects_report_small_sample_without_causal_claims(client, db_session):
    resume = ResumeRecord(title="后端版", content={})
    db_session.add(resume)
    db_session.commit()
    db_session.refresh(resume)
    _track(db_session, "甲", "后端", STATUS_INTERVIEW, resume_id=resume.id, resume_title="后端版")
    _track(db_session, "乙", "后端", STATUS_REJECTED, resume_id=resume.id, resume_title="后端版")

    effects = client.get("/api/analytics/dashboard").json()["resume_effects"]

    assert len(effects) == 1
    item = effects[0]
    assert item["resume_id"] == resume.id
    assert item["resume_title"] == "后端版"
    assert (item["total"], item["interview_count"]) == (2, 1)
    assert item["interview_rate"] == 0.5
    # 只有 2 条关联：必须亮样本量徽标，界面不许把它当稳定结论。
    assert item["small_sample"] is True


# ===== P2：停滞口径改为"最后一次状态变化" =====


def test_stalled_uses_status_date_instead_of_updated_at(client, db_session):
    """只改过备注（updated_at 新）但状态 10 天没变 → 仍然算停滞。"""
    old = utcnow() - timedelta(days=10)
    stale = date.today() - timedelta(days=10)
    track = _track(db_session, "卡住", "后端", STATUS_APPLIED, status_date=stale.isoformat())
    track.updated_at = utcnow()  # 备注改过：旧口径会把它当成"刚更新"
    db_session.commit()
    _ = old

    data = client.get("/api/analytics/dashboard").json()
    stats = client.get("/api/stats").json()

    assert data["stalled_count"] == 1
    assert stats["stalled_application_count"] == 1


def test_a_recent_status_date_clears_a_stale_updated_at(client, db_session):
    """导入的旧记录（updated_at 很旧）刚补了状态日期 → 不算停滞。"""
    track = _track(
        db_session, "刚推进", "后端", STATUS_APPLIED, status_date=date.today().isoformat()
    )
    track.updated_at = utcnow() - timedelta(days=30)
    db_session.commit()

    assert client.get("/api/analytics/dashboard").json()["stalled_count"] == 0
    assert client.get("/api/stats").json()["stalled_application_count"] == 0


def test_a_recent_status_change_event_beats_the_status_date(client, db_session):
    """事件是最强证据：改过状态（事件 1 天前）就算 status_date 很旧也不算停滞。"""
    stale = (date.today() - timedelta(days=30)).isoformat()
    track = _track(db_session, "有事件", "后端", STATUS_APPLIED, status_date=stale)
    track.updated_at = utcnow() - timedelta(days=30)
    db_session.add(
        ApplicationTrackEvent(
            track_id=track.id,
            from_status=STATUS_APPLIED,
            to_status=STATUS_INTERVIEW,
            status_date="",
            source="user",
            user_confirmed=True,
            event_at=utcnow() - timedelta(days=1),
        )
    )
    db_session.commit()

    assert client.get("/api/analytics/dashboard").json()["stalled_count"] == 0
    assert client.get("/api/stats").json()["stalled_application_count"] == 0


# ===== P3：周目标 =====


def test_weekly_goal_round_trip_and_this_week_count(client, db_session):
    _track(db_session, "本周一", "后端", STATUS_APPLIED, applied_at=date.today().isoformat())
    _track(
        db_session,
        "上周",
        "后端",
        STATUS_APPLIED,
        applied_at=(date.today() - timedelta(days=10)).isoformat(),
    )

    initial = client.get("/api/analytics/dashboard").json()["weekly_goal"]
    assert initial == {"target": 0, "this_week_count": 1}

    saved = client.put("/api/analytics/weekly-goal", json={"target": 6})
    assert saved.status_code == 200
    assert saved.json()["target"] == 6
    assert client.get("/api/analytics/dashboard").json()["weekly_goal"]["target"] == 6

    # 0 = 取消目标（不是"目标为零次"）。
    client.put("/api/analytics/weekly-goal", json={"target": 0})
    assert client.get("/api/analytics/dashboard").json()["weekly_goal"]["target"] == 0


def test_weekly_goal_rejects_out_of_range(client):
    assert client.put("/api/analytics/weekly-goal", json={"target": 101}).status_code == 422
    assert client.put("/api/analytics/weekly-goal", json={"target": -1}).status_code == 422


# ===== P3：生成成本与耗时 =====


def test_generation_cost_aggregates_the_usage_ledger(client, db_session):
    db_session.add_all(
        [
            LLMUsageRecord(
                task="resume_generate",
                model="m1",
                completion_tokens=1000,
                total_tokens=3000,
                duration_ms=10_000,
            ),
            LLMUsageRecord(
                task="resume_generate",
                model="m1",
                completion_tokens=2000,
                total_tokens=4000,
                duration_ms=20_000,
            ),
            LLMUsageRecord(
                task="resume_generate",
                model="m2",
                completion_tokens=500,
                total_tokens=1500,
                duration_ms=5_000,
            ),
            LLMUsageRecord(task="assistant", model="m1", completion_tokens=300, total_tokens=900),
        ]
    )
    db_session.commit()

    cost = client.get("/api/analytics/dashboard").json()["generation_cost"]

    assert cost["generate_calls"] == 3
    assert cost["generate_completion_tokens"] == 3500
    assert cost["generate_avg_duration_ms"] == 11666  # (10000+20000+5000)/3 截断
    assert cost["total_calls"] == 4
    assert cost["total_tokens"] == 9400
    by_model = {item["model"]: item for item in cost["by_model"]}
    assert by_model["m1"]["calls"] == 2
    assert by_model["m1"]["completion_tokens"] == 3000
    assert by_model["m2"]["calls"] == 1


# ===== 空库与摘要视图 =====


def test_new_blocks_have_explicit_zero_empty_states(client):
    """空库时每一项都是明确的零/空列表，前端据此渲染空态，不必到处判空。"""
    data = client.get("/api/analytics/dashboard").json()

    assert [item["channel"] for item in data["channel_stats"]] == list(CHANNELS)
    assert all(item["total"] == 0 for item in data["channel_stats"])
    assert [item["status"] for item in data["status_durations"]] == list(STATUSES)
    assert all(item["median_days"] is None for item in data["status_durations"])
    assert data["company_repeats"] == {"repeats": [], "no_interview": []}
    assert data["resume_effects"] == []
    assert data["weekly_goal"] == {"target": 0, "this_week_count": 0}
    assert data["generation_cost"]["generate_calls"] == 0
    assert data["generation_cost"]["by_model"] == []


def test_dashboard_brief_drops_the_new_long_arrays(client, db_session):
    _track(db_session, "甲", "后端", STATUS_APPLIED, channel=CHANNEL_PLATFORM)
    brief = dashboard_brief(build_dashboard(db_session))

    for key in (
        "channel_stats",
        "status_durations",
        "company_repeats",
        "resume_effects",
    ):
        assert key not in brief, key
    # 标量（周目标、生成成本）保留。
    assert "weekly_goal" in brief and "generation_cost" in brief


def test_soft_deleted_tracks_are_excluded_from_the_new_metrics(client, db_session):
    from app.services import trash

    kept = _track(
        db_session, "留着", "后端", STATUS_INTERVIEW, status_date=date.today().isoformat()
    )
    doomed = _track(db_session, "删掉", "后端", STATUS_INTERVIEW, channel=CHANNEL_REFERRAL)
    db_session.commit()
    trash.soft_delete(db_session, "application_track", doomed)
    db_session.commit()

    data = client.get("/api/analytics/dashboard").json()

    assert sum(item["total"] for item in data["channel_stats"]) == 1
    assert sum(item["denominator"] for item in data["status_durations"]) == 1
    assert data["company_repeats"]["repeats"] == []
    assert kept.id  # 只是让变量被使用，避免误删断言上下文


def test_parse_iso_date_accepts_only_strict_dates():
    from app.services.analytics_breakdowns import parse_iso_date

    assert parse_iso_date("2026-10-01") == date(2026, 10, 1)
    assert parse_iso_date("20261001") is None
    assert parse_iso_date("2026/10/01") is None
    assert parse_iso_date("") is None
    assert parse_iso_date("2026-13-01") is None
