# SPDX-License-Identifier: Apache-2.0
"""T08 交付单端点级守卫（backend-core 合并后补，契约见 contracts/receipt.md §7）。

服务层三态矩阵在 tests/test_delivery_receipt.py（backend-receipt 轨道）；本文件只钉
**端点接线**：路径存在、404 映射、只读/幂等语义、ack 不碰 track，以及「我已提交」
留下的 apply 快照不会被判成 artifact_missing。
"""

from __future__ import annotations

from app.models.apply import (
    ITEM_STATUS_FAILED,
    ITEM_STATUS_SUCCESS,
    TASK_KIND_APPLY,
    TASK_STATUS_COMPLETED,
    ApplyTask,
    ApplyTaskItem,
)
from app.models.profile import utcnow
from app.models.resume import ResumeRecord
from app.models.tracker import ApplicationTrack
from app.services import trash

RECEIPT_URL = "/api/apply/records/{record_id}/receipt"
ACK_URL = "/api/apply/records/{record_id}/receipt/ack"


def _item(
    db,
    *,
    status: str = ITEM_STATUS_SUCCESS,
    company: str = "示例科技",
    job_title: str = "后端开发",
    resume: ResumeRecord | None = None,
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
    db.add(item)
    db.commit()
    return item


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


def test_receipt_missing_or_deleted_record_returns_404(client, db_session):
    missing = client.get(RECEIPT_URL.format(record_id=999999))
    assert missing.status_code == 404
    assert "不存在或已被删除" in missing.json()["detail"]

    item = _item(db_session)
    trash.soft_delete(db_session, "apply_record", item)
    db_session.commit()
    assert client.get(RECEIPT_URL.format(record_id=item.id)).status_code == 404
    assert client.post(ACK_URL.format(record_id=item.id)).status_code == 404


def test_failed_record_without_snapshot_is_waiting_human(client, db_session):
    item = _item(db_session, status=ITEM_STATUS_FAILED)

    response = client.get(RECEIPT_URL.format(record_id=item.id))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["record_id"] == item.id
    assert body["state"] == "waiting_human"
    assert "snapshot_missing" in body["state_reasons"]
    assert body["delivery"] is None
    # 匹配不上填充记录是"未知"，不是缺件：不因此改三态。
    assert body["fill"]["unknown"] is True
    db_session.expire_all()
    assert db_session.get(ApplyTaskItem, item.id).receipt_acked_at is None


def test_submitted_apply_snapshot_is_ready_not_artifact_missing(client, db_session):
    resume = _resume(db_session)
    item = _item(db_session, resume=resume)
    submitted = client.post(f"/api/apply/records/{item.id}/submitted").json()

    response = client.get(RECEIPT_URL.format(record_id=item.id))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["delivery"] is not None
    # apply 路径按定义没有导出产物：artifact_sha256=None 是如实呈现，不是缺件。
    assert body["delivery"]["artifact_sha256"] is None
    assert "artifact_missing" not in body["state_reasons"]
    assert body["state"] in {"ready", "has_doubts"}
    # T05 挂的 hr_reply 提醒出现在跟进计划里（两个端点同源）。
    assert body["followup"]["reminder_id"] == submitted["reminder_id"]


def test_ack_is_idempotent_and_does_not_touch_track(client, db_session):
    resume = _resume(db_session)
    item = _item(db_session, resume=resume)
    submitted = client.post(f"/api/apply/records/{item.id}/submitted").json()

    db_session.expire_all()
    track = db_session.get(ApplicationTrack, submitted["track_id"])
    before = (track.status, track.updated_at, track.next_action_date, track.resume_id)

    first = client.post(ACK_URL.format(record_id=item.id))
    second = client.post(ACK_URL.format(record_id=item.id))

    assert first.status_code == 200 and second.status_code == 200, second.text
    first_body = first.json()
    second_body = second.json()
    assert first_body["acked"] is True and second_body["acked"] is True
    assert first_body["receipt_acked_at"] == second_body["receipt_acked_at"]
    assert first_body["receipt_acked_at"]

    db_session.expire_all()
    stored = db_session.get(ApplyTaskItem, item.id)
    assert stored.receipt_acked_at is not None
    refreshed = db_session.get(ApplicationTrack, submitted["track_id"])
    assert (
        refreshed.status,
        refreshed.updated_at,
        refreshed.next_action_date,
        refreshed.resume_id,
    ) == before
    # 只读视图现在显示已验收时刻。
    assert (
        client.get(RECEIPT_URL.format(record_id=item.id)).json()["receipt_acked_at"]
        == first_body["receipt_acked_at"]
    )


def test_failed_record_can_be_acked(client, db_session):
    item = _item(db_session, status=ITEM_STATUS_FAILED)

    response = client.post(ACK_URL.format(record_id=item.id))

    assert response.status_code == 200, response.text
    assert response.json()["acked"] is True
    db_session.expire_all()
    assert db_session.get(ApplyTaskItem, item.id).receipt_acked_at is not None


def test_receipt_paths_are_registered_in_openapi(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/apply/records/{record_id}/receipt" in paths
    assert "/api/apply/records/{record_id}/receipt/ack" in paths
    assert "/api/apply/records/{record_id}/submitted" in paths
