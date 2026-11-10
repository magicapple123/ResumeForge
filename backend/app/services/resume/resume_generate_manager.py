# SPDX-License-Identifier: Apache-2.0
"""简历生成并发管理器：运行槽位 + FIFO 排队 + 每任务 worker（问题清单 §9）。

职责边界：

- ResumeGenerateRunner 保持"单任务 worker"身份（线程、预算、快照、落库编排不变），
  本模块只负责**调度**：最多同时 RESUME_GENERATE_MAX_CONCURRENT 个 worker；超出的
  任务按入队顺序排队，有空位自动开始（用户不需要重试）。
- **提交不限制**：所有任务先落一行 resume_generate_task（pending = 排队态，不额外
  建表、任务行结构不变）；只有排队数到 RESUME_GENERATE_MAX_PENDING 才拒绝（429）。
- 队列里的任务**不持数据集租约**（只有真正开始的 worker 才 acquire_lease）。启动排队任务
  时若数据集身份已变，不拿新库跑旧快照：用**原身份**的 engine 把任务标 failed
  （「数据集已切换，请重新发起」）——刻意的"宁可失败，不写错库"。
- 取消按 task_id 路由：运行中交给对应 worker，排队中直接移出队列写终态，互不影响其它
  任务。失败不自动重排（重排会掩盖模型限流/额度问题）。
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from ...config import get_settings
from ...models.resume import GENERATE_STATUS_FAILED, ResumeGenerateTask
from ...runtime import dataset_scope
from ...runtime.dataset_scope import DatasetIdentity
from ...services.llm.usage_tasks import (
    ambient_scope,
    ambient_task,
    set_ambient_scope,
    set_ambient_task,
)
from .generate_snapshot import GenerationSnapshot
from .resume_generate_runner import ResumeGenerateRunner, ResumeGenerateRunnerError
from .resume_task_state import finalize_task, set_cancelled

logger = logging.getLogger(__name__)

# 排队任务的初始文案（API 建任务行时写进 message，前端任务条/进度条原样展示）。
QUEUE_MESSAGE = "排队中，等待空闲生成槽位"


class ResumeGenerateQueueFullError(ResumeGenerateRunnerError):
    """排队已满：API 据此回 429（"提交不限制"是指不因已有任务而拒绝）。"""


@dataclass
class _QueuedGeneration:
    """一条排队中的生成任务：worker 启动所需的全部输入 + 入队时的运行环境。"""

    task_id: int
    generation_snapshot: GenerationSnapshot | None
    snapshot_id: int | None
    # 入队时刻的数据集身份：排队任务不持租约，启动前要确认身份没变（见模块 docstring）。
    identity: DatasetIdentity
    # 入队时刻的用量审计上下文（任务名 / 输入范围 / 语言 / 预算）。排队任务由**上一个
    # worker 的收尾线程**启动，不显式恢复就会继承上一个任务的 language/budget。
    ambient_task: str | None
    ambient_scope: dict[str, object]
    # 入队那次 HTTP 请求的 request_id：日志关联必须指向"发起这条任务的请求"。
    request_id: str


class ResumeGenerateManager:
    """生成任务调度器：运行槽位有上限，超出排队；每个运行中的任务一个 worker。"""

    def __init__(self, *, session_factory: Callable[[], Any] | None = None) -> None:
        # 测试注入的会话工厂（既有用例给 runner._session_factory 赋值）：透传给每个 worker。
        self._session_factory = session_factory
        self._workers: dict[int, ResumeGenerateRunner] = {}
        self._pending: deque[_QueuedGeneration] = deque()
        self._lock = threading.Lock()

    # ===== 兼容既有调用点的只读查询 =====

    def is_running(self) -> bool:
        with self._lock:
            return bool(self._workers)

    def current_task_id(self) -> int | None:
        with self._lock:
            return next(iter(self._workers), None)

    # ===== 调度 =====

    def start(
        self,
        task_id: int,
        *,
        generation_snapshot: GenerationSnapshot | None = None,
        snapshot_id: int | None = None,
    ) -> None:
        """接收一条新建任务：有空槽立即开跑，否则排队（排队满才抛队列已满）。"""
        with self._lock:
            if task_id in self._workers:
                raise ResumeGenerateRunnerError("该任务已在生成中")
            queued = self._queue_entry(task_id, generation_snapshot, snapshot_id)
            if len(self._workers) < self._max_concurrent():
                self._launch_locked(queued)
                return
            if len(self._pending) >= self._max_pending():
                raise ResumeGenerateQueueFullError("生成队列已满，请等待现有任务完成")
            self._pending.append(queued)

    def cancel(self, task_id: int) -> None:
        """取消一条任务：运行中交给对应 worker，排队中移出队列并写终态，其余按 409。"""
        with self._lock:
            worker = self._workers.get(task_id)
            queued = self._pop_pending_locked(task_id)
        # worker.cancel 会 join 工作线程，而线程收尾要拿 manager 锁——必须在锁外调用。
        if worker is not None:
            worker.cancel(task_id)
            return
        if queued is not None:
            set_cancelled(
                queued.task_id,
                open_session=dataset_scope.frozen_session_factory(queued.identity),
            )
            return
        raise ResumeGenerateRunnerError("该任务当前未在运行，无法执行该操作")

    def shutdown(self) -> None:
        """收拢所有 worker。排队任务**不主动改状态**：交给启动恢复标 failed（不自动重跑）。"""
        with self._lock:
            workers = list(self._workers.values())
            self._pending.clear()
        for worker in workers:
            try:
                worker.shutdown()
            except Exception:  # noqa: BLE001 - 退出路径必须继续清理其它 worker
                logger.warning("关闭简历生成 worker 失败", exc_info=True)
        with self._lock:
            self._workers.clear()

    # ===== 内部：队列与 worker 生命周期 =====

    def _max_concurrent(self) -> int:
        return get_settings().resume_generate_max_concurrent

    def _max_pending(self) -> int:
        return get_settings().resume_generate_max_pending

    def _queue_entry(
        self,
        task_id: int,
        generation_snapshot: GenerationSnapshot | None,
        snapshot_id: int | None,
    ) -> _QueuedGeneration:
        # 局部导入：服务层不长期依赖 middleware（同 assistant_tool_exec 的既有做法）。
        from ...middleware.request_context import get_request_id

        return _QueuedGeneration(
            task_id=task_id,
            generation_snapshot=generation_snapshot,
            snapshot_id=snapshot_id,
            identity=dataset_scope.current_identity(),
            ambient_task=ambient_task(),
            ambient_scope=ambient_scope(),
            request_id=get_request_id(),
        )

    def _pop_pending_locked(self, task_id: int) -> _QueuedGeneration | None:
        for index, item in enumerate(self._pending):
            if item.task_id == task_id:
                del self._pending[index]
                return item
        return None

    def _launch_locked(self, queued: _QueuedGeneration) -> None:
        """在**已持有 manager 锁**时启动一条任务（租约由 worker.start 获取）。"""
        # 队列任务可能在别的 worker 收尾线程里启动：显式恢复入队时的审计上下文与
        # 请求关联 ID（否则日志的 request_id 会串成上一个 worker 的那次请求）。
        from ...middleware.request_context import request_id_context

        request_id_context.set(queued.request_id)
        set_ambient_task(queued.ambient_task)
        if queued.ambient_scope:
            set_ambient_scope(**queued.ambient_scope)  # type: ignore[arg-type]
        worker = ResumeGenerateRunner(session_factory=self._session_factory)
        # 先登记再启动：worker 若极快结束，收尾回调会在 on_finished 里 pop；后登记就会把
        # 已结束的 worker 留在槽位表里、白占一个槽位（只有极端快的 Provider 才可能触发）。
        self._workers[queued.task_id] = worker
        try:
            worker.start(
                queued.task_id,
                generation_snapshot=queued.generation_snapshot,
                snapshot_id=queued.snapshot_id,
                on_finished=self._on_finished,
            )
        except Exception:
            self._workers.pop(queued.task_id, None)
            raise

    def _on_finished(self, task_id: int) -> None:
        """worker 收尾回调（租约已归还）：腾出槽位并按 FIFO 启动排队任务。"""
        with self._lock:
            self._workers.pop(task_id, None)
            while self._pending and len(self._workers) < self._max_concurrent():
                self._start_pending_locked(self._pending.popleft())

    def _start_pending_locked(self, queued: _QueuedGeneration) -> None:
        current = dataset_scope.current_identity()
        if (current.dataset_id, current.generation) != (
            queued.identity.dataset_id,
            queued.identity.generation,
        ):
            # 排队期间切过数据集：快照属于原数据集，绝不拿新库跑旧任务（见模块 docstring）。
            self._mark_failed(queued, "数据集已切换，请重新发起")
            return
        try:
            self._launch_locked(queued)
        except Exception as exc:  # noqa: BLE001 - 排队任务必须有终态，不能永远停在 pending
            logger.warning("排队生成任务启动失败 task_id=%s：%s", queued.task_id, exc)
            self._mark_failed(queued, str(exc) or "生成任务启动失败，请重新发起")

    def _mark_failed(self, queued: _QueuedGeneration, message: str) -> None:
        """用**任务原数据集**的会话写 failed 终态（不碰当前库）。"""
        try:
            factory = dataset_scope.frozen_session_factory(queued.identity)
            with factory() as session:
                task = session.get(ResumeGenerateTask, queued.task_id)
                if task is not None:
                    finalize_task(session, task, GENERATE_STATUS_FAILED, error=message)
        except Exception:  # noqa: BLE001 - 收尾写库失败：任务行留给启动恢复兜底，不反向炸调度
            logger.exception("排队生成任务失败收尾写库失败 task_id=%s", queued.task_id)


_MANAGER: ResumeGenerateManager | None = None
_MANAGER_LOCK = threading.Lock()


def get_resume_generate_runner() -> ResumeGenerateManager:
    """进程内共享的生成管理器单例。

    名字沿用历史 API（调用方只关心"拿一个能 start/cancel/shutdown 的对象"）；并发模型
    从"单例运行器"换成"管理器 + 每任务 worker"后，调用点无需改动。
    """
    global _MANAGER
    with _MANAGER_LOCK:
        if _MANAGER is None:
            _MANAGER = ResumeGenerateManager()
        return _MANAGER


def reset_resume_generate_runner() -> None:
    """测试用：停止所有 worker 并释放单例，避免用例之间共享线程状态。"""
    global _MANAGER
    with _MANAGER_LOCK:
        if _MANAGER is not None:
            _MANAGER.shutdown()
        _MANAGER = None


__all__ = [
    "QUEUE_MESSAGE",
    "ResumeGenerateManager",
    "ResumeGenerateQueueFullError",
    "get_resume_generate_runner",
    "reset_resume_generate_runner",
]
