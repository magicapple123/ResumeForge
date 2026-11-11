# SPDX-License-Identifier: Apache-2.0
"""#18A 后台执行器：四个 kind 的真实副作用、暂停/继续、取消、失败、幂等、并发 start。

验收口径（收尾工单任务 1 必测 2-6/8）：
- 每个 kind 跑完 done，且**业务表真的变了**（简历文档 / 岗位 / JobMatchAnalysis / 队列招呼语）；
- pause 后 runner 停，resume 从 resume_cursor 继续且不重复副作用；
- cancel 保留已完成、其余 skipped；
- 失败 → step failed + task failed + error 可读；
- run_task_once 幂等、单例 start 并发只跑一个。
"""

from __future__ import annotations

import json
import threading
import time
from types import SimpleNamespace

import pytest
from app.models.apply import ApplyQueueItem, ApplyTask, JobMatchAnalysis
from app.models.job import Job
from app.models.resume import ResumeRecord
from app.models.versions import VERSION_SOURCE_ASSISTANT, ResumeVersion
from app.services import agent_task_service
from app.services import assistant_task_runner as runner_module
from app.services.assistant_task_handler_common import clear_all_task_state
from app.services.assistant_task_handlers import execute_step
from app.services.web_fetch import import_service
from assistant_task_fixtures import (
    EMPTY_MATCH_JSON,
    LIST_URL,
    FakeFetcher,
    ScriptedProvider,
    create_job,
    create_resume,
    detail_page,
    list_page,
    make_task,
    reset_fetcher,
)


def _use_provider(monkeypatch, responses: list[object]) -> ScriptedProvider:
    from app.services import assistant_task_handler_common as common

    provider = ScriptedProvider(responses)
    monkeypatch.setattr(common, "provider_for_task", lambda _db: provider)
    return provider


def _step_states(task) -> list[str]:
    return [step.status for step in task.steps]


@pytest.fixture(autouse=True)
def _reset_state():
    clear_all_task_state()
    reset_fetcher()
    yield
    clear_all_task_state()
    reset_fetcher()


def test_resume_batch_edit_writes_document_and_undo_version(client, db_session, monkeypatch):
    resume_id = create_resume(client)
    _use_provider(monkeypatch, ["STAR 改写：主导平台重构，吞吐提升 7 倍。"])
    task = make_task(
        db_session,
        kind="resume_batch_edit",
        params={"resume_id": resume_id, "section": "", "instruction": "按 STAR 重写"},
        steps=(("读取简历", "read"), ("逐条改写", "edit"), ("保存并留撤销点", "save")),
    )

    final = runner_module.run_task_once(db_session, task.id)

    assert final.status == "done", final.error
    assert _step_states(final) == ["done", "done", "done"]
    assert [step.attempt for step in final.steps] == [1, 1, 1]
    db_session.expire_all()
    record = db_session.get(ResumeRecord, resume_id)
    assert record is not None
    assert "STAR 改写" in json.dumps(record.content, ensure_ascii=False)
    versions = (
        db_session.query(ResumeVersion)
        .filter(
            ResumeVersion.resume_id == resume_id,
            ResumeVersion.source == VERSION_SOURCE_ASSISTANT,
        )
        .all()
    )
    assert len(versions) == 1
    assert final.steps[2].output_ref["version_id"] == versions[0].id


def test_job_import_writes_job_pool_only(client, db_session, monkeypatch):
    monkeypatch.setattr(import_service, "JobFetcher", FakeFetcher)
    FakeFetcher.pages[LIST_URL] = list_page()
    for index in (1, 2, 3):
        FakeFetcher.pages[f"https://jobs.example.com/campus/position/{index}"] = detail_page(
            f"https://jobs.example.com/campus/position/{index}"
        )
    task = make_task(
        db_session,
        kind="job_import",
        params={"url": LIST_URL, "limit": 2},
        steps=(("抓列表", "fetch"), ("补详情", "detail"), ("写入岗位广场", "import")),
    )

    final = runner_module.run_task_once(db_session, task.id)

    assert final.status == "done", final.error
    assert _step_states(final) == ["done", "done", "done"]
    assert db_session.query(Job).count() == 2
    assert final.steps[2].output_ref["imported"] == 2
    # 只进岗位广场：不自动入队、不投递。
    assert db_session.query(ApplyQueueItem).count() == 0
    assert db_session.query(ApplyTask).count() == 0


def test_match_batch_persists_job_match_analysis(client, db_session, monkeypatch):
    job_ids = [
        create_job(client, "后端开发工程师"),
        create_job(client, "前端开发工程师", "示例网络"),
    ]
    _use_provider(monkeypatch, [EMPTY_MATCH_JSON])
    task = make_task(
        db_session,
        kind="match_batch",
        params={"job_ids": job_ids},
        steps=(("读取资料与岗位", "read"), ("逐个匹配", "match"), ("汇总报告", "report")),
    )

    final = runner_module.run_task_once(db_session, task.id)

    assert final.status == "done", final.error
    assert db_session.query(JobMatchAnalysis).count() == 2
    assert final.steps[1].output_ref["processed"] == 2
    assert final.steps[2].output_ref["matched"] == 2


def test_greeting_batch_writes_queue_greetings_without_sending(client, db_session, monkeypatch):
    job_ids = [
        create_job(client, "后端开发工程师"),
        create_job(client, "前端开发工程师", "示例网络"),
    ]
    _use_provider(monkeypatch, ["你好，我有三年后端经验，希望聊聊这个岗位。"])
    task = make_task(
        db_session,
        kind="greeting_batch",
        params={"job_ids": job_ids, "template": ""},
        steps=(("读取岗位", "read"), ("逐个生成", "generate"), ("放进投递台", "handoff")),
    )

    final = runner_module.run_task_once(db_session, task.id)

    assert final.status == "done", final.error
    queued = db_session.query(ApplyQueueItem).all()
    assert len(queued) == 2
    assert all("后端经验" in row.greeting for row in queued)
    assert final.steps[2].output_ref["queued"] == 2
    # 只写队列，不发送（不创建投递任务）。
    assert db_session.query(ApplyTask).count() == 0


def test_pause_stops_runner_and_resume_continues_from_cursor(client, db_session, monkeypatch):
    job_ids = [create_job(client, "后端开发工程师")]
    _use_provider(monkeypatch, [EMPTY_MATCH_JSON])
    task = make_task(
        db_session,
        kind="match_batch",
        params={"job_ids": job_ids},
        steps=(("读取", "read"), ("匹配", "match"), ("汇总", "report")),
    )
    # 先手动完成第 0 步（模拟"跑到一半时用户点了暂停"）。
    current = agent_task_service.get_task(db_session, task.id)
    agent_task_service.mark_step_running(db_session, task.id, 0)
    read_result = execute_step(db_session, current, current.steps[0])
    assert read_result.ok
    agent_task_service.advance_step(db_session, task.id, 0, output_ref=read_result.output_ref)
    agent_task_service.pause(db_session, task.id)

    paused = runner_module.run_task_once(db_session, task.id)
    assert paused.status == "paused"
    assert paused.resume_cursor == 1
    assert _step_states(paused) == ["done", "pending", "pending"]
    assert db_session.query(JobMatchAnalysis).count() == 0

    agent_task_service.resume(db_session, task.id)
    final = runner_module.run_task_once(db_session, task.id)
    assert final.status == "done", final.error
    assert _step_states(final) == ["done", "done", "done"]
    # 第 0 步没有被重跑：attempt 与 output_ref 保持原样；匹配也只跑了一次。
    assert final.steps[0].attempt == 1
    assert final.steps[0].output_ref == read_result.output_ref
    assert db_session.query(JobMatchAnalysis).count() == 1


def test_cancel_skips_remaining_and_keeps_completed(client, db_session, monkeypatch):
    job_ids = [create_job(client, "后端开发工程师")]
    _use_provider(monkeypatch, [EMPTY_MATCH_JSON])
    task = make_task(
        db_session,
        kind="match_batch",
        params={"job_ids": job_ids},
        steps=(("读取", "read"), ("匹配", "match"), ("汇总", "report")),
    )
    current = agent_task_service.get_task(db_session, task.id)
    agent_task_service.mark_step_running(db_session, task.id, 0)
    read_result = execute_step(db_session, current, current.steps[0])
    agent_task_service.advance_step(db_session, task.id, 0, output_ref=read_result.output_ref)
    agent_task_service.cancel(db_session, task.id)

    final = runner_module.run_task_once(db_session, task.id)

    assert final.status == "cancelled"
    assert _step_states(final) == ["done", "skipped", "skipped"]
    assert final.steps[0].output_ref == read_result.output_ref


def test_handler_exception_marks_step_failed_with_readable_error(client, db_session):
    resume_id = create_resume(client)
    task = make_task(
        db_session,
        kind="resume_batch_edit",
        params={"resume_id": resume_id, "section": "", "instruction": "改写"},
        steps=(("读取", "read"), ("改写", "edit"), ("保存", "save")),
    )

    def boom(_db, _task, _step):
        raise RuntimeError("模型连接被重置")

    final = runner_module.run_task_once(db_session, task.id, execute=boom)

    assert final.status == "failed"
    assert final.steps[0].status == "failed"
    assert "模型连接被重置" in final.error
    assert "第 1 步" in final.error


def test_unknown_kind_and_old_task_without_params_fail_readably(client, db_session):
    unknown = make_task(
        db_session,
        kind="mystery_kind",
        params={},
        steps=(("神秘步骤", "x"),),
    )
    final = runner_module.run_task_once(db_session, unknown.id)
    assert final.status == "failed"
    assert "没有执行器" in final.error

    legacy = agent_task_service.create_task(
        db_session,
        title="执行器上线前的老任务",
        steps=[{"title": "老步骤", "kind": "read"}],
        source="assistant",
        params=None,
    )
    agent_task_service.start(db_session, legacy.id)
    final_legacy = runner_module.run_task_once(db_session, legacy.id)
    assert final_legacy.status == "failed"
    assert "没有执行器" in final_legacy.error


def test_run_task_once_is_idempotent_after_done(client, db_session, monkeypatch):
    job_ids = [create_job(client, "后端开发工程师")]
    _use_provider(monkeypatch, ["你好，希望聊聊这个岗位。"])
    task = make_task(
        db_session,
        kind="greeting_batch",
        params={"job_ids": job_ids},
        steps=(("读取", "read"), ("生成", "generate"), ("交付", "handoff")),
    )
    first = runner_module.run_task_once(db_session, task.id)
    assert first.status == "done"
    queue_ids = [row.id for row in db_session.query(ApplyQueueItem).all()]
    attempts = [step.attempt for step in first.steps]

    second = runner_module.run_task_once(db_session, task.id)
    assert second.status == "done"
    assert [row.id for row in db_session.query(ApplyQueueItem).all()] == queue_ids
    assert [step.attempt for step in second.steps] == attempts
    # 对已完成步骤再 advance 一次也是幂等空转。
    snapshot = agent_task_service.advance_step(db_session, task.id, 2)
    assert snapshot.resume_cursor == 3
    assert [step.attempt for step in snapshot.steps] == attempts


def test_thread_wrapper_turns_crash_into_failed_task(client, db_session, monkeypatch):
    """线程 wrapper 兜住任何异常：任务被标 failed（可读原因），不会永远 running。"""

    def explode(_db, _task_id):
        raise RuntimeError("线程内意外崩溃")

    task = make_task(
        db_session,
        kind="mystery_kind",
        params={},
        steps=(("一步", "x"),),
    )
    monkeypatch.setattr(runner_module, "run_task_once", explode)
    runner = runner_module.AssistantTaskRunner()
    runner._run(task.id)  # 直接跑 wrapper 体，同步验证兜底路径
    db_session.expire_all()
    latest = agent_task_service.get_task(db_session, task.id)
    assert latest.status == "failed"
    assert "任务执行器异常中止" in latest.error


def test_runner_start_single_flight(monkeypatch):
    release = threading.Event()
    entered = threading.Event()
    calls: list[int] = []

    def blocking_run(_db, task_id):
        calls.append(task_id)
        entered.set()
        release.wait(2)
        return SimpleNamespace(status="done", resume_cursor=0)

    monkeypatch.setattr(runner_module, "run_task_once", blocking_run)
    runner = runner_module.AssistantTaskRunner()
    assert runner.start(11) is True
    assert entered.wait(2) is True
    assert runner.start(12) is False
    assert calls == [11]
    release.set()
    for _ in range(200):
        if not runner.is_running():
            break
        time.sleep(0.01)
    assert runner.is_running() is False
