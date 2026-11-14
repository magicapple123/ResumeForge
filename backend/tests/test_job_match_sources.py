# SPDX-License-Identifier: Apache-2.0
"""岗位匹配的缓存归属：换了简历 / 简历改了 / 来源不同，都不能命中旧结论。

三条入口（单条、批量、后台任务）必须用同一份显式选择；旧结论没有指纹时判定为过期；
批量只在来源指纹一致时复用，不能拿 A 岗位的分析结果去回答 B 岗位。
"""

import json
from types import SimpleNamespace

import pytest
from app.models.job import Job
from app.models.profile import utcnow
from app.models.resume import ResumeRecord
from app.schemas.job_match import JobMatchResult
from app.services.apply import apply_service


def _seed(db):
    job = Job(title="Agent PM", company="Example", description="Build AI agents")
    db.add(job)
    db.flush()
    first = ResumeRecord(title="Resume A", job_id=job.id, content={"summary": "Agent A"})
    second = ResumeRecord(title="Resume B", job_id=job.id, content={"summary": "Agent B"})
    db.add_all([first, second])
    db.commit()
    return job, first, second


def _create(client, job, resume, **params):
    response = client.post(
        f"/api/jobs/{job.id}/match-analysis", params={"resume_id": resume.id, **params}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_selected_resume_and_revision_invalidate_match_cache(client, db_session):
    job, first, second = _seed(db_session)
    initial = _create(client, job, first)
    assert initial["source"]["resume_id"] == first.id
    assert initial["source"]["resume_title"] == "Resume A"
    assert _create(client, job, first)["source"] == initial["source"]
    assert (
        client.get(f"/api/jobs/{job.id}/match-analysis", params={"resume_id": second.id}).json()[
            "stale"
        ]
        is True
    )
    switched = _create(client, job, second)
    assert switched["source"]["resume_id"] == second.id
    assert switched["source"]["fingerprint"] != initial["source"]["fingerprint"]
    second.content = {"summary": "Agent B changed"}
    second.revision += 1
    db_session.commit()
    changed = _create(client, job, second)
    assert changed["source"]["resume_revision"] == 1
    assert changed["source"]["content_hash"] != switched["source"]["content_hash"]
    assert (
        client.get(f"/api/jobs/{job.id}/match-analysis", params={"resume_id": second.id}).json()[
            "stale"
        ]
        is False
    )


def test_legacy_cache_is_stale_and_jd_cache_is_untouched(client, db_session):
    job, first, _second = _seed(db_session)
    job.analysis_cache = {"fingerprint": "jd-only", "result": {"summary": "keep"}}
    apply_service.persist_match(db_session, job, JobMatchResult(advice="legacy"))
    db_session.commit()
    old = client.get(f"/api/jobs/{job.id}/match-analysis").json()
    assert old["stale"] is True
    assert old["reference_score"] is None
    fresh = _create(client, job, first)
    assert fresh["source"]["resume_id"] == first.id
    db_session.refresh(job)
    assert job.analysis_cache["result"] == {"summary": "keep"}


@pytest.mark.parametrize("state", ["deleted", "draft", "missing"])
def test_explicit_resume_must_be_saved_and_live(client, db_session, state):
    job, first, _second = _seed(db_session)
    if state == "deleted":
        first.deleted_at = utcnow()
    elif state == "draft":
        first.draft = True
    db_session.commit()
    selected = first.id if state != "missing" else 999999
    response = client.post(f"/api/jobs/{job.id}/match-analysis", params={"resume_id": selected})
    assert response.status_code == 400
    assert "简历" in response.json()["detail"]


def test_batch_uses_one_selected_resume_and_only_reuses_matching_source(client, db_session):
    job, first, second = _seed(db_session)
    other = Job(title="Engineer", company="Other", description="Build Python")
    db_session.add(other)
    db_session.commit()
    payload = {"job_ids": [job.id, other.id], "resume_id": first.id}
    response = client.post("/api/jobs/match-batches", json=payload)
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert {item["result"]["source"]["resume_id"] for item in items} == {first.id}
    reused = client.post("/api/jobs/match-batches", json=payload).json()["items"]
    assert {item["analysis_source"] for item in reused} == {"existing"}
    switched = client.post(
        "/api/jobs/match-batches", json={**payload, "resume_id": second.id}
    ).json()["items"]
    assert {item["analysis_source"] for item in switched} == {"local"}
    assert {item["result"]["source"]["resume_id"] for item in switched} == {second.id}


def test_context_defaults_and_background_handler_honor_selection(db_session):
    from app.services.ai_task_handlers import handle_job_match
    from app.services.job.job_match_background import create_job_match_background_task
    from app.services.job.job_match_context import job_resume_text

    job, first, second = _seed(db_session)
    assert json.loads(job_resume_text(db_session, job))["title"] == "Resume B"
    assert json.loads(job_resume_text(db_session, job, first.id))["title"] == "Resume A"
    context = SimpleNamespace(
        payload={"job_id": job.id, "resume_id": first.id},
        session=db_session,
        set_progress=lambda *_: None,
        set_result=lambda *_: None,
        check_canceled=lambda: None,
    )
    handle_job_match(context)
    assert apply_service.latest_match(db_session, job.id).result["source"]["resume_id"] == first.id
    context.payload["resume_id"] = second.id
    handle_job_match(context)
    assert apply_service.latest_match(db_session, job.id).result["source"]["resume_id"] == second.id
    task = create_job_match_background_task(db_session, [job.id], force=False, resume_id=first.id)
    assert task.resume_id == first.id
