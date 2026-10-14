"""dataset_scope 的租约/互斥/冻结会话与数据集原子切换（RF-03）。

全部用事件屏障/有限等待协调，禁止毫秒墙钟竞速；数据集文件都建在测试库同级的
datasets 目录（conftest 会按用例清理），不触碰真实数据。
"""

import json
import threading
import time

import pytest
from app import database
from app.dataset_registry import dataset_database_file
from app.models.job import Job
from app.runtime import dataset_scope
from app.runtime.dataset_scope import (
    DatasetScopeError,
    acquire_lease,
    current_dataset_id,
    current_generation,
    current_identity,
    frozen_session_factory,
    switch_lock,
)
from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider

MAIN = "main"


# ===== 公共小工具 =====


def _add_job(client, title: str) -> None:
    response = client.post("/api/jobs", json={"title": title, "company": "示例公司"})
    assert response.status_code in (200, 201)


def _job_titles(client) -> set[str]:
    response = client.get("/api/jobs")
    assert response.status_code == 200
    return {item["title"] for item in response.json()["items"]}


def _create_dataset(client, name: str) -> str:
    response = client.post("/api/settings/datasets", json={"name": name})
    assert response.status_code == 200
    return response.json()["id"]


def _activate(client, dataset_id: str):
    return client.post(f"/api/settings/datasets/{dataset_id}/activate")


@pytest.fixture
def fast_drain(monkeypatch):
    """把切换排空的上限降到 0.2s：期望超时的用例用小预算，不拖慢整轮测试。"""
    monkeypatch.setattr("app.services.datasets._DRAIN_TIMEOUT_SECONDS", 0.2)


# ===== 租约：切换的排空依据 =====


def test_a_held_lease_blocks_switching_and_release_unblocks_it(client, fast_drain):
    """A 库任务运行中（持租约）→ 切换 B 返回 409 → release → 切换成功。"""
    other = _create_dataset(client, "目标库 B")
    generation_before = current_generation()

    lease = acquire_lease("resume-generate")
    try:
        response = _activate(client, other)
        assert response.status_code == 409
        assert "resume-generate" in response.json()["detail"]  # 错误信息可读：谁在跑
        assert current_dataset_id() == MAIN  # 指针与引擎都保持原值
    finally:
        lease.release()

    assert _activate(client, other).status_code == 200
    assert current_dataset_id() == other
    assert current_generation() == generation_before + 1


def test_acquire_lease_fails_while_switch_lock_is_held():
    """切换持锁期间取租约直接失败：封死"排空后放进新任务"的 TOCTOU 窗口。"""
    with switch_lock(), pytest.raises(DatasetScopeError, match="切换"):
        acquire_lease("late-task")
    # 锁释放后恢复正常。
    lease = acquire_lease("after-switch")
    lease.release()
    assert dataset_scope.leases_pending() == 0


def test_lease_release_is_idempotent():
    lease = acquire_lease("once")
    lease.release()
    lease.release()  # 幂等：重复 release 不抛、计数不再减
    assert dataset_scope.leases_pending() == 0


def test_lease_check_rejects_writes_after_the_identity_changed():
    lease = acquire_lease("writer")
    identity_before = current_identity()
    lease.check()  # 身份未变：放行
    # 模拟一次完成的切换（发布新身份）。
    with switch_lock():
        new_identity = dataset_scope.publish_switch("0123456789abcdef", identity_before.engine)
    assert lease.identity is not new_identity
    with pytest.raises(DatasetScopeError, match="数据集已切换"):
        lease.check()
    lease.release()


# ===== 冻结会话工厂：按值捕获 engine =====


def test_frozen_session_factory_keeps_writing_to_the_old_database(client):
    """rebind 之后，冻结工厂开的会话仍连旧库——"按值捕获 SessionLocal"冻不住，
    必须按值捕获 engine（RF-03 证据 2）。"""
    _add_job(client, "切换前的岗位")
    other = _create_dataset(client, "新库")

    frozen = frozen_session_factory()
    # 切换到新库（走真实流程：预检 → 指针 → rebind → 发布）。
    assert _activate(client, other).status_code == 200
    _add_job(client, "切换后的岗位")

    # 冻结工厂的会话还连着旧库：读不到新库的数据，写进旧库文件。
    with frozen() as db:
        titles = {row.title for row in db.query(Job).all()}
        assert titles == {"切换前的岗位"}
        db.add(Job(title="冻结工厂写入", company="旧库"))
        db.commit()

    # 全局活动库是新的：只有"切换后的岗位"，冻结工厂写的那条不在。
    assert _job_titles(client) == {"切换后的岗位"}

    # 切回主数据：冻结工厂写的那条确实落在了旧库文件里。
    assert _activate(client, MAIN).status_code == 200
    assert _job_titles(client) == {"切换前的岗位", "冻结工厂写入"}


# ===== 目标库预检：失败不发布 =====


def test_a_failed_preview_keeps_the_current_dataset_usable(client):
    """目标库损坏 → 预检失败（409）→ 指针与引擎保持 A → A 继续可用。"""
    broken_id = "0123456789abcdef"
    target = dataset_database_file(broken_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"definitely not a sqlite database" * 64)

    response = _activate(client, broken_id)

    assert response.status_code == 409
    assert "预检" in response.json()["detail"]
    assert current_dataset_id() == MAIN
    # 原库毫发无损：照常读写。
    _add_job(client, "预检失败后仍可写")
    assert "预检失败后仍可写" in _job_titles(client)


def test_a_missing_target_file_is_reported_before_anything_changes(client):
    response = _activate(client, "0123456789abcdef")
    assert response.status_code == 404
    assert current_dataset_id() == MAIN


# ===== 相同记录 ID 的隔离 =====


def test_rows_with_the_same_id_stay_isolated_across_datasets(client, db_session):
    """两个库各有一条 id=777777 的岗位：切换后读写都只能看到自己那份数据。"""
    db_session.add(Job(id=777777, title="主数据 777777", company="A"))
    db_session.commit()

    other = _create_dataset(client, "同 ID 隔离")
    assert _activate(client, other).status_code == 200
    with database.SessionLocal() as session:
        session.add(Job(id=777777, title="数据集 777777", company="B"))
        session.commit()

    assert _job_titles(client) == {"数据集 777777"}

    assert _activate(client, MAIN).status_code == 200
    assert _job_titles(client) == {"主数据 777777"}


# ===== 并发切换互斥 =====


def test_concurrent_switches_are_serialized_not_interleaved(client, monkeypatch):
    """两个线程同时切换：互斥串行，两个都成功，generation 恰好 +2。"""
    monkeypatch.setattr("app.services.datasets._DRAIN_TIMEOUT_SECONDS", 0.2)
    dataset_b = _create_dataset(client, "并发 B")
    dataset_c = _create_dataset(client, "并发 C")
    generation_before = current_generation()

    from app.application import app as fastapi_app
    from fastapi.testclient import TestClient

    barrier = threading.Barrier(2)
    results: dict[str, int] = {}

    def _switch(tag: str, dataset_id: str) -> None:
        probe = TestClient(fastapi_app, client=("127.0.0.1", 50001))
        barrier.wait(timeout=5)
        results[tag] = probe.post(f"/api/settings/datasets/{dataset_id}/activate").status_code

    threads = [
        threading.Thread(target=_switch, args=("b", dataset_b)),
        threading.Thread(target=_switch, args=("c", dataset_c)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert results == {"b": 200, "c": 200}  # 串行执行，互不拒绝
    assert current_dataset_id() in {dataset_b, dataset_c}
    assert current_generation() == generation_before + 2


def _seed_generation_prerequisites(client) -> None:
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
    config = LLMConfig(base_url="https://api.example.com/v1", api_key="k", model="m")
    assert client.put("/api/settings/llm", json=config.model_dump()).status_code == 200


def _job(client) -> dict:
    return client.post("/api/jobs", json={"title": "后端开发工程师", "company": "示例公司"}).json()


def _wait_terminal(client, task_id: int) -> dict:

    terminal = {"completed", "cancelled", "failed"}
    deadline = time.monotonic() + 8
    body = client.get(f"/api/resumes/generate/tasks/{task_id}").json()
    while body["status"] not in terminal:
        assert time.monotonic() < deadline, f"任务未在 8s 内到达终态：{body}"
        time.sleep(0.02)
        body = client.get(f"/api/resumes/generate/tasks/{task_id}").json()
    return body


# ===== 后台 runner 接租约 =====


def test_apply_task_runner_holds_a_lease_for_the_task_duration(monkeypatch):
    from app.services.apply.task_runner import TaskRunner

    runner = TaskRunner()
    entered = threading.Event()
    gate = threading.Event()

    def fake_run(task_id: int) -> None:
        entered.set()
        assert gate.wait(timeout=5), "测试线程未放行"

    monkeypatch.setattr(runner, "_run", fake_run)
    runner.start(1)
    assert entered.wait(timeout=5)
    try:
        assert dataset_scope.leases_pending() == 1
    finally:
        gate.set()
    runner.shutdown()  # join 工作线程，租约在收拢链路里释放
    assert dataset_scope.leases_pending() == 0


def test_job_match_runner_holds_a_lease_for_the_task_duration(monkeypatch):
    from app.services.job.job_match_background import JobMatchBackgroundRunner

    runner = JobMatchBackgroundRunner()
    entered = threading.Event()
    gate = threading.Event()

    def fake_run(task_id: str) -> None:
        entered.set()
        assert gate.wait(timeout=5), "测试线程未放行"

    monkeypatch.setattr(runner, "_run", fake_run)
    runner.start("abc123")
    assert entered.wait(timeout=5)
    try:
        assert dataset_scope.leases_pending() == 1
        assert "job-match" in "、".join(dataset_scope.lease_owners())
    finally:
        gate.set()
    runner.shutdown()
    assert dataset_scope.leases_pending() == 0


def test_resume_generate_runner_holds_a_lease_and_releases_at_terminal(client, monkeypatch):
    _seed_generation_prerequisites(client)

    class SuccessfulProvider(BaseLLMProvider):
        async def chat(self, _messages, *, thinking: bool = True):  # pragma: no cover
            raise AssertionError("合法流式 JSON 不应触发修复调用")

        async def stream_chat(self, _messages):
            yield json.dumps(
                {
                    "summary": "具备 Python 后端开发经验。",
                    "projects": [{"name": "简历通", "role": "核心开发"}],
                },
                ensure_ascii=False,
            )

    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: SuccessfulProvider(resolved),
    )

    task = client.post("/api/resumes/generate/tasks", json={"job_id": _job(client)["id"]}).json()
    # 等任务进入运行态（轮询，事件式收尾，不依赖墙钟竞速）。

    deadline = time.monotonic() + 8
    while True:
        body = client.get(f"/api/resumes/generate/tasks/{task['id']}").json()
        if body["status"] in {"running", "completed", "failed", "cancelled"}:
            break
        assert time.monotonic() < deadline, f"任务未进入运行态：{body}"
        time.sleep(0.02)

    final = _wait_terminal(client, task["id"])
    assert final["status"] == "completed"
    # 任务结束后租约必须释放，否则切换会永远 409。
    assert dataset_scope.leases_pending() == 0


def test_starting_a_generation_while_switch_is_in_progress_returns_409_without_orphan(
    client,
):
    """TOCTOU 守卫：切换持锁期间启动生成 → 409（可读原因），且不留孤儿任务行。"""
    _seed_generation_prerequisites(client)

    from app import database
    from app.models.resume import ResumeGenerateTask

    job_id = _job(client)["id"]
    with switch_lock():
        response = client.post("/api/resumes/generate/tasks", json={"job_id": job_id})
        assert response.status_code == 409
        assert "切换" in response.json()["detail"]

    with database.SessionLocal() as session:
        assert session.query(ResumeGenerateTask).count() == 0  # 失败方不留活动孤儿
