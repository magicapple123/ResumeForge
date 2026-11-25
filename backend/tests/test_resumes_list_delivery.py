# SPDX-License-Identifier: Apache-2.0
"""简历列表的「投递过 N 次」聚合（CR-33 版本堆叠）。

口径：有岗位的简历取整个岗位的投递条数（``application_track.job_id``），同岗位的
多个版本拿到同一个数；通用简历按 ``resume_id`` 统计本人；回收站里的投递记录不计入。
这是一个**只读聚合**，不新增存储列，也不改变 ``total`` 与筛选口径。
"""

from __future__ import annotations

from app.models.job import Job
from app.models.resume import ResumeRecord
from app.models.tracker import ApplicationTrack


def _job(db_session, title: str) -> Job:
    job = Job(title=title, company="星海智能")
    db_session.add(job)
    db_session.commit()
    return job


def _resume(db_session, title: str, job_id: int | None) -> ResumeRecord:
    record = ResumeRecord(title=title, job_id=job_id, content={"name": "林舟"})
    db_session.add(record)
    db_session.commit()
    return record


def _track(
    db_session,
    *,
    job_id: int | None,
    resume_id: int | None,
    title: str = "AI 产品经理",
    deleted: bool = False,
):
    from datetime import datetime

    track = ApplicationTrack(
        company="星海智能",
        title=title,
        # 服务层会从公司名/岗位名算合并键；直接建行时必须自己填，且要唯一
        # （uq_application_track_company_title 是硬约束）。
        company_key="星海智能",
        title_key=title,
        job_id=job_id,
        resume_id=resume_id,
        deleted_at=datetime(2026, 11, 20, 10, 0, 0) if deleted else None,
    )
    db_session.add(track)
    db_session.commit()
    return track


def _briefs(client, query: str = "") -> dict[int, dict]:
    response = client.get(f"/api/resumes{query}")
    assert response.status_code == 200, response.text
    payload = response.json()
    return {item["id"]: item for item in payload["items"]}


def test_job_versions_share_the_job_delivery_count(client, db_session):
    job = _job(db_session, "AI 产品经理")
    first = _resume(db_session, "AI 产品经理-v1", job.id)
    latest = _resume(db_session, "AI 产品经理-v2", job.id)
    # 其中一条关联了 first，另一条只挂了岗位（历史数据常见）：两者都算这个岗位的投递。
    _track(db_session, job_id=job.id, resume_id=first.id, title="AI 产品经理-内推")
    _track(db_session, job_id=job.id, resume_id=None, title="AI 产品经理-官网")
    _track(db_session, job_id=job.id, resume_id=None, title="AI 产品经理-猎头")

    briefs = _briefs(client)

    assert briefs[first.id]["delivery_count"] == 3
    assert briefs[latest.id]["delivery_count"] == 3


def test_general_resume_counts_only_its_own_tracks(client, db_session):
    general = _resume(db_session, "通用简历", None)
    other = _resume(db_session, "另一个通用简历", None)
    _track(db_session, job_id=None, resume_id=general.id)

    briefs = _briefs(client)

    assert briefs[general.id]["delivery_count"] == 1
    assert briefs[other.id]["delivery_count"] == 0


def test_trashed_tracks_are_not_counted(client, db_session):
    job = _job(db_session, "数据产品经理")
    resume = _resume(db_session, "数据产品经理-v1", job.id)
    _track(db_session, job_id=job.id, resume_id=resume.id, title="数据产品经理-官网")
    _track(db_session, job_id=job.id, resume_id=resume.id, title="数据产品经理-内推", deleted=True)

    briefs = _briefs(client)

    assert briefs[resume.id]["delivery_count"] == 1


def test_delivery_count_does_not_change_filtering_or_total(client, db_session):
    job = _job(db_session, "增长产品经理")
    _resume(db_session, "增长-v1", job.id)
    _resume(db_session, "通用", None)
    _track(db_session, job_id=job.id, resume_id=None)

    response = client.get(f"/api/resumes?job_id={job.id}")
    payload = response.json()

    assert payload["total"] == 1
    assert [item["title"] for item in payload["items"]] == ["增长-v1"]
    assert payload["items"][0]["delivery_count"] == 1
