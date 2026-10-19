"""岗位解读缓存（R2）：一次模型调用，之后秒开。

为什么重要：解读是 10–60 秒、按 token 计费的调用。缓存丢掉不会报错，只会让用户
每次打开弹窗都重新等一遍、重新付一次钱——属于"坏了也没人喊"的问题，只能靠测试钉住。

覆盖：没有缓存时不发模型请求、生成后写回、内容改过标「可能过期」但结果仍可读。
"""

from __future__ import annotations

import pytest
from app.models.job import Job
from app.services.job_analysis_cache import (
    analysis_fingerprint,
    read_cached_analysis,
    store_analysis,
)

RESULT = {
    "summary": "岗位重点是病区护理与执业资格。",
    "requirements": [
        {"priority": "high", "category": "资质", "requirement": "护士执业资格证", "evidence": ""}
    ],
    "advice": [{"title": "突出临床能力", "action": "写明实习经历", "rationale": ""}],
}


@pytest.fixture
def job(client, db_session):
    created = client.post(
        "/api/jobs",
        json={
            "title": "护士",
            "company": "示例医院",
            "description": "负责病区护理工作。",
            "requirements": "持有护士执业资格证。",
        },
    )
    assert created.status_code in (200, 201), created.text
    return db_session.get(Job, created.json()["id"])


def test_without_cache_the_endpoint_reports_nothing_and_calls_no_model(client, job, monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("读取缓存不该调用模型")

    monkeypatch.setattr("app.services.job.job_analysis.generate_job_analysis", _boom)

    response = client.get(f"/api/jobs/{job.id}/analysis")

    assert response.status_code == 200
    assert response.json() == {
        "cached": False,
        "stale": False,
        "generated_at": None,
        "result": None,
    }


def test_generated_result_is_stored_and_served_from_cache(client, db_session, job):
    store_analysis(db_session, job, RESULT)

    response = client.get(f"/api/jobs/{job.id}/analysis")

    payload = response.json()
    assert payload["cached"] is True
    assert payload["stale"] is False
    assert payload["generated_at"]
    assert payload["result"]["summary"] == RESULT["summary"]


def test_changed_job_content_marks_the_cache_stale_but_keeps_the_result(client, db_session, job):
    store_analysis(db_session, job, RESULT)
    before = analysis_fingerprint(job)

    # 改一下岗位描述（用户补充了信息）。
    job.description = "负责病区护理工作，另需参与排班。"
    db_session.commit()
    db_session.refresh(job)

    assert analysis_fingerprint(job) != before
    payload = client.get(f"/api/jobs/{job.id}/analysis").json()
    assert payload["stale"] is True
    # 旧结果不丢：用户可能只是补了个标签，仍然值得看一眼。
    assert payload["result"]["summary"] == RESULT["summary"]


def test_fingerprint_ignores_surrounding_whitespace(job):
    """前后空格不算"内容变了"——否则用户在标题末尾多打一个空格就被判过期。"""
    before = analysis_fingerprint(job)
    job.description = f"  {job.description}  "
    assert analysis_fingerprint(job) == before


def test_corrupt_cache_reads_as_missing(job):
    job.analysis_cache = {"fingerprint": "x"}  # 没有 result
    assert read_cached_analysis(job) is None
