"""PR-10：create_track 的原子事务——record + 首个状态事件 + 投递快照要么整体落库、
要么整体回滚，任何一步故障注入后数据库都**无半成品**，失败有可解释的 HTTP 错误。
"""

import pytest
from app.models.resume import ResumeRecord
from app.models.resume_delivery import ResumeDeliveryRecord
from app.models.tracker import ApplicationTrack, ApplicationTrackEvent
from app.schemas.tracker import TrackCreate
from app.services import tracker as tracker_service
from sqlalchemy import select


def _payload(**overrides) -> TrackCreate:
    values = {"company": "示例科技", "title": "后端开发", **overrides}
    return TrackCreate(**values)


def _make_resume(db) -> ResumeRecord:
    record = ResumeRecord(
        title="后端岗位简历", job_title="后端开发", company="示例科技", content={}
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _counts(db) -> tuple[int, int, int]:
    return (
        len(db.scalars(select(ApplicationTrack)).all()),
        len(db.scalars(select(ApplicationTrackEvent)).all()),
        len(db.scalars(select(ResumeDeliveryRecord)).all()),
    )


def test_create_track_success_writes_record_event_and_snapshot(db_session):
    """基线：三段写入在同一事务里全部落库（事件 + 快照外键引用同一批 flush 出的 id）。"""
    resume = _make_resume(db_session)
    created = tracker_service.create_track(db_session, _payload(resume_id=resume.id))
    assert _counts(db_session) == (1, 1, 1)
    event = db_session.scalars(select(ApplicationTrackEvent)).one()
    assert event.track_id == created.id
    assert event.from_status == "" and event.to_status == "applied"
    delivery = db_session.scalars(select(ResumeDeliveryRecord)).one()
    assert delivery.track_id == created.id
    # 目的地快照来自实际投递目标（track 记录），不是从简历反推。
    assert delivery.company == "示例科技"
    assert delivery.job_title == "后端开发"


def test_freeze_failure_rolls_back_track_and_event(db_session):
    """审计复现：快照冻结失败（freeze_delivery 抛异常）后，进度与事件都不得残留。"""
    resume = _make_resume(db_session)

    def exploding_freeze(*args, **kwargs):
        raise RuntimeError("freeze_delivery 注入失败")

    monkey = pytest.MonkeyPatch()
    monkey.setattr(tracker_service, "freeze_delivery", exploding_freeze)
    try:
        with pytest.raises(RuntimeError):
            tracker_service.create_track(db_session, _payload(resume_id=resume.id))
    finally:
        monkey.undo()
    db_session.rollback()
    assert _counts(db_session) == (0, 0, 0)
    # 简历还在（回滚只回滚这次写入，不动其它数据）。
    assert db_session.get(ResumeRecord, resume.id) is not None


def test_event_failure_rolls_back_track(db_session):
    """事件插入失败：进度不得残留（用户重试不会撞唯一约束）。"""

    def exploding_event(*args, **kwargs):
        raise RuntimeError("record_status_change 注入失败")

    monkey = pytest.MonkeyPatch()
    monkey.setattr(tracker_service, "record_status_change", exploding_event)
    try:
        with pytest.raises(RuntimeError):
            tracker_service.create_track(db_session, _payload())
    finally:
        monkey.undo()
    db_session.rollback()
    assert _counts(db_session) == (0, 0, 0)


def test_final_commit_failure_rolls_back_everything(db_session):
    """最终 commit 失败：record / event / 快照整体回滚，无任何业务半成品。"""

    def failing_commit():
        raise RuntimeError("commit 注入失败")

    original_commit = db_session.commit
    db_session.commit = failing_commit
    try:
        with pytest.raises(RuntimeError):
            tracker_service.create_track(db_session, _payload())
    finally:
        db_session.commit = original_commit
    db_session.rollback()
    assert _counts(db_session) == (0, 0, 0)


def test_api_create_track_failure_leaves_no_residue_and_retry_succeeds(
    db_session, client, monkeypatch
):
    """API 层：故障沿调用链冒泡为可解释的服务端错误（TestClient 默认重抛未处理异常），
    且数据库无残留——列表为空，去掉故障后重试成功（不撞唯一约束）。"""
    resume = _make_resume(db_session)

    def exploding_freeze(*args, **kwargs):
        raise RuntimeError("freeze_delivery 注入失败")

    monkeypatch.setattr(tracker_service, "freeze_delivery", exploding_freeze)
    with pytest.raises(RuntimeError, match="freeze_delivery 注入失败"):
        client.post(
            "/api/tracker",
            json={"company": "示例科技", "title": "后端开发", "resume_id": resume.id},
        )
    assert client.get("/api/tracker").json()["total"] == 0
    # 无半成品挡路：去掉故障后重试成功。
    ok = client.post("/api/tracker", json={"company": "示例科技", "title": "后端开发"})
    assert ok.status_code == 201
    assert client.get("/api/tracker").json()["total"] == 1
