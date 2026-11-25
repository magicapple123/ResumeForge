# SPDX-License-Identifier: Apache-2.0
"""CR-29：通知偏好六个开关（决策类打断 / 结果类安静）+ emit 侧闸门。

验收要求"关掉后通道行为按预期"，所以这里不做"只测 PUT 回显"的假覆盖：

1. 默认值必须符合 §9 口径——提醒到点与等待确认开，任务/批次完成关；
2. 六个开关各自落库为 ``AppSetting``，且下一次读出来的快照跟着变；
3. 静默时段按服务端本地时间跨午夜判定；
4. 关掉「需要你确认」后，wait-approval **一条通知都不写**（emit 侧断言）；
   打开时同一步幂等、换一步再写一条。
"""

from __future__ import annotations

import json
from datetime import datetime

from app.models.notification import Notification
from app.models.setting import AppSetting
from app.services.notification_settings import (
    KEY_BATCH_DONE,
    KEY_QUIET_HOURS,
    KEY_REMINDER_DUE,
    KEY_SOUND,
    KEY_TASK_DONE,
    KEY_TASK_WAITING,
    quiet_active,
)


def _create(client, steps, *, title="整理岗位并改写简历"):
    response = client.post("/api/agent-tasks", json={"title": title, "steps": steps})
    assert response.status_code == 201, response.text
    return response.json()


def _waiting_task(client):
    """建一个 3 步任务，推进到第 1 步等待确认，返回 task id。"""
    task = _create(client, ["准备计划", "等待确认", "执行写入"])
    task_id = task["id"]
    assert client.post(f"/api/agent-tasks/{task_id}/start").status_code == 200
    assert client.post(f"/api/agent-tasks/{task_id}/steps/0/complete", json={}).status_code == 200
    assert client.post(f"/api/agent-tasks/{task_id}/steps/1/wait-approval").status_code == 200
    return task_id


def test_defaults_interrupt_decisions_and_quiet_results(client):
    body = client.get("/api/settings/notifications").json()

    assert body["notify_reminder_due"] is True
    assert body["notify_task_waiting"] is True
    assert body["notify_task_done"] is False
    assert body["notify_batch_done"] is False
    assert body["notify_sound"] is True
    assert body["notify_quiet_hours"] is False
    assert body["quiet_active"] is False
    assert (body["quiet_start"], body["quiet_end"]) == ("22:00", "08:00")


def test_every_switch_persists_as_a_setting(client, db_session):
    response = client.put(
        "/api/settings/notifications",
        json={
            "notify_reminder_due": False,
            "notify_task_waiting": False,
            "notify_task_done": True,
            "notify_batch_done": True,
            "notify_sound": False,
            "notify_quiet_hours": True,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["notify_task_done"] is True

    rows = {
        row.key: json.loads(row.value)
        for row in db_session.query(AppSetting)
        .filter(
            AppSetting.key.in_(
                (
                    KEY_REMINDER_DUE,
                    KEY_TASK_WAITING,
                    KEY_TASK_DONE,
                    KEY_BATCH_DONE,
                    KEY_SOUND,
                    KEY_QUIET_HOURS,
                )
            )
        )
        .all()
    }
    assert rows == {
        KEY_REMINDER_DUE: False,
        KEY_TASK_WAITING: False,
        KEY_TASK_DONE: True,
        KEY_BATCH_DONE: True,
        KEY_SOUND: False,
        KEY_QUIET_HOURS: True,
    }
    # 再读一次：快照来自库，不是内存里的默认值。
    again = client.get("/api/settings/notifications").json()
    assert again["notify_reminder_due"] is False
    assert again["notify_batch_done"] is True


def test_partial_update_keeps_the_other_switches(client):
    client.put("/api/settings/notifications", json={"notify_task_done": True})
    body = client.put("/api/settings/notifications", json={"notify_sound": False}).json()

    assert body["notify_task_done"] is True
    assert body["notify_sound"] is False
    assert body["notify_reminder_due"] is True


def test_quiet_window_wraps_midnight(client, db_session):
    client.put("/api/settings/notifications", json={"notify_quiet_hours": True})

    assert quiet_active(db_session, now=datetime(2026, 1, 1, 23, 0)) is True
    assert quiet_active(db_session, now=datetime(2026, 1, 1, 7, 59)) is True
    assert quiet_active(db_session, now=datetime(2026, 1, 1, 8, 0)) is False
    assert quiet_active(db_session, now=datetime(2026, 1, 1, 12, 0)) is False


def test_wait_approval_writes_exactly_one_notification_per_step(client, db_session):
    task_id = _waiting_task(client)

    rows = db_session.query(Notification).filter(Notification.type == "agent_task").all()
    assert len(rows) == 1
    assert rows[0].dedupe_key == f"agent-task-waiting:{task_id}:1"
    assert "等你确认" in rows[0].title

    # 同一步重复调用：状态幂等，通知也不该多一条。
    client.post(f"/api/agent-tasks/{task_id}/steps/1/wait-approval")
    assert db_session.query(Notification).filter(Notification.type == "agent_task").count() == 1


def test_wait_approval_switch_off_emits_nothing(client, db_session):
    client.put("/api/settings/notifications", json={"notify_task_waiting": False})

    _waiting_task(client)

    assert db_session.query(Notification).filter(Notification.type == "agent_task").count() == 0
