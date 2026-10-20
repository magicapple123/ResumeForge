# SPDX-License-Identifier: Apache-2.0
"""简历生成任务的启动恢复、收拢、总预算与并发守卫（RF-02，从 test_resume_generate_task.py 拆出）。

原文档超 500 行预算后的拆分：生命周期类用例聚在这里，"后台继续"的
取消/防重复/落库一致性用例留在原文件。共享夹具在 conftest（client/clean_db）。
"""

import asyncio
import json
import threading
import time

import pytest
from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider
from app.services.resume.resume_generate_runner import reset_resume_generate_runner

TERMINAL_STATUSES = {"completed", "cancelled", "failed"}


def _get_task(client, task_id):
    response = client.get(f"/api/resumes/generate/tasks/{task_id}")
    assert response.status_code == 200
    return response.json()


def _wait_status(client, task_id, status, timeout=8.0):
    deadline = time.monotonic() + timeout
    task = _get_task(client, task_id)
    while task["status"] != status:
        if time.monotonic() >= deadline:
            raise AssertionError(f"任务 {task_id} 未在 {timeout}s 内进入 {status}：{task}")
        time.sleep(0.02)
        task = _get_task(client, task_id)
    return task


@pytest.fixture(autouse=True)
def _isolate_runner(clean_db):
    """每个用例独享一份运行器单例（与原文件同纪律）：线程状态不跨用例泄漏。"""
    reset_resume_generate_runner()
    yield
    reset_resume_generate_runner()


def _configure(client):
    config = LLMConfig(base_url="https://api.example.com/v1", api_key="k", model="m")
    assert client.put("/api/settings/llm", json=config.model_dump()).status_code == 200


def _seed_profile(client):
    assert (
        client.put(
            "/api/profile",
            json={
                "name": "张三",
                "projects": [
                    {
                        "name": "简历通",
                        "role": "核心开发",
                        "tech_stack": "Python, FastAPI",
                        "description": "开发简历生成接口",
                    }
                ],
            },
        ).status_code
        == 200
    )


def _job(client):
    return client.post("/api/jobs", json={"title": "后端开发工程师", "company": "示例公司"}).json()


def _wait_terminal(client, task_id, timeout=8.0):
    deadline = time.monotonic() + timeout
    task = _get_task(client, task_id)
    while task["status"] not in TERMINAL_STATUSES:
        if time.monotonic() >= deadline:
            raise AssertionError(f"任务 {task_id} 未在 {timeout}s 内到达终态：{task}")
        time.sleep(0.02)
        task = _get_task(client, task_id)
    return task


class EndlessProvider(BaseLLMProvider):
    """无限产出 chunk、永不结束，用于在"运行中"取消（否则取消竞态无法稳定复现）。"""

    async def chat(self, _messages, *, thinking: bool = True):
        raise AssertionError("不应触发一次性对话")

    async def stream_chat(self, _messages):
        index = 0
        while True:
            yield f'{{"chunk": {index}}}'
            index += 1
            await asyncio.sleep(0.001)


# ===== RF-02：完整生命周期（孤儿恢复 / 收拢 / 总预算 / 字符计数 / 仲裁守卫）=====


def _seed_orphan_generate_tasks() -> None:
    from app import database
    from app.models.resume import (
        GENERATE_STATUS_PENDING,
        GENERATE_STATUS_RUNNING,
        ResumeGenerateTask,
    )

    with database.SessionLocal() as session:
        session.add(ResumeGenerateTask(status=GENERATE_STATUS_PENDING, title="孤儿一"))
        session.add(ResumeGenerateTask(status=GENERATE_STATUS_RUNNING, title="孤儿二"))
        session.commit()


def _drive_lifespan_startup_and_shutdown() -> None:
    """手动驱动一遍 lifespan：启动恢复在进入时执行，退出收拢在退出时执行。"""
    from app import application as application_module

    async def _drive():
        async with application_module.lifespan(application_module.app):
            return

    asyncio.run(_drive())


def test_startup_recovers_orphaned_generate_tasks(client):
    """进程中断遗留的 pending/running 生成任务在启动时转 failed，不自动重跑模型调用。"""
    _seed_orphan_generate_tasks()
    _drive_lifespan_startup_and_shutdown()

    from app import database
    from app.models.resume import ResumeGenerateTask

    with database.SessionLocal() as session:
        rows = session.query(ResumeGenerateTask).order_by(ResumeGenerateTask.id).all()
        assert len(rows) == 2
        for row in rows:
            assert row.status == "failed"
            assert "应用重启" in (row.error or "")
            assert row.resume_id is None  # 绝不落半成品
            assert row.finished_at is not None


def test_new_generation_can_start_after_orphan_recovery(client, monkeypatch):
    """孤儿清走之后，生成入口不再被 409 挡住（诊断报告的核心场景）。"""
    _seed_orphan_generate_tasks()
    _drive_lifespan_startup_and_shutdown()

    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: EndlessProvider(resolved),
    )

    started = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]})
    assert started.status_code == 201  # 不是 409

    # 收尾：取消胜出的任务，别让后台线程跨用例残留。
    client.post(f"/api/resumes/generate/tasks/{started.json()['id']}/cancel")
    assert _wait_terminal(client, started.json()["id"])["status"] == "cancelled"


def test_shutdown_calls_the_resume_generate_runner(monkeypatch):
    """退出收拢必须调用 resume runner 的 shutdown()（与投递/匹配 runner 同等待遇）。"""
    from app import application as application_module

    calls: list[str] = []

    class _SpyRunner:
        def shutdown(self) -> None:
            calls.append("resume-runner")

    monkeypatch.setattr(application_module, "get_resume_generate_runner", lambda: _SpyRunner())

    _drive_lifespan_startup_and_shutdown()
    assert calls == ["resume-runner"]


class ChunkedSuccessfulProvider(BaseLLMProvider):
    """把固定文本拆成多块产出：保证"逐块累计"路径被真正走到。"""

    def __init__(self, text: str, chunk_size: int = 7) -> None:
        super().__init__(LLMConfig(base_url="https://api.example.com/v1", model="m"))
        self.text = text
        self.chunk_size = chunk_size

    async def chat(self, _messages, *, thinking: bool = True):
        raise AssertionError("合法流式 JSON 不应触发修复调用")

    async def stream_chat(self, _messages):
        for index in range(0, len(self.text), self.chunk_size):
            yield self.text[index : index + self.chunk_size]


def test_received_chars_matches_the_full_stream_length(client, monkeypatch):
    """字符计数等价性（RF-02）：逐块累计必须与最后全量拼接的长度完全一致。"""
    payload = json.dumps(
        {
            "summary": "具备 Python 后端开发经验，熟悉 FastAPI 与数据库设计。",
            "projects": [{"name": "简历通", "role": "核心开发"}],
        },
        ensure_ascii=False,
    )
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: ChunkedSuccessfulProvider(payload),
    )

    task = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]}).json()
    final = _wait_terminal(client, task["id"])

    assert final["status"] == "completed"
    # 计数 = 流里每一块的长度之和 = 最后 join 成完整文本的长度。
    assert final["received_chars"] == len(payload)


def test_generation_expires_at_the_total_budget(client, monkeypatch):
    """总预算到期 → 任务落 failed（可读的超时原因），不是 cancelled，也不落半成品。"""
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: EndlessProvider(resolved),
    )

    # 超时用例：预算注入毫秒级让它真的到期；成功路径的预算是安全网，不动（两档纪律）。
    class _FastBudgetSettings:
        resume_generate_budget_seconds = 0.3

    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.get_settings",
        lambda: _FastBudgetSettings(),
    )

    task = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]}).json()
    final = _wait_terminal(client, task["id"])

    assert final["status"] == "failed"
    assert "超时" in final["error"]
    assert final["resume_id"] is None
    # 预算到期即断流：不该等到大量 chunk 之后才收尾。
    assert final["received_chars"] > 0


def test_finalize_never_overwrites_an_existing_terminal_status(db_session):
    """仲裁守卫：异常/取消收尾只允许从 pending/running 转入，绝不覆盖已有终态。"""
    from app.models.resume import (
        GENERATE_STATUS_CANCELLED,
        GENERATE_STATUS_FAILED,
        GENERATE_STATUS_RUNNING,
        ResumeGenerateTask,
    )
    from app.services.resume.resume_generate_runner import ResumeGenerateRunner

    runner = ResumeGenerateRunner()

    # 已被取消的终态：再来一次 failed 收尾必须保持 cancelled。
    task = ResumeGenerateTask(status=GENERATE_STATUS_CANCELLED, title="已被取消")
    db_session.add(task)
    db_session.commit()
    runner._finalize(db_session, task, GENERATE_STATUS_FAILED, error="不该生效")
    db_session.refresh(task)
    assert task.status == GENERATE_STATUS_CANCELLED

    # 进行中的任务正常收尾不受守卫影响。
    active = ResumeGenerateTask(status=GENERATE_STATUS_RUNNING, title="运行中")
    db_session.add(active)
    db_session.commit()
    runner._finalize(db_session, active, GENERATE_STATUS_FAILED, error="正常失败")
    db_session.refresh(active)
    assert active.status == GENERATE_STATUS_FAILED


def test_concurrent_starts_keep_exactly_one_active_task(client, monkeypatch):
    """single-flight 竞态守卫：两个并发启动只留一个活动任务，失败方不留活动孤儿。"""
    from app import database
    from app.application import app as fastapi_app
    from app.models.resume import GENERATE_ACTIVE_STATUSES, ResumeGenerateTask
    from fastapi.testclient import TestClient

    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: EndlessProvider(resolved),
    )

    barrier = threading.Barrier(2)
    results: dict[str, tuple[int, dict]] = {}

    def _start(tag: str) -> None:
        # 复用 client 的回环身份；不进 lifespan（client fixture 已启动过）。
        probe = TestClient(fastapi_app, client=("127.0.0.1", 50001))
        barrier.wait(timeout=5)
        response = probe.post("/api/resumes/generate/tasks", json={"job_id": job["id"]})
        results[tag] = (response.status_code, response.json())

    threads = [threading.Thread(target=_start, args=(tag,)) for tag in ("a", "b")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    codes = sorted(code for code, _body in results.values())
    assert codes == [201, 409], f"并发启动应恰好一胜一败：{results}"
    winner = next(body for code, body in results.values() if code == 201)

    # 失败方不留活动孤儿：库里活动任务恰好一条，且就是胜者。
    with database.SessionLocal() as session:
        active = (
            session.query(ResumeGenerateTask)
            .filter(ResumeGenerateTask.status.in_(GENERATE_ACTIVE_STATUSES))
            .all()
        )
        assert len(active) == 1
        assert active[0].id == winner["id"]

    # 收尾：取消胜者，终态干净。
    cancelled = client.post(f"/api/resumes/generate/tasks/{winner['id']}/cancel")
    assert cancelled.status_code == 200
    assert _wait_terminal(client, winner["id"])["status"] == "cancelled"
