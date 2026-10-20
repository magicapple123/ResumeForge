# SPDX-License-Identifier: Apache-2.0
"""PR-09 可信交付账本：目的地快照来自实际投递目标、补投冻结、存档与下载同源、
原简历删除后证据仍可达、幂等键语义、旧快照兼容标注。
"""

import hashlib
import json

from app.models.job import Job
from app.models.resume import ResumeRecord
from app.models.resume_delivery import ResumeDeliveryRecord
from app.models.tracker import ApplicationTrack
from app.schemas.resume import ResumeContent
from app.schemas.tracker import TrackCreate
from app.services.resume.resume_delivery import canonical_content_sha256
from app.services.tracker import create_track, record_applied, update_track
from sqlalchemy import select


def _content(name: str = "林致远") -> dict:
    return ResumeContent(
        name=name,
        phone="13800001234",
        email="lin.zhiyuan@example.com",
        city="杭州",
        summary="十年后端开发经验。",
        skills=[{"name": "Python", "level": "精通"}],
        education=[{"school": "星辰理工大学", "major": "计算机科学与技术", "degree": "本科"}],
    ).model_dump()


def _make_resume(db, *, title: str = "通用简历", job: Job | None = None) -> ResumeRecord:
    record = ResumeRecord(
        title=title,
        job_id=job.id if job else None,
        job_title=job.title if job else "",  # 通用简历：不绑定岗位
        company=job.company if job else "",
        content=_content(),
        warnings=[],
        source="ai",
        model="test-model",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _deliveries(db) -> list[ResumeDeliveryRecord]:
    return list(db.scalars(select(ResumeDeliveryRecord)).all())


# ===== 场景 1：通用简历投给具体公司，快照目的地是实际目标 =====


def test_generic_resume_apply_snapshot_uses_actual_destination(db_session):
    """通用简历（无公司）投给 Destination Co：快照 company/job_title 取投递目标，
    不是简历上的空值/通用标题。"""
    resume = _make_resume(db_session)  # company="" job_title=""
    record_applied(
        db_session,
        company="Destination Co",
        title="资深后端工程师",
        resume_id=resume.id,
        resume_title=resume.title,
    )
    db_session.commit()
    delivery = _deliveries(db_session)[0]
    assert delivery.company == "Destination Co"
    assert delivery.job_title == "资深后端工程师"
    assert delivery.source == "apply"


def test_generic_resume_track_link_snapshot_uses_track_destination(db_session):
    """track 路径同理：通用简历关联到 A 公司的进度，快照目的地 = A 公司。"""
    resume = _make_resume(db_session)
    created = create_track(
        db_session, TrackCreate(company="A公司", title="A岗位", resume_id=resume.id)
    )
    db_session.commit()
    delivery = _deliveries(db_session)[0]
    assert delivery.company == "A公司"
    assert delivery.job_title == "A岗位"
    assert delivery.track_id == created.id

    # 同一份通用简历关联到 B 公司的进度：两个目的地各有一份快照。
    create_track(db_session, TrackCreate(company="B公司", title="B岗位", resume_id=resume.id))
    db_session.commit()
    assert {(d.company, d.job_title) for d in _deliveries(db_session)} == {
        ("A公司", "A岗位"),
        ("B公司", "B岗位"),
    }


# ===== 场景 2：已有进度后来补投（record_applied 补 resume_id）也冻结快照 =====


def test_record_applied_backfill_link_freezes_snapshot(db_session):
    """审计复现：进度已存在（比如用户先手动建了），投递台后来补上 resume_id——
    这次投递同样是真实动作，必须冻结快照。"""
    resume = _make_resume(db_session)
    # 第一次投递不带简历（旧条目形态）。
    record_applied(db_session, company="示例科技", title="后端开发")
    db_session.commit()
    assert _deliveries(db_session) == []

    # 同一岗位再次投递，这次带上了简历（补投/补录）。
    record_applied(
        db_session,
        company="示例科技",
        title="后端开发",
        resume_id=resume.id,
        resume_title=resume.title,
        attempt_key="apply_task_item:42",
    )
    db_session.commit()
    track = db_session.query(ApplicationTrack).one()
    assert track.resume_id == resume.id
    deliveries = _deliveries(db_session)
    assert len(deliveries) == 1
    assert deliveries[0].source == "apply"
    assert deliveries[0].track_id == track.id
    assert deliveries[0].company == "示例科技"
    assert deliveries[0].idempotency_key == "apply_task_item:42"


def test_update_track_backfill_link_freezes_snapshot(db_session):
    """表单路径的补投：已有进度后来关联简历（PUT resume_id 从无到有）→ 快照。"""
    resume = _make_resume(db_session)
    created = create_track(db_session, TrackCreate(company="示例科技", title="后端开发"))
    db_session.commit()
    assert _deliveries(db_session) == []
    update_track(
        db_session,
        created,
        TrackCreate(company="示例科技", title="后端开发", resume_id=resume.id),
    )
    db_session.commit()
    deliveries = _deliveries(db_session)
    assert len(deliveries) == 1
    assert deliveries[0].company == "示例科技"
    assert deliveries[0].job_title == "后端开发"


# ===== 场景 3：脱敏导出——存档与下载同源、实际参数、双指纹 =====


def test_redacted_export_archive_matches_download(db_session, client):
    """审计复现：脱敏导出 + page_limit=2 存档——存档 content 是脱敏后的内容
    （与下载产物同源），render_context/request_params 记录实际生效的参数。"""
    resume = _make_resume(db_session, title="后端岗位简历")
    response = client.post(
        f"/api/resumes/{resume.id}/export",
        json={"format": "md", "redact": True, "page_limit": 2, "record_delivery": True},
    )
    assert response.status_code == 200
    # 下载产物已脱敏。
    assert "林致远".encode() not in response.content

    delivery = _deliveries(db_session)[0]
    # 存档 content 与下载产物同源：同样是脱敏后的内容。
    assert delivery.content["name"] != "林致远"
    assert delivery.source_content_sha256 == canonical_content_sha256(delivery.content)
    # 双指纹：artifact = 导出字节哈希（与响应头一致）；content_sha256 语义不变。
    assert delivery.artifact_sha256 == hashlib.sha256(response.content).hexdigest()
    assert delivery.content_sha256 == response.headers["X-Content-Sha256"]
    assert delivery.content_sha256 == delivery.artifact_sha256
    # 实际生效参数：请求 page_limit=2 → 存档就是 2，不是记录默认值。
    assert delivery.request_params["page_limit"] == 2
    assert delivery.render_context["page_limit"] == 2
    assert delivery.request_params["redact"] is True
    assert delivery.request_params["format"] == "md"
    # 幂等键：同一份产物只留一份存档。
    assert delivery.idempotency_key == f"export:{resume.id}:{delivery.artifact_sha256}"


def test_plain_export_archive_records_default_effective_params(db_session, client):
    """不带覆盖的导出存档：request_params 如实记录"生效值"（记录默认折算），不是 None。"""
    resume = _make_resume(db_session)
    response = client.get(f"/api/resumes/{resume.id}/export?format=md&record_delivery=true")
    assert response.status_code == 200
    delivery = _deliveries(db_session)[0]
    assert delivery.request_params["page_limit"] == (resume.page_limit or 1)
    assert delivery.request_params["redact"] is False
    assert delivery.request_params["watermark"] == ""
    # 未脱敏存档：内容就是原内容。
    assert delivery.content["name"] == "林致远"


def test_duplicate_export_does_not_duplicate_archive(db_session, client):
    """幂等：同一份产物导出两次（重复点击）只留一份存档。"""
    resume = _make_resume(db_session)
    first = client.get(f"/api/resumes/{resume.id}/export?format=md&record_delivery=true")
    second = client.get(f"/api/resumes/{resume.id}/export?format=md&record_delivery=true")
    assert first.status_code == second.status_code == 200
    assert first.content == second.content
    assert len(_deliveries(db_session)) == 1


def test_reexport_after_edit_creates_new_archive(db_session, client):
    """改过内容后重导出：字节不同 → 新的存档（真实第二次交付不被吞）。"""
    resume = _make_resume(db_session)
    client.get(f"/api/resumes/{resume.id}/export?format=md&record_delivery=true")
    edited = dict(resume.content)
    edited["summary"] = "改写后的summary"
    assert client.put(f"/api/resumes/{resume.id}", json=edited).status_code == 200
    client.get(f"/api/resumes/{resume.id}/export?format=md&record_delivery=true")
    assert len(_deliveries(db_session)) == 2


# ===== 场景 4：原简历删除后，交付详情/下载仍可达 =====


def test_delivery_detail_and_download_survive_resume_deletion(db_session, client):
    """审计复现：外键 SET NULL 后数据库证据还在，但旧入口要求原记录存活——
    新的独立入口按快照 id 直接可达，且从进度也能进入对应 delivery。"""
    job = Job(title="后端开发", company="示例科技")
    db_session.add(job)
    db_session.commit()
    resume = _make_resume(db_session)
    record_applied(
        db_session,
        company="示例科技",
        title="后端开发",
        job_id=job.id,
        resume_id=resume.id,
        resume_title=resume.title,
    )
    db_session.commit()
    track_id = db_session.query(ApplicationTrack).one().id
    delivery_id = _deliveries(db_session)[0].id

    # 彻底删除简历（purge 语义硬删）。
    db_session.delete(resume)
    db_session.commit()

    # 详情独立可达：目的地/标题快照自持。
    detail = client.get(f"/api/resumes/deliveries/{delivery_id}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["company"] == "示例科技"
    assert body["resume_title"] == "通用简历"
    assert body["destination_recorded"] is True
    assert body["replayable"] is False  # apply 快照没有导出产物

    # apply/track 快照的下载：返回冻结的内容 JSON。
    download = client.get(f"/api/resumes/deliveries/{delivery_id}/download")
    assert download.status_code == 200
    payload = json.loads(download.content)
    assert payload["content"]["name"] == "林致远"
    # RR-04：哈希按**响应字节**算（返回的是带说明的 JSON 封装，不是 content 字段本身）；
    # 存档里那份内容的规范化哈希另用 X-Source-Content-Sha256 报出来。
    assert download.headers["X-Content-Sha256"] == hashlib.sha256(download.content).hexdigest()
    stored = _deliveries(db_session)[0]
    assert download.headers["X-Source-Content-Sha256"] == (
        stored.source_content_sha256 or stored.content_sha256
    )
    assert download.headers["X-Content-Sha256"] != download.headers["X-Source-Content-Sha256"]

    # 从进度进入对应 delivery。
    track_deliveries = client.get(f"/api/tracker/{track_id}/deliveries")
    assert track_deliveries.status_code == 200
    assert [item["id"] for item in track_deliveries.json()] == [delivery_id]

    # 旧入口：简历已删 → 404（口径不变），新入口才是删除后的出路。
    assert client.get("/api/resumes/999999/deliveries").status_code == 404


def test_export_snapshot_download_replays_from_archive(db_session, client):
    """export 快照：凭存档内容 + 实际参数重放导出，产物与当时下载的一致。"""
    resume = _make_resume(db_session)
    original = client.get(f"/api/resumes/{resume.id}/export?format=md&record_delivery=true")
    assert original.status_code == 200
    delivery_id = _deliveries(db_session)[0].id

    detail = client.get(f"/api/resumes/deliveries/{delivery_id}")
    assert detail.json()["replayable"] is True

    replay = client.get(f"/api/resumes/deliveries/{delivery_id}/download")
    assert replay.status_code == 200
    assert replay.headers["X-Delivery-Replay"] == "true"
    # 同内容 + 同参数的确定性渲染：重放产物与当时的下载逐字节一致。
    assert replay.content == original.content
    # RR-04：下载头必须指向**本次实际返回的字节**；历史指纹另用 X-Artifact-Sha256。
    assert replay.headers["X-Content-Sha256"] == hashlib.sha256(replay.content).hexdigest()
    stored = _deliveries(db_session)[0]
    assert replay.headers["X-Artifact-Sha256"] == stored.artifact_sha256
    # md 是确定性渲染：重放字节与存档指纹本就应当相等。
    assert replay.headers["X-Content-Sha256"] == replay.headers["X-Artifact-Sha256"]


def test_html_replay_header_tracks_actual_bytes_not_the_stored_hash(db_session, client):
    """HTML 每次渲染换 CSP nonce：重放字节与历史指纹不同，头必须按实际字节算。"""
    resume = _make_resume(db_session)
    original = client.get(f"/api/resumes/{resume.id}/export?format=html&record_delivery=true")
    assert original.status_code == 200
    delivery = _deliveries(db_session)[0]
    stored_hash = delivery.artifact_sha256
    assert stored_hash == hashlib.sha256(original.content).hexdigest()

    first = client.get(f"/api/resumes/deliveries/{delivery.id}/download")
    second = client.get(f"/api/resumes/deliveries/{delivery.id}/download")
    assert first.status_code == second.status_code == 200
    for response in (first, second):
        # 修复前这里等于 stored_hash，而返回的字节每次都不同 —— 用户永远核对不上。
        assert response.headers["X-Content-Sha256"] == hashlib.sha256(response.content).hexdigest()
        assert response.headers["X-Artifact-Sha256"] == stored_hash
        # CSP nonce 每次渲染都换：重放字节与"当初下载的那份"并不相同，
        # 响应头如实反映这件事（X-Arifact-Sha256 留着历史指纹供比对）。
        assert response.headers["X-Content-Sha256"] != stored_hash
    assert first.content != second.content


def test_legacy_snapshot_without_params_reports_not_replayable(db_session, client):
    """旧快照兼容：没有 request_params 的历史行——如实标注不可还原/目的地未记录，
    不编造数据。"""
    resume = _make_resume(db_session)
    legacy_track = ResumeDeliveryRecord(
        resume_id=resume.id,
        source="track",
        content={},
        render_context={},
        content_sha256="a" * 64,
        rendered_config_sha256="b" * 64,
    )
    # 旧 export 快照：有导出格式但没有实际请求参数——重放会错，必须 409 不可还原。
    legacy_export = ResumeDeliveryRecord(
        resume_id=resume.id,
        source="export",
        export_format="md",
        content={},
        render_context={"page_limit": 1},
        content_sha256="c" * 64,
        rendered_config_sha256="d" * 64,
    )
    db_session.add_all([legacy_track, legacy_export])
    db_session.commit()
    detail = client.get(f"/api/resumes/deliveries/{legacy_track.id}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["request_params"] is None
    assert body["replayable"] is False
    assert body["destination_recorded"] is False  # 旧快照没有目的地字段
    # track 快照没有导出产物：内容 JSON 下载仍可达（证据本身是完整的）。
    download = client.get(f"/api/resumes/deliveries/{legacy_track.id}/download")
    assert download.status_code == 200
    # 旧 export 快照缺参数：409 不可还原，不假装能重放出同一份文件。
    replay = client.get(f"/api/resumes/deliveries/{legacy_export.id}/download")
    assert replay.status_code == 409


def test_missing_delivery_returns_404(db_session, client):
    assert client.get("/api/resumes/deliveries/999999").status_code == 404
    assert client.get("/api/resumes/deliveries/999999/download").status_code == 404
    assert client.get("/api/tracker/999999/deliveries").status_code == 404


# ===== 场景 5：幂等键——同一次动作重放不重复记账，真实重投不被吞 =====


def test_apply_attempt_key_replay_does_not_duplicate(db_session):
    """同一 attempt_key 重放（任务重试）：不重复冻结快照。"""
    resume = _make_resume(db_session)
    for _ in range(2):
        record_applied(
            db_session,
            company="示例科技",
            title="后端开发",
            resume_id=resume.id,
            resume_title=resume.title,
            attempt_key="apply_task_item:7",
        )
        db_session.commit()
    assert len(db_session.query(ApplicationTrack).all()) == 1
    assert len(_deliveries(db_session)) == 1


def test_second_real_attempt_not_merged_away(db_session):
    """真实第二次投递（不同条目 → 不同 attempt_key）：快照不被 company+title 合并吞掉。"""
    resume = _make_resume(db_session)
    record_applied(
        db_session,
        company="示例科技",
        title="后端开发",
        resume_id=resume.id,
        resume_title=resume.title,
        attempt_key="apply_task_item:11",
    )
    db_session.commit()
    record_applied(
        db_session,
        company="示例科技",
        title="后端开发",
        resume_id=resume.id,
        resume_title=resume.title,
        attempt_key="apply_task_item:12",
    )
    db_session.commit()
    # 进度仍是一条（合并键语义不变），但两次真实投递各有一份证据。
    assert db_session.query(ApplicationTrack).count() == 1
    assert len(_deliveries(db_session)) == 2
    assert {d.idempotency_key for d in _deliveries(db_session)} == {
        "apply_task_item:11",
        "apply_task_item:12",
    }
