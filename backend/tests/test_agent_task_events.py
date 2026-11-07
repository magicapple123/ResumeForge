# SPDX-License-Identifier: Apache-2.0
"""T26 事件触发：提醒到期 → 生成任务卡。

覆盖手册 §5 T26 的 a–g：开关默认关、开启后生成「准备：…」、重复扫描不重复、
延期产生新 occurrence、关闭后不再生成但保留已生成、只补最近 24h（注入时钟）、
提醒列表/弹窗接口回归。
"""

from datetime import UTC, datetime, timedelta

from app.models.agent_task import AgentTask
from app.services.agent_task_events import (
    BACKFILL_WINDOW,
    TASK_TITLE_PREFIX,
    scan_due_reminders,
)
from app.services.settings_service import get_agent_task_events_enabled

# 注入时钟：所有扫描都用它，不写死 datetime.now()（手册 T26 风险项）。
NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
SETTING_URL = "/api/settings/agent-task-events"


def _set_enabled(client, enabled: bool) -> dict:
    response = client.put(SETTING_URL, json={"enabled": enabled})
    assert response.status_code == 200, response.text
    return response.json()


def _create_reminder(client, *, remind_at: datetime, title: str = "面试提醒") -> dict:
    response = client.post(
        "/api/reminders",
        json={"title": title, "remind_at": remind_at.isoformat(), "kind": "other"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _tasks(client) -> list[dict]:
    response = client.get("/api/agent-tasks")
    assert response.status_code == 200, response.text
    return response.json()


def _scan(db_session, *, now: datetime = NOW, enabled: bool | None = None) -> dict:
    db_session.expire_all()
    result = scan_due_reminders(db_session, now=now, enabled=enabled)
    db_session.expire_all()
    return result


def test_switch_defaults_off_and_off_creates_nothing(client, db_session):
    """a) 开关默认关：GET 默认 false；关闭时到期提醒不生成任何任务卡。"""
    response = client.get(SETTING_URL)
    assert response.status_code == 200
    assert response.json() == {"enabled": False}
    assert get_agent_task_events_enabled(db_session) is False

    _create_reminder(client, remind_at=NOW - timedelta(minutes=5))
    result = _scan(db_session)

    assert result == {"enabled": False, "created": 0, "skipped": 0, "created_task_ids": []}
    assert _tasks(client) == []
    assert db_session.query(AgentTask).count() == 0


def test_enabled_generates_prepare_task_card(client, db_session):
    """b) 开启后到期 → 生成一条「准备：<提醒标题>」，只建卡不执行。"""
    assert _set_enabled(client, True) == {"enabled": True}
    due = NOW - timedelta(minutes=5)
    reminder = _create_reminder(client, remind_at=due, title="字节跳动二面")

    result = _scan(db_session)

    assert result["enabled"] is True
    assert result["created"] == 1
    tasks = _tasks(client)
    assert len(tasks) == 1
    task = tasks[0]
    assert task["title"] == f"{TASK_TITLE_PREFIX}字节跳动二面"
    assert task["status"] == "draft"
    assert task["source"] == "reminder"
    assert task["goal"] and "不会自动执行" in task["goal"]
    # 只生成"待用户确认的卡"：一个确认步骤，没有任何已执行动作。
    assert len(task["steps"]) == 1
    assert task["steps"][0]["status"] == "pending"
    assert task["steps"][0]["title"].startswith("确认：")

    row = db_session.get(AgentTask, task["id"])
    assert row is not None
    assert row.reminder_id == reminder["id"]
    # occurrence 落的是绝对时间（naive UTC，与全库口径一致）。
    assert row.occurrence_due_at == due.replace(tzinfo=None)
    assert row.dataset_key == "main"


def test_repeated_scans_do_not_duplicate(client, db_session):
    """c) 扫描 3 次只有一张卡：去重键是 (reminder_id, occurrence_due_at)。"""
    _set_enabled(client, True)
    _create_reminder(client, remind_at=NOW - timedelta(minutes=10))

    first = _scan(db_session)
    second = _scan(db_session)
    third = _scan(db_session)

    assert first["created"] == 1
    assert second["created"] == 0
    assert third["created"] == 0
    assert second["skipped"] == 1 and third["skipped"] == 1
    assert len(_tasks(client)) == 1


def test_postponed_reminder_creates_a_second_occurrence(client, db_session):
    """d) 提醒延期 → occurrence_due_at 变 → 允许再生成一条；旧卡保留不动。"""
    _set_enabled(client, True)
    reminder = _create_reminder(client, remind_at=NOW - timedelta(hours=2))
    first = _scan(db_session)
    assert first["created"] == 1

    later = NOW - timedelta(hours=1)
    patched = client.patch(
        f"/api/reminders/{reminder['id']}", json={"remind_at": later.isoformat()}
    )
    assert patched.status_code == 200, patched.text
    second = _scan(db_session)

    assert second["created"] == 1
    tasks = _tasks(client)
    assert len(tasks) == 2
    assert {task["title"] for task in tasks} == {f"{TASK_TITLE_PREFIX}面试提醒"}
    due_times = {db_session.get(AgentTask, task["id"]).occurrence_due_at for task in tasks}
    assert len(due_times) == 2


def test_disabling_keeps_existing_cards(client, db_session):
    """e) 关闭后不再生成；已生成的卡保留（不追删）。"""
    _set_enabled(client, True)
    _create_reminder(client, remind_at=NOW - timedelta(minutes=30), title="已生成的")
    assert _scan(db_session)["created"] == 1

    assert _set_enabled(client, False) == {"enabled": False}
    _create_reminder(client, remind_at=NOW - timedelta(minutes=5), title="关闭后的")
    result = _scan(db_session)

    assert result["created"] == 0
    tasks = _tasks(client)
    assert [task["title"] for task in tasks] == [f"{TASK_TITLE_PREFIX}已生成的"]


def test_only_the_last_24_hours_are_backfilled(client, db_session):
    """f) 应用 3 天没启动：只补最近 24h 内到期的，更早的不生成（注入时钟，不批量）。"""
    _set_enabled(client, True)
    _create_reminder(client, remind_at=NOW - timedelta(days=3), title="三天前的（不该生成）")
    _create_reminder(client, remind_at=NOW - timedelta(hours=20), title="二十小时前的（该生成）")

    result = _scan(db_session)

    assert result["created"] == 1
    titles = [task["title"] for task in _tasks(client)]
    assert titles == [f"{TASK_TITLE_PREFIX}二十小时前的（该生成）"]
    assert timedelta(hours=24) == BACKFILL_WINDOW


def test_reminder_list_and_upcoming_are_unchanged(client, db_session):
    """g) 原有提醒列表/待办接口行为不变：生成任务卡不改提醒本身的字段与数量。"""
    _set_enabled(client, True)
    past = _create_reminder(client, remind_at=NOW - timedelta(minutes=5), title="过期的提醒")
    future = _create_reminder(client, remind_at=NOW + timedelta(hours=2), title="两小时后")

    assert _scan(db_session)["created"] == 1

    listed = client.get("/api/reminders")
    assert listed.status_code == 200
    ids = {item["id"] for item in listed.json()}
    assert ids == {past["id"], future["id"]}
    by_id = {item["id"]: item for item in listed.json()}
    for original in (past, future):
        current = by_id[original["id"]]
        assert current["title"] == original["title"]
        assert current["status"] == "pending"
        assert current["remind_at"] == original["remind_at"]

    upcoming = client.get("/api/reminders/upcoming")
    assert upcoming.status_code == 200
    upcoming_ids = {item["id"] for item in upcoming.json()}
    assert past["id"] in upcoming_ids and future["id"] in upcoming_ids

    popup = client.get("/api/settings/reminder-popup")
    assert popup.status_code == 200 and "enabled" in popup.json()


def test_event_task_is_visible_in_conversation_filtered_list(client, db_session):
    """h) 事件任务（`conversation_id=None`）出现在任何会话的任务区；别的会话的任务不串台。

    这是 T26 收尾的回归点：前端任务区只按当前会话拉列表（`?conversation_id=X`），
    提醒生成的任务卡没有会话归属——若列表按"精确等值"过滤，它就永远不可达。
    """
    from app.services.agent_task_service import create_task, list_tasks

    _set_enabled(client, True)
    _create_reminder(client, remind_at=NOW - timedelta(minutes=5), title="字节跳动二面")
    assert _scan(db_session)["created"] == 1

    event_task = db_session.query(AgentTask).filter(AgentTask.source == "reminder").one()
    assert event_task.conversation_id is None

    mine = create_task(db_session, title="本会话的任务", steps=["收集要求"], conversation_id=7)
    other = create_task(db_session, title="别的会话的任务", steps=["收集要求"], conversation_id=8)

    db_session.expire_all()
    listed_ids = [task.id for task in list_tasks(db_session, conversation_id=7)]
    assert event_task.id in listed_ids
    assert mine.id in listed_ids
    assert other.id not in listed_ids

    # 不过滤的列表行为不变：三条都在，且新→旧。
    unfiltered = [task.id for task in list_tasks(db_session)]
    assert unfiltered == sorted([event_task.id, mine.id, other.id], reverse=True)

    # 走 HTTP 的同一条路径（前端用的正是这个查询参数）。
    response = client.get("/api/agent-tasks", params={"conversation_id": 7})
    assert response.status_code == 200, response.text
    api_ids = [item["id"] for item in response.json()]
    assert event_task.id in api_ids
    assert other.id not in api_ids


def test_startup_scheduler_starts_only_when_enabled(client, db_session):
    """启动钩子：默认关不建空线程；开启后启动线程并能立即唤醒；可干净停止。"""
    from app.services import agent_task_events

    agent_task_events.stop_scheduler()
    assert agent_task_events.start_scheduler_if_enabled() is False
    assert agent_task_events.get_scheduler() is None

    _set_enabled(client, True)
    assert agent_task_events.start_scheduler_if_enabled() is True
    scheduler = agent_task_events.get_scheduler()
    assert scheduler is not None
    agent_task_events.trigger_check()
    agent_task_events.stop_scheduler()
    assert agent_task_events.get_scheduler() is None
