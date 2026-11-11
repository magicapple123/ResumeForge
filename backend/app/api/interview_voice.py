# SPDX-License-Identifier: Apache-2.0
"""模拟面试实时语音 P0 的服务端控制面：活动轮次登记 + cancel 端点 + 幂等落库入口。

自 ``interview_stream.py`` 拆出（#26 P0 加 cancel/interrupted 之后那支过了 500 行预算）。
这里只有**控制面**：谁在生成、怎么取消、回答怎么按 ``client_turn_id`` 幂等落库；
SSE 事件怎么排、回滚文本怎么写在 ``interview_stream.py`` 与
``services/interview/voice_turns.py``。

## cancel 为什么是独立 HTTP 请求

现有链路是 POST SSE（前端 ``fetch` + ``consumeSSE``），同一条连接上没法再发控制帧。
插话时客户端先发 ``POST /api/interview/voice/turns/cancel`，再 abort 当前流；生成器在
下一个 delta 边界看到 ``cancelled`` 就停下并回滚。本地单用户应用不做多路复用，
cancel 不带标识时取消全部活动轮次（通常只有一条），最不容易误伤历史轮次。

## 为什么不用 asyncio.Event

生成器只在 delta 边界检查，不需要唤醒等待者；而且测试里 cancel 可能来自另一个线程
（TestClient 的 portal 线程），跨事件循环的 Event 反而不可靠。普通 bool + 锁足够。
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from threading import Lock

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..models.interview import InterviewMessage, InterviewSession
from ..services.interview.voice_turns import record_answer_for_turn

logger = logging.getLogger(__name__)


@dataclass
class TurnControl:
    """一条正在生成的轮次的运行时状态（只在内存里，随生成结束销毁）。"""

    session_id: int
    client_turn_id: str | None
    started_at: float
    cancelled: bool = False
    # 调用方上报的"已播出"字符位置；None = 未上报（P0 按已 flush 处理）。
    played_chars: int | None = None
    # 已经 flush 给前端的 question 文本（回滚时按它截断，也是 generated_chars 的来源）。
    sent_text: str = ""
    first_delta_at: float | None = None


_active_turns: list[TurnControl] = []
_turns_lock = Lock()


def register_turn(session_id: int, client_turn_id: str | None) -> TurnControl | None:
    """登记一条正在生成的轮次；同 (会话, 幂等键) 已有活动轮次时返回 ``None``。"""
    with _turns_lock:
        if client_turn_id is not None and any(
            item.session_id == session_id and item.client_turn_id == client_turn_id
            for item in _active_turns
        ):
            return None
        control = TurnControl(
            session_id=session_id,
            client_turn_id=client_turn_id,
            started_at=time.perf_counter(),
        )
        _active_turns.append(control)
        return control


def unregister_turn(control: TurnControl) -> None:
    with _turns_lock:
        if control in _active_turns:
            _active_turns.remove(control)


def cancel_active_turns(
    *,
    session_id: int | None = None,
    client_turn_id: str | None = None,
    played_chars: int | None = None,
) -> list[TurnControl]:
    """标记活动轮次为"已取消"；不带筛选条件时取消全部（本地单用户应用通常只有一条）。"""
    with _turns_lock:
        targets = [
            item
            for item in _active_turns
            if (session_id is None or item.session_id == session_id)
            and (client_turn_id is None or item.client_turn_id == client_turn_id)
        ]
        for item in targets:
            item.cancelled = True
            if played_chars is not None:
                item.played_chars = max(0, int(played_chars))
        return targets


def active_turn_count() -> int:
    """当前活动轮次数（测试与观测用；不含内容）。"""
    with _turns_lock:
        return len(_active_turns)


def is_turn_active(session_id: int, client_turn_id: str | None) -> bool:
    if not client_turn_id:
        return False
    with _turns_lock:
        return any(
            item.session_id == session_id and item.client_turn_id == client_turn_id
            for item in _active_turns
        )


def record_stream_answer(
    session: InterviewSession,
    content: str,
    client_turn_id: str | None = None,
) -> InterviewMessage:
    """流式端点的回答落库入口（替代通用的 ``_record_answer``，加上幂等键处理）。

    同一轮正在生成时再提交 → 409：既不能重复计轮，也不能让两条生成流同时写库。
    """
    if is_turn_active(session.id, client_turn_id):
        raise HTTPException(status_code=409, detail="这一轮正在生成中")
    return record_answer_for_turn(session, content, client_turn_id)


class _TurnCancelPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # 都可空：P0 前端单链路只知道"取消最近一轮"；P1 接 TTS 时带上精确播放位置。
    session_id: int | None = Field(default=None, ge=1)
    client_turn_id: str | None = Field(default=None, max_length=64)
    played_chars: int | None = Field(default=None, ge=0)


class _TurnCancelResult(BaseModel):
    cancelled: int = 0
    generated_chars: int = 0
    played_chars: int = 0
    rolled_back_chars: int = 0


def register_voice_routes(router: APIRouter) -> None:
    """把语音取消端点挂到既有的 /api/interview router 上（不新开 prefix）。"""

    @router.post("/voice/turns/cancel", response_model=_TurnCancelResult)
    def cancel_voice_turn(payload: _TurnCancelPayload | None = None) -> _TurnCancelResult:
        """插话取消：标记活动轮次，生成器在下一个 delta 边界停下并回滚。

        返回的是**这一刻**的估算（生成器随后还会再 flush 一点点），用于前端/观测；
        落库的最终 ``rolled_back_chars`` 以服务端写回的 context 为准。
        """
        body = payload or _TurnCancelPayload()
        controls = cancel_active_turns(
            session_id=body.session_id,
            client_turn_id=body.client_turn_id,
            played_chars=body.played_chars,
        )
        generated = max((len(item.sent_text) for item in controls), default=0)
        played = (
            min(int(body.played_chars), generated) if body.played_chars is not None else generated
        )
        logger.info(
            "interview_voice cancel turns=%d generated_chars=%d played_chars=%d",
            len(controls),
            generated,
            played,
        )
        return _TurnCancelResult(
            cancelled=len(controls),
            generated_chars=generated,
            played_chars=played,
            rolled_back_chars=max(0, generated - played),
        )


__all__ = [
    "TurnControl",
    "active_turn_count",
    "cancel_active_turns",
    "is_turn_active",
    "record_stream_answer",
    "register_turn",
    "register_voice_routes",
    "unregister_turn",
]
