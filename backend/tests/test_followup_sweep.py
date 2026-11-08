# SPDX-License-Identifier: Apache-2.0
"""期一 T02/T03：跟进巡检（followup_sweep）的行为守卫。

钉住计划 §6.1 与 §10 T02/T03 的完成判据：

- 7d / 21d 两桶**互斥**（>21 只出确认桶），同周各桶仅一张卡；
- 唯一约束兜底并发：模拟"另一个扫描已过了桶键检查"的 TOCTOU 窗口，仍只能有一张卡；
- 总开关关闭时**零写入**（复用 T26 同一开关），已建卡保留不追删；
- 近 7 天已决策 / stopped 永久排除；提醒通道 7 天内让位（否则同周两张卡）；
- 单桶上限 5 家、按最久没动优先、合成一张卡；
- 文案双向守卫：禁词逐条 + 必备要素（天数 / "没有记录到任何状态变化" / "要不要…？"），
  建卡时运行时自检不过要改用兜底模板并告警；
- 阈值单一来源：FOLLOWUP_SILENCE_DAYS == STALLED_DAYS，改阈值时 /api/stats 与巡检
  候选同步变化。
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime, timedelta

import pytest
from app.models.agent_task import (
    AGENT_TASK_SOURCE_FOLLOWUP,
    AGENT_TASK_SOURCE_REF_STALLED_CONFIRM,
    AGENT_TASK_SOURCE_REF_STALLED_FOLLOWUP,
    AGENT_TASK_SOURCE_REMINDER,
    AGENT_TASK_STATUS_DRAFT,
    AgentTask,
)
from app.models.followup import (
    FOLLOWUP_DECISION_CONTACTED,
    FOLLOWUP_DECISION_REPLIED,
    FOLLOWUP_DECISION_STOPPED,
    ApplicationFollowUp,
)
from app.models.profile import utcnow
from app.models.reminder import REMINDER_KIND_HR_REPLY, REMINDER_STATUS_PENDING, Reminder
from app.models.tracker import (
    STATUS_APPLIED,
    STATUS_INTERVIEW,
    STATUS_REJECTED,
    ApplicationTrack,
    normalize_key,
)
from app.services import followup_sweep
from app.services.followup_sweep import (
    FALLBACK_STEP_TEMPLATE,
    FOLLOWUP_STEP_TEMPLATE,
    FORBIDDEN_PHRASES,
    MAX_TRACKS_PER_BUCKET,
    REQUIRED_FRAGMENT,
    check_step_text,
    scan_stalled_tracks,
)
from app.services.settings_service import save_agent_task_events_enabled

# 注入时钟：naive UTC（全库口径）。2026-11-07 是 ISO 周 2026-W45 的周六，
# 常见时区上换算成本地日期仍是同一周——周键断言不随 CI 机器时区漂移。
NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
NOW_NAIVE = NOW.replace(tzinfo=None)
WEEK_KEY_RE = re.compile(r"^\d{4}-W\d{2}$")
FOLLOWUP = AGENT_TASK_SOURCE_REF_STALLED_FOLLOWUP
CONFIRM = AGENT_TASK_SOURCE_REF_STALLED_CONFIRM


def _ago(days: float) -> datetime:
    """NOW 之前 N 天（naive UTC，可直接写进 updated_at / decided_at）。"""
    return (NOW - timedelta(days=days)).replace(tzinfo=None)


def _track(
    db,
    *,
    company: str = "甲公司",
    title: str = "后端开发",
    status: str = STATUS_APPLIED,
    days_ago: float = 0,
    updated_at: datetime | None = None,
) -> ApplicationTrack:
    record = ApplicationTrack(
        company=company,
        title=title,
        company_key=normalize_key(company),
        title_key=normalize_key(title),
        status=status,
        updated_at=updated_at if updated_at is not None else _ago(days_ago),
    )
    db.add(record)
    db.commit()
    return record


def _scan(db, *, now: datetime = NOW, enabled: bool | None = True) -> dict:
    db.expire_all()
    result = scan_stalled_tracks(db, now=now, enabled=enabled)
    db.expire_all()
    return result


def _cards(db) -> list[AgentTask]:
    db.expire_all()
    return list(
        db.query(AgentTask)
        .filter(AgentTask.source == AGENT_TASK_SOURCE_FOLLOWUP)
        .order_by(AgentTask.id)
        .all()
    )


def _track_ids(card: AgentTask) -> set[int]:
    ids: set[int] = set()
    for step in card.steps:
        output_ref = step.output_ref or {}
        ids.add(int(output_ref["track_id"]))
    return ids


def _ordered_track_ids(card: AgentTask) -> list[int]:
    return [int((step.output_ref or {})["track_id"]) for step in card.steps]


# ===== 两桶互斥 / 卡结构 =====


def test_two_buckets_are_mutually_exclusive(db_session):
    fresh = _track(db_session, company="刚更新", days_ago=6)
    follow = _track(db_session, company="七天半", days_ago=7.5)
    big = _track(db_session, company="二十二天", days_ago=22)
    huge = _track(db_session, company="三十天", days_ago=30)

    result = _scan(db_session)

    assert result["enabled"] is True
    assert result["created"] == 2
    cards = _cards(db_session)
    assert {card.source_ref for card in cards} == {FOLLOWUP, CONFIRM}
    by_bucket = {card.source_ref: card for card in cards}
    follow_ids = _track_ids(by_bucket[FOLLOWUP])
    confirm_ids = _track_ids(by_bucket[CONFIRM])

    assert follow_ids == {follow.id}
    assert confirm_ids == {big.id, huge.id}
    # 互斥：>21 天只进确认桶；<=7 天两桶都不进；同一岗位不会同时出现在两个桶。
    assert follow_ids.isdisjoint(confirm_ids)
    assert fresh.id not in follow_ids | confirm_ids

    for card in cards:
        assert card.status == AGENT_TASK_STATUS_DRAFT
        assert card.source == AGENT_TASK_SOURCE_FOLLOWUP
        assert card.conversation_id is None
        assert WEEK_KEY_RE.match(card.occurrence_key or ""), card.occurrence_key
        assert card.dataset_key == "main"
    # 同一次扫描出的两张卡属于同一周。
    assert by_bucket[FOLLOWUP].occurrence_key == by_bucket[CONFIRM].occurrence_key
    assert by_bucket[FOLLOWUP].title.startswith("跟进：")
    assert by_bucket[CONFIRM].title.startswith("确认：")
    assert [step.kind for step in by_bucket[FOLLOWUP].steps] == ["followup"]
    assert {step.kind for step in by_bucket[CONFIRM].steps} == {"confirm"}
    # 每岗一步、output_ref 指回 track；初始状态是 pending（等用户决策）。
    step = by_bucket[FOLLOWUP].steps[0]
    assert step.output_ref == {"track_id": follow.id}
    assert step.status == "pending"


# ===== 去重：同周每桶仅一张卡（含并发 TOCTOU 窗口）=====


def test_one_card_per_bucket_per_week(db_session, monkeypatch):
    _track(db_session, company="甲", days_ago=8)
    _track(db_session, company="乙", days_ago=9)

    first = _scan(db_session)
    second = _scan(db_session)
    assert first["created"] == 1
    assert second["created"] == 0
    assert len(_cards(db_session)) == 1
    assert len(_cards(db_session)[0].steps) == 2

    # 模拟并发：另一轮扫描已经过了"桶键不存在"的检查（TOCTOU 窗口），直接插入同一
    # 桶键。唯一索引 uq_agent_task_source_occurrence 必须把它挡成 IntegrityError，
    # 而不是出第二张卡——**删掉唯一索引这条用例会精确变红**。
    monkeypatch.setattr(followup_sweep, "_card_exists", lambda *_args, **_kwargs: False)
    third = _scan(db_session)
    assert third["created"] == 0
    assert len(_cards(db_session)) == 1


# ===== 开关 =====


def test_disabled_writes_nothing(client, db_session):
    _track(db_session, days_ago=8)

    assert _scan(db_session, enabled=False) == {
        "enabled": False,
        "created": 0,
        "skipped": 0,
        "created_task_ids": [],
    }
    assert _cards(db_session) == []

    # enabled=None 读 T26 同一个设置：默认关 → 零写入。
    assert _scan(db_session, enabled=None)["created"] == 0
    assert _cards(db_session) == []


def test_enabled_flag_is_reused_from_agent_task_events_setting(db_session):
    _track(db_session, days_ago=8)
    assert db_session.query(AgentTask).count() == 0

    # 直接写服务层开关（HTTP PUT 还会启动调度线程，那是 T26 的接线，不是这里要验的）。
    save_agent_task_events_enabled(db_session, True)
    assert _scan(db_session, enabled=None)["created"] == 1

    # 关闭后不再生成新卡，已建卡保留不追删。
    save_agent_task_events_enabled(db_session, False)
    _track(db_session, company="关闭后", days_ago=9)
    assert _scan(db_session, enabled=None)["created"] == 0
    assert len(_cards(db_session)) == 1


# ===== 候选过滤：近期决策 / stopped / 非进行中 =====


def test_recent_decisions_and_stopped_are_excluded(db_session):
    contacted = _track(db_session, company="刚联系过", days_ago=8)
    replied_long_ago = _track(db_session, company="十天前回过", days_ago=8)
    stopped = _track(db_session, company="不跟了", days_ago=8)
    plain = _track(db_session, company="没表过态", days_ago=8)
    db_session.add_all(
        [
            ApplicationFollowUp(
                track_id=contacted.id,
                decided_at=_ago(2),
                decision=FOLLOWUP_DECISION_CONTACTED,
            ),
            ApplicationFollowUp(
                track_id=replied_long_ago.id,
                decided_at=_ago(10),
                decision=FOLLOWUP_DECISION_REPLIED,
            ),
            ApplicationFollowUp(
                track_id=stopped.id,
                decided_at=_ago(100),
                decision=FOLLOWUP_DECISION_STOPPED,
            ),
        ]
    )
    db_session.commit()

    result = _scan(db_session)

    assert result["created"] == 1
    ids = _track_ids(_cards(db_session)[0])
    assert ids == {replied_long_ago.id, plain.id}
    # 近 7 天已表过态的不打扰；stopped 是永久排除（100 天前也不行）。
    assert contacted.id not in ids
    assert stopped.id not in ids


def test_terminal_and_deleted_tracks_are_not_candidates(db_session):
    off = _track(db_session, company="Offer", status=STATUS_INTERVIEW, days_ago=8)
    rejected = _track(db_session, company="已结束", status=STATUS_REJECTED, days_ago=30)
    soft_deleted = _track(db_session, company="回收站", days_ago=8)
    soft_deleted.deleted_at = _ago(1)
    db_session.commit()

    assert _scan(db_session)["created"] == 1
    ids = _track_ids(_cards(db_session)[0])
    assert ids == {off.id}
    assert rejected.id not in ids and soft_deleted.id not in ids


# ===== 让位规则（防双响）=====


def _reminder_card_for(db, track: ApplicationTrack, *, created_days_ago: float) -> Reminder:
    reminder = Reminder(
        title="跟进：甲公司 · 后端开发",
        remind_at=_ago(1),
        kind=REMINDER_KIND_HR_REPLY,
        status=REMINDER_STATUS_PENDING,
        track_id=track.id,
    )
    db.add(reminder)
    db.flush()
    db.add(
        AgentTask(
            conversation_id=None,
            dataset_key="main",
            title="准备：跟进：甲公司 · 后端开发",
            goal="",
            status=AGENT_TASK_STATUS_DRAFT,
            source=AGENT_TASK_SOURCE_REMINDER,
            reminder_id=reminder.id,
            occurrence_due_at=_ago(1),
            created_at=_ago(created_days_ago),
        )
    )
    db.commit()
    return reminder


def test_reminder_channel_wins_for_7_days(db_session):
    deferred = _track(db_session, company="提醒通道", days_ago=8)
    expired = _track(db_session, company="提醒卡已过期", days_ago=8)
    _reminder_card_for(db_session, deferred, created_days_ago=2)  # 7 天内：巡检让位
    _reminder_card_for(db_session, expired, created_days_ago=8)  # 窗口外：巡检照常出卡

    result = _scan(db_session)

    assert result["created"] == 1
    followup_cards = _cards(db_session)
    assert len(followup_cards) == 1
    ids = _track_ids(followup_cards[0])
    assert expired.id in ids
    # 这就是"同周两张卡"的守卫：同一家公司不能既有提醒卡又有巡检卡。
    assert deferred.id not in ids


# ===== 上限与排序 =====


def test_at_most_five_tracks_per_bucket_oldest_first(db_session):
    tracks = [_track(db_session, company=f"公司{i}", days_ago=8 + i) for i in range(7)]

    result = _scan(db_session)

    assert result["created"] == 1
    card = _cards(db_session)[0]
    assert len(card.steps) == MAX_TRACKS_PER_BUCKET == 5
    # updated_at 升序 = 最久没动的优先；第 6、7 家等下周。
    expected = [track.id for track in sorted(tracks, key=lambda item: (item.updated_at, item.id))][
        :MAX_TRACKS_PER_BUCKET
    ]
    assert _ordered_track_ids(card) == expected
    assert result["skipped"] == 2


# ===== 文案双向守卫 =====


def _step_titles(db) -> list[str]:
    titles: list[str] = []
    for card in _cards(db):
        for step in card.steps:
            titles.append(step.title)
    return titles


def test_rendered_text_has_all_required_elements(db_session):
    _track(db_session, company="甲公司", title="后端开发", days_ago=8)
    _track(db_session, company="乙公司", title="客户端开发", days_ago=22)
    _scan(db_session)

    titles = _step_titles(db_session)
    assert len(titles) == 2
    for title in titles:
        assert REQUIRED_FRAGMENT in title
        assert "要不要" in title and "？" in title
        assert re.search(r"\d+ 天", title), title
        for phrase in FORBIDDEN_PHRASES:
            assert phrase not in title
        days = int(re.search(r"(\d+) 天", title).group(1))
        assert check_step_text(title, expected_days=days) is None


@pytest.mark.parametrize("phrase", FORBIDDEN_PHRASES)
def test_forbidden_phrases_are_rejected(phrase: str):
    text = FOLLOWUP_STEP_TEMPLATE.format(days=8, company="某公司", title="后端") + phrase
    reason = check_step_text(text, expected_days=8)
    assert reason is not None and "禁词" in reason


def test_required_elements_are_enforced_independently():
    valid = FOLLOWUP_STEP_TEMPLATE.format(days=8, company="某公司", title="后端")
    assert check_step_text(valid, expected_days=8) is None

    no_days = valid.replace("8 天", "很久")
    assert "天数" in (check_step_text(no_days, expected_days=8) or "")

    no_fragment = valid.replace(REQUIRED_FRAGMENT, "进展缓慢")
    assert "没有记录到" in (check_step_text(no_fragment, expected_days=8) or "")

    no_question = valid.replace("要不要发一条跟进？", "建议发一条跟进。")
    assert "要不要" in (check_step_text(no_question, expected_days=8) or "")


def test_runtime_self_check_falls_back_and_warns(db_session, monkeypatch, caplog):
    """模板被改坏时：运行时自检改用兜底文案并 logger.warning，绝不把禁词发出去。"""
    monkeypatch.setattr(followup_sweep, "FOLLOWUP_STEP_TEMPLATE", "对方还没回复你，要不要问一下？")
    _track(db_session, days_ago=8)

    with caplog.at_level(logging.WARNING):
        assert _scan(db_session)["created"] == 1

    title = _cards(db_session)[0].steps[0].title
    assert title == FALLBACK_STEP_TEMPLATE.format(days=8)
    assert "禁词" in caplog.text
    assert check_step_text(title, expected_days=8) is None


# ===== 阈值单一来源 =====


def test_followup_thresholds_single_source(client, db_session, monkeypatch):
    """一处定义：看板的"卡住"与巡检的"跟进"必须是同一个阈值。

    两个消费点各自在**模块命名空间**里持有绑定值（``api/stats.py`` import 的
    ``STALLED_DAYS`` 与巡检 import 的 ``FOLLOWUP_SILENCE_DAYS``），所以验证"同步
    变化"必须 monkeypatch 这两个消费点本身，而不是只改 ``models/tracker`` 的定义——
    只改定义不会回流到模块级绑定，那恰恰是"消费者各自绑定"的边界，不是缺陷。
    """
    import inspect

    from app.models import tracker as tracker_model

    assert tracker_model.FOLLOWUP_SILENCE_DAYS == tracker_model.STALLED_DAYS
    assert tracker_model.CONFIRM_SILENCE_DAYS == 21  # 产品拍板的固定口径
    assert tracker_model.FOLLOWUP_SILENCE_DAYS != tracker_model.CONFIRM_SILENCE_DAYS
    # is_stalled 的默认参数也来自同一个 STALLED_DAYS（代码层只有一处定义）。
    default_days = inspect.signature(tracker_model.is_stalled).parameters["days"].default
    assert default_days == tracker_model.STALLED_DAYS

    # 真实时钟口径：/api/stats 用 utcnow()，巡检这里也用同一时刻，避免两条时间线打架。
    moment = utcnow()
    _track(
        db_session,
        company="六天半",
        updated_at=moment - timedelta(days=6, hours=12),
    )
    assert client.get("/api/stats").json()["stalled_application_count"] == 0
    assert _scan(db_session, now=moment)["created"] == 0

    monkeypatch.setattr("app.api.stats.STALLED_DAYS", 6)
    monkeypatch.setattr(followup_sweep, "FOLLOWUP_SILENCE_DAYS", 6)
    assert client.get("/api/stats").json()["stalled_application_count"] == 1
    assert _scan(db_session, now=moment)["created"] == 1


# ===== T03 hook：与提醒扫描共用 Session/租约，且互不拖垮 =====


def test_run_for_current_dataset_runs_sweep_in_same_session(client, monkeypatch):
    from app.services import agent_task_events

    seen: dict = {}

    def fake_reminders(db, *, now=None, **kwargs):
        seen["reminder_db"] = db
        seen["now"] = now
        return {"enabled": True, "created": 0, "skipped": 0, "created_task_ids": []}

    def fake_sweep(db, *, now=None, **kwargs):
        seen["sweep_db"] = db
        seen["sweep_now"] = now
        return {"enabled": True, "created": 1, "skipped": 0, "created_task_ids": [1]}

    monkeypatch.setattr(agent_task_events, "scan_due_reminders", fake_reminders)
    monkeypatch.setattr(agent_task_events, "scan_stalled_tracks", fake_sweep)

    result = agent_task_events.run_for_current_dataset(now=NOW_NAIVE)

    assert result is not None and result["created"] == 0
    # 同一 Session、同一 now：不另起线程/租约的第二套时间线。
    assert seen["sweep_db"] is seen["reminder_db"]
    assert seen["sweep_now"] == seen["now"] == NOW_NAIVE


def test_sweep_failure_does_not_break_reminder_scan(client, monkeypatch):
    from app.services import agent_task_events

    def fake_reminders(db, *, now=None, **kwargs):
        return {"enabled": True, "created": 2, "skipped": 0, "created_task_ids": [1, 2]}

    def exploding_sweep(db, *, now=None, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(agent_task_events, "scan_due_reminders", fake_reminders)
    monkeypatch.setattr(agent_task_events, "scan_stalled_tracks", exploding_sweep)

    result = agent_task_events.run_for_current_dataset(now=NOW_NAIVE)

    # 巡检是旁路：失败不能把提醒扫描的既有返回值变成 None。
    assert result == {"enabled": True, "created": 2, "skipped": 0, "created_task_ids": [1, 2]}
