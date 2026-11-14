# SPDX-License-Identifier: Apache-2.0
"""「改文字重问」端点（Q1-L2）。

自 ``api/interview.py`` 拆出：那支本来 473 行，加这条端点会顶到 510（`test_file_size_budget`
是硬闸门）。拆法与同目录的 ``register_voice_routes`` / ``register_material_routes`` 一致——
端点挂在**同一个** router 上（前缀与鉴权完全不变），只把校验与错误口径留在本模块。

为什么不复用 ``/answers/stream`` + ``client_turn_id``：那一轮**已经答完**时，
``record_answer_for_turn`` 会直接回放 ``done``、根本不重新生成（幂等语义本来如此），
所以"改文字"必须有独立入口，不能靠复用。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.interview import InterviewAnswerRevise
from ..services.interview.voice_turns import AnswerNotReviseable, revise_answer_for_turn


def register_revise_routes(
    router: APIRouter,
    *,
    session_or_404: Callable[[Session, int], Any],
    require_provider: Callable[[Session], Any],
    stream_events: Callable[..., Any],
    answered_rounds: Callable[[Any], int],
    status_active: str,
) -> None:
    """把 ``POST /{session_id}/answers/revise`` 挂到既有采访 router 上（不新开 prefix）。"""

    @router.post("/{session_id}/answers/revise")
    async def revise_answer_stream(
        session_id: int, payload: InterviewAnswerRevise, db: Session = Depends(get_db)
    ):
        """改掉自己刚提交的那条回答，作废该轮回应并重新生成。

        只能改**最后一条**回答：改中间某一轮会让后续轮次的上下文与"第 N 轮"编号一起错位。
        """
        session = session_or_404(db, session_id)
        if session.status != status_active:
            raise HTTPException(status_code=409, detail="这场面试已经结束")
        provider, _model = require_provider(db)
        try:
            answer, stale = revise_answer_for_turn(session, payload.message_id, payload.content)
        except AnswerNotReviseable as error:
            # 404 与 409 分开：不存在是客户端记错了 id，不是最后一条则是用法问题。
            status_code = 404 if "不存在" in str(error) else 409
            raise HTTPException(status_code=status_code, detail=str(error)) from error
        # 作废这一轮旧的面试官回应：不删的话重新生成会写出第二条，同一轮出现两个问题。
        for item in stale:
            db.delete(item)
        db.commit()
        index = answered_rounds(session)

        return StreamingResponse(
            stream_events(db, session, provider, index, answer),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )


__all__ = ["register_revise_routes"]
