# SPDX-License-Identifier: Apache-2.0
"""§6.4-5 / G08：任务创建与 start 之间切数据集的竞争窗口。

入口在"建 task 行并 commit"之后才 runner.start。如果这中间允许切换数据集完成：
- 旧库留下一条永远 pending 的孤儿任务（后续生成会被"已有任务"挡住）；
- 或 runner 在新库按同一个数字 id 去跑别的任务。

实现上的封口是「HTTP 请求租约 + runner 长任务租约的交接」：请求中途切换必须等请求
结束（排空超时后 409），runner 拿到租约后切换又要等它跑完。本用例不靠毫秒墙钟竞速，
用事件屏障把 start 卡住，再真实发起一次切换请求：

1. start 被卡住期间切换 → 409、数据集指针未变；
2. 放行后任务在**原数据集**完成并落库；
3. 切到目标数据集后看不到这条任务/简历（没有跨库写）。
"""

from __future__ import annotations

import threading
import time

import pytest
from app.runtime import dataset_scope
from app.services.resume import resume_generate_runner as runner_module
from app.services.resume.resume_generate_runner import reset_resume_generate_runner
from tests.resume_generate_task_support import (
    SuccessfulProvider,
    _configure,
    _seed_profile,
    _wait_terminal,
)

MAIN = "main"


@pytest.fixture(autouse=True)
def _isolate_runner():
    reset_resume_generate_runner()
    yield
    reset_resume_generate_runner()


def _create_dataset(client, name: str) -> str:
    response = client.post("/api/settings/datasets", json={"name": name})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _activate(client, dataset_id: str):
    return client.post(f"/api/settings/datasets/{dataset_id}/activate")


def _activate_until_ok(client, dataset_id: str, timeout: float = 8.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _activate(client, dataset_id).status_code == 200:
            return
        time.sleep(0.02)
    raise AssertionError(f"切换 {dataset_id} 在 {timeout}s 内一直失败")


def test_switching_between_task_commit_and_runner_start_never_crosses_datasets(
    client, monkeypatch
):
    monkeypatch.setattr("app.services.datasets._DRAIN_TIMEOUT_SECONDS", 0.2)
    _seed_profile(client)
    _configure(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: SuccessfulProvider(resolved),
    )
    target = _create_dataset(client, "竞态目标库 B")
    runner = runner_module.get_resume_generate_runner()
    original_start = runner.start
    reached_start = threading.Event()
    allow_start = threading.Event()

    def delayed_start(task_id: int) -> None:
        """卡在「task 已 commit、租约尚未交接」的瞬间。"""
        reached_start.set()
        assert allow_start.wait(timeout=10), "测试自身的放行事件超时"
        original_start(task_id)

    monkeypatch.setattr(runner, "start", delayed_start)

    outcome: dict[str, object] = {}

    def create_task() -> None:
        from app.application import app as fastapi_app
        from fastapi.testclient import TestClient

        probe = TestClient(fastapi_app, client=("127.0.0.1", 50111))
        outcome["response"] = probe.post("/api/resumes/generate/tasks", json={})

    worker = threading.Thread(target=create_task, name="race-create-task")
    worker.start()
    assert reached_start.wait(timeout=10), "任务创建请求没有走到 runner.start"

    # 窗口期：任务行已提交、runner 还没有租约。此时切换必须被请求租约挡住。
    switch = _activate(client, target)
    assert switch.status_code == 409, switch.text
    assert "http-request" in switch.json()["detail"]
    assert dataset_scope.current_dataset_id() == MAIN

    allow_start.set()
    worker.join(timeout=20)
    assert not worker.is_alive()
    created = outcome["response"]
    assert created is not None
    assert created.status_code == 201, created.text
    task_id = created.json()["id"]

    final = _wait_terminal(client, task_id)
    assert final["status"] == "completed"
    assert final["resume_id"] is not None
    assert client.get(f"/api/resumes/{final['resume_id']}").status_code == 200

    # 任务与简历都只在原数据集；目标库看不到这条任务（数字 id 相同也不跨库）。
    _activate_until_ok(client, target)
    try:
        assert client.get("/api/resumes").json()["items"] == []
        assert client.get(f"/api/resumes/generate/tasks/{task_id}").status_code == 404
    finally:
        _activate_until_ok(client, MAIN)
