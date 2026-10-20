# SPDX-License-Identifier: Apache-2.0
"""RF-18：状态变化事件与真实 cohort 指标。

钉三件事：

1. **所有状态变化写点都留痕**：手动编辑、识别合并、投递台自动记录；拒信也是一次
   状态变化，同样留痕——事件是追加的，它不会（也不该）被终态合并规则抹掉历史。
2. **历史不回填**：功能上线前的旧记录没有事件，指标里如实标
   ``historical_track_count``；**绝不从当前状态或 ``updated_at`` 反推历史**——
   构造一条没有事件的旧 track，断言它不出现在任何阶段的到达集合里。
3. **每个指标可解释**：分子/分母正确、小样本提示、缺日期的事件如实计数。
   特别地，"没有到过测评的面试记录"不会被当成笔试通过——转化只看事件里
   真的到过那个阶段。
"""
from datetime import timedelta

from app.models.profile import utcnow
from app.models.tracker import (
    EVENT_SOURCE_SYSTEM,
    EVENT_SOURCE_USER,
    STATUS_APPLIED,
    STATUS_ASSESSMENT,
    STATUS_INTERVIEW,
    STATUS_REJECTED,
    STATUS_SCREENING,
    ApplicationTrack,
    ApplicationTrackEvent,
)
from app.schemas.tracker import TrackCreate, TrackRecordIn, TrackUpdate
from app.services import tracker as tracker_service
from app.services.track_events import (
    SMALL_SAMPLE_THRESHOLD,
    record_status_change,
    track_cohort_metrics,
)


def _create(db, **overrides) -> ApplicationTrack:
    payload = TrackCreate(
        **{
            "company": "示例科技",
            "title": "后端开发实习生",
            "status": STATUS_APPLIED,
            **overrides,
        }
    )
    return tracker_service.create_track(db, payload)


def _events(db, track_id: int) -> list[ApplicationTrackEvent]:
    return (
        db.query(ApplicationTrackEvent)
        .filter(ApplicationTrackEvent.track_id == track_id)
        .order_by(ApplicationTrackEvent.id)
        .all()
    )


# ===== 事件留痕 =====


def test_create_track_records_first_event(db_session):
    track = _create(db_session)
    events = _events(db_session, track.id)
    assert len(events) == 1
    assert events[0].from_status == ""
    assert events[0].to_status == STATUS_APPLIED
    assert events[0].source == EVENT_SOURCE_USER
    assert events[0].user_confirmed is True


def test_manual_update_records_event_and_rejection_is_kept(db_session):
    track = _create(db_session)
    track_id = track.id
    tracker_service.update_track(
        db_session,
        track,
        TrackUpdate(
            company="示例科技",
            title="后端开发实习生",
            status=STATUS_INTERVIEW,
        ),
    )
    # 拒信也留痕：终态是时间线上真实发生过的一步。
    tracker_service.update_track(
        db_session,
        db_session.get(ApplicationTrack, track_id),
        TrackUpdate(
            company="示例科技",
            title="后端开发实习生",
            status=STATUS_REJECTED,
            stage_note="技术面挂了",
        ),
    )
    events = _events(db_session, track_id)
    assert [(e.from_status, e.to_status) for e in events] == [
        ("", STATUS_APPLIED),
        (STATUS_APPLIED, STATUS_INTERVIEW),
        (STATUS_INTERVIEW, STATUS_REJECTED),
    ]
    assert all(e.source == EVENT_SOURCE_USER and e.user_confirmed for e in events)
    # 状态字段本身走到终态，但事件追加的历史仍在：拒信不抹掉"曾到过面试"。
    assert db_session.get(ApplicationTrack, track_id).status == STATUS_REJECTED


def test_same_status_resave_does_not_spam_events(db_session):
    track = _create(db_session)
    tracker_service.update_track(
        db_session,
        track,
        TrackUpdate(
            company="示例科技",
            title="后端开发实习生",
            status=STATUS_APPLIED,
            note="只改了备注",
        ),
    )
    assert len(_events(db_session, track.id)) == 1


def test_apply_merges_records_events_for_created_and_updated(db_session):
    tracker_service.apply_merges(
        db_session,
        [TrackRecordIn(company="甲公司", title="后端", status=STATUS_APPLIED, status_date="2026-10-01")],
        source="recognized",
    )
    tracker_service.apply_merges(
        db_session,
        [TrackRecordIn(company="甲公司", title="后端", status=STATUS_INTERVIEW, status_date="2026-10-08")],
        source="recognized",
    )
    track = db_session.query(ApplicationTrack).filter_by(company="甲公司").one()
    events = _events(db_session, track.id)
    assert [(e.from_status, e.to_status) for e in events] == [
        ("", STATUS_APPLIED),
        (STATUS_APPLIED, STATUS_INTERVIEW),
    ]
    # 识别导入：程序写入（system），但经过了用户确认页勾选。
    assert all(e.source == EVENT_SOURCE_SYSTEM and e.user_confirmed for e in events)
    assert events[1].status_date == "2026-10-08"


def test_record_applied_marks_system_unconfirmed(db_session):
    tracker_service.record_applied(
        db_session, company="乙公司", title="前端", applied_on="2026-10-02"
    )
    db_session.commit()  # record_applied 由投递台流程提交；测试里显式提交以可见
    track = db_session.query(ApplicationTrack).filter_by(company="乙公司").one()
    events = _events(db_session, track.id)
    assert len(events) == 1
    assert events[0].source == EVENT_SOURCE_SYSTEM
    assert events[0].user_confirmed is False
    assert events[0].status_date == "2026-10-02"


def test_record_status_change_skips_no_op(db_session):
    track = _create(db_session)
    before = len(_events(db_session, track.id))
    record_status_change(db_session, track, from_status=STATUS_APPLIED, to_status=STATUS_APPLIED)
    assert len(_events(db_session, track.id)) == before


# ===== cohort 指标 =====


def test_cohort_metrics_numerator_denominator_and_small_sample(db_session):
    # 甲：已投递 → 面试（中间无事件，转化按"到过"算，不要求逐级都有事件）
    a = _create(db_session, company="甲", title="后端")
    tracker_service.update_track(
        db_session, a, TrackUpdate(company="甲", title="后端", status=STATUS_INTERVIEW)
    )
    # 乙：已投递（没有下一步）
    _create(db_session, company="乙", title="前端")
    metrics = track_cohort_metrics(db_session)

    assert metrics["event_track_count"] == 2
    applied = next(
        c for c in metrics["conversions"] if c["from_status"] == STATUS_APPLIED
    )
    assert applied["denominator"] == 2  # 到过「已投递」的：甲、乙
    assert applied["numerator"] == 0  # 到过「筛选中」的：0 条（甲直接到了面试）
    # 甲从「测评/笔试」到「面试」：分母 1（甲到过测评吗？没有——甲的事件是
    # applied→interview，没到过 assessment），所以这对的分子分母都是 0。
    assessment = next(
        c for c in metrics["conversions"] if c["from_status"] == STATUS_ASSESSMENT
    )
    assert assessment["denominator"] == 0
    interview = next(
        c for c in metrics["conversions"] if c["from_status"] == STATUS_INTERVIEW
    )
    assert interview["denominator"] == 1  # 到过「面试」的：甲
    assert interview["numerator"] == 0  # 到过「Offer」的：0
    assert applied["small_sample"] is True  # 分母 < 阈值


def test_cohort_metrics_excludes_old_tracks_without_events(db_session):
    """历史不回填：没有事件的旧记录不出现在任何阶段的到达集合里。"""
    old = ApplicationTrack(
        company="老公司",
        title="老岗位",
        status=STATUS_INTERVIEW,  # 当前状态是面试，但**绝不能**据此反推它到过哪些阶段
        updated_at=utcnow() - timedelta(days=90),
    )
    db_session.add(old)
    db_session.commit()
    metrics = track_cohort_metrics(db_session)

    assert metrics["historical_track_count"] == 1
    assert metrics["event_track_count"] == 0
    for conversion in metrics["conversions"]:
        assert conversion["denominator"] == 0
        assert conversion["numerator"] == 0
    for duration in metrics["durations"]:
        assert duration["median_days"] is None


def test_cohort_duration_uses_event_dates_and_counts_undated(db_session):
    _create(db_session, company="甲", title="后端", status_date="2026-10-01")
    # 手动更新带日期：甲的「筛选中」事件有业务日期。
    tracker_service.update_track(
        db_session,
        db_session.query(ApplicationTrack).filter_by(company="甲").one(),
        TrackUpdate(company="甲", title="后端", status=STATUS_SCREENING, status_date="2026-10-06"),
    )
    _create(db_session, company="乙", title="前端")  # 没有 status_date
    tracker_service.update_track(
        db_session,
        db_session.query(ApplicationTrack).filter_by(company="乙").one(),
        TrackUpdate(company="乙", title="前端", status=STATUS_SCREENING),
    )
    metrics = track_cohort_metrics(db_session)

    duration = metrics["durations"][0]  # applied → screening
    assert duration["numerator"] == 2  # 两条都有可用日期（乙用落库日兜底）
    assert duration["median_days"] is not None
    assert metrics["undated_event_count"] == 2  # 乙的两次事件都没写日期
    assert SMALL_SAMPLE_THRESHOLD == 5


def test_cohort_conversion_counts_reached_not_current_status(db_session):
    """到过 = 事件里出现过那个阶段：面试后被拒的记录仍算"到过面试"，
    而从未到过测评的记录不会被当成笔试通过。"""
    a = _create(db_session, company="甲", title="后端")
    tracker_service.update_track(
        db_session, a, TrackUpdate(company="甲", title="后端", status=STATUS_INTERVIEW)
    )
    tracker_service.update_track(
        db_session, a, TrackUpdate(company="甲", title="后端", status=STATUS_REJECTED)
    )
    metrics = track_cohort_metrics(db_session)

    # 拒信不抹历史：甲到过「面试」。
    reached_interview = next(
        c for c in metrics["conversions"] if c["from_status"] == STATUS_INTERVIEW
    )
    assert reached_interview["denominator"] == 1
    # 甲从未到过「测评/笔试」，所以"测评→面试"的分母不含它——
    # 没有到过测评的面试记录不会被自动当成笔试通过。
    assessment_pair = next(
        c for c in metrics["conversions"] if c["from_status"] == STATUS_ASSESSMENT
    )
    assert assessment_pair["denominator"] == 0
