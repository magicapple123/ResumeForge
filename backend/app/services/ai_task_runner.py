# SPDX-License-Identifier: Apache-2.0
"""AI 任务执行器：把 handler 放到**后台线程**跑，与发起它的 HTTP 请求彻底解耦。

**为什么必须解耦**：改动前多数 AI 入口是"请求-响应一体"——用户在等的那条 HTTP 连接
就是任务的生命线。关掉弹窗 / 切页 / 刷新，连接一断，浏览器不再读响应，后端却还在把
token 烧完（`sync def` 端点尤其明显：它跑在线程池里，客户端断开对它毫无影响）。
本执行器把 handler 交给一个 daemon 线程，请求只负责"建任务 + 启动"，然后立刻返回
``{id, status}``；前端靠 ``GET /ai-tasks/{id}`` 轮询。请求断开不影响任务，任务也不需要
请求上下文。

**取消怎么做到"真的停"**（两道闸，缺一不可）：

1. :class:`AiTaskContext` 持有一个 ``threading.Event``。handler 在阶段边界调用
   ``ctx.check_canceled()``、在轮询等待里调用 ``ctx.sleep()``——两次模型输出之间的间隙
   靠它拦住。
2. 模型流可能挂在 socket read 上（对端不发数据），而检查点只在 chunk 之间轮询，永远轮询
   不到挂起的 ``await``。所以复用 ``resume_generate_runner`` 已经在用的
   :class:`RunnerEventLoopHandle`：主协程 task 的句柄登记在句柄对象上，``cancel()`` 借
   ``call_soon_threadsafe`` 把取消直接打进任务线程的事件循环，亚秒级退出。
   **不另写线程池**——同一套跨线程中止机制，一处修两处受益。

**终态仲裁是原子的**：完成、失败、取消三方都走 ``UPDATE … WHERE status IN (pending,
running)``，谁先落谁赢，后来的 UPDATE 影响 0 行即自动放弃。这样"用户点了取消，但 handler
恰好在同一瞬间成功"不会互相覆盖成一半取消一半成功——``canceled`` 先落，成功就被丢弃。

**数据集隔离**：``start()`` 在**发起线程**里取 ``dataset_scope.acquire_lease``（项目硬约束），
并把租约身份的 engine 按值冻结成 sessionmaker（RF-03）。于是任务运行期间切换数据集不会
把结果写到新库去，租约在收尾（无论成功/失败/取消）时归还。
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any

from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

from ..database import SessionLocal
from ..models.ai_task import (
    AI_TASK_ACTIVE_STATUSES,
    AI_TASK_STATUS_CANCELED,
    AI_TASK_STATUS_FAILED,
    AI_TASK_STATUS_RUNNING,
    AI_TASK_STATUS_SUCCEEDED,
    AiTask,
)
from ..models.profile import utcnow
from ..runtime import dataset_scope
from ..runtime.dataset_scope import DatasetLease, DatasetScopeError
from ..runtime.log_context import run_with_bound_context
from ..services.llm.base import LLMError
from .ai_task_registry import (
    AiTaskCanceled,
    AiTaskHandler,
    AiTaskHandlerError,
    get_ai_task_handler,
)
from .resume.resume_runner_loop import RunnerEventLoopHandle

logger = logging.getLogger(__name__)


class AiTaskRunnerError(Exception):
    """执行器控制类错误（类型未注册、数据集正在切换…），message 可直接展示。"""


class AiTaskNotFoundError(AiTaskRunnerError):
    """任务记录不存在（API 层据此回 404，而不是 500）。"""


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


class AiTaskRunner:
    """进程内单例执行器：可同时跑多个任务（每个任务一线程 + 一事件循环 + 一租约）。"""

    def __init__(self, *, session_factory: Callable[[], Session] | None = None) -> None:
        # session_factory 显式传入时优先（测试注入）；否则用全局 SessionLocal，
        # 真正执行时按租约身份再冻结一层（RF-03）。
        self._session_factory = session_factory
        self._lock = threading.Lock()
        self._slots: dict[int, _Slot] = {}

    # ===== 查询 =====
    def is_running(self, task_id: int | None = None) -> bool:
        with self._lock:
            if task_id is None:
                return bool(self._slots)
            slot = self._slots.get(task_id)
        return slot is not None and slot.thread is not None and slot.thread.is_alive()

    def running_task_ids(self) -> tuple[int, ...]:
        with self._lock:
            return tuple(sorted(self._slots))

    # ===== 启动 =====
    def start(self, task_id: int) -> None:
        """读任务行、解析 handler、取租约、起线程。已在跑则幂等返回。"""
        factory = self._session_factory or SessionLocal
        probe = factory()
        try:
            task = probe.get(AiTask, task_id)
            if task is None:
                raise AiTaskNotFoundError("任务记录不存在")
            kind = str(task.kind or "")
            payload = dict(task.payload or {})
        finally:
            probe.close()

        handler = get_ai_task_handler(kind)
        if handler is None:
            raise AiTaskRunnerError(f"未注册的任务类型：{kind}")

        with self._lock:
            if task_id in self._slots:
                return
            # 先取租约再起线程（RF-03 TOCTOU）：切换持锁期间直接失败，不留孤儿任务。
            try:
                lease = dataset_scope.acquire_lease(f"ai-task:{kind}")
            except DatasetScopeError as exc:
                raise AiTaskRunnerError(str(exc)) from exc
            cancel = threading.Event()
            slot = _Slot(cancel=cancel, loop_handle=RunnerEventLoopHandle(cancel))
            self._slots[task_id] = slot

        # 按值冻结租约身份的 engine：任务期间切换数据集，写入仍落在旧库。
        frozen = sessionmaker(bind=lease.identity.engine, autoflush=False, expire_on_commit=False)
        thread = threading.Thread(
            target=run_with_bound_context(
                self._run_releasing_lease,
                task_id,
                kind,
                payload,
                handler,
                lease,
                slot,
                frozen,
                task_id=task_id,
                dataset_id=lease.identity.dataset_id,
            ),
            name=f"rf-ai-task-{task_id}",
            daemon=True,
        )
        slot.thread = thread
        thread.start()

    def _run_releasing_lease(
        self,
        task_id: int,
        kind: str,
        payload: dict[str, Any],
        handler: AiTaskHandler,
        lease: DatasetLease,
        slot: _Slot,
        factory: Callable[[], Session],
    ) -> None:
        """线程入口：无论任务怎么收尾，租约与运行槽位都会归还。"""
        try:
            self._run(task_id, kind, payload, handler, lease, slot, factory)
        finally:
            lease.release()
            with self._lock:
                self._slots.pop(task_id, None)

    def _run(
        self,
        task_id: int,
        kind: str,
        payload: dict[str, Any],
        handler: AiTaskHandler,
        lease: DatasetLease,
        slot: _Slot,
        factory: Callable[[], Session],
    ) -> None:
        session = factory()
        context = AiTaskContext(
            task_id=task_id,
            kind=kind,
            payload=payload,
            session=session,
            session_factory=factory,
            cancel_event=slot.cancel,
            loop_handle=slot.loop_handle,
        )
        try:
            if not self._mark_running(session, task_id):
                # 刚建就取消（或已被别处收尾）：不执行 handler，保持既有终态。
                return
            try:
                handler(context)
            except AiTaskCanceled:
                self._mark_terminal(session, task_id, AI_TASK_STATUS_CANCELED, error="已取消")
                return
            except asyncio.CancelledError:
                # 跨线程取消打到事件循环后，有些实现会以 CancelledError 形式冒出来。
                self._mark_terminal(session, task_id, AI_TASK_STATUS_CANCELED, error="已取消")
                return
            except DatasetScopeError as exc:
                # 数据集已切换（防御路径：租约正常时应挡住切换）：结果绝不写到新库去。
                logger.warning("AI 任务因数据集切换中止 task_id=%s：%s", task_id, exc)
                self._mark_terminal(session, task_id, AI_TASK_STATUS_FAILED, error=str(exc))
                return
            except (AiTaskHandlerError, LLMError) as exc:
                logger.warning("AI 任务失败 task_id=%s：%s", task_id, exc)
                self._mark_terminal(
                    session, task_id, AI_TASK_STATUS_FAILED, error=str(exc) or "任务失败"
                )
                return
            except Exception:  # noqa: BLE001 - 任务线程异常必须兜底，绝不能静默丢失
                logger.exception("AI 任务执行发生内部错误 task_id=%s", task_id)
                self._mark_terminal(
                    session,
                    task_id,
                    AI_TASK_STATUS_FAILED,
                    error="任务执行发生内部错误，详见后端日志",
                )
                return

            # handler 正常返回：写回前再校验一次数据集归属。
            try:
                lease.check()
            except DatasetScopeError as exc:
                logger.warning("AI 任务因数据集切换放弃写入 task_id=%s：%s", task_id, exc)
                self._mark_terminal(session, task_id, AI_TASK_STATUS_FAILED, error=str(exc))
                return
            self._mark_terminal(
                session,
                task_id,
                AI_TASK_STATUS_SUCCEEDED,
                result_ref=context.result_ref,
            )
        finally:
            session.close()

    # ===== 取消 =====
    def cancel(self, task_id: int) -> AiTask:
        """协作式取消：先发信号（让 handler 停），再落库（让前端看到 canceled）。

        已到终态的任务**幂等**：直接返回当前行，不改写、不报错——取消按钮不该因为
        "任务刚好跑完"而弹一个错误。
        """
        with self._lock:
            slot = self._slots.get(task_id)
        if slot is not None:
            slot.cancel.set()
            # 主动中止挂起的模型调用：只 set 事件停不掉挂在 socket read 上的 await。
            slot.loop_handle.cancel_main_task()
        session = (self._session_factory or SessionLocal)()
        try:
            task = session.get(AiTask, task_id)
            if task is None:
                raise AiTaskNotFoundError("任务记录不存在")
            if task.status not in AI_TASK_ACTIVE_STATUSES:
                return task
            self._mark_terminal(session, task_id, AI_TASK_STATUS_CANCELED, error="已取消")
            session.expire_all()
            refreshed = session.get(AiTask, task_id)
            return refreshed or task
        finally:
            session.close()

    def mark_failed(self, task_id: int, reason: str) -> None:
        """启动失败等"还没进 handler 就结束"的收尾，避免留下幽灵 pending 行。"""
        session = (self._session_factory or SessionLocal)()
        try:
            self._mark_terminal(session, task_id, AI_TASK_STATUS_FAILED, error=reason)
        finally:
            session.close()

    def shutdown(self) -> None:
        """进程收拢：给全部在跑的任务发取消信号并短暂等待（别让 daemon 线程带着租约走）。"""
        with self._lock:
            slots = list(self._slots.values())
        for slot in slots:
            slot.cancel.set()
            slot.loop_handle.cancel_main_task()
        for slot in slots:
            thread = slot.thread
            if thread is not None:
                thread.join(timeout=5)

    # ===== 终态落库（原子仲裁） =====

    def _mark_running(self, session: Session, task_id: int) -> bool:
        """pending→running。返回是否真的抢到（False = 已被取消/收尾，不该再执行）。"""
        try:
            result = session.execute(
                update(AiTask)
                .where(AiTask.id == task_id, AiTask.status.in_(AI_TASK_ACTIVE_STATUSES))
                .values(status=AI_TASK_STATUS_RUNNING, started_at=utcnow(), progress=1)
            )
            session.commit()
        except Exception:  # noqa: BLE001 - 落库失败按"没抢到"处理，绝不带病执行
            logger.exception("AI 任务置为运行态失败 task_id=%s", task_id)
            session.rollback()
            return False
        return result.rowcount > 0

    def _mark_terminal(
        self,
        session: Session,
        task_id: int,
        status: str,
        *,
        error: str = "",
        result_ref: dict[str, Any] | None = None,
    ) -> None:
        """写终态。**只从 pending/running 出发**：谁先落谁赢，后来的影响 0 行即放弃。"""
        # handler 可能留下半截事务（甚至处于失败状态），先丢掉再原子更新。
        try:
            session.rollback()
        except Exception:  # noqa: BLE001 - 回滚失败不影响下面的 UPDATE
            logger.warning("AI 任务收尾前回滚失败 task_id=%s", task_id)
        values: dict[str, Any] = {"status": status, "finished_at": utcnow()}
        if status == AI_TASK_STATUS_SUCCEEDED:
            values["progress"] = 100
            if result_ref:
                values["result_ref"] = result_ref
        if error:
            values["error"] = error
        try:
            session.execute(
                update(AiTask)
                .where(AiTask.id == task_id, AiTask.status.in_(AI_TASK_ACTIVE_STATUSES))
                .values(**values)
            )
            session.commit()
        except Exception:  # noqa: BLE001 - 终态写不进去也不能让线程崩在 finally 里
            logger.exception("AI 任务写终态失败 task_id=%s status=%s", task_id, status)
            session.rollback()


_RUNNER: AiTaskRunner | None = None
_RUNNER_LOCK = threading.Lock()


def get_ai_task_runner() -> AiTaskRunner:
    """进程内共享的任务执行器单例。"""
    global _RUNNER
    with _RUNNER_LOCK:
        if _RUNNER is None:
            _RUNNER = AiTaskRunner()
        return _RUNNER


def reset_ai_task_runner() -> None:
    """测试用：释放单例，避免用例之间共享线程状态。"""
    global _RUNNER
    with _RUNNER_LOCK:
        if _RUNNER is not None:
            _RUNNER.shutdown()
        _RUNNER = None


__all__ = [
    "AiTaskCanceled",
    "AiTaskContext",
    "AiTaskNotFoundError",
    "AiTaskRunner",
    "AiTaskRunnerError",
    "get_ai_task_runner",
    "reset_ai_task_runner",
]
