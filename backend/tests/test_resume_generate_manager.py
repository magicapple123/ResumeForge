# SPDX-License-Identifier: Apache-2.0
"""生成管理器（问题清单 §9）的私有接线：排队任务启动时恢复入队请求的日志/审计上下文。

为什么单独一个文件：这两项都是 **ContextVar**，只有"排队任务由上一个 worker 的收尾线程
启动"时才会串味；走真实 HTTP + 真线程的并发用例很难稳定断言日志里的 request_id 归属。
这里用不跑线程的假 worker 直接钉住 manager 的传参责任。
"""

from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest
from app.middleware.request_context import get_request_id, request_id_context
from app.services.llm.usage_tasks import (
    ambient_scope,
    ambient_task,
    set_ambient_scope,
    set_ambient_task,
)
from app.services.resume import resume_generate_manager as manager_module
from app.services.resume.resume_generate_manager import ResumeGenerateManager


class _CapturingWorker:
    """只记录 start 时刻的上下文，不真正起线程（管理器调度逻辑是被测对象）。"""

    instances: list[_CapturingWorker] = []

    def __init__(self, *, session_factory=None) -> None:
        self.task_id: int | None = None
        self.request_id = ""
        self.task_name: str | None = None
        self.scope: dict[str, object] = {}
        _CapturingWorker.instances.append(self)

    def start(self, task_id, *, generation_snapshot=None, snapshot_id=None, on_finished=None):
        self.task_id = task_id
        self.request_id = get_request_id()
        self.task_name = ambient_task()
        self.scope = ambient_scope()
        self.on_finished = on_finished

    def cancel(self, task_id: int) -> None:  # pragma: no cover - 本文件不触发
        raise AssertionError("本用例不取消")

    def shutdown(self) -> None:
        """空实现：假 worker 没有线程可停。"""


@pytest.fixture
def manager(monkeypatch):
    """每个用例一个干净管理器：槽位 1（第二条必然排队），worker 换成本文件的假实现。"""
    _CapturingWorker.instances = []
    monkeypatch.setattr(manager_module, "ResumeGenerateRunner", _CapturingWorker)
    monkeypatch.setattr(
        manager_module,
        "get_settings",
        lambda: SimpleNamespace(resume_generate_max_concurrent=1, resume_generate_max_pending=50),
    )
    instance = ResumeGenerateManager()
    yield instance
    instance.shutdown()


def _apply_request_context(request_id: str, language: str) -> None:
    """模拟一次 HTTP 请求入口写下的关联上下文（与 API 入口同一组 ContextVar）。"""
    request_id_context.set(request_id)
    set_ambient_task("resume_generate")
    set_ambient_scope(input_scope="resume+profile+job", masked=True, language=language, budget=4096)


def test_queued_task_launched_from_finishing_worker_keeps_enqueuing_context(manager):
    """第二条排队，第一条在**另一个线程**收尾：启动第二条时必须恢复它入队时的上下文。"""
    _apply_request_context("rq-first", "zh-CN")
    manager.start(101)  # 槽位 1：立即开跑，记下第一次请求的上下文
    _apply_request_context("rq-second", "en-US")
    manager.start(102)  # 没槽位：排队，记下第二次请求的上下文

    (first,) = _CapturingWorker.instances
    assert (first.task_id, first.request_id, first.scope.get("language")) == (
        101,
        "rq-first",
        "zh-CN",
    )

    # 收尾线程的上下文是"干净"的（request_id 默认 "-"、无 ambient）：排空不依赖继承。
    drain = threading.Thread(target=manager._on_finished, args=(101,), daemon=True)
    drain.start()
    drain.join(timeout=5)
    assert not drain.is_alive()

    assert len(_CapturingWorker.instances) == 2
    second = _CapturingWorker.instances[1]
    assert second.task_id == 102
    # 日志关联必须指向**发起这条任务的那次请求**，而不是上一个 worker 的请求。
    assert second.request_id == "rq-second"
    assert second.task_name == "resume_generate"
    assert second.scope.get("language") == "en-US"
    assert second.scope.get("budget") == 4096
    # 一号 worker 已从运行槽位移除，队列也空了。
    assert manager.is_running()
    assert manager.current_task_id() == 102


def test_queue_full_error_is_distinct(manager, monkeypatch):
    """排队满抛专用异常（API 据此回 429，而不是 409）。"""
    from app.services.resume.resume_generate_manager import ResumeGenerateQueueFullError
    from app.services.resume.resume_generate_runner import ResumeGenerateRunnerError

    monkeypatch.setattr(
        manager_module,
        "get_settings",
        lambda: SimpleNamespace(resume_generate_max_concurrent=1, resume_generate_max_pending=1),
    )
    manager.start(201)  # 槽位 1：立即开跑
    manager.start(202)  # 排队 1/1
    with pytest.raises(ResumeGenerateQueueFullError, match="队列已满"):
        manager.start(203)
    assert issubclass(ResumeGenerateQueueFullError, ResumeGenerateRunnerError)
