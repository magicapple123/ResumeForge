"""岗位广场批量适配度分析的接口与记录测试。"""
import pytest
from app.models.job import JOB_STATUS_OPEN, Job
from app.models.profile import UserProfile
from app.schemas.setting import LLMConfig


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


def test_local_batch_returns_sorted_items_and_keeps_a_history_record(client, db_session):
    db_session.add(UserProfile(name="张示例", summary="Python 后端开发"))
    db_session.commit()
    first = _job(db_session, "后端开发", "负责 Python 服务开发", "熟悉 Python；本科及以上")
    second = _job(db_session, "产品助理", "负责用户访谈与需求整理", "具备沟通能力")

    response = client.post(
        "/api/jobs/match-batches",
        json={"job_ids": [second.id, first.id, second.id]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["requested_count"] == 2
    assert body["completed_count"] == 2
    assert body["failed_count"] == 0
    assert all(item["analysis_source"] == "local" for item in body["items"])
    assert [item["rank"] for item in body["items"]] == [1, 2]
    assert body["items"][0]["reference_score"]["score"] >= body["items"][1]["reference_score"]["score"]

    history = client.get("/api/jobs/match-batches").json()
    assert len(history) == 1
    assert history[0]["id"] == body["id"]
    assert history[0]["top_score"] == body["items"][0]["reference_score"]["score"]

    detail = client.get(f"/api/jobs/match-batches/{body['id']}")
    assert detail.status_code == 200
    assert [item["job_id"] for item in detail.json()["items"]] == [
        item["job_id"] for item in body["items"]
    ]


def test_batch_requires_profile_or_resume(client, db_session):
    job = _job(db_session, "后端开发", "负责服务开发", "熟悉 Python")

    response = client.post("/api/jobs/match-batches", json={"job_ids": [job.id]})

    assert response.status_code == 400
    assert "个人资料为空" in response.json()["detail"]


def test_batch_missing_job_returns_404(client, db_session):
    db_session.add(UserProfile(name="张示例"))
    db_session.commit()

    response = client.post("/api/jobs/match-batches", json={"job_ids": [999999]})

    assert response.status_code == 404


def test_batch_history_unknown_id_returns_404(client):
    assert client.get("/api/jobs/match-batches/999999").status_code == 404


@pytest.mark.asyncio
async def test_configured_model_provider_failure_keeps_items_failed_instead_of_local_fallback(
    monkeypatch,
):
    from app.services.job import job_match_batch

    item = job_match_batch.BatchMatchInput(
        job_id=1,
        job_title="后端开发",
        company="示例公司",
        payload={"title": "后端开发", "requirements": "熟悉 Python"},
        profile_text='{"summary":"Python 后端开发"}',
        resume_text="",
        existing_result=None,
        existing_model="",
    )
    config = LLMConfig(base_url="https://model.example/v1", model="test-model")

    def fail_create_provider(_config):
        raise ValueError("invalid provider")

    monkeypatch.setattr(job_match_batch, "create_provider", fail_create_provider)

    run = await job_match_batch.run_batch_match([item], config)

    assert len(run.items) == 1
    assert run.items[0].status == "failed"
    assert "无法创建模型连接" in run.items[0].error
    assert run.items[0].result is None
