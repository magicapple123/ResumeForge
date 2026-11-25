# SPDX-License-Identifier: Apache-2.0
"""CR-22：提醒到期真的通知（与「任务卡」开关解耦）。

覆盖任务书 §CR-22 的验收与反证：

1. 任务卡开关关闭（默认）时，扫描仍产生 1 条通知、且**不**建卡；
2. 连扫两次只 1 条（occurrence 的 ``notified_at`` 条件更新，CR-28）；
3. 改期 → 重新武装 → 再发 1 条；
4. 「提醒到点通知」关闭时投递段零副作用（不写库、不改 ``notified_at``）；
5. 停机补扫窗口内多条 → 只发 1 条合并通知，但每条 reminder 都标记已通知；
6. 窗口外（>24h）不投递；
7. ``emit`` 幂等 + inbox API（列表 / 未读 / 单条已读 / 全部已读）。
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from app.models.agent_task import AgentTask
from app.models.job import Job
from app.models.notification import Notification
from app.models.profile import utcnow
from app.models.reminder import ReminderOccurrence
from app.models.setting import AppSetting
from app.services.agent_task_events import scan_due_reminders
from app.services.notifications import emit

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
CARD_SETTING = "/api/settings/agent-task-events"
NOTIFY_KEY = "notify_reminder_due"


def _set_flag(db, key: str, value: bool) -> None:
    """直接写 AppSetting（本流不新增 HTTP 开关；W2-A 才接界面）。"""
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=json.dumps(value)))
    else:
        row.value = json.dumps(value)
    db.commit()


def _set_cards(client, enabled: bool) -> None:
    response = client.put(CARD_SETTING, json={"enabled": enabled})
    assert response.status_code == 200, response.text


def _create_reminder(client, *, remind_at: datetime, title: str, **extra) -> dict:
    response = client.post(
        "/api/reminders",
        json={"title": title, "remind_at": remind_at.isoformat(), "kind": "other", **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _scan(
    db, *, now: datetime = NOW, cards: bool | None = None, notify: bool | None = None
) -> dict:
    db.expire_all()
    result = scan_due_reminders(db, now=now, enabled=cards, notify_enabled=notify)
    db.expire_all()
    return result


def test_delivery_is_independent_from_task_card_switch(client, db_session):
    """默认：任务卡关、通知开 → 1 条通知、0 张卡。"""
    assert client.get(CARD_SETTING).json() == {"enabled": False}
    job = Job(title="AI 应用开发工程师", company="星海智能")
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)

    reminder = _create_reminder(
        client,
        remind_at=NOW - timedelta(minutes=5),
        title="做线上测评",
        kind="assessment_deadline",
        job_id=job.id,
    )

    result = _scan(db_session)

    assert result["delivered"] == 1
    assert result["created"] == 0 and result["created_task_ids"] == []
    assert db_session.query(AgentTask).count() == 0

    rows = db_session.query(Notification).all()
    assert len(rows) == 1
    note = rows[0]
    assert note.title == "提醒：做线上测评"
    assert "测评截止" in note.body
    assert "星海智能" in note.body and "AI 应用开发工程师" in note.body
    assert note.deep_link == f"/tracker?reminder={reminder['id']}"
    assert note.read_at is None
    assert note.expires_at is not None and note.expires_at > NOW.replace(tzinfo=None)

    occurrence = (
        db_session.query(ReminderOccurrence)
        .filter(ReminderOccurrence.reminder_id == reminder["id"])
        .one()
    )
    assert occurrence.notified_at == NOW.replace(tzinfo=None)


def test_repeated_scans_deliver_only_once(client, db_session):
    _create_reminder(
        client, remind_at=NOW - timedelta(minutes=10), title="催 HR 回复", kind="hr_reply"
    )

    first = _scan(db_session)
    second = _scan(db_session)

    assert first["delivered"] == 1
    assert second["delivered"] == 0
    assert db_session.query(Notification).count() == 1


def test_rescheduling_rearms_delivery(client, db_session):
    reminder = _create_reminder(client, remind_at=NOW - timedelta(minutes=10), title="面试提醒")
    assert _scan(db_session)["delivered"] == 1

    later = NOW + timedelta(hours=2)
    patched = client.patch(
        f"/api/reminders/{reminder['id']}", json={"remind_at": later.isoformat()}
    )
    assert patched.status_code == 200, patched.text
    # 改到未来：还没到期，不发。
    assert _scan(db_session, now=later - timedelta(minutes=30))["delivered"] == 0
    # 到点：再发一条。
    assert _scan(db_session, now=later + timedelta(minutes=1))["delivered"] == 1
    assert db_session.query(Notification).count() == 2

    # 改回过去（模拟"改错了"）：重新武装后仍要能发。
    back = NOW - timedelta(minutes=10)
    client.patch(f"/api/reminders/{reminder['id']}", json={"remind_at": back.isoformat()})
    assert _scan(db_session)["delivered"] == 1
    assert db_session.query(Notification).count() == 3


def test_notify_switch_off_has_zero_side_effects(client, db_session):
    _set_cards(client, True)
    _set_flag(db_session, NOTIFY_KEY, False)
    reminder = _create_reminder(client, remind_at=NOW - timedelta(minutes=5), title="不该提醒")

    result = _scan(db_session)

    assert result["delivered"] == 0 and result["notification_ids"] == []
    # 任务卡段不受通知开关影响。
    assert result["created"] == 1
    assert db_session.query(Notification).count() == 0
    db_session.expire_all()
    occurrence = (
        db_session.query(ReminderOccurrence)
        .filter(ReminderOccurrence.reminder_id == reminder["id"])
        .one()
    )
    assert occurrence.notified_at is None


def test_backfill_merges_into_single_notification(client, db_session):
    for index in range(3):
        _create_reminder(
            client,
            remind_at=NOW - timedelta(hours=index + 1),
            title=f"积压提醒 {index}",
        )

    result = _scan(db_session)

    assert result["delivered"] == 3
    rows = db_session.query(Notification).all()
    assert len(rows) == 1
    assert "3 条提醒到期" in rows[0].body
    assert "3 条" in rows[0].title
    assert rows[0].deep_link == "/tracker"
    # 每条都必须标记，否则下一轮会把"没发过的"再发一遍。
    db_session.expire_all()
    assert all(row.notified_at is not None for row in db_session.query(ReminderOccurrence).all())


def test_older_than_window_is_not_delivered(client, db_session):
    _create_reminder(client, remind_at=NOW - timedelta(days=3), title="三天前")

    assert _scan(db_session)["delivered"] == 0
    assert db_session.query(Notification).count() == 0


def test_emit_is_idempotent_and_inbox_api_round_trip(client, db_session):
    first = emit(
        db_session,
        type="reminder_due",
        title="提醒：手工投递",
        body="提醒 · 今天",
        deep_link="/tracker?reminder=1",
        dedupe_key="manual:1",
    )
    second = emit(
        db_session,
        type="reminder_due",
        title="提醒：重复投递",
        dedupe_key="manual:1",
    )
    db_session.commit()
    assert first.id == second.id
    assert db_session.query(Notification).count() == 1

    listed = client.get("/api/notifications")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert len(body) == 1
    assert set(body[0]) == {
        "id",
        "type",
        "severity",
        "title",
        "body",
        "deep_link",
        "read_at",
        "created_at",
        "expires_at",
    }
    assert body[0]["title"] == "提醒：手工投递"

    assert client.get("/api/notifications/unread-count").json() == {"unread": 1}
    marked = client.post(f"/api/notifications/{body[0]['id']}/read")
    assert marked.status_code == 200, marked.text
    assert marked.json()["read_at"] is not None
    assert client.get("/api/notifications/unread-count").json() == {"unread": 1 - 1}

    emit(
        db_session,
        type="reminder_due",
        title="第二条",
        dedupe_key="manual:2",
    )
    db_session.commit()
    assert client.post("/api/notifications/read-all").json() == {"updated": 1}
    assert client.get("/api/notifications/unread-count").json() == {"unread": 0}
    assert client.post("/api/notifications/999999/read").status_code == 404


def test_expired_notifications_are_filtered_from_inbox(client, db_session):
    row = emit(
        db_session,
        type="reminder_due",
        title="过期通知",
        dedupe_key="manual:expired",
        expires_at=utcnow() - timedelta(days=1),
    )
    db_session.commit()
    assert row.id
    assert client.get("/api/notifications").json() == []
    assert client.get("/api/notifications/unread-count").json() == {"unread": 0}
