"""岗位批量适配度分析后台任务测试。"""

import asyncio
import threading
from types import SimpleNamespace

from app.models.job import JOB_STATUS_OPEN, Job
from app.models.profile import UserProfile
from app.schemas.job_match_batch import JobMatchBatchItem
from app.schemas.setting import LLMConfig
from app.services.job import job_match_background as background
from app.services.job.job_match_batch import BatchMatchCancelled, BatchMatchInput, BatchMatchRun


def _job(db_session) -> Job:
    job = Job(
        title="后端开发",
        company="示例公司",
        status=JOB_STATUS_OPEN,
        description="负责 Python 服务开发",
        requirements="熟悉 Python",
    )
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    return job


def _input(job_id: int) -> BatchMatchInput:
    return BatchMatchInput(
        job_id=job_id,
        job_title="后端开发",
        company="示例公司",
        payload={"title": "后端开发"},
        profile_text="Python",
        resume_text="",
        existing_result=None,
        existing_model="",
    )


def test_background_runner_completes_and_persists_progress(db_session, monkeypatch):
    job = _job(db_session)
    db_session.add(UserProfile(name="张示例", summary="Python 后端开发"))
    db_session.commit()
    task = background.create_job_match_background_task(db_session, [job.id], force=False)
    runner = background.JobMatchBackgroundRunner()
    completed = JobMatchBatchItem(
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        status="completed",
    )

    monkeypatch.setattr(background, "build_batch_inputs", lambda *_args, **_kwargs: [_input(job.id)])
    monkeypatch.setattr(background, "get_llm_config", lambda _db: LLMConfig())

    async def fake_run(inputs, config, *, on_item_complete=None, should_cancel=None):
        assert len(inputs) == 1
        assert config.model == ""
        assert should_cancel is not None and not should_cancel()
        if on_item_complete is not None:
            on_item_complete(completed)
        return BatchMatchRun(items=[completed], model="")

    monkeypatch.setattr(background, "run_batch_match", fake_run)
    monkeypatch.setattr(
        background,
        "persist_batch",
        lambda *_args, **_kwargs: SimpleNamespace(id=123),
    )

    runner.start(task.task_id)
    thread = runner._thread
    assert thread is not None
    thread.join(timeout=5)
    assert not thread.is_alive()

    saved = background.get_job_match_background_task(db_session, task.task_id)
    assert saved is not None
    assert saved.status == "completed"
    assert saved.completed_count == 1
    assert saved.failed_count == 0
    assert saved.batch_id == 123
    assert saved.finished_at is not None


def test_background_runner_cancel_keeps_completed_items(db_session, monkeypatch):
    job = _job(db_session)
    db_session.add(UserProfile(name="张示例", summary="Python 后端开发"))
    db_session.commit()
    task = background.create_job_match_background_task(db_session, [job.id], force=False)
    runner = background.JobMatchBackgroundRunner()
    completed = JobMatchBatchItem(
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        status="completed",
    )

    monkeypatch.setattr(background, "build_batch_inputs", lambda *_args, **_kwargs: [_input(job.id)])
    monkeypatch.setattr(background, "get_llm_config", lambda _db: LLMConfig())
    started = threading.Event()
    cancelled = threading.Event()

    async def fake_run(inputs, config, *, on_item_complete=None, should_cancel=None):
        del inputs, config
        started.set()
        if on_item_complete is not None:
            on_item_complete(completed)
        while should_cancel is None or not should_cancel():
            await asyncio.sleep(0.001)
        cancelled.set()
        raise BatchMatchCancelled([completed], "")

    monkeypatch.setattr(background, "run_batch_match", fake_run)
    monkeypatch.setattr(
        background,
        "persist_batch",
        lambda *_args, **_kwargs: SimpleNamespace(id=456),
    )

    runner.start(task.task_id)
    assert runner._thread is not None
    assert runner.is_running()
    assert started.wait(timeout=5)
    runner.cancel(task.task_id)
    thread = runner._thread
    assert thread is not None
    thread.join(timeout=5)
    assert cancelled.is_set()

    saved = background.get_job_match_background_task(db_session, task.task_id)
    assert saved is not None
    assert saved.status == "cancelled"
    assert saved.batch_id == 456
    assert "取消前完成" in saved.message


def test_orphaned_background_task_is_marked_failed(db_session):
    task = background.create_job_match_background_task(db_session, [1], force=False)
    db_session.expire_all()
    current = background.get_job_match_background_task(db_session, task.task_id)
    assert current is not None
    background._write_task(db_session, current.model_copy(update={"status": "running"}))

    background.JobMatchBackgroundRunner().fail_orphaned_task(db_session)

    saved = background.get_job_match_background_task(db_session, task.task_id)
    assert saved is not None
    assert saved.status == "failed"
    assert "上次退出" in saved.error


def test_background_api_creates_task_and_starts_runner(client, db_session, monkeypatch):
    db_session.add(UserProfile(name="张示例", summary="Python 后端开发"))
    db_session.commit()
    job = _job(db_session)
    started: list[str] = []

    class FakeRunner:
        def start(self, task_id: str) -> None:
            started.append(task_id)

    monkeypatch.setattr(
        "app.api.job_match.get_job_match_background_runner", lambda: FakeRunner()
    )

    response = client.post(
        "/api/jobs/match-batch-tasks",
        json={"job_ids": [job.id]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "pending"
    assert started == [body["task_id"]]
    assert client.get("/api/jobs/match-batch-tasks").json()[0]["task_id"] == body["task_id"]
