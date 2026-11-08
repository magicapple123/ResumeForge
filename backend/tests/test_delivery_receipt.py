# SPDX-License-Identifier: Apache-2.0
"""T08 投递交付单读视图：三态矩阵、优先级、快照缺失、填充 URL 匹配、ack 幂等。

口径见计划 §10 T08 / §11：``test_state_matrix`` 表驱动覆盖三态；优先级只由
``test_waiting_human_beats_doubts`` 钉（判定顺序改反 -> 仅它红）；快照缺失/失败记录
必须可读；填充匹配不上标 unknown 而不是缺件；指纹不同不改三态；ack 幂等且不碰 track。
"""

import pytest
from app.models.apply import ApplyTask, ApplyTaskItem
from app.models.claim import RESPONSIBILITY_LED, VERIFICATION_CONFIRMED, ClaimRecord
from app.models.job import Job
from app.models.profile import utcnow
from app.models.reminder import (
    REMINDER_KIND_HR_REPLY,
    REMINDER_STATUS_DISMISSED,
    REMINDER_STATUS_PENDING,
    Reminder,
)
from app.models.resume import ResumeRecord
from app.models.resume_delivery import ResumeDeliveryRecord
from app.models.tracker import ApplicationTrack
from app.models.web_form_record import WebFormFillRecord
from app.services import trash
from app.services.delivery_receipt import (
    HUMAN_STEP_CAPTCHA_REQUIRED,
    HUMAN_STEP_CONFIRM_IN_BROWSER,
    HUMAN_STEP_FILL_REQUIRED_FIELD,
    HUMAN_STEP_LOGIN_REQUIRED,
    REASON_ARTIFACT_MISSING,
    REASON_DOUBTS_PRESENT,
    REASON_PAGE_LIMIT,
    REASON_SNAPSHOT_MISSING,
    STATE_HAS_DOUBTS,
    STATE_READY,
    STATE_WAITING_HUMAN,
    ReceiptNotFound,
    ack_receipt,
    build_receipt,
)
from app.services.resume.resume_delivery import canonical_content_sha256
from app.services.tracker import record_applied


def _content(tag="v1"):
    """形状安全的 v2 文档（不会被本地风险规则误命中）。"""
    return {"version": 2, "header": {"items": []}, "sections": [], "note": tag}


def _resume(db, *, title="投递版简历", content=None, page_limit=1):
    resume = ResumeRecord(title=title, content=content or _content(), page_limit=page_limit)
    db.add(resume)
    db.commit()
    db.refresh(resume)
    return resume


def _job(db, *, url="", title="后端工程师", company="示例科技"):
    job = Job(title=title, company=company, source_url=url)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def _item(db, *, status="success", job=None, **codes):
    task = ApplyTask(kind="apply")
    db.add(task)
    db.flush()
    item = ApplyTaskItem(
        task_id=task.id,
        job_id=job.id if job is not None else None,
        job_title=job.title if job is not None else "后端工程师",
        company=job.company if job is not None else "示例科技",
        status=status,
        **codes,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def _delivery(db, item, **overrides):
    """手工落快照：apply 路径无 artifact；export 路径才有 pages/产物（ADR-0002）。"""
    payload = overrides.pop("content", _content())
    resume = overrides.pop("resume", None)
    render_context = overrides.pop("render_context", {})
    delivery = ResumeDeliveryRecord(
        resume_id=resume.id if resume is not None else None,
        job_id=item.job_id,
        source=overrides.pop("source", "apply"),
        resume_title=resume.title if resume is not None else "",
        job_title=item.job_title,
        company=item.company,
        content=payload,
        render_context=render_context,
        content_sha256=canonical_content_sha256(payload),
        rendered_config_sha256="0" * 64,
        source_content_sha256=canonical_content_sha256(payload),
        idempotency_key=f"apply_task_item:{item.id}",
        **overrides,
    )
    db.add(delivery)
    db.commit()
    db.refresh(delivery)
    return delivery


def _fill(db, *, url, filled=0, unverified=0, failed=0, total=3, deleted=False):
    record = WebFormFillRecord(
        url=url,
        items=[{"index": i, "field": f"field_{i}", "status": "filled"} for i in range(total)],
        filled=filled,
        unverified=unverified,
        failed=failed,
        deleted_at=utcnow() if deleted else None,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _record_applied_item(db, *, job=None):
    """走真实写路径（record_applied -> freeze_delivery），拿到带 track 的 apply 快照。"""
    resume = _resume(db)
    job = job or _job(db)
    item = _item(db, job=job)
    record_applied(
        db,
        company=item.company,
        title=item.job_title,
        job_id=job.id,
        resume_id=resume.id,
        resume_title=resume.title,
        attempt_key=f"apply_task_item:{item.id}",
    )
    db.commit()
    delivery = (
        db.query(ResumeDeliveryRecord)
        .filter(ResumeDeliveryRecord.idempotency_key == f"apply_task_item:{item.id}")
        .one()
    )
    return item, delivery


# ===== 3. 快照缺失 / 失败记录：可读、不 500 =====


def test_missing_snapshot_is_waiting_human_not_error(db_session):
    item = _item(db_session, status="failed", failure_category="captcha_required")
    receipt = build_receipt(db_session, item.id)
    assert receipt.record_id == item.id
    assert receipt.state == STATE_WAITING_HUMAN
    assert receipt.state_reasons == [REASON_SNAPSHOT_MISSING, HUMAN_STEP_CAPTCHA_REQUIRED]
    assert receipt.delivery is None
    assert receipt.doubts.count == 0
    assert receipt.followup is None
    assert receipt.receipt_acked_at is None
    assert receipt.fill is not None
    assert (receipt.fill.matched, receipt.fill.unknown) == (False, True)


def test_ack_works_for_failed_record_without_snapshot(db_session):
    item = _item(db_session, status="failed", failure_category="login_required")
    receipt = ack_receipt(db_session, item.id)
    assert receipt.state == STATE_WAITING_HUMAN
    assert receipt.receipt_acked_at is not None
    assert receipt.state_reasons == [REASON_SNAPSHOT_MISSING, HUMAN_STEP_LOGIN_REQUIRED]


def test_apply_snapshot_without_artifact_can_be_ready(db_session):
    """apply 路径按 ADR-0002 本来就没有 artifact——不能因此永远卡在人手上。"""
    item, _ = _record_applied_item(db_session)
    receipt = build_receipt(db_session, item.id)
    assert receipt.state == STATE_READY
    assert receipt.state_reasons == []
    assert receipt.delivery is not None
    assert receipt.delivery.artifact_sha256 is None
    assert receipt.delivery.pages is None
    assert receipt.delivery.company == item.company
    assert receipt.delivery.content_sha256
    assert receipt.delivery.resume_changed_since_delivery is False


def test_export_snapshot_without_artifact_is_waiting_human(db_session):
    item = _item(db_session)
    _delivery(db_session, item, source="export", export_format="pdf", pages=1)
    receipt = build_receipt(db_session, item.id)
    assert receipt.state == STATE_WAITING_HUMAN
    assert receipt.state_reasons == [REASON_ARTIFACT_MISSING]
    assert receipt.delivery is not None
    assert receipt.delivery.export_format == "pdf"


# ===== 4. 有疑点：页数 / 台账疑点 =====


def test_pages_over_limit_is_has_doubts(db_session):
    item = _item(db_session)
    _delivery(
        db_session,
        item,
        source="export",
        artifact_sha256="b" * 64,
        export_format="pdf",
        pages=3,
        request_params={"format": "pdf"},
        render_context={"page_limit": 2},
    )
    receipt = build_receipt(db_session, item.id)
    assert receipt.state == STATE_HAS_DOUBTS
    assert receipt.state_reasons == [REASON_PAGE_LIMIT]
    assert receipt.delivery is not None
    assert (receipt.delivery.pages, receipt.delivery.page_limit) == (3, 2)
    assert receipt.delivery.request_params == {"format": "pdf"}


def test_fact_ledger_doubts_are_counted(db_session):
    claim = ClaimRecord(
        title="主导支付系统重构",
        source_fact="主导了支付系统重构",
        candidate_wording="主导支付系统重构，支撑日均 10 万单",
        responsibility_level=RESPONSIBILITY_LED,
        verification_status=VERIFICATION_CONFIRMED,
        boundary="",
        interview_details={},
    )
    db_session.add(claim)
    db_session.commit()
    item = _item(db_session)
    _delivery(db_session, item, render_context={"page_limit": 1})

    receipt = build_receipt(db_session, item.id)
    assert receipt.doubts.count == 1
    assert receipt.state == STATE_HAS_DOUBTS
    assert receipt.state_reasons == [REASON_DOUBTS_PRESENT]

    # 台账条目软删后不再计入（只数 live 台账）。
    trash.soft_delete(db_session, "claim", claim)
    db_session.commit()
    assert build_receipt(db_session, item.id).doubts.count == 0


# ===== 5. 填充记录：URL 精确匹配 / 匹配不上 unknown =====


def test_fill_record_matched_by_exact_url(db_session):
    job = _job(db_session, url="https://example.com/jobs/42")
    item = _item(db_session, job=job)
    _delivery(db_session, item)
    _fill(db_session, url="https://example.com/jobs/42", filled=3, total=3)
    receipt = build_receipt(db_session, item.id)
    assert receipt.fill is not None
    assert (receipt.fill.matched, receipt.fill.unknown) == (True, False)
    assert receipt.fill.url == "https://example.com/jobs/42"
    assert (receipt.fill.filled_count, receipt.fill.total_count, receipt.fill.failed_count) == (
        3,
        3,
        0,
    )
    assert receipt.state == STATE_READY


def test_fill_record_failed_fields_need_human(db_session):
    job = _job(db_session, url="https://example.com/jobs/43")
    item = _item(db_session, job=job)
    _delivery(db_session, item)
    _fill(db_session, url="https://example.com/jobs/43", filled=1, unverified=1, failed=1)
    receipt = build_receipt(db_session, item.id)
    assert receipt.fill is not None
    assert receipt.fill.total_count == 3
    assert receipt.human_steps == [HUMAN_STEP_FILL_REQUIRED_FIELD, HUMAN_STEP_CONFIRM_IN_BROWSER]
    assert receipt.state == STATE_WAITING_HUMAN


def test_fill_record_unknown_when_url_mismatch_or_deleted(db_session):
    job = _job(db_session, url="https://example.com/jobs/44")
    item = _item(db_session, job=job)
    _delivery(db_session, item)
    _fill(db_session, url="https://example.com/jobs/other", filled=5, total=5)
    receipt = build_receipt(db_session, item.id)
    assert receipt.fill is not None
    assert (receipt.fill.matched, receipt.fill.unknown) == (False, True)
    assert receipt.fill.url == "https://example.com/jobs/44"
    assert receipt.fill.filled_count == 0
    assert receipt.state == STATE_READY  # 匹配不上不是缺件，不判卡在人手上

    # 已软删的填充记录不算匹配。
    _fill(db_session, url="https://example.com/jobs/44", filled=2, total=2, deleted=True)
    assert build_receipt(db_session, item.id).fill.unknown is True


# ===== 6. 指纹不同只展示，不参与三态 =====


def test_resume_changed_since_delivery_only_displayed(db_session):
    resume = _resume(db_session, content=_content("投出时"))
    item = _item(db_session)
    _delivery(
        db_session, item, resume=resume, content=resume.content, render_context={"page_limit": 1}
    )
    assert build_receipt(db_session, item.id).delivery.resume_changed_since_delivery is False

    resume.content = _content("投出后又改了一版")
    db_session.commit()
    receipt = build_receipt(db_session, item.id)
    assert receipt.delivery is not None
    assert receipt.delivery.resume_changed_since_delivery is True
    assert receipt.state == STATE_READY  # 只展示，不参与三态
    assert receipt.state_reasons == []


# ===== 7. 跟进计划（hr_reply 提醒）=====


def test_followup_reads_pending_hr_reply_reminder(db_session):
    item, delivery = _record_applied_item(db_session)
    assert delivery.track_id is not None
    assert build_receipt(db_session, item.id).followup is None

    due = utcnow()
    reminder = Reminder(
        title="跟进：示例科技 · 后端工程师",
        remind_at=due,
        kind=REMINDER_KIND_HR_REPLY,
        status=REMINDER_STATUS_PENDING,
        track_id=delivery.track_id,
    )
    db_session.add(reminder)
    db_session.commit()
    followup = build_receipt(db_session, item.id).followup
    assert followup is not None
    assert (followup.reminder_id, followup.due_at) == (reminder.id, due)

    reminder.status = REMINDER_STATUS_DISMISSED
    db_session.commit()
    assert build_receipt(db_session, item.id).followup is None


# ===== 8. ack：幂等、只写一列、不碰 track =====


def test_ack_idempotent_and_track_untouched(db_session):
    item, delivery = _record_applied_item(db_session)
    track = db_session.get(ApplicationTrack, delivery.track_id)
    before = (track.status, track.updated_at, track.next_action_date, track.resume_id)
    first = ack_receipt(db_session, item.id)
    second = ack_receipt(db_session, item.id)
    assert first.receipt_acked_at is not None
    assert first.receipt_acked_at == second.receipt_acked_at
    assert second.state == STATE_READY

    db_session.expire_all()
    acked = db_session.get(ApplyTaskItem, item.id)
    assert acked.receipt_acked_at == first.receipt_acked_at
    assert (acked.status, acked.finished_at) == (item.status, item.finished_at)
    track_after = db_session.get(ApplicationTrack, track.id)
    assert (
        track_after.status,
        track_after.updated_at,
        track_after.next_action_date,
        track_after.resume_id,
    ) == before
    assert (
        db_session.query(ResumeDeliveryRecord)
        .filter(ResumeDeliveryRecord.idempotency_key == f"apply_task_item:{item.id}")
        .count()
        == 1
    )


# ===== 9. 404：不存在 / 已软删 =====


def test_missing_or_deleted_record_raises_not_found(db_session):
    with pytest.raises(ReceiptNotFound):
        build_receipt(db_session, 999_999)
    with pytest.raises(ReceiptNotFound):
        ack_receipt(db_session, 999_999)
    item = _item(db_session)
    _delivery(db_session, item)
    trash.soft_delete(db_session, "apply_record", item)
    db_session.commit()
    with pytest.raises(ReceiptNotFound):
        build_receipt(db_session, item.id)
