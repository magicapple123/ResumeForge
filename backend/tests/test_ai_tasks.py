# SPDX-License-Identifier: Apache-2.0
"""通用 AI 任务（``ai_task``）的端到端测试：建 / 查 / 活跃列表 / 取消（含幂等）。

**为什么用替换 handler 而不是打桩模型**：本组用例要验的是"任务机制"本身——后台线程
与请求解耦、进度能查到、取消能真的让执行体停下、终态原子仲裁。这些与模型无关，
换 handler 才能确定性地控制"跑多久"和"什么时候被取消"。

另外两条验证真实内置 handler 的收尾映射（``resume_generate`` 的 ``result_ref`` 与失败原因）。
"""

from __future__ import annotations

import time
from typing import Any

import pytest
from app.models.ai_task import (
    AI_TASK_KIND_JOB_MATCH,
    AI_TASK_KIND_RESUME_GENERATE,
    AiTask,
)
from app.models.resume import (
    GENERATE_STATUS_COMPLETED,
    GENERATE_STATUS_FAILED,
    ResumeGenerateTask,
)
from app.services.ai_task_registry import register_ai_task_handler
from app.services.ai_task_runner import reset_ai_task_runner

TASK_PATH = "/api/ai-tasks"


@pytest.fixture(autouse=True)
def _reset_runner():
    """每个用例结束后释放执行器：不让上一个用例的线程跑进下一个用例的库。"""
    yield
    reset_ai_task_runner()


def _wait_status(client, task_id: int, expected: str, timeout: float = 8.0) -> dict[str, Any]:
    """轮询到期望状态（后台线程的收尾是异步的，不能只查一次）。"""
    deadline = time.monotonic() + timeout
    latest: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = client.get(f"{TASK_PATH}/{task_id}")
        assert response.status_code == 200, response.text
        latest = response.json()
        if latest["status"] == expected:
            return latest
        time.sleep(0.05)
    raise AssertionError(f"任务未在 {timeout}s 内进入 {expected}，最后状态：{latest}")


def _quick_handler(ctx: Any) -> None:
    """一次几乎立刻成功的任务：验进度上报与 result_ref 落库。"""
    ctx.set_progress(42, "做到一半")
    ctx.set_result({"job_id": 7})


def _hanging_handler(ctx: Any) -> None:
    """一直等到被取消：验取消真的让执行体停下（而不是只改数据库状态）。"""
    while True:
        ctx.sleep(0.02)


def test_create_and_query_task_reports_progress_and_result(client):
    register_ai_task_handler(AI_TASK_KIND_JOB_MATCH, _quick_handler)

    created = client.post(
        TASK_PATH,
        json={"kind": AI_TASK_KIND_JOB_MATCH, "payload": {"job_id": 7}, "label": "适配某个岗位"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["kind"] == AI_TASK_KIND_JOB_MATCH
    assert body["label"] == "适配某个岗位"

    done = _wait_status(client, body["id"], "succeeded")
    assert done["progress"] == 100
    # 落点标识原样保存：前端据此生成 /jobs?job_id=7。
    assert done["result_ref"] == {"job_id": 7}
    assert done["finished_at"] is not None


def test_cancel_really_stops_the_handler(client):
    observed: list[str] = []

    def handler(ctx: Any) -> None:
        try:
            while True:
                ctx.sleep(0.02)
        except Exception as exc:  # noqa: BLE001 - 只为记录执行体确实被打断
            observed.append(type(exc).__name__)
            raise

    register_ai_task_handler(AI_TASK_KIND_JOB_MATCH, handler)

    created = client.post(TASK_PATH, json={"kind": AI_TASK_KIND_JOB_MATCH, "payload": {}})
    task_id = created.json()["id"]

    cancelled = client.post(f"{TASK_PATH}/{task_id}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "canceled"

    # 执行体必须在取消后退出：线程池里还在跑的"取消"是假的。
    reset_ai_task_runner()
    assert observed, "取消只改了状态，执行体没有被停下"


def test_cancel_is_idempotent_on_a_finished_task(client):
    register_ai_task_handler(AI_TASK_KIND_JOB_MATCH, _quick_handler)

    task_id = client.post(TASK_PATH, json={"kind": AI_TASK_KIND_JOB_MATCH, "payload": {}}).json()[
        "id"
    ]
    _wait_status(client, task_id, "succeeded")

    again = client.post(f"{TASK_PATH}/{task_id}/cancel")
    assert again.status_code == 200, again.text
    # 已完成的任务不因"取消晚了"而被改写，也不报错。
    assert again.json()["status"] == "succeeded"


def test_unknown_kind_is_rejected(client):
    response = client.post(TASK_PATH, json={"kind": "not_a_kind", "payload": {}})
    assert response.status_code == 400
    assert "not_a_kind" in response.json()["detail"]


def test_missing_task_returns_404(client):
    assert client.get(f"{TASK_PATH}/999999").status_code == 404
    assert client.post(f"{TASK_PATH}/999999/cancel").status_code == 404


def test_active_lists_running_tasks(client):
    register_ai_task_handler(AI_TASK_KIND_JOB_MATCH, _hanging_handler)

    task_id = client.post(TASK_PATH, json={"kind": AI_TASK_KIND_JOB_MATCH, "payload": {}}).json()[
        "id"
    ]
    _wait_status(client, task_id, "running")

    active = client.get(f"{TASK_PATH}/active")
    assert active.status_code == 200
    assert task_id in [row["id"] for row in active.json()]

    client.post(f"{TASK_PATH}/{task_id}/cancel")
    # 终态任务不再出现在活跃列表里（刷新后不该恢复一条已经结束的任务）。
    assert task_id not in [row["id"] for row in client.get(f"{TASK_PATH}/active").json()]


def _seed_resume_task(db_session, status: str, *, resume_id: int | None, error: str = "") -> int:
    task = ResumeGenerateTask(status=status, resume_id=resume_id, error=error, message="")
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)
    return task.id


def test_resume_generate_handler_maps_result_ref(client, db_session):
    """监管型 handler：把既有简历任务的完成态映射成统一任务的 result_ref。"""
    from app.models.resume import ResumeRecord

    record = ResumeRecord(title="生成结果")
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    resume_task_id = _seed_resume_task(db_session, GENERATE_STATUS_COMPLETED, resume_id=record.id)

    created = client.post(
        TASK_PATH,
        json={
            "kind": AI_TASK_KIND_RESUME_GENERATE,
            "payload": {"resume_task_id": resume_task_id},
        },
    )
    assert created.status_code == 201, created.text

    done = _wait_status(client, created.json()["id"], "succeeded")
    assert done["result_ref"] == {"resume_id": record.id}


def test_resume_generate_handler_reports_failure_reason(client, db_session):
    resume_task_id = _seed_resume_task(
        db_session, GENERATE_STATUS_FAILED, resume_id=None, error="模型输出未能解析为有效 JSON"
    )

    created = client.post(
        TASK_PATH,
        json={
            "kind": AI_TASK_KIND_RESUME_GENERATE,
            "payload": {"resume_task_id": resume_task_id},
        },
    )
    failed = _wait_status(client, created.json()["id"], "failed")
    # 后端 detail 只写原因："请…" 由前端 errorGuidance 补。
    assert failed["error"] == "模型输出未能解析为有效 JSON"


def test_resume_generate_handler_without_task_id_fails(client):
    created = client.post(TASK_PATH, json={"kind": AI_TASK_KIND_RESUME_GENERATE, "payload": {}})
    failed = _wait_status(client, created.json()["id"], "failed")
    assert "简历生成任务标识" in failed["error"]


def test_task_table_is_registered(db_session):
    """模型注册进 Base.metadata（create_all 靠它建表）。"""
    assert AiTask.__tablename__ == "ai_task"
    assert db_session.query(AiTask).count() == 0


def test_handler_receives_declared_payload(client):
    """payload 原样进 handler（重放所需的所有信息都在这里，不靠请求上下文）。"""
    seen: list[dict[str, Any]] = []

    def handler(ctx: Any) -> None:
        seen.append(dict(ctx.payload))
        ctx.set_result({"job_id": 1})

    register_ai_task_handler(AI_TASK_KIND_JOB_MATCH, handler)
    task_id = client.post(
        TASK_PATH, json={"kind": AI_TASK_KIND_JOB_MATCH, "payload": {"job_id": 3, "force": True}}
    ).json()["id"]
    _wait_status(client, task_id, "succeeded")
    assert seen == [{"job_id": 3, "force": True}]


def test_orphaned_tasks_are_failed_on_startup(db_session):
    """进程中断留下的 pending/running 会被启动恢复收尾，前端不会永远看到 running。"""
    from app.services.ai_task_recovery import (
        ORPHANED_AI_TASK_REASON,
        fail_orphaned_ai_tasks,
    )

    running = AiTask(kind=AI_TASK_KIND_JOB_MATCH, payload={}, label="中断的任务")
    done = AiTask(
        kind=AI_TASK_KIND_JOB_MATCH,
        status="succeeded",
        payload={},
        label="已完成的任务",
    )
    db_session.add_all([running, done])
    db_session.commit()

    assert fail_orphaned_ai_tasks(db_session) == 1

    db_session.expire_all()
    recovered = db_session.get(AiTask, running.id)
    assert recovered is not None
    assert recovered.status == "failed"
    assert recovered.error == ORPHANED_AI_TASK_REASON
    assert recovered.finished_at is not None
    # 已到终态的任务不受影响。
    untouched = db_session.get(AiTask, done.id)
    assert untouched is not None
    assert untouched.status == "succeeded"
