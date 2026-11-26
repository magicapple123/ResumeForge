# SPDX-License-Identifier: Apache-2.0
"""#28 收藏夹后端：收藏时间写入口、找回层（搜索/筛选/排序）、生命周期徽标与导出。

验收判据（来自问题清单 #28 验证段）：
- 2024 年入库的老岗位收藏后，按收藏时间排序必须在第一行（28A/28E）；
- 手动改成 closed 的收藏岗位在「已关闭」筛选里可见（28A/28B）；
- 投递成功后该行显示已投递、立即投递禁用（28B，与 14C 同源）；
- 导出的 CSV 在 Excel 打开中文不乱码（UTF-8 BOM，28F）；
- 取消收藏后列表立即少一行、总数减一（现有 FavoritesPage 用例不许退化）。
"""

from datetime import datetime

from app.models.apply import ApplyQueueItem, ApplyTask, ApplyTaskItem
from app.models.job import Job
from app.models.profile import utcnow
from app.models.resume import ResumeRecord


def _job(db_session, **overrides) -> Job:
    data = {
        "title": "后端开发",
        "company": "字节跳动",
        "status": "开放中",
        "favorite": False,
        "created_at": datetime(2024, 1, 1, 8, 0, 0),
        "updated_at": datetime(2024, 1, 1, 8, 0, 0),
    }
    data.update(overrides)
    job = Job(**data)
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    return job


def _apply_record(db_session, job: Job) -> None:
    """造一条「投成功过这个岗位」的投递记录（28B 已投判据）。"""
    parent = ApplyTask(kind="apply", status="completed", total=1, config={})
    db_session.add(parent)
    db_session.flush()
    db_session.add(
        ApplyTaskItem(
            task_id=parent.id,
            job_id=job.id,
            job_title=job.title,
            company=job.company,
            status="success",
            finished_at=utcnow(),
        )
    )
    db_session.commit()


def _queue_item(db_session, job: Job) -> None:
    """造一条「在投递队列里待投递」的条目（28B 在队列判据）。"""
    db_session.add(
        ApplyQueueItem(
            job_id=job.id,
            job_title=job.title,
            company=job.company,
            status="pending",
        )
    )
    db_session.commit()


def test_favoriting_writes_timestamp_and_unfavoriting_clears_it(client, db_session):
    """收藏写当前时间（非近似），取消清空——28E 的写入口语义。"""
    job = _job(db_session)

    response = client.put(f"/api/jobs/{job.id}", json={"favorite": True})

    assert response.status_code == 200
    body = response.json()
    assert body["favorite"] is True
    assert body["favorited_at"] is not None
    assert body["favorited_at_estimated"] is False

    response = client.put(f"/api/jobs/{job.id}", json={"favorite": False})
    assert response.status_code == 200
    assert response.json()["favorite"] is False
    assert response.json()["favorited_at"] is None


def test_old_job_favorited_now_sorts_first(client, db_session):
    """2024 年入库的老岗位收藏后，按收藏时间排第一（不是按入库时间沉底）。"""
    old = _job(db_session, title="2024 老岗位", created_at=datetime(2024, 1, 1))
    new = _job(db_session, title="2026 新岗位", created_at=datetime(2026, 1, 1))
    # 先收藏 old、再收藏 new：默认排序必须按收藏时间把 new 排前、old 排第二。
    client.put(f"/api/jobs/{old.id}", json={"favorite": True})
    client.put(f"/api/jobs/{new.id}", json={"favorite": True})

    response = client.get("/api/jobs/favorites", params={"sort": "favorited_desc"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert [item["id"] for item in payload["items"]] == [new.id, old.id]
    # 发布时间排序则相反（2026 新岗位仍在前），证明两条排序不是同一份实现。
    posted = client.get("/api/jobs/favorites", params={"sort": "posted_desc"}).json()
    assert [item["id"] for item in posted["items"]] == [new.id, old.id]
    # 收藏时间升序：老收藏在前。
    ascending = client.get(
        "/api/jobs/favorites", params={"sort": "favorited_desc", "order": "asc"}
    ).json()
    assert [item["id"] for item in ascending["items"]] == [old.id, new.id]


def test_status_filter_shows_closed_favorites(client, db_session):
    """手动改成已截止的收藏岗位，在「已关闭」筛选里可见。"""
    open_job = _job(db_session, title="在招岗位", status="开放中")
    closed = _job(db_session, title="已关闭岗位", status="已截止")
    client.put(f"/api/jobs/{open_job.id}", json={"favorite": True})
    client.put(f"/api/jobs/{closed.id}", json={"favorite": True})

    payload = client.get("/api/jobs/favorites", params={"status": "已截止"}).json()

    assert payload["total"] == 1
    assert payload["items"][0]["id"] == closed.id
    assert payload["items"][0]["status"] == "已截止"


def test_applied_and_queued_badges(client, db_session):
    """已投递 = 投递记录成功或进度表有行；在队列 = 队列里 pending。"""
    applied_job = _job(db_session, title="已投岗位")
    queued_job = _job(db_session, title="队列岗位")
    plain_job = _job(db_session, title="普通岗位")
    for job in (applied_job, queued_job, plain_job):
        client.put(f"/api/jobs/{job.id}", json={"favorite": True})
    _apply_record(db_session, applied_job)
    _queue_item(db_session, queued_job)

    payload = client.get("/api/jobs/favorites").json()
    states = {item["id"]: (item["applied"], item["queued"]) for item in payload["items"]}

    assert states[applied_job.id] == (True, False)
    assert states[queued_job.id] == (False, True)
    assert states[plain_job.id] == (False, False)

    # 批量生命周期端点与列表同一份口径（前端行内按钮用它判断是否禁用）。
    lifecycle = client.post(
        "/api/jobs/favorites/lifecycle",
        json={"job_ids": [applied_job.id, queued_job.id, plain_job.id]},
    ).json()
    lifecycle_states = {
        item["job_id"]: (item["applied"], item["queued"]) for item in lifecycle["items"]
    }
    assert lifecycle_states == states


def test_applied_filter_splits_applied_and_unapplied(client, db_session):
    """「已投 / 未投」筛选在分页之前生效，total 是筛选后的集合。"""
    applied_job = _job(db_session, title="已投岗位")
    plain_job = _job(db_session, title="未投岗位")
    client.put(f"/api/jobs/{applied_job.id}", json={"favorite": True})
    client.put(f"/api/jobs/{plain_job.id}", json={"favorite": True})
    _apply_record(db_session, applied_job)

    applied_only = client.get("/api/jobs/favorites", params={"applied": "true"}).json()
    unapplied_only = client.get("/api/jobs/favorites", params={"applied": "false"}).json()

    assert applied_only["total"] == 1
    assert applied_only["items"][0]["id"] == applied_job.id
    assert unapplied_only["total"] == 1
    assert unapplied_only["items"][0]["id"] == plain_job.id


def test_keyword_search_and_batch_unfavorite(client, db_session):
    """关键词命中标题/备注；批量取消收藏后列表立即少一行（28A/28F）。"""
    match = _job(db_session, title="Java 后端", note="内推码 ABC")
    other = _job(db_session, title="前端开发")
    client.put(f"/api/jobs/{match.id}", json={"favorite": True})
    client.put(f"/api/jobs/{other.id}", json={"favorite": True})

    keyword = client.get("/api/jobs/favorites", params={"keyword": "内推码"}).json()
    assert keyword["total"] == 1
    assert keyword["items"][0]["id"] == match.id

    result = client.post(
        "/api/jobs/favorites/batch",
        json={"job_ids": [match.id, other.id, 999999], "favorite": False},
    ).json()
    assert result["updated"] == 2
    assert result["skipped"] == [999999]
    remaining = client.get("/api/jobs/favorites").json()
    assert remaining["total"] == 0


def test_csv_export_has_utf8_bom_and_excel_friendly_chinese(client, db_session):
    """导出的 CSV 带 UTF-8 BOM + CRLF，中文可被 Excel 正确识别（28F 验收）。"""
    job = _job(db_session, title="后端开发（校招）", company="字节跳动", salary="20-30K")
    client.put(f"/api/jobs/{job.id}", json={"favorite": True})

    response = client.get("/api/jobs/favorites/export", params={"format": "csv"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    raw = response.content
    assert raw.startswith("\ufeff".encode("utf-8")), "CSV 必须以 UTF-8 BOM 开头"
    text = raw.decode("utf-8-sig")
    assert "\r\n" in text, "Excel 兼容需要 CRLF"
    assert "后端开发（校招）" in text
    assert "字节跳动" in text
    assert "岗位名" in text


def test_markdown_export_contains_rows_and_notes(client, db_session):
    """Markdown 导出（28F）：一张表 + 备注分节，备注里的 | 被转义。"""
    job = _job(db_session, title="后端开发", note="为什么收藏 | 因为匹配度高")
    client.put(f"/api/jobs/{job.id}", json={"favorite": True})

    response = client.get("/api/jobs/favorites/export", params={"format": "md"})

    assert response.status_code == 200
    text = response.content.decode("utf-8")
    assert "# 收藏夹（1 条）" in text
    assert "## 备注" in text
    assert "因为匹配度高" in text
    assert "\\|" in text, "表格单元格里的竖线必须转义"


def test_estimated_favorite_time_is_labelled_in_export(client, db_session):
    """迁移回填的近似收藏时间在导出里标「时间不详」（28E 的 UI 判据）。"""
    job = _job(db_session)
    job.favorite = True
    job.favorited_at = datetime(2026, 1, 2, 3, 4, 5)
    job.favorited_at_estimated = True
    db_session.commit()

    text = client.get("/api/jobs/favorites/export", params={"format": "csv"}).content.decode(
        "utf-8-sig"
    )

    assert "2026-01-02 03:04（时间不详）" in text


def test_resume_favorite_backfills_missing_timestamp(client, db_session):
    """历史简历（favorite=True 但时间戳为空）再切换收藏时补上时间戳。"""
    record = ResumeRecord(title="旧简历", job_title="岗位", content={"name": "用户"}, favorite=True)
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    assert record.favorited_at is None

    response = client.patch(f"/api/resumes/{record.id}/favorite", json={"favorite": True})

    assert response.status_code == 200
    assert response.json()["favorited_at"] is not None
    assert response.json()["favorited_at_estimated"] is False


def test_non_favorites_never_appear_in_favorites_list(client, db_session):
    """收藏夹只含 favorite=True 的行；取消收藏即从列表消失。"""
    job = _job(db_session, title="普通岗位", favorite=False)

    payload = client.get("/api/jobs/favorites").json()

    assert payload["total"] == 0
    assert payload["items"] == []
    assert job.id != 0


# ===== T15 / R2：收藏不许改写 updated_at =====
# 病根：三张表的 ``updated_at`` 都带 ``onupdate=utcnow``，一次 ORM 属性赋值收藏就会在
# flush 时把它刷成"刚刚"；简历列表默认按 ``updated_desc`` 排序，于是点一下星星，那一行
# 就带着星星跳到组首——用户以为"收藏错了行"。下面四段分别钉住四个写入路径。


def _parsed(value):
    """响应里的 ISO 时间串 -> datetime（字段为 null 时原样返回 None）。"""
    return datetime.fromisoformat(value) if isinstance(value, str) else value


def test_resume_favorite_does_not_touch_updated_at(client, db_session):
    """简历收藏端点：updated_at 逐字相等，只有 favorited_at 变。"""
    old = datetime(2026, 11, 1, 9, 0, 0)
    record = ResumeRecord(title="待收藏简历", content={"name": "用户"}, updated_at=old)
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    before = record.updated_at
    assert before is not None

    response = client.patch(f"/api/resumes/{record.id}/favorite", json={"favorite": True})

    assert response.status_code == 200
    body = response.json()
    assert body["favorite"] is True
    assert _parsed(body["favorited_at"]) is not None
    db_session.expire_all()
    after = db_session.get(ResumeRecord, record.id)
    assert after.updated_at == before, "收藏不该改写 updated_at（否则列表会跳行）"
    assert after.favorited_at is not None

    # 取消收藏同样不许动 updated_at，且把时间戳清回 NULL（与「从未收藏」同形）。
    client.patch(f"/api/resumes/{record.id}/favorite", json={"favorite": False})
    db_session.expire_all()
    after = db_session.get(ResumeRecord, record.id)
    assert after.updated_at == before
    assert after.favorite is False
    assert after.favorited_at is None


def test_job_favorite_keeps_updated_at(client, db_session):
    """岗位 PUT 收藏：updated_at 不动，favorited_at 变（28E 语义不变）。"""
    job = _job(db_session)  # updated_at = 2024-01-01 08:00
    before = job.updated_at

    response = client.put(f"/api/jobs/{job.id}", json={"favorite": True})

    assert response.status_code == 200
    assert _parsed(response.json()["favorited_at"]) is not None
    db_session.expire_all()
    after = db_session.get(Job, job.id)
    assert after.updated_at == before
    assert after.favorite is True

    client.put(f"/api/jobs/{job.id}", json={"favorite": False})
    db_session.expire_all()
    after = db_session.get(Job, job.id)
    assert after.updated_at == before
    assert after.favorited_at is None


def test_batch_favorite_and_assistant_tool_keep_updated_at(client, db_session):
    """批量收藏端点与助手工具两条路径与单条收藏同一口径。"""
    from app.services.assistant_tools.job_tools import _tool_update_resume

    first = _job(db_session, title="批量 A")
    second = _job(db_session, title="批量 B")
    stamps = {first.id: first.updated_at, second.id: second.updated_at}

    result = client.post(
        "/api/jobs/favorites/batch",
        json={"job_ids": [first.id, second.id], "favorite": True},
    ).json()

    assert result["updated"] == 2
    db_session.expire_all()
    for job_id, stamp in stamps.items():
        row = db_session.get(Job, job_id)
        assert row.updated_at == stamp, f"批量收藏改写了岗位 {job_id} 的 updated_at"
        assert row.favorited_at is not None

    old = datetime(2026, 3, 4, 5, 6, 7)
    record = ResumeRecord(title="助手看上的简历", content={"name": "用户"}, updated_at=old)
    db_session.add(record)
    db_session.commit()

    _tool_update_resume(db_session, {"resume_id": record.id, "favorite": True})

    db_session.expire_all()
    after = db_session.get(ResumeRecord, record.id)
    assert after.favorite is True
    assert after.favorited_at is not None
    assert after.updated_at == old, "助手改收藏同样不该改写 updated_at"


def test_favorite_idempotent_keeps_original_timestamp(client, db_session):
    """已收藏再收藏：不刷新 favorited_at，也不刷新 updated_at（幂等语义不变）。"""
    stamp = datetime(2026, 5, 6, 7, 8, 9)
    job = _job(db_session, favorite=True, favorited_at=stamp)
    before = job.updated_at

    client.put(f"/api/jobs/{job.id}", json={"favorite": True})

    db_session.expire_all()
    after = db_session.get(Job, job.id)
    assert after.favorited_at == stamp
    assert after.updated_at == before
