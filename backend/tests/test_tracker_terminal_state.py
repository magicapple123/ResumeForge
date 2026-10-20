# SPDX-License-Identifier: Apache-2.0
"""拒信终态与乱序通知的守卫（RF-06，从 test_tracker.py 拆出）。

覆盖两件事：``resolve_status`` 的 7×7 全组合取舍矩阵（rejected 是终态，不能被
旧通知复活），以及 ``_merge_into`` 的阶段字段守卫（状态没前进就不许覆盖
``stage_note``/``status_date``）。
"""
import pytest
from app.models.tracker import (
    MERGE_UNCHANGED,
    STATUS_APPLIED,
    STATUS_ASSESSMENT,
    STATUS_INTERVIEW,
    STATUS_OFFER,
    STATUS_REJECTED,
    STATUS_SCREENING,
    STATUS_UNKNOWN,
    resolve_status,
)
from app.schemas.tracker import TrackRecordIn
from app.services.tracker import apply_merges, list_tracks, preview_merges
from app.services.tracker_merge import _merge_into


def _record(**overrides) -> TrackRecordIn:
    base = {
        "company": "示例科技",
        "title": "后端开发实习生",
        "status": STATUS_APPLIED,
    }
    base.update(overrides)
    return TrackRecordIn(**base)


# ===== 归一化 =====


_EXPECTED_RESOLUTIONS = {
    STATUS_APPLIED: {
        STATUS_APPLIED: STATUS_APPLIED,
        STATUS_SCREENING: STATUS_SCREENING,
        STATUS_ASSESSMENT: STATUS_ASSESSMENT,
        STATUS_INTERVIEW: STATUS_INTERVIEW,
        STATUS_OFFER: STATUS_OFFER,
        STATUS_REJECTED: STATUS_REJECTED,
        STATUS_UNKNOWN: STATUS_APPLIED,
    },
    STATUS_SCREENING: {
        STATUS_APPLIED: STATUS_SCREENING,
        STATUS_SCREENING: STATUS_SCREENING,
        STATUS_ASSESSMENT: STATUS_ASSESSMENT,
        STATUS_INTERVIEW: STATUS_INTERVIEW,
        STATUS_OFFER: STATUS_OFFER,
        STATUS_REJECTED: STATUS_REJECTED,
        STATUS_UNKNOWN: STATUS_SCREENING,
    },
    STATUS_ASSESSMENT: {
        STATUS_APPLIED: STATUS_ASSESSMENT,
        STATUS_SCREENING: STATUS_ASSESSMENT,
        STATUS_ASSESSMENT: STATUS_ASSESSMENT,
        STATUS_INTERVIEW: STATUS_INTERVIEW,
        STATUS_OFFER: STATUS_OFFER,
        STATUS_REJECTED: STATUS_REJECTED,
        STATUS_UNKNOWN: STATUS_ASSESSMENT,
    },
    STATUS_INTERVIEW: {
        STATUS_APPLIED: STATUS_INTERVIEW,
        STATUS_SCREENING: STATUS_INTERVIEW,
        STATUS_ASSESSMENT: STATUS_INTERVIEW,
        STATUS_INTERVIEW: STATUS_INTERVIEW,
        STATUS_OFFER: STATUS_OFFER,
        STATUS_REJECTED: STATUS_REJECTED,
        STATUS_UNKNOWN: STATUS_INTERVIEW,
    },
    STATUS_OFFER: {
        STATUS_APPLIED: STATUS_OFFER,
        STATUS_SCREENING: STATUS_OFFER,
        STATUS_ASSESSMENT: STATUS_OFFER,
        STATUS_INTERVIEW: STATUS_OFFER,
        STATUS_OFFER: STATUS_OFFER,
        STATUS_REJECTED: STATUS_REJECTED,
        STATUS_UNKNOWN: STATUS_OFFER,
    },
    # 终态行：先有拒信，之后任何通知（包括乱序旧回执、甚至 Offer）都保持已结束。
    STATUS_REJECTED: {
        STATUS_APPLIED: STATUS_REJECTED,
        STATUS_SCREENING: STATUS_REJECTED,
        STATUS_ASSESSMENT: STATUS_REJECTED,
        STATUS_INTERVIEW: STATUS_REJECTED,
        STATUS_OFFER: STATUS_REJECTED,
        STATUS_REJECTED: STATUS_REJECTED,
        STATUS_UNKNOWN: STATUS_REJECTED,
    },
    STATUS_UNKNOWN: {
        STATUS_APPLIED: STATUS_APPLIED,
        STATUS_SCREENING: STATUS_SCREENING,
        STATUS_ASSESSMENT: STATUS_ASSESSMENT,
        STATUS_INTERVIEW: STATUS_INTERVIEW,
        STATUS_OFFER: STATUS_OFFER,
        STATUS_REJECTED: STATUS_REJECTED,
        STATUS_UNKNOWN: STATUS_UNKNOWN,
    },
}



@pytest.mark.parametrize("current", list(_EXPECTED_RESOLUTIONS))
@pytest.mark.parametrize("incoming", list(_EXPECTED_RESOLUTIONS[STATUS_APPLIED]))
def test_resolve_status_all_pairs(current, incoming):
    """7×7 全组合钉住状态取舍矩阵：拒信是终态，不能被旧通知复活。"""
    assert resolve_status(current, incoming) == _EXPECTED_RESOLUTIONS[current][incoming]


# ===== 合并计划与执行 =====




def test_a_rejection_survives_a_stale_out_of_order_notice(db_session):
    """先贴了拒信、又贴来更早的「申请已收到」：终态不复活，阶段字段也不被污染。"""
    apply_merges(
        db_session,
        [_record(status=STATUS_REJECTED, stage_note="技术面挂了", status_date="2026-09-30")],
    )
    stale = _record(
        status=STATUS_APPLIED,
        stage_note="简历已收到",
        status_date="2026-09-01",
        evidence="感谢您的投递",
    )
    preview = preview_merges(db_session, [stale])
    assert preview[0].action == MERGE_UNCHANGED

    apply_merges(db_session, [stale])
    stored = list_tracks(db_session)[0]
    assert stored.status == STATUS_REJECTED
    assert stored.stage_note == "技术面挂了"
    assert stored.status_date == "2026-09-30"
    # 来源摘录仍按现状保留：用户可能正是为了留下这封通知的原文才导入它的。
    assert stored.evidence == "感谢您的投递"


def test_merge_into_does_not_pollute_stage_fields_when_status_does_not_advance():
    """``_merge_into`` 的防御性守卫：状态没前进，阶段说明/状态日期就不许被旧阶段拖回去。"""
    from app.models.tracker import ApplicationTrack

    # 已结束的记录收到乱序旧回执：状态保住终态，阶段字段也不能被污染。
    record = ApplicationTrack(
        status=STATUS_REJECTED, stage_note="技术面挂了", status_date="2026-09-30"
    )
    _merge_into(
        record,
        _record(status=STATUS_APPLIED, stage_note="简历已收到", status_date="2026-09-01"),
    )
    assert record.status == STATUS_REJECTED
    assert record.stage_note == "技术面挂了"
    assert record.status_date == "2026-09-30"

    # 同阶段的通知同样"不新于"当前状态：不改写阶段字段。
    record = ApplicationTrack(
        status=STATUS_INTERVIEW, stage_note="二面", status_date="2026-09-20"
    )
    _merge_into(
        record,
        _record(status=STATUS_INTERVIEW, stage_note="一面", status_date="2026-09-10"),
    )
    assert record.status == STATUS_INTERVIEW
    assert record.stage_note == "二面"
    assert record.status_date == "2026-09-20"


def test_merge_into_lets_a_rejection_notice_rewrite_the_stage():
    """拒信通知总是推进状态（终态互斥），它自己的阶段说明与日期理应被采纳。"""
    from app.models.tracker import ApplicationTrack

    record = ApplicationTrack(
        status=STATUS_INTERVIEW, stage_note="二面", status_date="2026-09-20"
    )
    _merge_into(
        record,
        _record(status=STATUS_REJECTED, stage_note="技术面挂了", status_date="2026-09-30"),
    )
    assert record.status == STATUS_REJECTED
    assert record.stage_note == "技术面挂了"
    assert record.status_date == "2026-09-30"


