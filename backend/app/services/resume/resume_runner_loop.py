# SPDX-License-Identifier: Apache-2.0
"""工作线程事件循环的显式管理（PR-07 取消即时中止的机制载体）。

模型流可能挂在 socket read 上（对端不发数据）：``_stop`` 的检查点只在
chunk / 事件间隙轮询，永远轮询不到挂起的 await。把主 task 句柄登记在一个
可跨线程访问的句柄对象上，cancel()/shutdown() 才能经 ``call_soon_threadsafe``
把取消直接打进事件循环，线程亚秒级退出、租约即时归还。

取消引发的 CancelledError 由调用方（resume_generate_runner 的 ``_run``）
既有异常分类映射为"用户取消"；"结果未知不自动重放"的纪律不受影响。

**收尾纪律与 asyncio.run 对齐**：显式驱动循环也必须在关闭前取消残留任务并
``shutdown_asyncgens()``（见 ``_shutdown_loop``）。否则 provider 流里被 GC 的内层
异步生成器会在 ready 队列留下 athrow task，主 task 一完成循环就关，Task.__del__ 便打
``Task was destroyed but it is pending!``（2026-10-25/26 生产日志每条生成任务一条，用户可见
的"收尾报错"）。``asyncio.run`` 自带这两步，这正是"换成显式循环"时最容易丢的东西。
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
from typing import Any

logger = logging.getLogger(__name__)

# 收尾要跑几轮：第一轮取消主 task 之外的残留任务并关闭已登记的异步生成器；生成器的
# finalizer 钩子会在收尾期间再投递 create_task(aclose())，第二轮把新出现的任务收干净。
_SHUTDOWN_ROUNDS = 2


def _shutdown_loop(loop: asyncio.AbstractEventLoop) -> None:
    """执行与 asyncio.run 相同的收尾纪律：取消残留任务 + 关闭未收尾的异步生成器。

    **为什么必须**：drive() 用 run_until_complete(main_task) 替代 asyncio.run，但
    asyncio.run 在关闭循环前还做两件事——取消所有残留任务、shutdown_asyncgens()。
    少了它们，provider 流里被 GC 的异步生成器（真实 OpenAI/Anthropic 流在
    data: [DONE] 处以 break 退出内层 aiter_lines/aiter_sse，内层生成器随即失去引用）
    会把 finalizer 钩子投递的 create_task(agen.aclose()) 留在 ready 队列里；主 task
    已经完成、循环马上关闭，那个 athrow task 没机会执行就被销毁，Task.__del__ 打
    ERROR（生产日志里每条生成任务 completed 时恰好一条）。

    **不得吞掉业务异常**：本函数只处理收尾期的残留，不读取主 task 的结果；主 task 的
    异常由 run_until_complete 原样抛给调用方。
    """
    for _round in range(_SHUTDOWN_ROUNDS):
        # 先跑一轮空步：把 ready 队列里由 finalizer 钩子投递的 create_task 回调落成
        # 真实 task，后面才看得见、取消得掉。
        loop.run_until_complete(asyncio.sleep(0))
        pending = [task for task in asyncio.all_tasks(loop) if not task.done()]
        for task in pending:
            task.cancel()
        if pending:
            loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        # 关闭仍未 aclose 的异步生成器（各自的 finally 逐层展开）。
        loop.run_until_complete(loop.shutdown_asyncgens())


class RunnerEventLoopHandle:
    """持有一个工作线程事件循环与其主 task 的句柄（线程安全登记/取消）。"""

    def __init__(self, cancel_requested: threading.Event) -> None:
        # cancel_requested 就是 runner 的 _stop 事件：登记前到达的取消靠 drive 的
        # 复查兜住，登记后到达的取消走 cancel_main_task 的跨线程投递。
        self.cancel_requested = cancel_requested
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._main_task: asyncio.Task | None = None

    def drive(self, coro: Any) -> None:
        """在工作线程里显式驱动事件循环跑完 ``coro``（替代 ``asyncio.run``）。

        与 asyncio.run 的差别只有一个、但很关键：主 task 的句柄登记在句柄对象上，
        cancel_main_task() 才能跨线程中止它——asyncio.run 把循环和 task 藏在内部，
        外部唯一能做的就是等检查点轮询到，而挂在 socket read 上的流永远轮询不到。
        异常原样向上抛，由调用方的既有异常分类收尾（CancelledError → cancelled，
        其余照旧）。
        """
        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            main_task = loop.create_task(coro)
            with self._lock:
                self._loop = loop
                self._main_task = main_task
            # 竞态兜底：cancel 可能在登记完成之前已经请求了取消（此刻它拿不到
            # task 句柄，cancel_main_task 是空操作）；登记后复查一次，保证"已请求
            # 取消"一定转化为 task 取消。
            if self.cancel_requested.is_set():
                main_task.cancel()
            loop.run_until_complete(main_task)
        finally:
            with self._lock:
                self._loop = None
                self._main_task = None
            # 收尾失败不得掩盖主 task 的真实异常（取消/业务错误由调用方分类）：
            # 这里只记录，不向上抛。
            try:
                _shutdown_loop(loop)
            except Exception:  # noqa: BLE001 - 收尾是尽力而为，业务异常优先
                logger.exception("工作线程事件循环收尾失败")
            finally:
                asyncio.set_event_loop(None)
                loop.close()

    def request_cancel(self) -> None:
        """标记"已请求取消"（登记前到达的取消在 drive 的复查里兜住）。"""
        self.cancel_requested.set()

    def cancel_main_task(self) -> None:
        """跨线程中止挂起的模型调用：向工作线程的事件循环投递主 task 取消。

        循环已关闭（线程刚好退出）时投递会抛 RuntimeError——线程退出即
        租约归还，无需再取消，吞掉即可。
        """
        with self._lock:
            loop = self._loop
            task = self._main_task
        if loop is None or task is None or task.done():
            return
        with contextlib.suppress(RuntimeError):
            loop.call_soon_threadsafe(task.cancel)
