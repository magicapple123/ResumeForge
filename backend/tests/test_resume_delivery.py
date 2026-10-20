# SPDX-License-Identifier: Apache-2.0
"""投递快照（RF-17）：「哪一版投给了谁」的冻结证据与血缘。

核心验收：**投递之后 PUT/revise 改 content，快照与哈希不变**——简历记录保持原地
更新语义，投递后润色改的是 record，证据是 freeze 下来的快照。
"""
import hashlib
import json

import pytest
from app.models.job import Job
from app.models.resume import ResumeRecord
from app.models.resume_delivery import ResumeDeliveryRecord
from app.models.tracker import ApplicationTrack
from app.schemas.resume import ResumeContent
from app.schemas.tracker import TrackCreate
from app.services.tracker import create_track, record_applied, update_track
from sqlalchemy import select


def _content(name: str = "林致远") -> dict:
    return ResumeContent(
        name=name,
        phone="13800001234",
        email="lin.zhiyuan@example.com",
        city="杭州",
        job_intent="高级后端开发工程师",
        summary="十年后端开发经验。",
        skills=[{"name": "Python", "level": "精通"}],
        education=[{"school": "星辰理工大学", "major": "计算机科学与技术", "degree": "本科"}],
    ).model_dump()


def _make_resume(db, *, title: str = "后端岗位简历", job: Job | None = None) -> ResumeRecord:
    record = ResumeRecord(
        title=title,
        job_id=job.id if job else None,
        job_title=job.title if job else "后端开发",
        company=job.company if job else "示例科技",
        content=_content(),
        warnings=[],
        source="ai",
        model="test-model",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _canonical_sha(content: dict) -> str:
    return hashlib.sha256(
        json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _deliveries(db) -> list[ResumeDeliveryRecord]:
    return list(db.scalars(select(ResumeDeliveryRecord)).all())


# ===== apply 路径 =====


def test_record_applied_with_resume_freezes_snapshot(db_session):
    job = Job(title="后端开发实习生", company="示例科技")
    db_session.add(job)
    db_session.commit()
    # 简历本身就是为这个岗位生成的：快照上的岗位冗余来自简历记录。
    resume = _make_resume(db_session, job=job)

    record_applied(
        db_session,
        company="示例科技",
        title="后端开发实习生",
        job_id=job.id,
        resume_id=resume.id,
        resume_title=resume.title,
    )
    db_session.commit()

    track = db_session.query(ApplicationTrack).one()
    assert track.resume_id == resume.id
    assert track.resume_title == resume.title

    deliveries = _deliveries(db_session)
    assert len(deliveries) == 1
    delivery = deliveries[0]
    assert delivery.source == "apply"
    assert delivery.track_id == track.id
    assert delivery.resume_id == resume.id
    assert delivery.job_id == job.id
    assert delivery.resume_title == resume.title
    assert delivery.company == "示例科技"
    assert delivery.job_title == "后端开发实习生"
    assert delivery.model == "test-model"
    # 内容快照与哈希：对序列化 content 的稳定 sha256。
    assert delivery.content == resume.content
    assert delivery.content_sha256 == _canonical_sha(resume.content)
    assert len(delivery.rendered_config_sha256) == 64


def test_record_applied_without_resume_still_works(db_session):
    """旧行为兼容：不带 resume 参数的调用（识别导入等）零变化、不产生快照。"""
    record_applied(db_session, company="示例科技", title="后端开发实习生")
    db_session.commit()
    track = db_session.query(ApplicationTrack).one()
    assert track.resume_id is None
    assert track.resume_title == ""
    assert _deliveries(db_session) == []


# ===== 验收核心：投递后润色不篡改证据 =====


def test_editing_resume_after_delivery_leaves_snapshot_untouched(db_session, client):
    job = Job(title="后端开发实习生", company="示例科技")
    db_session.add(job)
    db_session.commit()
    resume = _make_resume(db_session, job=job)
    record_applied(
        db_session,
        company="示例科技",
        title="后端开发实习生",
        job_id=job.id,
        resume_id=resume.id,
        resume_title=resume.title,
    )
    db_session.commit()
    before = _deliveries(db_session)[0]
    original_sha = before.content_sha256

    # 投递之后用户润色简历：走真实的 PUT 路径。
    edited = dict(resume.content)
    edited["summary"] = "投递后润色过的summary"
    response = client.put(f"/api/resumes/{resume.id}", json=edited)
    assert response.status_code == 200

    db_session.expire_all()
    after = db_session.get(ResumeDeliveryRecord, before.id)
    assert after.content_sha256 == original_sha
    assert after.content["summary"] != "投递后润色过的summary"
    assert after.rendered_config_sha256 == before.rendered_config_sha256
    # record 本身确实变了——变的只是"当前版"，不是证据。
    db_session.refresh(resume)
    assert resume.content["summary"] == "投递后润色过的summary"


# ===== 删除后证据仍可读 =====


def test_snapshot_survives_job_and_resume_deletion(db_session):
    job = Job(title="后端开发实习生", company="示例科技")
    db_session.add(job)
    db_session.commit()
    resume = _make_resume(db_session, job=job)
    record_applied(
        db_session,
        company="示例科技",
        title="后端开发实习生",
        job_id=job.id,
        resume_id=resume.id,
        resume_title=resume.title,
    )
    db_session.commit()
    delivery_id = _deliveries(db_session)[0].id

    # 彻底删除（purge 语义就是硬删行）：外键 SET NULL，冗余快照兜底。
    db_session.delete(resume)
    db_session.delete(job)
    db_session.commit()

    delivery = db_session.get(ResumeDeliveryRecord, delivery_id)
    assert delivery.resume_id is None
    assert delivery.job_id is None
    assert delivery.resume_title == "后端岗位简历"
    assert delivery.company == "示例科技"
    assert delivery.job_title == "后端开发实习生"
    assert delivery.content["name"] == "林致远"


# ===== track 路径：手工/表单显式关联 =====


def test_manual_track_link_freezes_snapshot_once(db_session):
    resume = _make_resume(db_session)

    created = create_track(
        db_session, TrackCreate(company="示例科技", title="后端开发", resume_id=resume.id)
    )
    assert created.resume_title == resume.title
    assert [d.source for d in _deliveries(db_session)] == ["track"]
    assert _deliveries(db_session)[0].track_id == created.id

    # 反复保存（改备注）不产生新快照：同一关联只有一次血缘。
    update_track(
        db_session,
        created,
        TrackCreate(company="示例科技", title="后端开发", resume_id=resume.id, note="跟进中"),
    )
    assert len(_deliveries(db_session)) == 1

    # 换一份简历再关联：这才是新的一次投递血缘。
    other = _make_resume(db_session, title="另一版简历")
    update_track(
        db_session, created, TrackCreate(company="示例科技", title="后端开发", resume_id=other.id)
    )
    assert len(_deliveries(db_session)) == 2

    # 未关联简历的进度不产生快照。
    create_track(db_session, TrackCreate(company="另一家", title="前端开发"))
    assert len(_deliveries(db_session)) == 2


# ===== export 路径：响应头 + 显式存档 =====


@pytest.fixture
def api_resume(db_session):
    return _make_resume(db_session)


def test_export_default_does_not_freeze(db_session, client, api_resume):
    response = client.get(f"/api/resumes/{api_resume.id}/export?format=md")
    assert response.status_code == 200
    assert _deliveries(db_session) == []


def test_export_with_record_delivery_freezes_consistent_hashes(db_session, client, api_resume):
    response = client.get(
        f"/api/resumes/{api_resume.id}/export?format=md&record_delivery=true"
    )
    assert response.status_code == 200
    content_sha = response.headers["X-Content-Sha256"]
    config_sha = response.headers["X-Render-Config-Sha256"]
    assert len(content_sha) == 64 and len(config_sha) == 64

    deliveries = _deliveries(db_session)
    assert len(deliveries) == 1
    delivery = deliveries[0]
    assert delivery.source == "export"
    # 库里的证据与响应头逐字一致：用户可拿哈希核对"下载到的文件"。
    assert delivery.content_sha256 == content_sha
    assert delivery.rendered_config_sha256 == config_sha
    assert delivery.export_format == "md"
    assert delivery.filename
    assert delivery.resume_id == api_resume.id
    # export 路径的内容指纹是导出产物字节的 sha256（与 ExportDelivery 同口径）。
    assert content_sha == hashlib.sha256(response.content).hexdigest()


def test_deliveries_endpoint_returns_summaries_without_content(db_session, client, api_resume):
    from app.services.resume.resume_delivery import freeze_delivery

    freeze_delivery(db_session, record=api_resume, source="track")
    db_session.commit()

    response = client.get(f"/api/resumes/{api_resume.id}/deliveries")
    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    summary = items[0]
    assert summary["source"] == "track"
    assert summary["resume_title"] == api_resume.title
    assert len(summary["content_sha256"]) == 64
    # 刻意不返回正文全文（含照片 base64 体积大）。
    assert "content" not in summary
    assert "render_context" not in summary

    # 简历不存在 → 404，与详情接口同一口径。
    assert client.get("/api/resumes/999999/deliveries").status_code == 404
