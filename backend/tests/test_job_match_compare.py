# SPDX-License-Identifier: Apache-2.0
"""岗位横向对比（「AI 对比选岗」）的接口与持久化测试。"""

from app.models.job import JOB_STATUS_OPEN, Job
from app.services.profile.entry_store import upsert_entry


def _seed_profile(db_session) -> None:
    upsert_entry(db_session, "basic_info", values={"basic_info.name": "张示例"})
    upsert_entry(db_session, "summary", values={"summary.content": "Python 后端开发"})


def _job(db_session, title: str, description: str, requirements: str) -> Job:
    job = Job(
        title=title,
        company="示例公司",
        status=JOB_STATUS_OPEN,
        description=description,
        requirements=requirements,
    )
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    return job


def test_compare_mode_ranks_jobs_and_persists_the_comparison(client, db_session):
    """横向对比：本地降级也要给出名次与理由，并且能从历史回看。"""
    _seed_profile(db_session)
    first = _job(db_session, "后端开发", "负责 Python 服务开发", "熟悉 Python；本科及以上")
    second = _job(db_session, "产品助理", "负责用户访谈与需求整理", "具备沟通能力")

    response = client.post(
        "/api/jobs/match-batches",
        json={"job_ids": [first.id, second.id], "mode": "compare"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "compare"
    comparison = body["comparison"]
    assert comparison is not None
    assert comparison["summary"]
    assert sorted(item["rank"] for item in comparison["items"]) == [1, 2]
    assert [item["rank"] for item in body["items"]] == [1, 2], "批次条目没有按对比名次重排"

    history = client.get("/api/jobs/match-batches").json()
    assert history[0]["mode"] == "compare"

    detail = client.get(f"/api/jobs/match-batches/{body['id']}").json()
    assert detail["comparison"]["items"] == comparison["items"]


def test_compare_mode_requires_at_least_two_jobs(client, db_session):
    _seed_profile(db_session)
    job = _job(db_session, "后端开发", "负责服务开发", "熟悉 Python")

    response = client.post(
        "/api/jobs/match-batches",
        json={"job_ids": [job.id], "mode": "compare"},
    )

    assert response.status_code == 400
    assert "至少选择 2 个岗位" in response.json()["detail"]


def test_compare_mode_rejects_more_than_the_cap(client, db_session):
    _seed_profile(db_session)
    jobs = [_job(db_session, f"岗位{i}", "负责服务开发", "熟悉 Python") for i in range(13)]

    response = client.post(
        "/api/jobs/match-batches",
        json={"job_ids": [job.id for job in jobs], "mode": "compare"},
    )

    assert response.status_code == 400
    assert "最多" in response.json()["detail"]


def test_compare_background_task_validates_the_selection(client, db_session):
    _seed_profile(db_session)
    job = _job(db_session, "后端开发", "负责服务开发", "熟悉 Python")

    response = client.post(
        "/api/jobs/match-batch-tasks",
        json={"job_ids": [job.id], "mode": "compare"},
    )

    assert response.status_code == 400
    assert "至少选择 2 个岗位" in response.json()["detail"]
