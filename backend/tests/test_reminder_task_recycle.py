# SPDX-License-Identifier: Apache-2.0
"""CR-26：提醒完成/忽略后回收它生成的任务卡（单向联动）。

口径（任务书 §CR-26 + §9）：
- 只做「提醒 done/dismissed → 结束该 reminder 下未终态卡」；
- 软删提醒**不**连坐；
- 任务卡被取消**不**反写提醒状态。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.models.agent_task import (
    AGENT_TASK_STATUS_CANCELLED,
    AGENT_TASK_STATUS_DRAFT,
    AGENT_TASK_STEP_STATUS_PENDING,
    AGENT_TASK_STEP_STATUS_SKIPPED,
    AgentTask,
)
from app.models.reminder import Reminder
from app.services.agent_task_events import scan_due_reminders
from app.services.agent_task_transitions import cancel

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
CARD_SETTING = "/api/settings/agent-task-events"


def _enable_cards(client) -> None:
    assert client.put(CARD_SETTING, json={"enabled": True}).status_code == 200


def _reminder_with_card(client, db_session, *, title: str) -> tuple[dict, AgentTask]:
    created = client.post(
        "/api/reminders",
        json={
            "title": title,
            "remind_at": (NOW - timedelta(minutes=5)).isoformat(),
            "kind": "other",
        },
    )
    assert created.status_code == 201, created.text
    db_session.expire_all()
    scan_due_reminders(db_session, now=NOW)
    db_session.expire_all()
    task = db_session.query(AgentTask).filter(AgentTask.reminder_id == created.json()["id"]).one()
    assert task.status == AGENT_TASK_STATUS_DRAFT
    return created.json(), task


def test_done_reminder_cancels_its_task_card(client, db_session):
    _enable_cards(client)
    reminder, task = _reminder_with_card(client, db_session, title="做线上测评")

    patched = client.patch(f"/api/reminders/{reminder['id']}", json={"status": "done"})
    assert patched.status_code == 200, patched.text

    db_session.expire_all()
    row = db_session.get(AgentTask, task.id)
    assert row.status == AGENT_TASK_STATUS_CANCELLED
    assert "已完成" in row.error
    assert row.finished_at is not None
    step = row.steps[0]
    assert step.status == AGENT_TASK_STEP_STATUS_SKIPPED
    # 只回收它自己的卡：提醒本身变 done，任务卡不反写任何提醒字段。
    assert db_session.get(Reminder, reminder["id"]).status == "archived"


def test_dismissed_reminder_also_cancels(client, db_session):
    _enable_cards(client)
    reminder, task = _reminder_with_card(client, db_session, title="催 HR 回复")

    patched = client.patch(f"/api/reminders/{reminder['id']}", json={"status": "dismissed"})
    assert patched.status_code == 200, patched.text

    db_session.expire_all()
    row = db_session.get(AgentTask, task.id)
    assert row.status == AGENT_TASK_STATUS_CANCELLED
    assert "忽略" in row.error


def test_soft_delete_reminder_keeps_task_card(client, db_session):
    _enable_cards(client)
    reminder, task = _reminder_with_card(client, db_session, title="留着历史的")

    assert client.delete(f"/api/reminders/{reminder['id']}").status_code == 204

    db_session.expire_all()
    assert db_session.get(AgentTask, task.id).status == AGENT_TASK_STATUS_DRAFT


def test_cancelling_task_does_not_touch_reminder(client, db_session):
    _enable_cards(client)
    reminder, task = _reminder_with_card(client, db_session, title="反向不联动")

    cancel(db_session, task.id)
    db_session.expire_all()

    assert db_session.get(AgentTask, task.id).status == AGENT_TASK_STATUS_CANCELLED
    assert db_session.get(Reminder, reminder["id"]).status == "active"


def test_patch_without_terminal_status_leaves_card_alone(client, db_session):
    _enable_cards(client)
    reminder, task = _reminder_with_card(client, db_session, title="只改备注")

    patched = client.patch(f"/api/reminders/{reminder['id']}", json={"note": "补充备注"})
    assert patched.status_code == 200, patched.text

    db_session.expire_all()
    assert db_session.get(AgentTask, task.id).status == AGENT_TASK_STATUS_DRAFT
    assert db_session.get(AgentTask, task.id).steps[0].status == AGENT_TASK_STEP_STATUS_PENDING
