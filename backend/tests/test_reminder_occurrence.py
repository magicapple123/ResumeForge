# SPDX-License-Identifier: Apache-2.0
"""CR-28：提醒的「这一次」（occurrence）——重复、稍后、跳过、逾期自动跳过。

逐条对应任务书的验收：

1. 单次完成 → 不再出现（计划归档，列表/待办都查不到）；
2. 每周规则完成 → 下周同日出现（新的 occurrence，不是同一条被复用）；
3. 跳过不结束计划（skipped 同样生成下一次，计划仍 active）；
4. 稍后 1 小时 → due_at 前移、``snoozed_from`` 保留原始时刻；
5. 逾期 ``due_at + 7 天`` 未处理 → 自动 skipped + 一条「已过期」通知。

时间一律用带时区的 ISO 传（``toISOString`` 路径），断言不随测试机时区漂移。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.models.notification import Notification
from app.models.reminder import (
    REMINDER_OCCURRENCE_STATUS_DONE,
    REMINDER_OCCURRENCE_STATUS_PENDING,
    REMINDER_OCCURRENCE_STATUS_SKIPPED,
    REMINDER_STATUS_ACTIVE,
    REMINDER_STATUS_ARCHIVED,
    Reminder,
    ReminderOccurrence,
)
from app.services.agent_task_events import scan_due_reminders
from app.services.reminder_occurrences import (
    EXPIRE_AFTER,
    resolve_snooze_until,
    settle_occurrence,
)

NOW = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)


def _create(client, *, remind_at: datetime = NOW, **extra) -> dict:
    payload = {"title": "每周复盘", "remind_at": remind_at.isoformat(), **extra}
    response = client.post("/api/reminders", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _occurrences(db, reminder_id: int) -> list[ReminderOccurrence]:
    db.expire_all()
    return (
        db.query(ReminderOccurrence)
        .filter(ReminderOccurrence.reminder_id == reminder_id)
        .order_by(ReminderOccurrence.due_at.asc(), ReminderOccurrence.id.asc())
        .all()
    )


def test_create_lands_one_pending_occurrence(client, db_session):
    created = _create(client)

    rows = _occurrences(db_session, created["id"])
    assert len(rows) == 1
    assert rows[0].status == REMINDER_OCCURRENCE_STATUS_PENDING
    assert rows[0].due_at == NOW.replace(tzinfo=None)
    assert created["remind_at"].startswith("2026-11-25T12:00")
    assert created["status"] == REMINDER_STATUS_ACTIVE


def test_single_occurrence_done_disappears(client, db_session):
    created = _create(client)

    patched = client.patch(f"/api/reminders/{created['id']}", json={"status": "done"})
    assert patched.status_code == 200, patched.text
    assert patched.json()["status"] == REMINDER_STATUS_ARCHIVED

    rows = _occurrences(db_session, created["id"])
    assert [row.status for row in rows] == [REMINDER_OCCURRENCE_STATUS_DONE]

    # 不再出现：待办与默认列表都为空（归档视图仍能查到，供"已完成"回看）。
    assert client.get("/api/reminders/upcoming").json() == []
    assert client.get("/api/reminders").json() == []
    archived = client.get("/api/reminders?status=archived").json()
    assert [item["id"] for item in archived] == [created["id"]]


def test_weekly_done_creates_next_same_weekday(client, db_session):
    created = _create(client, recurrence="weekly")

    patched = client.patch(f"/api/reminders/{created['id']}", json={"status": "done"})
    assert patched.status_code == 200, patched.text
    # 计划还活着：这才叫"重复"。
    assert patched.json()["status"] == REMINDER_STATUS_ACTIVE

    rows = _occurrences(db_session, created["id"])
    assert [row.status for row in rows] == [
        REMINDER_OCCURRENCE_STATUS_DONE,
        REMINDER_OCCURRENCE_STATUS_PENDING,
    ]
    assert rows[1].due_at == (NOW + timedelta(days=7)).replace(tzinfo=None)

    # 下一次出现在待办里，时间就是下周同一天。
    upcoming = client.get("/api/reminders/upcoming").json()
    assert [item["id"] for item in upcoming] == [created["id"]]
    assert upcoming[0]["remind_at"].startswith("2026-12-02T12:00")


def test_skip_keeps_plan_alive_and_schedules_next(client, db_session):
    created = _create(client, recurrence="daily")

    patched = client.patch(f"/api/reminders/{created['id']}", json={"status": "dismissed"})
    assert patched.status_code == 200, patched.text
    assert patched.json()["status"] == REMINDER_STATUS_ACTIVE

    rows = _occurrences(db_session, created["id"])
    assert [row.status for row in rows] == [
        REMINDER_OCCURRENCE_STATUS_SKIPPED,
        REMINDER_OCCURRENCE_STATUS_PENDING,
    ]
    assert rows[1].due_at == (NOW + timedelta(days=1)).replace(tzinfo=None)


def test_recurrence_until_stops_the_series(client, db_session):
    created = _create(
        client, recurrence="daily", recurrence_until=(NOW + timedelta(hours=12)).isoformat()
    )
    patched = client.patch(f"/api/reminders/{created['id']}", json={"status": "done"})
    assert patched.json()["status"] == REMINDER_STATUS_ARCHIVED
    assert len(_occurrences(db_session, created["id"])) == 1


def test_snooze_one_hour_moves_due_and_keeps_origin(client, db_session):
    created = _create(client, remind_at=NOW - timedelta(hours=2))

    response = client.post(f"/api/reminders/{created['id']}/snooze", json={"preset": "one_hour"})
    assert response.status_code == 200, response.text

    rows = _occurrences(db_session, created["id"])
    assert len(rows) == 1
    # 原始时刻留在 snoozed_from，due_at 前移（≈ now + 1h，允许执行耗时的几秒误差）。
    assert rows[0].snoozed_from == (NOW - timedelta(hours=2)).replace(tzinfo=None)
    assert rows[0].due_at > datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=55)
    assert rows[0].due_at < datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1, minutes=5)
    # 推后不会生成新的 occurrence，也不会让计划结束。
    assert response.json()["status"] == REMINDER_STATUS_ACTIVE

    # 再推一次：snoozed_from 仍是最早的那个（保留"本来是什么时候"）。
    client.post(f"/api/reminders/{created['id']}/snooze", json={"preset": "one_hour"})
    again = _occurrences(db_session, created["id"])
    assert again[0].snoozed_from == rows[0].snoozed_from


def test_snooze_specific_until_clears_notified_flag(client, db_session):
    created = _create(client, remind_at=NOW - timedelta(hours=2))
    db_session.query(ReminderOccurrence).filter(
        ReminderOccurrence.reminder_id == created["id"]
    ).update({"notified_at": NOW.replace(tzinfo=None)})
    db_session.commit()

    target = NOW + timedelta(days=2)
    response = client.post(
        f"/api/reminders/{created['id']}/snooze", json={"until": target.isoformat()}
    )
    assert response.status_code == 200, response.text
    rows = _occurrences(db_session, created["id"])
    assert rows[0].due_at == target.replace(tzinfo=None)
    assert rows[0].notified_at is None


def test_snooze_rejects_both_or_neither(client):
    created = _create(client)
    both = client.post(
        f"/api/reminders/{created['id']}/snooze",
        json={"preset": "one_hour", "until": NOW.isoformat()},
    )
    neither = client.post(f"/api/reminders/{created['id']}/snooze", json={})
    assert both.status_code == 422
    assert neither.status_code == 422


def test_snooze_presets_use_local_wall_clock():
    local_now = datetime(2026, 11, 25, 21, 30).astimezone()

    def _local(value: datetime) -> datetime:
        """返回值是 naive UTC；断言要看本机墙钟，所以显式标 UTC 再转本地。"""
        return value.replace(tzinfo=UTC).astimezone()

    # 已经过了 20:00：今晚 20:00 顺延到明天，不把时间往回拨。
    tonight = _local(resolve_snooze_until("tonight", now=local_now))
    assert tonight.date() == local_now.date() + timedelta(days=1)
    assert (tonight.hour, tonight.minute) == (20, 0)

    morning = _local(resolve_snooze_until("tomorrow_morning", now=local_now))
    assert morning.date() == local_now.date() + timedelta(days=1)
    assert (morning.hour, morning.minute) == (9, 0)

    one_hour = resolve_snooze_until("one_hour", now=local_now)
    assert one_hour == (local_now + timedelta(hours=1)).astimezone(UTC).replace(tzinfo=None)


def test_expire_after_seven_days_skips_and_notifies(client, db_session):
    created = _create(client, remind_at=NOW - EXPIRE_AFTER - timedelta(hours=1))

    result = scan_due_reminders(db_session, now=NOW, enabled=False, notify_enabled=False)
    assert result["expired"] == 1

    rows = _occurrences(db_session, created["id"])
    assert [row.status for row in rows] == [REMINDER_OCCURRENCE_STATUS_SKIPPED]
    notes = db_session.query(Notification).all()
    assert len(notes) == 1
    assert "已过期" in notes[0].title
    assert "逾期 7 天未处理" in notes[0].body

    # 单次提醒过期后没有下一次：计划仍在（跳过不结束计划），但不再出现在待办里。
    assert client.get("/api/reminders/upcoming").json() == []
    assert db_session.get(Reminder, created["id"]).status == REMINDER_STATUS_ACTIVE


def test_expire_recurring_generates_next_occurrence(client, db_session):
    created = _create(
        client, remind_at=NOW - EXPIRE_AFTER - timedelta(hours=1), recurrence="weekly"
    )

    scan_due_reminders(db_session, now=NOW, enabled=False, notify_enabled=False)

    rows = _occurrences(db_session, created["id"])
    assert [row.status for row in rows] == [
        REMINDER_OCCURRENCE_STATUS_SKIPPED,
        REMINDER_OCCURRENCE_STATUS_PENDING,
    ]


def test_settle_is_idempotent(client, db_session):
    created = _create(client)
    reminder = db_session.get(Reminder, created["id"])

    first = settle_occurrence(db_session, reminder, status=REMINDER_OCCURRENCE_STATUS_DONE)
    second = settle_occurrence(db_session, reminder, status=REMINDER_OCCURRENCE_STATUS_DONE)
    db_session.commit()

    assert first["occurrence_id"] is not None
    # 重复点完成：没有待办可结算，不会多出下一次、也不会改计划状态。
    assert second["occurrence_id"] is None
    assert reminder.status == REMINDER_STATUS_ARCHIVED
    assert len(_occurrences(db_session, created["id"])) == 1


def test_unknown_recurrence_is_rejected(client):
    response = client.post(
        "/api/reminders",
        json={"title": "坏规则", "remind_at": NOW.isoformat(), "recurrence": "hourly"},
    )
    assert response.status_code == 422


def test_archive_pause_and_resume(client, db_session):
    created = _create(client)

    paused = client.patch(f"/api/reminders/{created['id']}", json={"status": "archived"})
    assert paused.json()["status"] == REMINDER_STATUS_ARCHIVED
    assert client.get("/api/reminders/upcoming").json() == []

    resumed = client.patch(f"/api/reminders/{created['id']}", json={"status": "active"})
    assert resumed.json()["status"] == REMINDER_STATUS_ACTIVE
    # 恢复后补回一条待办，否则用户会以为"恢复"没生效。
    assert len(_occurrences(db_session, created["id"])) == 1
    assert client.get("/api/reminders/upcoming").json()[0]["id"] == created["id"]
