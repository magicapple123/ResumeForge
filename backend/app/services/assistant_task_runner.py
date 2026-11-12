# SPDX-License-Identifier: Apache-2.0
"""#18A 助手长任务的唯一后台执行器（单例线程 + 条件推进）。

设计约束（来自收尾工单任务 1 与 T19/T20 的状态机）：
- 进程内同一时刻只跑一个助手任务：单例线程 + 锁；已在跑时 start **排队**——前一个
  到终态/暂停后自动开始下一个，同 id 不重复入队（不丢任务）。
- 同步核心 run_task_once(db, task_id)：可测试、可直接在测试里跑完一整个任务，
  与线程 wrapper 完全解耦（线程只负责开 SessionLocal 并兜异常）。
- 只推进 running 任务：每步之间重读数据库状态，paused/cancelled 立刻停；
  用户 resume 时从 resume_cursor 继续，已完成的步骤不重跑（advance_step 是条件写）。
- 不动 recover_running_tasks 的语义：重启只把 running 置 paused；执行器不碰它。
- 失败不吞咽：handler 抛异常 → 日志 + 任务 fail（error 可读）；线程 wrapper 兜住
  任何意外，避免线程静默死掉留下永远 running 的任务。
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.agent_task import (
    AGENT_TASK_STATUS_CANCELLED,
    AGENT_TASK_STATUS_DONE,
    AGENT_TASK_STATUS_FAILED,
    AGENT_TASK_STATUS_PAUSED,
    AGENT_TASK_STATUS_RUNNING,
    AgentTask,
)
from . import agent_task_service
from .assistant_task_handlers import clear_task_state, execute_step

logger = logging.getLogger(__name__)

#: 任务终态：到这些状态就停止推进。
TERMINAL_STATUSES = (
    AGENT_TASK_STATUS_DONE,
    AGENT_TASK_STATUS_FAILED,
    AGENT_TASK_STATUS_CANCELLED,
)
#: 单步失败时写进任务 error 的最大长度（任务行是状态位，不是日志）。
MAX_TASK_ERROR_CHARS = 500


def run_task_once(
    db: Session,
    task_id: int,
    *,
    execute: Callable[..., Any] | None = None,
) -> AgentTask:
    """同步推进一个 running 任务直到终态/暂停；返回最新快照。

    execute 可注入（默认真实 handler 分发，测试用它构造"必失败的一步"或"阻塞的一步"）。
    默认值在**调用时**才解析成模块里的 `execute_step`（不做定义期绑定），这样测试用
    `monkeypatch.setattr(runner_module, "execute_step", ...)` 就能替换执行器线程里的行为。
    只接受 running 状态：draft 要先 start、paused 要先 resume、终态直接返回。
    """
    run_step = execute_step if execute is None else execute
    task = agent_task_service.get_task(db, task_id)
    if task.status != AGENT_TASK_STATUS_RUNNING:
        return task
    while True:
        task = agent_task_service.get_task(db, task_id)
        if task.status in TERMINAL_STATUSES or task.status == AGENT_TASK_STATUS_PAUSED:
            break
        if task.status != AGENT_TASK_STATUS_RUNNING:
            break
        cursor = int(task.resume_cursor or 0)
        steps = list(task.steps)
        if cursor < 0 or cursor >= len(steps):
            agent_task_service.fail(db, task_id, f"任务游标越界（cursor={cursor}），无法继续")
            task = agent_task_service.get_task(db, task_id)
            break
        step = steps[cursor]
        try:
            agent_task_service.mark_step_running(db, task_id, cursor)
            result = run_step(db, task, step)
        except Exception as exc:  # noqa: BLE001 - 执行器不能因单步异常静默死掉
            logger.exception("助手任务执行步骤异常 task_id=%s step=%s", task_id, cursor)
            agent_task_service.fail(
                db, task_id, f"第 {cursor + 1} 步执行出错：{exc}"[:MAX_TASK_ERROR_CHARS]
            )
            task = agent_task_service.get_task(db, task_id)
            break
        if not result.ok:
            message = str(result.error or f"第 {cursor + 1} 步失败")
            agent_task_service.fail(db, task_id, message[:MAX_TASK_ERROR_CHARS])
            task = agent_task_service.get_task(db, task_id)
            break
        agent_task_service.advance_step(db, task_id, cursor, output_ref=result.output_ref)
    final = agent_task_service.get_task(db, task_id)
    if final.status in TERMINAL_STATUSES:
        clear_task_state(task_id)
    return final


class AssistantTaskRunner:
    """单例线程执行器：同一时刻最多一个助手任务在跑，其余按 FIFO 排队。"""

    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._task_id: int | None = None
        #: 等待执行的任务 id（FIFO）；由 `_run` 的 finally 在锁内出队并派生下一个线程。
        self._pending: deque[int] = deque()
        self._lock = threading.Lock()

    def is_running(self) -> bool:
        thread = self._thread
        return thread is not None and thread.is_alive()

    def pending_ids(self) -> tuple[int, ...]:
        """排队中的任务 id 快照（测试与排障用；不代表这些任务已开始）。"""
        with self._lock:
            return tuple(self._pending)

    def start(self, task_id: int) -> bool:
        """接受一个任务：空闲则立即拉起线程，已有任务在跑则排队。

        返回值语义是"**已接受**"而不是"已开始"：排队时同样返回 True。已在跑时排队、
        前一个任务到终态/暂停后自动开始下一个；**同 id 不会重复入队**（去重只看队列，
        不看正在跑的那个——否则"暂停后立刻继续"会被误当成重复而丢失）。

        之所以必须排队：API 层已把任务置为 running，若这里丢弃请求就没有任何线程会
        推进它，只能等重启或手动"暂停→继续"才能恢复。
        """
        task_id = int(task_id)
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                if task_id in self._pending:
                    logger.info("助手任务执行器忙，同 id 已在队列里，忽略 task_id=%s", task_id)
                    return True
                self._pending.append(task_id)
                logger.info(
                    "执行器忙，已排队 task_id=%s pending=%s", task_id, list(self._pending)
                )
                return True
            self._spawn_locked(task_id)
            return True

    def _spawn_locked(self, task_id: int) -> None:
        """在**已持有 `self._lock`** 的前提下派生执行线程。

        必须是"锁内派生"：若在锁外调用，外部 `start()` 可能抢在出队与新线程登记之间
        插进来，导致队列顺序反转或同一个 id 被启动两次。
        """
        task_id = int(task_id)
        self._task_id = task_id
        self._thread = threading.Thread(
            target=self._run,
            args=(task_id,),
            name=f"assistant-task-{task_id}",
            daemon=True,
        )
        self._thread.start()

    def _run(self, task_id: int) -> None:
        try:
            with SessionLocal() as db:
                final = run_task_once(db, task_id)
            logger.info(
                "助手任务执行结束 task_id=%s status=%s cursor=%s",
                task_id,
                final.status,
                final.resume_cursor,
            )
        except Exception:  # noqa: BLE001 - 线程 wrapper 的最后一道保险
            logger.exception("助手任务执行线程异常 task_id=%s", task_id)
            try:
                with SessionLocal() as db:
                    agent_task_service.fail(db, task_id, "任务执行器异常中止，可在任务卡重试")
            except Exception:  # noqa: BLE001 - 连失败都写不进去时只能记日志
                logger.exception("助手任务失败状态写不进去 task_id=%s", task_id)
        finally:
            with self._lock:
                self._thread = None
                self._task_id = None
                next_id = self._pending.popleft() if self._pending else None
                if next_id is not None:
                    # 锁内派生，避免外部 start 插队导致顺序反转。
                    self._spawn_locked(next_id)
                    logger.info("助手任务执行器接续下一个 task_id=%s", next_id)


#: 进程内单例（API 层与测试共用；测试可直接调 run_task_once 而不启动线程）。
runner = AssistantTaskRunner()


__all__ = [
    "AssistantTaskRunner",
    "MAX_TASK_ERROR_CHARS",
    "TERMINAL_STATUSES",
    "run_task_once",
    "runner",
]
