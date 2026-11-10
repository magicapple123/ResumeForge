# SPDX-License-Identifier: Apache-2.0
"""简历生成并发（问题清单 §9）：同岗位去重、多任务并跑、排队、取消路由、跨数据集。

全部用例走真实 HTTP + 真实后台 worker 线程；Provider 用测试替身，不发网络请求。
调度上限用 monkeypatch 替换管理器模块的 get_settings（只影响并发/排队两个值），
生成预算仍由 runner 自己的 get_settings 提供（成功路径的预算是安全网，不动）。
"""

import json
from types import SimpleNamespace

import pytest
from app import database
from app.runtime import dataset_scope
from app.services.resume import resume_generate_manager as manager_module
from app.services.resume.resume_generate_manager import QUEUE_MESSAGE
from app.services.resume.resume_generate_runner import reset_resume_generate_runner
from tests.resume_generate_task_support import (
    EndlessProvider,
    SuccessfulProvider,
    _configure,
    _get_task,
    _job,
    _seed_profile,
    _wait_status,
    _wait_terminal,
)

MAIN = "main"


@pytest.fixture(autouse=True)
def _isolate_runner(clean_db):
    """每个用例前后释放管理器：worker 是真实线程，不能跨用例残留。"""
    reset_resume_generate_runner()
    yield
    reset_resume_generate_runner()


def _set_limits(monkeypatch, *, concurrent: int, pending: int = 50) -> None:
    """替换调度上限：管理器每次调度都读它，因此用例内随时可改。"""
    monkeypatch.setattr(
        manager_module,
        "get_settings",
        lambda: SimpleNamespace(
            resume_generate_max_concurrent=concurrent,
            resume_generate_max_pending=pending,
        ),
    )


def _start(client, job):
    return client.post("/api/resumes/generate/tasks", json={"job_id": job["id"] if job else None})


def _endless(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: EndlessProvider(resolved),
    )


class ChunkedSuccessfulProvider(SuccessfulProvider):
    """把固定文本拆成多块产出：保证逐块累计与「每 400 字提交一次」的路径真的走到。"""

    def __init__(self, resolved, text: str, chunk_size: int = 13) -> None:
        super().__init__(resolved)
        self.text = text
        self.chunk_size = chunk_size

    async def stream_chat(self, _messages):
        for index in range(0, len(self.text), self.chunk_size):
            yield self.text[index : index + self.chunk_size]


def _resume_totals(client) -> int:
    return client.get("/api/resumes").json()["total"]


# ===== 并发：不同岗位 / 通用简历 =====


def test_two_different_jobs_run_at_the_same_time(client, monkeypatch):
    """同时发起两个不同岗位：两个都 running → 都取消 → 都 cancelled，不产生简历。"""
    _seed_profile(client)
    _configure(client)
    job_a, job_b = _job(client), _job(client)
    _endless(client, monkeypatch)

    first = _start(client, job_a)
    second = _start(client, job_b)
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text

    _wait_status(client, first.json()["id"], "running")
    _wait_status(client, second.json()["id"], "running")
    # 两条同时在跑：旧实现第二条会在 API 就被 409 挡住。
    assert _get_task(client, first.json()["id"])["status"] == "running"
    assert _get_task(client, second.json()["id"])["status"] == "running"

    for task in (first.json(), second.json()):
        cancelled = client.post(f"/api/resumes/generate/tasks/{task['id']}/cancel")
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["status"] == "cancelled"

    assert _wait_terminal(client, first.json()["id"])["status"] == "cancelled"
    assert _wait_terminal(client, second.json()["id"])["status"] == "cancelled"
    assert _resume_totals(client) == 0


def test_general_resumes_can_run_in_parallel(client, monkeypatch):
    """job_id=None（通用简历）没有岗位可去重：连起两份都应 201 并同时跑。"""
    _seed_profile(client)
    _configure(client)
    _endless(client, monkeypatch)

    first = _start(client, None)
    second = _start(client, None)
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    _wait_status(client, first.json()["id"], "running")
    _wait_status(client, second.json()["id"], "running")

    for task in (first.json(), second.json()):
        client.post(f"/api/resumes/generate/tasks/{task['id']}/cancel")


def test_same_job_is_rejected_but_other_job_allowed(client, monkeypatch):
    """同岗位去重：同一 job 已有活动任务 → 409（detail 保留「正在进行」）；换岗位放行。"""
    _seed_profile(client)
    _configure(client)
    job_a, job_b = _job(client), _job(client)
    _endless(client, monkeypatch)

    first = _start(client, job_a)
    assert first.status_code == 201
    _wait_status(client, first.json()["id"], "running")

    duplicate = _start(client, job_a)
    assert duplicate.status_code == 409, duplicate.text
    assert "正在进行" in duplicate.json()["detail"]

    other = _start(client, job_b)
    assert other.status_code == 201, other.text
    _wait_status(client, other.json()["id"], "running")

    for task in (first.json(), other.json()):
        client.post(f"/api/resumes/generate/tasks/{task['id']}/cancel")


# ===== 排队：上限 / 自动开始 / 取消排队任务 / 队列满 =====


def test_task_beyond_limit_queues_then_starts_when_a_slot_frees(client, monkeypatch):
    """max_concurrent=1：第二条 pending + 「排队中」文案；取消第一条后自动开始。"""
    _set_limits(monkeypatch, concurrent=1)
    _seed_profile(client)
    _configure(client)
    job_a, job_b = _job(client), _job(client)
    _endless(client, monkeypatch)

    first = _start(client, job_a)
    assert first.status_code == 201
    _wait_status(client, first.json()["id"], "running")

    second = _start(client, job_b)
    assert second.status_code == 201, second.text
    queued = second.json()
    assert queued["status"] == "pending"
    assert QUEUE_MESSAGE in queued["message"]
    # 没有空槽：它保持 pending，不会因为等待而被拒。
    assert _get_task(client, queued["id"])["status"] == "pending"

    assert (
        client.post(f"/api/resumes/generate/tasks/{first.json()['id']}/cancel").status_code == 200
    )
    # 槽位空出后自动开始：用户不需要重试。
    _wait_status(client, queued["id"], "running")
    assert client.post(f"/api/resumes/generate/tasks/{queued['id']}/cancel").status_code == 200
    assert _wait_terminal(client, queued["id"])["status"] == "cancelled"
    assert _resume_totals(client) == 0


def test_cancelling_a_queued_task_does_not_occupy_a_slot(client, monkeypatch):
    """取消排队中的任务：直接 cancelled、不占槽位、不产生简历，也不影响正在跑的那条。"""
    _set_limits(monkeypatch, concurrent=1)
    _seed_profile(client)
    _configure(client)
    job_a, job_b, job_c = _job(client), _job(client), _job(client)
    _endless(client, monkeypatch)

    running = _start(client, job_a)
    _wait_status(client, running.json()["id"], "running")
    queued = _start(client, job_b).json()
    assert queued["status"] == "pending"

    cancelled = client.post(f"/api/resumes/generate/tasks/{queued['id']}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert _wait_terminal(client, queued["id"])["status"] == "cancelled"
    assert _get_task(client, running.json()["id"])["status"] == "running"

    # 排队取消腾出的位置不被占用：下一条照样能排队（而不是被 429 或立刻开跑）。
    third = _start(client, job_c)
    assert third.status_code == 201, third.text
    assert third.json()["status"] == "pending"

    assert (
        client.post(f"/api/resumes/generate/tasks/{running.json()['id']}/cancel").status_code == 200
    )
    # 槽位空出后它自动开跑（而不是永远停在 pending），再取消它收尾。
    _wait_status(client, third.json()["id"], "running")
    assert (
        client.post(f"/api/resumes/generate/tasks/{third.json()['id']}/cancel").status_code == 200
    )
    assert _wait_terminal(client, third.json()["id"])["status"] == "cancelled"
    assert _resume_totals(client) == 0


def test_queue_full_is_rejected_without_leaving_an_orphan_task(client, monkeypatch):
    """排队数到上限才 429「生成队列已满」；被拒的请求不留空任务行。"""
    from app.models.resume import ResumeGenerateTask

    _set_limits(monkeypatch, concurrent=1, pending=1)
    _seed_profile(client)
    _configure(client)
    jobs = [_job(client) for _ in range(3)]
    _endless(client, monkeypatch)

    running = _start(client, jobs[0])
    _wait_status(client, running.json()["id"], "running")
    queued = _start(client, jobs[1])
    assert queued.status_code == 201, queued.text
    assert queued.json()["status"] == "pending"

    rejected = _start(client, jobs[2])
    assert rejected.status_code == 429, rejected.text
    assert "队列已满" in rejected.json()["detail"]

    # 回滚干净：库里只有那条运行中与那条排队中的任务，没有被拒请求的空行。
    with database.SessionLocal() as session:
        statuses = sorted(row.status for row in session.query(ResumeGenerateTask).all())
    assert statuses == ["pending", "running"]

    client.post(f"/api/resumes/generate/tasks/{queued.json()['id']}/cancel")
    client.post(f"/api/resumes/generate/tasks/{running.json()['id']}/cancel")


# ===== 取消只影响一份 =====


def test_cancelling_one_task_does_not_stop_the_other(client, monkeypatch):
    """按 task_id 路由取消：取消 A 之后 B 仍在 running（旧单例实现会误停唯一线程）。"""
    _seed_profile(client)
    _configure(client)
    job_a, job_b = _job(client), _job(client)
    _endless(client, monkeypatch)

    first = _start(client, job_a)
    second = _start(client, job_b)
    _wait_status(client, first.json()["id"], "running")
    _wait_status(client, second.json()["id"], "running")

    assert (
        client.post(f"/api/resumes/generate/tasks/{first.json()['id']}/cancel").status_code == 200
    )
    assert _wait_terminal(client, first.json()["id"])["status"] == "cancelled"
    assert _get_task(client, second.json()["id"])["status"] == "running"

    client.post(f"/api/resumes/generate/tasks/{second.json()['id']}/cancel")


# ===== SQLite 并发写 =====


def test_two_workers_commit_progress_concurrently_without_lock_errors(client, monkeypatch):
    """两个 worker 同时每 400 字提交一次 progress：不出现 database is locked，都完成落库。"""
    payload = json.dumps(
        {
            "summary": "具备 Python 后端开发经验，熟悉 FastAPI 与数据库设计。" * 20,
            "projects": [{"name": "简历通", "role": "核心开发"}],
        },
        ensure_ascii=False,
    )
    _seed_profile(client)
    _configure(client)
    job_a, job_b = _job(client), _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: ChunkedSuccessfulProvider(resolved, payload),
    )

    first = _start(client, job_a)
    second = _start(client, job_b)
    assert first.status_code == 201 and second.status_code == 201

    finals = [
        _wait_terminal(client, first.json()["id"], timeout=20),
        _wait_terminal(client, second.json()["id"], timeout=20),
    ]
    assert [item["status"] for item in finals] == ["completed", "completed"]
    for item in finals:
        assert item["resume_id"] is not None
        assert "locked" not in item["error"].lower()
    assert _resume_totals(client) == 2
    # 两条结果互不串：各自身份能从简历记录读回对应的岗位。
    assert client.get(f"/api/resumes/{finals[0]['resume_id']}").json()["job_id"] == job_a["id"]
    assert client.get(f"/api/resumes/{finals[1]['resume_id']}").json()["job_id"] == job_b["id"]


# ===== 数据集切换：运行中拒绝、队列任务跨库启动失败 =====


def _create_dataset(client, name: str) -> str:
    response = client.post("/api/settings/datasets", json={"name": name})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _activate_until_ok(client, dataset_id: str, timeout: float = 8.0) -> None:
    import time

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if client.post(f"/api/settings/datasets/{dataset_id}/activate").status_code == 200:
            return
        time.sleep(0.02)
    raise AssertionError(f"切换 {dataset_id} 在 {timeout}s 内一直失败")


def test_dataset_switch_waits_for_all_running_tasks(client, monkeypatch):
    """有任务在跑时切换被租约挡住（409）；全部结束后切换成功。"""
    _set_limits(monkeypatch, concurrent=1)
    _seed_profile(client)
    _configure(client)
    job_a, job_b = _job(client), _job(client)
    _endless(client, monkeypatch)
    target = _create_dataset(client, "并发切换目标库")

    running = _start(client, job_a)
    _wait_status(client, running.json()["id"], "running")
    queued = _start(client, job_b).json()
    assert queued["status"] == "pending"

    blocked = client.post(f"/api/settings/datasets/{target}/activate")
    assert blocked.status_code == 409, blocked.text
    assert "resume-generate" in blocked.json()["detail"]

    try:
        client.post(f"/api/resumes/generate/tasks/{running.json()['id']}/cancel")
        _wait_status(client, queued["id"], "running")
        client.post(f"/api/resumes/generate/tasks/{queued['id']}/cancel")
        _wait_terminal(client, queued["id"])
        _activate_until_ok(client, target)
        assert dataset_scope.current_dataset_id() == target
    finally:
        _activate_until_ok(client, MAIN)


def test_queued_task_started_after_dataset_switch_fails_instead_of_writing(client, monkeypatch):
    """排队任务跨数据集启动：不拿新库跑旧快照，用原库把任务标 failed 并给出原因。"""
    _set_limits(monkeypatch, concurrent=1)
    _seed_profile(client)
    _configure(client)
    job_a, job_b = _job(client), _job(client)
    _endless(client, monkeypatch)
    target = _create_dataset(client, "排队切换目标库")

    running = _start(client, job_a)
    _wait_status(client, running.json()["id"], "running")
    queued = _start(client, job_b).json()
    assert queued["status"] == "pending"

    # 让 A 收尾时没有空槽，B 留在队列里（这是"切换发生时仍排队"的唯一可测形态）。
    _set_limits(monkeypatch, concurrent=0)
    client.post(f"/api/resumes/generate/tasks/{running.json()['id']}/cancel")
    _wait_terminal(client, running.json()["id"])
    assert _get_task(client, queued["id"])["status"] == "pending"

    # 没有租约了：切换成功。再触发一次调度，排队的 B 必须失败而不是去新库跑。
    try:
        assert client.post(f"/api/settings/datasets/{target}/activate").status_code == 200
        _set_limits(monkeypatch, concurrent=1)
        manager = manager_module.get_resume_generate_runner()
        manager._on_finished(0)  # 没有对应的 worker：只驱动一次队列排空
        _activate_until_ok(client, MAIN)
        final = _wait_terminal(client, queued["id"])
        assert final["status"] == "failed"
        assert "数据集已切换" in final["error"]
        assert final["resume_id"] is None
    finally:
        _activate_until_ok(client, MAIN)
    assert _resume_totals(client) == 0


# ===== 配置：默认值 / 边界 / 环境变量 =====


def test_concurrency_settings_defaults_and_bounds(monkeypatch):
    """默认同时 4 个、排队上限 50；0/9 与 0/201 在启动校验就被拒；环境变量可覆盖。"""
    from app.config import Settings
    from pydantic import ValidationError

    settings = Settings(_env_file=None)
    assert settings.resume_generate_max_concurrent == 4
    assert settings.resume_generate_max_pending == 50

    monkeypatch.setenv("RESUME_GENERATE_MAX_CONCURRENT", "1")
    monkeypatch.setenv("RESUME_GENERATE_MAX_PENDING", "3")
    from_env = Settings(_env_file=None)
    assert from_env.resume_generate_max_concurrent == 1
    assert from_env.resume_generate_max_pending == 3

    for invalid in (0, 9):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, resume_generate_max_concurrent=invalid)
    for invalid_pending in (0, 201):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, resume_generate_max_pending=invalid_pending)


# ===== 重启恢复（不自动重跑） =====


def test_restart_recovery_fails_pending_and_running_tasks_without_rerunning(client, monkeypatch):
    """模拟进程中断后的启动恢复：运行中与排队中的任务都标 failed，不自动重跑。"""
    from app.services.resume.generate_recovery import fail_orphaned_generate_tasks

    _set_limits(monkeypatch, concurrent=1)
    _seed_profile(client)
    _configure(client)
    job_a, job_b = _job(client), _job(client)
    _endless(client, monkeypatch)

    running = _start(client, job_a)
    _wait_status(client, running.json()["id"], "running")
    queued = _start(client, job_b).json()
    assert queued["status"] == "pending"

    with database.SessionLocal() as session:
        assert fail_orphaned_generate_tasks(session) == 2

    # 收掉残余线程：不再有人推进这两条，任务行也不会被改写回活动态。
    reset_resume_generate_runner()
    for task_id in (running.json()["id"], queued["id"]):
        final = _get_task(client, task_id)
        assert final["status"] == "failed"
        assert "应用重启" in final["error"]
        assert final["resume_id"] is None
    assert _resume_totals(client) == 0
