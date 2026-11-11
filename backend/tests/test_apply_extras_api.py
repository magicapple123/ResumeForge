# SPDX-License-Identifier: Apache-2.0
"""投递台补强端点（#14）：summary / stale / 一键写进度（查重）/ 话术库 / 屏蔽清单。

这 5 组端点全部挂在 ``/api/apply`` 下、实现都在 ``api/apply_extra.py``（``api/apply.py``
的行数预算只剩个位数余量）。这里钉住的是**契约形状**与四条最容易错的性质：

- ``summary`` 的 applied 只算真正动过手的（成功 + 失败），跳过的记录不算；
- ``stale`` 只收"投成功且进度仍静止"的记录，误收会让提醒变成噪音；
- 一键写进度**连调两次只建一条**（否则漏斗被自己的点击污染）；
- ``PUT /greeting-templates`` 不带 ``uses`` 时不清零计数（编辑正文不该洗掉统计）。
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from app.models.apply import (
    ITEM_STATUS_FAILED,
    ITEM_STATUS_SKIPPED,
    ITEM_STATUS_SUCCESS,
    TASK_KIND_APPLY,
    ApplyTask,
    ApplyTaskItem,
)
from app.models.job import JOB_STATUS_OPEN, Job
from app.models.profile import utcnow
from app.models.resume import ResumeRecord
from app.models.tracker import (
    CHANNEL_PLATFORM,
    SOURCE_APPLY,
    SOURCE_MANUAL,
    STATUS_APPLIED,
    STATUS_INTERVIEW,
    STATUS_OFFER,
    ApplicationTrack,
    normalize_key,
)
from app.services.apply.blocklist import load_blocklist
from app.services.apply.greeting_templates import render_greeting_template


def _job(db_session, **overrides) -> Job:
    data = {
        "title": "后端开发",
        "company": "A公司",
        "source": "BOSS直聘",
        "source_url": "https://www.zhipin.com/job/1",
        "status": JOB_STATUS_OPEN,
    }
    data.update(overrides)
    job = Job(**data)
    db_session.add(job)
    db_session.commit()
    return job


def _resume(db_session, job: Job | None = None) -> ResumeRecord:
    record = ResumeRecord(
        title="张三-后端",
        job_id=job.id if job is not None else None,
        job_title=job.title if job is not None else "后端开发",
        content={"name": "张三"},
    )
    db_session.add(record)
    db_session.commit()
    return record


def _task(db_session, *, count: int = 1) -> ApplyTask:
    task = ApplyTask(kind=TASK_KIND_APPLY, status="completed", total=count, config={})
    db_session.add(task)
    db_session.commit()
    return task


def _record(db_session, task: ApplyTask, job: Job | None = None, **overrides) -> ApplyTaskItem:
    data = {
        "task_id": task.id,
        "job_id": job.id if job is not None else None,
        "job_title": job.title if job is not None else "后端开发",
        "company": job.company if job is not None else "A公司",
        "status": ITEM_STATUS_SUCCESS,
    }
    data.update(overrides)
    item = ApplyTaskItem(**data)
    db_session.add(item)
    db_session.commit()
    return item


def _track(db_session, *, company: str, title: str, status: str, job: Job | None = None):
    track = ApplicationTrack(
        company=company,
        title=title,
        company_key=normalize_key(company),
        title_key=normalize_key(title),
        status=status,
        job_id=job.id if job is not None else None,
    )
    db_session.add(track)
    db_session.commit()
    return track


# ===== 14F summary =====


def test_summary_counts_only_records_inside_the_window(client, db_session):
    task = _task(db_session, count=4)
    now = utcnow()
    _record(db_session, task, status=ITEM_STATUS_SUCCESS, created_at=now, finished_at=now)
    _record(db_session, task, status=ITEM_STATUS_FAILED, created_at=now, finished_at=now)
    # 跳过的不算"投递"：那是"没投"，计进去会让漏斗虚高。
    _record(db_session, task, status=ITEM_STATUS_SKIPPED, created_at=now, finished_at=now)
    # 窗口外的记录不参与（默认 7 天）。
    old = now - timedelta(days=30)
    _record(db_session, task, status=ITEM_STATUS_SUCCESS, created_at=old, finished_at=old)

    body = client.get("/api/apply/summary?days=7").json()

    assert body == {"applied": 2, "succeeded": 1, "failed": 1, "interviewing": 0}


def test_summary_interviewing_counts_interview_and_beyond(client, db_session):
    task = _task(db_session)
    now = utcnow()
    _record(db_session, task, created_at=now, finished_at=now)
    _track(db_session, company="A公司", title="后端", status=STATUS_APPLIED)
    _track(db_session, company="B公司", title="后端", status=STATUS_INTERVIEW)
    _track(db_session, company="C公司", title="后端", status=STATUS_OFFER)

    body = client.get("/api/apply/summary").json()

    # 面试 / Offer 都算"在面"（rank ≥ interview），只停在"已投递"的还不算。
    assert body["interviewing"] == 2
    assert body["applied"] == 1


def test_summary_ignores_deleted_records_and_tracks(client, db_session):
    task = _task(db_session)
    now = utcnow()
    _record(db_session, task, created_at=now, finished_at=now, deleted_at=now)
    deleted_track = _track(db_session, company="D公司", title="后端", status=STATUS_INTERVIEW)
    deleted_track.deleted_at = now
    db_session.commit()

    body = client.get("/api/apply/summary").json()

    assert body == {"applied": 0, "succeeded": 0, "failed": 0, "interviewing": 0}


# ===== 14C stale =====


def test_stale_lists_only_silent_records(client, db_session):
    task = _task(db_session, count=5)
    now = utcnow()
    silent_job = _job(db_session)
    silent = _record(db_session, task, silent_job, finished_at=now - timedelta(days=8))
    _track(db_session, company="A公司", title="后端开发", status=STATUS_APPLIED, job=silent_job)

    fresh_job = _job(db_session, source_url="https://www.zhipin.com/job/2")
    _record(db_session, task, fresh_job, finished_at=now - timedelta(days=2))
    _track(
        db_session, company="A公司", title="后端开发（新）", status=STATUS_APPLIED, job=fresh_job
    )

    advanced_job = _job(db_session, source_url="https://www.zhipin.com/job/3")
    _record(db_session, task, advanced_job, finished_at=now - timedelta(days=9))
    _track(
        db_session,
        company="A公司",
        title="后端开发（已面试）",
        status=STATUS_INTERVIEW,
        job=advanced_job,
    )

    # 没有进度记录的投递不算"无回音"：系统还不知道这个目标，该做的是"更新进度"。
    _record(
        db_session,
        task,
        _job(db_session, source_url="https://www.zhipin.com/job/4"),
        finished_at=now - timedelta(days=10),
    )
    # 失败记录也没投出去，没有回音可言。
    failed_job = _job(db_session, source_url="https://www.zhipin.com/job/5")
    _record(
        db_session,
        task,
        failed_job,
        status=ITEM_STATUS_FAILED,
        finished_at=now - timedelta(days=10),
    )
    _track(
        db_session, company="A公司", title="后端开发（失败）", status=STATUS_APPLIED, job=failed_job
    )

    body = client.get("/api/apply/records/stale?days=7").json()

    assert body["count"] == 1
    assert [entry["record_id"] for entry in body["items"]] == [silent.id]
    entry = body["items"][0]
    assert set(entry) == {"record_id", "job_id", "job_title", "company", "applied_at", "days"}
    assert entry["job_id"] == silent_job.id
    assert entry["days"] >= 7
    # applied_at 是 YYYY-MM-DD（与 tracker 的日期字段同一格式）。
    assert len(entry["applied_at"]) == 10 and entry["applied_at"][4] == "-"


# ===== 14C 一键写进度（必须查重）=====


def test_track_link_is_idempotent_and_records_the_provenance(client, db_session):
    job = _job(db_session)
    resume = _resume(db_session, job)
    task = _task(db_session)
    finished = utcnow() - timedelta(days=3)
    record = _record(db_session, task, job, resume_id=resume.id, finished_at=finished)

    first = client.post(f"/api/apply/records/{record.id}/track")
    second = client.post(f"/api/apply/records/{record.id}/track")

    assert first.status_code == 200
    assert first.json()["created"] is True
    assert first.json()["stage"] == STATUS_APPLIED
    assert second.status_code == 200
    assert second.json()["created"] is False, "第二次点击不该再建一条进度"
    assert second.json()["track_id"] == first.json()["track_id"]

    rows = db_session.query(ApplicationTrack).all()
    assert len(rows) == 1
    track = rows[0]
    assert track.source == SOURCE_APPLY
    assert track.channel == CHANNEL_PLATFORM
    assert track.job_id == job.id
    assert track.resume_id == resume.id
    assert track.applied_at == finished.date().isoformat()


def test_track_link_reuses_a_manually_created_track_without_job_id(client, db_session):
    """手工建过的那条进度没有 ``job_id``，但就是同一个岗位——该复用，不是再建一条。"""
    job = _job(db_session)
    manual = _track(db_session, company=job.company, title=job.title, status=STATUS_INTERVIEW)
    manual.source = SOURCE_MANUAL
    db_session.commit()
    task = _task(db_session)
    record = _record(db_session, task, job)

    body = client.post(f"/api/apply/records/{record.id}/track").json()

    assert body["created"] is False
    assert body["track_id"] == manual.id
    assert body["stage"] == STATUS_INTERVIEW, "已有进度更靠后时不许被新建的 applied 覆盖"
    assert db_session.query(ApplicationTrack).count() == 1


def test_track_link_rejects_missing_record(client, db_session):
    response = client.post("/api/apply/records/9999/track")

    assert response.status_code == 404


# ===== 14D 话术库 =====


def test_greeting_templates_roundtrip_keeps_usage_count(client):
    body_with_vars = "您好{name}，看到贵司{company}在招{job_title}，我有三年经验想聊聊。"

    assert client.get("/api/apply/greeting-templates").json() == {"templates": []}

    saved = client.put(
        "/api/apply/greeting-templates",
        json={"templates": [{"name": "通用开场", "body": body_with_vars, "tags": ["通用"]}]},
    )
    assert saved.status_code == 200
    template = saved.json()["templates"][0]
    assert template["id"], "服务端必须补一个 id，前端靠它做套用与计数"
    assert template["uses"] == 0
    assert template["tags"] == ["通用"]

    # 套用 3 次后回写 uses（契约里没有单独的计数端点，靠 PUT 带上新值）。
    used = client.put(
        "/api/apply/greeting-templates",
        json={
            "templates": [
                {"id": template["id"], "name": "通用开场", "body": body_with_vars, "uses": 3}
            ]
        },
    )
    assert used.json()["templates"][0]["uses"] == 3

    # 再编辑正文但**省略** uses：计数必须保留，不能被清零。
    edited = client.put(
        "/api/apply/greeting-templates",
        json={
            "templates": [{"id": template["id"], "name": "通用开场（改）", "body": body_with_vars}]
        },
    )
    assert edited.json()["templates"][0]["uses"] == 3
    assert (
        client.get("/api/apply/greeting-templates").json()["templates"][0]["name"]
        == "通用开场（改）"
    )


def test_greeting_template_rendering_fills_known_vars_and_keeps_the_rest():
    body = "您好{name}，看到贵司{company}在招{job_title}，{未知}保持原样。"

    rendered = render_greeting_template(body, company="A公司", job_title="后端开发", name="张三")

    assert rendered == "您好张三，看到贵司A公司在招后端开发，{未知}保持原样。"
    # 缺值回落空串（安全字典语义），但**绝不**因为不认识的花括号而抛异常。
    assert render_greeting_template("您好{name}") == "您好"
    assert render_greeting_template("{ 不是占位符 }") == "{ 不是占位符 }"


# ===== 14E 屏蔽清单 =====


def test_blocklist_roundtrip_strips_and_dedupes(client, db_session):
    response = client.put(
        "/api/apply/blocklist",
        json={"companies": ["A公司", "  A公司  ", ""], "keywords": ["区块链", "区块链"]},
    )

    assert response.status_code == 200
    assert response.json() == {"companies": ["A公司"], "keywords": ["区块链"]}
    assert client.get("/api/apply/blocklist").json() == {
        "companies": ["A公司"],
        "keywords": ["区块链"],
    }


def test_blocklist_stores_stopwords_but_does_not_match_on_them(client, db_session):
    """停用词（「北京」这类）照样存下来给用户看，但**不参与匹配**——否则一填就屏蔽整城。"""
    client.put(
        "/api/apply/blocklist",
        json={"companies": [], "keywords": ["北京", "外包", "区块链"]},
    )

    stored = client.get("/api/apply/blocklist").json()
    assert stored["keywords"] == ["北京", "外包", "区块链"]

    active = load_blocklist(db_session)
    assert active.keyword_hit("B公司", "北京 后端开发") == ""
    assert active.keyword_hit("B公司", "区块链后端开发") == "区块链"


@pytest.mark.parametrize("payload", [{}, {"companies": [], "keywords": []}])
def test_blocklist_empty_payload_is_a_noop(client, db_session, payload):
    response = client.put("/api/apply/blocklist", json=payload)

    assert response.status_code == 200
    assert response.json() == {"companies": [], "keywords": []}
