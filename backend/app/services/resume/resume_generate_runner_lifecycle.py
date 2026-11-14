# SPDX-License-Identifier: Apache-2.0
"""简历生成 worker 的生命周期（从 app.services.resume.resume_generate_runner 纯搬迁拆出）。

构造 / 线程启动 / 取消 / 关闭 / 任务会话与「当前任务」校验。执行体（_run 与落库）与状态写入
薄委托仍在 resume_generate_runner；本模块由它 re-export，测试与调用方的旧 import 路径不变。
被 monkeypatch 的模块级符号（create_provider / get_settings / prepare_selection_boost）
都留在 resume_generate_runner，不随本模块搬走。
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import sessionmaker

from ...database import SessionLocal
from ...runtime import dataset_scope
from ...runtime.dataset_scope import DatasetLease, DatasetScopeError
from ...runtime.log_context import run_with_bound_context
from ...services.resume.generate_snapshot import GenerationSnapshot
from .resume_runner_loop import RunnerEventLoopHandle

logger = logging.getLogger(__name__)


class ResumeGenerateRunnerError(Exception):
    """运行器控制类错误（任务未在运行等），message 为中文提示。"""


class _RunnerLifecycle:
    """单任务 worker 的生命周期：构造 / 启动 / 取消 / 关闭 / 任务会话。"""

    if TYPE_CHECKING:
        # 执行体与终态写入由宿主 ResumeGenerateRunner 提供（本 mixin 只做生命周期编排，
        # 声明在这里是为了 pyright 能解析 self._run / self._set_cancelled）。
        def _run(self, task_id: int) -> None: ...

        def _set_cancelled(self, task_id: int) -> None: ...

    def __init__(self, *, session_factory: Callable[[], Any] | None = None) -> None:
        # session_factory 默认 None：启动时按值冻结 engine（RF-03，rebind 仍写旧库）；显式传入（测试注入）优先。
        self._session_factory = session_factory
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._current_task_id: int | None = None
        self._lease: DatasetLease | None = None
        self._frozen_factory: Callable[[], Any] | None = None
        # 事件循环与主 task 句柄委托给句柄对象（机制见 resume_runner_loop docstring）：
        # cancel()/shutdown() 借它跨线程中止挂起的模型调用。
        self._loop_handle = RunnerEventLoopHandle(self._stop)
        self._generation_snapshot: GenerationSnapshot | None = None
        self._snapshot_id: int | None = None
        self._on_finished: Callable[[int], None] | None = None  # 收尾回调，只消费一次

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def current_task_id(self) -> int | None:
        return self._current_task_id

    def start(
        self,
        task_id: int,
        *,
        generation_snapshot: GenerationSnapshot | None = None,
        snapshot_id: int | None = None,
        on_finished: Callable[[int], None] | None = None,
    ) -> None:
        """启动后台生成任务；generation_snapshot=创建时冻结的快照；on_finished 在租约归还后回调。"""
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                raise ResumeGenerateRunnerError("已有简历生成任务正在进行中")
            # 先取租约再起线程（RF-03 TOCTOU）：切换持锁期间直接失败并回滚空任务。
            try:
                lease = dataset_scope.acquire_lease("resume-generate")
            except DatasetScopeError as exc:
                raise ResumeGenerateRunnerError(str(exc)) from exc
            self._lease = lease
            self._frozen_factory = (
                self._session_factory
                if self._session_factory is not None
                else sessionmaker(
                    bind=lease.identity.engine, autoflush=False, expire_on_commit=False
                )
            )
            self._stop.clear()
            self._current_task_id = task_id
            self._generation_snapshot = generation_snapshot
            self._snapshot_id = snapshot_id
            self._on_finished = on_finished
            self._thread = threading.Thread(
                # RF-20：复制启动方 contextvars 并绑定 task_id/dataset_id（同 apply 运行器）。
                target=run_with_bound_context(
                    self._run_releasing_lease,
                    task_id,
                    lease,
                    task_id=task_id,
                    dataset_id=lease.identity.dataset_id,
                ),
                name=f"rf-generate-{task_id}",
                daemon=True,
            )
            self._thread.start()

    def _run_releasing_lease(self, task_id: int, lease: DatasetLease) -> None:
        """线程入口：保证租约归还；收尾回调在归还后触发（排队任务才能立刻拿到租约）。"""
        try:
            self._run(task_id)
        finally:
            lease.release()
            callback, self._on_finished = self._on_finished, None
            if callback is not None:
                try:
                    callback(task_id)
                except Exception:  # noqa: BLE001 - 调度回调失败不得掩盖任务真实结果
                    logger.exception("生成任务完成回调失败 task_id=%s", task_id)

    def cancel(self, task_id: int) -> None:
        # 先落"取消"信号：若线程已跑完并提交终态，终态守卫会拒绝改写（apply 同款纪律）。
        self._require_current(task_id)
        self._stop.set()
        # 主动中止挂起的模型调用；终态晚于租约归还，避免紧随的切换在排空窗撞 409。
        self._loop_handle.cancel_main_task()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=2.0)
        self._set_cancelled(task_id)

    def shutdown(self) -> None:
        self._stop.set()
        # 与 cancel 同一机制：进程收拢时也主动中止挂起的模型调用（别白等 read timeout）。
        self._loop_handle.cancel_main_task()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=5)

    def _require_current(self, task_id: int) -> None:
        if self._current_task_id != task_id or not self.is_running():
            raise ResumeGenerateRunnerError("该任务当前未在运行，无法执行该操作")

    # ===== 工作线程 =====

    def _open_session(self) -> Any:
        """开一个任务会话：优先用启动时冻结的工厂（RF-03），退回测试注入，再退回全局。"""
        factory = self._frozen_factory or self._session_factory or SessionLocal
        return factory()
