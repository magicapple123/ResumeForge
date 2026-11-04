# SPDX-License-Identifier: Apache-2.0
"""岗位批量适配度分析后台任务测试。"""

import asyncio
import threading
import time
from types import SimpleNamespace

from app.database import SessionLocal
from app.models.job import JOB_STATUS_OPEN, Job
from app.schemas.job_match_batch import JobMatchBatchItem
from app.schemas.setting import LLMConfig
from app.services.job import job_match_background as background
from app.services.job.job_match_batch import BatchMatchCancelled, BatchMatchInput, BatchMatchRun
from app.services.profile.entry_store import upsert_entry


def _seed_profile(db_session) -> None:
    """资料自 F2 起落在新模型：批量匹配读全量新资料（旧 user_profile 已退役）。"""
    upsert_entry(db_session, "basic_info", values={"basic_info.name": "张示例"})
    upsert_entry(db_session, "summary", values={"summary.content": "Python 后端开发"})


def _job(db_session, title: str = "后端开发") -> Job:
    job = Job(
        title=title,
        company="示例公司",
        status=JOB_STATUS_OPEN,
        description="负责 Python 服务开发",
        requirements="熟悉 Python",
    )
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    return job


def _input(job_id: int, title: str = "后端开发") -> BatchMatchInput:
    return BatchMatchInput(
        job_id=job_id,
        job_title=title,
        company="示例公司",
        payload={"title": title},
        profile_text="Python",
        resume_text="",
        existing_result=None,
        existing_model="",
    )


def test_background_runner_completes_and_persists_progress(db_session, monkeypatch):
    job = _job(db_session)
    _seed_profile(db_session)
    task = background.create_job_match_background_task(db_session, [job.id], force=False)
    runner = background.JobMatchBackgroundRunner()
    completed = JobMatchBatchItem(
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        status="completed",
    )

    monkeypatch.setattr(
        background, "build_batch_inputs", lambda *_args, **_kwargs: [_input(job.id)]
    )
    monkeypatch.setattr(background, "get_llm_config", lambda _db: LLMConfig())

    async def fake_run(
        inputs, config, *, on_item_start=None, on_item_complete=None, should_cancel=None
    ):
        assert len(inputs) == 1
        assert config.model == ""
        assert should_cancel is not None and not should_cancel()
        # 先"开始"再"完成"：真实执行顺序，缺失 start 回调就是问题 13 的根因。
        if on_item_start is not None:
            on_item_start(_input(job.id))
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
    """取消打断**正在进行**的模型调用，已完成项照样落库。

    这里刻意把 mock 写成"不查 should_cancel、一直 await"的形态：真实用户按取消时，
    工作线程正是卡在一次模型请求的 await 上，协作式回调在那里根本轮不到执行。
    旧实现等到这次调用自己返回才收敛（界面一直「已处理 0/3」），新实现必须当场打断。
    """
    job = _job(db_session)
    _seed_profile(db_session)
    task = background.create_job_match_background_task(db_session, [job.id], force=False)
    runner = background.JobMatchBackgroundRunner()
    completed = JobMatchBatchItem(
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        status="completed",
    )

    monkeypatch.setattr(
        background, "build_batch_inputs", lambda *_args, **_kwargs: [_input(job.id)]
    )
    monkeypatch.setattr(background, "get_llm_config", lambda _db: LLMConfig())
    started = threading.Event()
    cancelled = threading.Event()

    async def fake_run(
        inputs, config, *, on_item_start=None, on_item_complete=None, should_cancel=None
    ):
        del config, should_cancel
        if on_item_start is not None:
            on_item_start(inputs[0])
        if on_item_complete is not None:
            on_item_complete(completed)
        started.set()
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            cancelled.set()
            raise

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
    started_at = time.monotonic()
    runner.cancel(task.task_id)
    thread = runner._thread
    assert thread is not None
    thread.join(timeout=5)
    elapsed = time.monotonic() - started_at
    assert cancelled.is_set(), "进行中的模型调用必须被真正打断，而不是等它跑完"
    assert elapsed < 5, f"取消收敛超过 5 秒：{elapsed:.2f}s"

    saved = background.get_job_match_background_task(db_session, task.task_id)
    assert saved is not None
    assert saved.status == "cancelled"
    assert saved.batch_id == 456
    assert saved.completed_count == 1, "取消前完成的那一项结果必须保留"
    assert saved.current_job_id is None
    assert "取消前完成" in saved.message


def test_background_runner_cancel_between_items_keeps_items(db_session, monkeypatch):
    """两个岗位之间收到取消（协作式退出）：已完成项照旧落库，状态落 cancelled。"""
    job = _job(db_session)
    _seed_profile(db_session)
    task = background.create_job_match_background_task(db_session, [job.id], force=False)
    runner = background.JobMatchBackgroundRunner()
    completed = JobMatchBatchItem(
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        status="completed",
    )

    monkeypatch.setattr(
        background, "build_batch_inputs", lambda *_args, **_kwargs: [_input(job.id)]
    )
    monkeypatch.setattr(background, "get_llm_config", lambda _db: LLMConfig())

    async def fake_run(
        inputs, config, *, on_item_start=None, on_item_complete=None, should_cancel=None
    ):
        del config, should_cancel
        # 取消信号在手，但批次是**在下一个岗位开始前**才发现它的。
        if on_item_complete is not None:
            on_item_complete(completed)
        raise BatchMatchCancelled([completed], "")

    monkeypatch.setattr(background, "run_batch_match", fake_run)
    monkeypatch.setattr(
        background,
        "persist_batch",
        lambda *_args, **_kwargs: SimpleNamespace(id=457),
    )

    runner.start(task.task_id)
    thread = runner._thread
    assert thread is not None
    thread.join(timeout=5)

    saved = background.get_job_match_background_task(db_session, task.task_id)
    assert saved is not None
    assert saved.status == "cancelled"
    assert saved.batch_id == 457


def test_background_runner_cancel_without_any_item_leaves_no_empty_batch(db_session, monkeypatch):
    """一项都没跑完就取消：状态要有终态，但历史里不能多出一条 0/3 的空批次。"""
    job = _job(db_session)
    _seed_profile(db_session)
    task = background.create_job_match_background_task(db_session, [job.id], force=False)
    runner = background.JobMatchBackgroundRunner()
    started = threading.Event()
    persisted: list[object] = []

    monkeypatch.setattr(
        background, "build_batch_inputs", lambda *_args, **_kwargs: [_input(job.id)]
    )
    monkeypatch.setattr(background, "get_llm_config", lambda _db: LLMConfig())
    monkeypatch.setattr(
        background,
        "persist_batch",
        lambda *_args, **_kwargs: persisted.append(1) or SimpleNamespace(id=999),
    )

    async def fake_run(*_args, **_kwargs):
        started.set()
        await asyncio.sleep(30)

    monkeypatch.setattr(background, "run_batch_match", fake_run)

    runner.start(task.task_id)
    assert started.wait(timeout=5)
    runner.cancel(task.task_id)
    thread = runner._thread
    assert thread is not None
    thread.join(timeout=5)

    saved = background.get_job_match_background_task(db_session, task.task_id)
    assert saved is not None
    assert saved.status == "cancelled"
    assert saved.batch_id is None
    assert persisted == []


def test_background_runner_cancel_during_comparison_keeps_per_job_results(db_session, monkeypatch):
    """对比（N+1 次调用）中途取消：逐岗结论已经拿到，必须照样落库。"""
    job = _job(db_session)
    _seed_profile(db_session)
    task = background.create_job_match_background_task(
        db_session, [job.id], force=False, mode="compare"
    )
    runner = background.JobMatchBackgroundRunner()
    completed = JobMatchBatchItem(
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        status="completed",
    )
    comparison_started = threading.Event()

    monkeypatch.setattr(
        background, "build_batch_inputs", lambda *_args, **_kwargs: [_input(job.id)]
    )
    monkeypatch.setattr(background, "get_llm_config", lambda _db: LLMConfig())
    monkeypatch.setattr(
        background,
        "persist_batch",
        lambda *_args, **_kwargs: SimpleNamespace(id=460),
    )

    async def fake_match(inputs, config, *, on_item_start=None, on_item_complete=None, **_):
        del inputs, config
        if on_item_complete is not None:
            on_item_complete(completed)
        return BatchMatchRun(items=[completed], model="")

    async def fake_comparison(*_args, **_kwargs):
        comparison_started.set()
        await asyncio.sleep(30)

    monkeypatch.setattr(background, "run_batch_match", fake_match)
    monkeypatch.setattr(background, "run_batch_comparison", fake_comparison)

    runner.start(task.task_id)
    assert comparison_started.wait(timeout=5)
    runner.cancel(task.task_id)
    thread = runner._thread
    assert thread is not None
    thread.join(timeout=5)

    saved = background.get_job_match_background_task(db_session, task.task_id)
    assert saved is not None
    assert saved.status == "cancelled"
    assert saved.batch_id == 460
    assert saved.completed_count == 1
    assert saved.completed_count == 1


def test_background_runner_runs_next_task_normally_after_cancel(db_session, monkeypatch):
    """取消状态不得泄漏到下一次任务：新任务必须能正常跑完。"""
    job = _job(db_session)
    _seed_profile(db_session)
    runner = background.JobMatchBackgroundRunner()
    completed = JobMatchBatchItem(
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        status="completed",
    )

    monkeypatch.setattr(
        background, "build_batch_inputs", lambda *_args, **_kwargs: [_input(job.id)]
    )
    monkeypatch.setattr(background, "get_llm_config", lambda _db: LLMConfig())
    monkeypatch.setattr(
        background,
        "persist_batch",
        lambda *_args, **_kwargs: SimpleNamespace(id=458),
    )
    started = threading.Event()

    async def hanging_run(
        inputs, config, *, on_item_start=None, on_item_complete=None, should_cancel=None
    ):
        del inputs, config, on_item_start, on_item_complete, should_cancel
        started.set()
        await asyncio.sleep(30)

    monkeypatch.setattr(background, "run_batch_match", hanging_run)
    first = background.create_job_match_background_task(db_session, [job.id], force=False)
    runner.start(first.task_id)
    assert started.wait(timeout=5)
    runner.cancel(first.task_id)
    first_thread = runner._thread
    assert first_thread is not None
    first_thread.join(timeout=5)
    saved_first = background.get_job_match_background_task(db_session, first.task_id)
    assert saved_first is not None
    assert saved_first.status == "cancelled"

    async def completing_run(
        inputs, config, *, on_item_start=None, on_item_complete=None, should_cancel=None
    ):
        del config
        assert should_cancel is not None and not should_cancel(), "上一次的取消不得带进新任务"
        if on_item_complete is not None:
            on_item_complete(completed)
        return BatchMatchRun(items=[completed], model="")

    monkeypatch.setattr(background, "run_batch_match", completing_run)
    second = background.create_job_match_background_task(db_session, [job.id], force=False)
    runner.start(second.task_id)
    second_thread = runner._thread
    assert second_thread is not None
    second_thread.join(timeout=5)

    saved_second = background.get_job_match_background_task(db_session, second.task_id)
    assert saved_second is not None
    assert saved_second.status == "completed"
    assert saved_second.batch_id == 458


def test_background_runner_marks_current_job_before_it_starts(db_session, monkeypatch):
    """问题 13：`current_job_title` 必须是**当前**这一项，计数只在完成后 +1。"""
    first = _job(db_session, "后端开发")
    second = _job(db_session, "增长运营")
    _seed_profile(db_session)
    task = background.create_job_match_background_task(
        db_session, [first.id, second.id], force=False
    )
    runner = background.JobMatchBackgroundRunner()
    # (每个岗位开始时的 current_job_title, completed_count)
    observed: list[tuple[str, int]] = []

    def _probe_current() -> tuple[str, int]:
        # 用独立会话读：写入发生在 runner 线程自己的会话里，已提交。
        probe = SessionLocal()
        try:
            current = background.get_job_match_background_task(probe, task.task_id)
            assert current is not None
            return current.current_job_title, current.completed_count
        finally:
            probe.close()

    async def fake_run(
        inputs, config, *, on_item_start=None, on_item_complete=None, should_cancel=None
    ):
        del config, should_cancel
        assert on_item_start is not None
        assert on_item_complete is not None
        items = []
        for item in inputs:
            on_item_start(item)
            observed.append(_probe_current())
            done = JobMatchBatchItem(
                job_id=item.job_id,
                job_title=item.job_title,
                company=item.company,
                status="completed",
            )
            items.append(done)
            on_item_complete(done)
        return BatchMatchRun(items=items, model="")

    monkeypatch.setattr(
        background,
        "build_batch_inputs",
        lambda *_args, **_kwargs: [_input(first.id, first.title), _input(second.id, second.title)],
    )
    monkeypatch.setattr(background, "get_llm_config", lambda _db: LLMConfig())
    monkeypatch.setattr(background, "run_batch_match", fake_run)
    monkeypatch.setattr(
        background,
        "persist_batch",
        lambda *_args, **_kwargs: SimpleNamespace(id=789),
    )

    runner.start(task.task_id)
    thread = runner._thread
    assert thread is not None
    thread.join(timeout=5)
    assert not thread.is_alive()

    # ① 每个岗位开始前，current_job_title 已经是该岗位（不是上一个）。
    assert observed == [("后端开发", 0), ("增长运营", 1)]
    # ② 全部完成后 current_job_title 清空，③ 计数只在完成时 +1（共 2）。
    db_session.expire_all()
    saved = background.get_job_match_background_task(db_session, task.task_id)
    assert saved is not None
    assert saved.status == "completed"
    assert saved.current_job_id is None
    assert saved.current_job_title == ""
    assert saved.completed_count == 2


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
    _seed_profile(db_session)
    job = _job(db_session)
    started: list[str] = []

    class FakeRunner:
        def start(self, task_id: str) -> None:
            started.append(task_id)

    monkeypatch.setattr("app.api.job_match.get_job_match_background_runner", lambda: FakeRunner())

    response = client.post(
        "/api/jobs/match-batch-tasks",
        json={"job_ids": [job.id]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "pending"
    assert started == [body["task_id"]]
    assert client.get("/api/jobs/match-batch-tasks").json()[0]["task_id"] == body["task_id"]
