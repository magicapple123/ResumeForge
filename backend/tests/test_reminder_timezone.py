# SPDX-License-Identifier: Apache-2.0
"""CR-27：助手创建提醒偏 8 小时——写入层时区归一。

全库口径是 **naive UTC**，而助手/工具给的是**用户本地时间**的裸串。修法只有一条：
``reminder_service.to_naive_utc()`` 是所有写入（create/update、HTTP/工具/未来导入）的
唯一归一入口——裸 datetime 按本机时区解释，aware 先归一成 UTC 再去掉 tzinfo。

断言口径：期望值一律按 ``datetime.now().astimezone().utcoffset()`` 现算，**不写死 8 小时**；
测试机时区不是 UTC+8 时也要绿。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

from app.schemas.reminder import ReminderCreate, ReminderUpdate
from app.services.reminder_service import create_reminder, to_naive_utc, update_reminder

BARE_LOCAL = datetime(2026, 11, 26, 10, 0, 0)


def _expected_utc(bare_local: datetime) -> datetime:
    """把「本机墙钟」换算成库里应有的 naive UTC（按运行环境时区现算）。"""
    return bare_local.astimezone().astimezone(UTC).replace(tzinfo=None)


def test_to_naive_utc_interprets_naive_as_local():
    assert to_naive_utc(BARE_LOCAL) == _expected_utc(BARE_LOCAL)


def test_to_naive_utc_normalizes_aware_to_utc():
    offset = datetime.now().astimezone().utcoffset() or timedelta(0)
    localized = BARE_LOCAL.replace(tzinfo=timezone(offset))
    assert to_naive_utc(localized) == BARE_LOCAL - offset

    # 固定 +08:00 的入参（与运行环境时区无关）→ 02:00 UTC。
    assert to_naive_utc(datetime(2026, 11, 26, 10, 0, tzinfo=timezone(timedelta(hours=8)))) == (
        datetime(2026, 11, 26, 2, 0)
    )
    # ``...Z`` 即 UTC：数值不变，只去掉 tzinfo。
    assert to_naive_utc(datetime(2026, 11, 26, 2, 0, tzinfo=UTC)) == datetime(2026, 11, 26, 2, 0)


def test_create_reminder_stores_naive_local_as_utc(db_session):
    reminder = create_reminder(db_session, ReminderCreate(title="做线上测评", remind_at=BARE_LOCAL))
    db_session.refresh(reminder)
    assert reminder.remind_at == _expected_utc(BARE_LOCAL)
    assert reminder.remind_at.tzinfo is None


def test_create_reminder_stores_aware_input_as_utc(db_session):
    aware = datetime(2026, 11, 26, 10, 0, tzinfo=timezone(timedelta(hours=8)))
    reminder = create_reminder(db_session, ReminderCreate(title="带时区", remind_at=aware))
    db_session.refresh(reminder)
    assert reminder.remind_at == datetime(2026, 11, 26, 2, 0)


def test_update_reminder_normalizes_new_remind_at(db_session):
    created = create_reminder(db_session, ReminderCreate(title="改期", remind_at=BARE_LOCAL))
    updated = update_reminder(
        db_session, created, ReminderUpdate(remind_at=BARE_LOCAL + timedelta(days=1))
    )
    db_session.refresh(updated)
    assert updated.remind_at == _expected_utc(BARE_LOCAL + timedelta(days=1))


def test_api_bare_and_aware_inputs_land_on_same_utc_instant(client):
    """前端 ``toISOString()``（带 Z）与助手裸串（本地）写的是同一个瞬间。"""
    bare = client.post(
        "/api/reminders",
        json={"title": "助手裸串", "remind_at": "2026-11-26T10:00:00", "kind": "other"},
    )
    assert bare.status_code == 201, bare.text
    assert datetime.fromisoformat(bare.json()["remind_at"]) == _expected_utc(BARE_LOCAL)

    # 前端路径不变：UTC 串原样落库。
    with_z = client.post(
        "/api/reminders",
        json={"title": "前端 UTC", "remind_at": "2026-11-26T02:00:00Z", "kind": "other"},
    )
    assert with_z.status_code == 201, with_z.text
    assert datetime.fromisoformat(with_z.json()["remind_at"]) == datetime(2026, 11, 26, 2, 0)


def test_preview_shows_local_trigger_time(db_session):
    """确认卡上显示的是换算后的本机时间，而不是模型给的原始串。"""
    from app.services.assistant_tools.previews import preview_create_reminder

    preview = preview_create_reminder(
        db_session, {"title": "做测评", "remind_at": "2026-11-26T02:00:00Z", "kind": "other"}
    )
    changes = {change.field: change for change in preview.changes}
    expected = datetime(2026, 11, 26, 2, 0, tzinfo=UTC).astimezone().strftime("%Y-%m-%d %H:%M")
    assert changes["提醒时间"].after is not None
    assert changes["提醒时间"].after.startswith(expected)
    assert "本机时间" in changes["提醒时间"].after
