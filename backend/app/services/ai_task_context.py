# SPDX-License-Identifier: Apache-2.0
"""AI 后台任务 handler 的上下文：取消协作、进度上报与结果落点，以及跨线程句柄。

纯搬迁自 ``ai_task_runner.py``：handler 能看到的全部能力面单独成文件，执行器
单例、线程编排与终态仲裁留在原模块。"""

from __future__ import annotations

import threading
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ..models.ai_task import AiTask
from .ai_task_registry import AiTaskCanceled
from .resume.resume_runner_loop import RunnerEventLoopHandle


class AiTaskContext:
    """handler 拿到的全部能力：上报进度、交回落点、检查取消、驱动异步调用。

    刻意**不**暴露"把任务标成成功/失败"的方法：终态由执行器统一仲裁（见模块 docstring
    的原子 UPDATE）。handler 一旦能自己写终态，取消与完成就会在同一个时间窗里打架。
    """

    def __init__(
        self,
        *,
        task_id: int,
        kind: str,
        payload: dict[str, Any],
        session: Session,
        session_factory: Callable[[], Session],
        cancel_event: threading.Event,
        loop_handle: RunnerEventLoopHandle,
    ) -> None:
        self._task_id = task_id
        self._kind = kind
        self._payload = payload
        self._session = session
        self._session_factory = session_factory
        self._cancel = cancel_event
        self._loop_handle = loop_handle
        self._result_ref: dict[str, Any] | None = None

    # ===== 只读信息 =====
    @property
    def task_id(self) -> int:
        return self._task_id

    @property
    def kind(self) -> str:
        return self._kind

    @property
    def payload(self) -> dict[str, Any]:
        return self._payload

    @property
    def result_ref(self) -> dict[str, Any] | None:
        """handler 交回的落点标识（执行器在成功收尾时写库）。"""
        return self._result_ref

    @property
    def session(self) -> Session:
        """任务自己的数据库会话（与租约引擎绑定）。handler 可读写，执行器负责收尾。"""
        return self._session

    @property
    def canceled(self) -> bool:
        """只读的取消标志：给出"要在停之前做点收尾（例如取消底层任务）"的 handler 用。"""
        return self._cancel.is_set()

    # ===== 取消协作 =====
    def check_canceled(self) -> None:
        """取消检查点：把"用户点了取消"变成一次可被执行器识别的异常。"""
        if self._cancel.is_set():
            raise AiTaskCanceled

    def sleep(self, seconds: float) -> None:
        """可被取消打断的等待（轮询型 handler 用它，别用 ``time.sleep``）。"""
        if self._cancel.wait(seconds):
            raise AiTaskCanceled

    # ===== 上报 =====
    def set_progress(self, progress: int, message: str = "") -> None:
        """上报 0–100 的粗粒度进度 + 一句阶段说明（前端页头任务面板直接显示）。

        ``message`` 为空时保留上一条：调用方常常只想推进度，不想重复那句话。
        """
        self.check_canceled()
        row = self._session.get(AiTask, self._task_id)
        if row is None:
            # 记录被清理（回收站/换库）：任务无处可写，按取消退出，别继续白跑。
            raise AiTaskCanceled
        row.progress = max(0, min(100, int(progress)))
        if message:
            row.message = message
        self._session.commit()

    def set_result(self, result_ref: dict[str, Any]) -> None:
        """交回"完成后点通知该跳哪"的标识，例如 ``{"resume_id": 12}``。"""
        self._result_ref = dict(result_ref)

    def drive(self, coro: Coroutine[Any, Any, Any]) -> None:
        """在本任务线程的事件循环里跑完 ``coro``，并允许其它线程中途取消它。

        与 ``asyncio.run`` 的差别只有一处、但很关键：主 task 句柄登记在
        ``RunnerEventLoopHandle`` 上，``cancel()`` 才能跨线程把取消打进挂起的 await
        （见 ``resume_runner_loop`` 模块 docstring）。协程里的返回值请写进闭包变量，
        这里不返回（保持与既有 handle 的接口一致）。
        """
        self._loop_handle.drive(coro)

    def open_session(self) -> Session:
        """另开一个会话（读"别的线程会改的表"时用它，避免 identity map 的陈旧读）。"""
        return self._session_factory()


@dataclass
class _Slot:
    """一个正在运行的任务占用的跨线程句柄（取消靠它打到任务线程去）。"""

    cancel: threading.Event
    loop_handle: RunnerEventLoopHandle
    thread: threading.Thread | None = None
