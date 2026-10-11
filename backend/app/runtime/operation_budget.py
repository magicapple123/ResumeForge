"""业务操作总预算：monotonic deadline + 共享取消事件 + child() 派生。

给"由多段网络调用/重试/工具轮次组成的业务操作"一个总 deadline 与协作式取消
（架构文档 §2.2）。第一个使用方是简历生成任务（RF-02）：模型流式输出期间每个
事件后调用 :meth:`OperationBudget.raise_if_stopped`，预算到期即断流收尾，不再
出现"等下一块 chunk 才能检查取消"之外的无限等待。

设计约定：
- **纯墙钟**（``time.monotonic()``），不涉及 asyncio 事件循环；在工作线程里
  按事件频率轮询，与"每 chunk 检查停止信号"同频；
- ``cancel_event`` 可注入外部 ``threading.Event``——调用方把既有取消信号
  （如 ``ResumeGenerateRunner._stop``）传进来，避免两套取消信号各说各话；
- 取消与过期共用一个异常类型（:class:`OperationCancelled`），用 message 区分
  原因，让上层能分别落 cancelled / failed。
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

_CANCELLED_MESSAGE = "已取消"
_EXPIRED_MESSAGE = "操作超时，已终止"


class OperationCancelled(Exception):
    """操作被用户取消或预算耗尽。message 为中文且区分原因（已取消 / 超时）。"""


@dataclass
class OperationBudget:
    """一次业务操作的总预算。``deadline`` 是 ``time.monotonic()`` 的绝对值。"""

    deadline: float
    cancel_event: threading.Event = field(default_factory=threading.Event)

    @classmethod
    def start(
        cls, seconds: float, *, cancel_event: threading.Event | None = None
    ) -> OperationBudget:
        """以"现在 + seconds"为 deadline 建立预算；``seconds`` 必须为正。"""
        if seconds <= 0:
            raise ValueError(f"预算秒数必须为正数，收到 {seconds!r}")
        return cls(
            deadline=time.monotonic() + seconds,
            cancel_event=cancel_event if cancel_event is not None else threading.Event(),
        )

    def remaining(self) -> float:
        """距预算耗尽还剩多少秒（可能为负）。"""
        return self.deadline - time.monotonic()

    def is_expired(self) -> bool:
        return self.remaining() <= 0

    def is_cancelled(self) -> bool:
        return self.cancel_event.is_set()

    def expiry_reason(self) -> str:
        """停止原因：用户取消优先于超时（两者同时成立时按取消归类）。"""
        return _CANCELLED_MESSAGE if self.is_cancelled() else _EXPIRED_MESSAGE

    def raise_if_stopped(self) -> None:
        """取消或过期即抛 :class:`OperationCancelled`；正常时零开销返回。"""
        if self.is_cancelled() or self.is_expired():
            raise OperationCancelled(self.expiry_reason())

    def child(self, max_seconds: float | None = None) -> OperationBudget:
        """派生受限子预算：deadline 取 ``min(父, now + max_seconds)``，共享取消事件。

        生成任务里的"格式修复 / 质量重试"每段取 child，保证任何一段的内部重试
        都不可能把整次操作拖过总预算。
        """
        if max_seconds is None:
            deadline = self.deadline
        else:
            if max_seconds <= 0:
                raise ValueError(f"子预算秒数必须为正数，收到 {max_seconds!r}")
            deadline = min(self.deadline, time.monotonic() + max_seconds)
        return OperationBudget(deadline=deadline, cancel_event=self.cancel_event)

    def cancel(self) -> None:
        """触发取消信号。幂等：重复调用等价于一次。"""
        self.cancel_event.set()

    def __repr__(self) -> str:
        state = (
            "cancelled"
            if self.is_cancelled()
            else ("expired" if self.is_expired() else f"remaining={self.remaining():.3f}s")
        )
        return f"OperationBudget({state})"


__all__ = ["OperationBudget", "OperationCancelled"]
