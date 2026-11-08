# SPDX-License-Identifier: Apache-2.0
"""期一 T05：「我已提交」（submit_confirmation + POST /api/apply/records/{id}/submitted）。

契约见 ``D:/rf_verify/contracts/CONTRACTS.md`` B 节与 ``contracts/core.md``。钉住：

- 前置：记录不存在/已软删 → 404；非 success → 409；
- 点一次：1 条 track（合并键去重，状态事件 user_confirmed=True）+ 1 条 hr_reply 提醒
  （+7 天）+ 1 条投递快照（幂等键 apply_task_item:{id}）；
- 连点 3 次行数不变，提醒时间不被延后；
- 已在「面试」的 track 不被降级；
- 一次性引导：开关关 → 不弹也不标记；开 → 第一次 true 并落标记，之后 false。
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from app.models.agent_task import AgentTask
from app.models.apply import (
    ITEM_STATUS_FAILED,
    ITEM_STATUS_PENDING,
    ITEM_STATUS_SUCCESS,
    TASK_KIND_APPLY,
    TASK_STATUS_COMPLETED,
    ApplyTask,
    ApplyTaskItem,
)
from app.models.profile import utcnow
from app.models.reminder import REMINDER_KIND_HR_REPLY, REMINDER_STATUS_PENDING, Reminder
from app.models.resume import ResumeRecord
from app.models.resume_delivery import ResumeDeliveryRecord
from app.models.setting import AppSetting
from app.models.tracker import (
    STATUS_INTERVIEW,
    ApplicationTrack,
    ApplicationTrackEvent,
    normalize_key,
)
from app.services.settings_service import save_agent_task_events_enabled
from app.services.submit_confirmation import FOLLOWUP_HINT_SETTING_KEY, HR_REPLY_REMINDER_DAYS

URL_TEMPLATE = "/api/apply/records/{record_id}/submitted"


def _resume(db) -> ResumeRecord:
    record = ResumeRecord(
        title="后端岗位简历",
        job_title="后端开发",
        company="示例科技",
        content={"name": "张三", "city": "杭州"},
        warnings=[],
        source="ai",
        model="test-model",
    )
    db.add(record)
    db.commit()
    return record


def _item(
    db,
    *,
    company: str = "示例科技",
    job_title: str = "后端开发",
    status: str = ITEM_STATUS_SUCCESS,
    resume: ResumeRecord | None = None,
    deleted: bool = False,
) -> ApplyTaskItem:
    task = ApplyTask(
        kind=TASK_KIND_APPLY,
        status=TASK_STATUS_COMPLETED,
        total=1,
        processed=1,
        succeeded=1 if status == ITEM_STATUS_SUCCESS else 0,
    )
    db.add(task)
    db.flush()
    item = ApplyTaskItem(
        task_id=task.id,
        company=company,
        job_title=job_title,
        status=status,
        finished_at=utcnow(),
        resume_id=resume.id if resume else None,
        resume_title=resume.title if resume else "",
    )
    if deleted:
        item.deleted_at = utcnow()
    db.add(item)
    db.commit()
    return item


def _url(item: ApplyTaskItem) -> str:
    return URL_TEMPLATE.format(record_id=item.id)


def _counts(db) -> dict[str, int]:
    db.expire_all()
    return {
        "tracks": db.query(ApplicationTrack).count(),
        "reminders": db.query(Reminder).count(),
        "deliveries": db.query(ResumeDeliveryRecord).count(),
        "events": db.query(ApplicationTrackEvent).count(),
        "tasks": db.query(AgentTask).count(),
    }


def test_click_creates_track_reminder_and_delivery_snapshot(client, db_session):
    resume = _resume(db_session)
    item = _item(db_session, resume=resume)

    response = client.post(_url(item))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["record_id"] == item.id
    assert body["created_track"] is True
    assert body["created_reminder"] is True
    # 开关默认关：巡检还没开，引导也不弹、也不标记。
    assert body["show_followup_hint"] is False
    track_id = body["track_id"]

    db_session.expire_all()
    track = db_session.get(ApplicationTrack, track_id)
    assert track is not None
    assert (track.company, track.title) == ("示例科技", "后端开发")
    assert track.company_key == normalize_key("示例科技")
    assert track.status == "applied"

    reminder = db_session.get(Reminder, body["reminder_id"])
    assert reminder is not None
    assert reminder.kind == REMINDER_KIND_HR_REPLY
    assert reminder.status == REMINDER_STATUS_PENDING
    assert reminder.track_id == track_id
    assert reminder.title == "跟进：示例科技 · 后端开发"
    expected_due = utcnow() + timedelta(days=HR_REPLY_REMINDER_DAYS)
    assert abs((reminder.remind_at - expected_due).total_seconds()) < 60
    assert datetime.fromisoformat(body["reminder_due_at"]) == reminder.remind_at

    delivery = db_session.query(ResumeDeliveryRecord).one()
    assert delivery.idempotency_key == f"apply_task_item:{item.id}"
    assert (delivery.company, delivery.job_title) == ("示例科技", "后端开发")
    assert delivery.track_id == track_id

    # record_applied(user_confirmed=True)：首个状态事件标记为用户确认。
    event = db_session.query(ApplicationTrackEvent).one()
    assert event.to_status == "applied" and event.user_confirmed is True


def test_repeat_clicks_are_idempotent(client, db_session):
    resume = _resume(db_session)
    item = _item(db_session, resume=resume)

    first = client.post(_url(item)).json()
    after_first = _counts(db_session)
    second = client.post(_url(item)).json()
    third = client.post(_url(item)).json()
    after_third = _counts(db_session)

    assert first["created_track"] is True and first["created_reminder"] is True
    assert second["created_track"] is False and second["created_reminder"] is False
    assert third["created_track"] is False and third["created_reminder"] is False
    assert second["track_id"] == third["track_id"] == first["track_id"]
    assert second["reminder_id"] == third["reminder_id"] == first["reminder_id"]
    # 行数不变：track 1 / reminder 1 / delivery 1。
    assert after_first == after_third
    assert after_third["tracks"] == 1
    assert after_third["reminders"] == 1
    assert after_third["deliveries"] == 1
    # 提醒时间不被重复点击延后。
    assert second["reminder_due_at"] == first["reminder_due_at"]


def test_existing_interview_track_is_not_downgraded(client, db_session):
    track = ApplicationTrack(
        company="示例科技",
        title="后端开发",
        company_key=normalize_key("示例科技"),
        title_key=normalize_key("后端开发"),
        status=STATUS_INTERVIEW,
    )
    db_session.add(track)
    db_session.commit()
    track_id = track.id
    item = _item(db_session, resume=_resume(db_session))

    response = client.post(_url(item))

    assert response.status_code == 200, response.text
    assert response.json()["created_track"] is False
    db_session.expire_all()
    refreshed = db_session.get(ApplicationTrack, track_id)
    assert refreshed.status == STATUS_INTERVIEW, "已在面试的进度不能被一次『我已提交』拉回已投递"


def test_pending_hr_reply_reminder_is_reused(client, db_session):
    track = ApplicationTrack(
        company="示例科技",
        title="后端开发",
        company_key=normalize_key("示例科技"),
        title_key=normalize_key("后端开发"),
    )
    db_session.add(track)
    db_session.flush()
    existing = Reminder(
        title="用户自己设的跟进提醒",
        remind_at=utcnow() + timedelta(days=2),
        kind=REMINDER_KIND_HR_REPLY,
        status=REMINDER_STATUS_PENDING,
        track_id=track.id,
    )
    db_session.add(existing)
    db_session.commit()
    original_due = existing.remind_at
    item = _item(db_session)

    body = client.post(_url(item)).json()

    assert body["created_reminder"] is False
    assert body["reminder_id"] == existing.id
    db_session.expire_all()
    assert db_session.query(Reminder).count() == 1
    assert db_session.get(Reminder, existing.id).remind_at == original_due


def test_followup_hint_is_shown_at_most_once_and_only_when_enabled(client, db_session):
    item = _item(db_session)

    # 开关默认关：不弹、不标记（等用户开了开关，第一次「我已提交」仍应看到）。
    assert client.post(_url(item)).json()["show_followup_hint"] is False
    db_session.expire_all()
    assert db_session.get(AppSetting, FOLLOWUP_HINT_SETTING_KEY) is None

    save_agent_task_events_enabled(db_session, True)
    assert client.post(_url(item)).json()["show_followup_hint"] is True
    assert client.post(_url(item)).json()["show_followup_hint"] is False

    db_session.expire_all()
    row = db_session.get(AppSetting, FOLLOWUP_HINT_SETTING_KEY)
    assert row is not None and json.loads(row.value) is True


def test_disabled_switch_after_hint_shown_keeps_it_hidden(client, db_session):
    item = _item(db_session)
    save_agent_task_events_enabled(db_session, True)
    assert client.post(_url(item)).json()["show_followup_hint"] is True

    save_agent_task_events_enabled(db_session, False)
    assert client.post(_url(item)).json()["show_followup_hint"] is False


def test_only_successful_records_can_be_marked(client, db_session):
    for status in (ITEM_STATUS_FAILED, ITEM_STATUS_PENDING):
        item = _item(db_session, status=status)
        response = client.post(_url(item))
        assert response.status_code == 409, (status, response.text)
        assert "投递成功" in response.json()["detail"]
    assert db_session.query(ApplicationTrack).count() == 0


def test_missing_or_deleted_record_returns_404(client, db_session):
    assert client.post(_url(ApplyTaskItem(id=999999))).status_code == 404

    deleted = _item(db_session, deleted=True)
    response = client.post(_url(deleted))
    assert response.status_code == 404
    assert db_session.query(ApplicationTrack).count() == 0


def test_record_without_company_is_rejected(client, db_session):
    item = _item(db_session, company="")
    response = client.post(_url(item))
    assert response.status_code == 409
    assert db_session.query(ApplicationTrack).count() == 0
