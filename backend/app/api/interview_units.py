# SPDX-License-Identifier: Apache-2.0
"""面试端点的**公共层**：同步工作单元 + 流式轮次控制面。

这里有两块内容，共同点是"被 ``interview.py`` 与 ``interview_stream.py`` 共用，且都不该
再回头依赖路由模块"：

1. **同步工作单元**（RF-02）：每个函数都是一段"碰 Session 的完整工作"——准备、落库、收尾。
   ``api/interview.py`` 本来就贴着 500 行预算（`test_file_size_budget` 是硬闸门），把
   "准备 / 落库"两段集中到这里，既把主文件压回预算内，也让"哪些代码在 worker 里跑"一眼可见。
2. **流式轮次控制面**：进程内的活动轮次登记（``TurnControl`` / ``register_turn``）、
   cancel 标记与 ``client_turn_id`` 幂等落库入口 ``record_stream_answer``。原来长在
   ``interview_voice.py`` 里，但"回答怎么落库"是准备段的一部分，而准备段在本模块——
   控制面留在一个路由模块里，就形成了"公共层回头依赖路由"的反向边（守卫
   ``test_import_direction`` 的 ``api-cross-module-imports`` 规则）。搬过来之后
   ``interview_voice`` 只负责挂路由，并为了既有导入路径再导出这几个名字。

## 纪律（与 ``app/runtime/blocking.py`` 同一套）

- 这些函数**只能**经 ``run_sync(...)`` 调用，或者由 FastAPI 直接从 ``def`` 路由里调用
  （Starlette 会把 ``def`` handler 整个丢进线程池）。
- 每个函数收口时把会话状态推进到"事件循环只读已加载标量"的程度：``commit`` / ``refresh``
  / 关系读热都留在函数里。这样 ``await`` 之后按属性读的都是内存值，不会在事件循环上触发
  SELECT——而 SQLite 的 ``busy_timeout`` 是 5 秒，一次锁等待就够把同进程的 SSE 卡住。
- 跨函数传递的是 id 与不可变快照（``AnswerPrep`` / ``FinishPrep`` / ``QuestionTurn``），
  不是懒加载的 ORM 关系。

``AnswerPrep`` / ``FinishPrep`` 里带着请求会话 ``db``：编排函数（``_answer_after_recording``
/ ``_auto_close`` / ``_ensure_report``）需要在多个 ``await`` 之间继续落库，而把 ``Session``
当实参一路传下去正是本批要消灭的形态。**它只能以 ``run_sync(..., prep.db, ...)`` 的形式
交给 worker**，事件循环上不许直接碰。

## patch 点的纪律

测试把 ``_require_provider`` / ``_ask_next_question`` / ``generate_report`` 打桩在
``app.api.interview`` 的命名空间上（"monkeypatch 钉死端点编排"的既有约定）。所以本模块
**不按值导入**它们：需要的两处（``prepare_answer`` / ``prepare_stream_answer`` /
``prepare_finish``）由路由以 ``require_provider=`` 注入，路由那次求值会按名字读
``app.api.interview`` 的模块全局，补丁落点保持不变。
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models.interview import (
    INTERVIEW_STATUS_ACTIVE,
    INTERVIEW_STATUS_FINISHED,
    InterviewMessage,
    InterviewSession,
)
from ..schemas.interview import InterviewDetail
from ..services.interview.interview import add_message, answered_rounds, mark_finished
from ..services.interview.interview_camera import has_real_report
from ..services.interview.session_open import record_opening_question
from ..services.interview.voice_turns import record_answer_for_turn
from .interview_shared import (
    SessionMaterial,
    _commit_and_refresh,
    _mark_interrupted_by_id,
    _record_answer,
    _session_or_404,
    _to_detail,
    _warm_messages,
)

#: 「取 provider」的注入签名：``(db) -> (provider, model)``，未配置时抛 400。
RequireProvider = Callable[[Session], tuple[Any, str]]


@dataclass(frozen=True)
class AnswerPrep:
    """ "回答已落库"之后的冻结状态：请求会话、会话行、provider、轮次序号与回答 id。

    存 ``answer_id`` 而不是那条 ORM 消息：取消路径要把"这一轮没答完"写回去，跨 ``await``
    只传 id，由 worker 重新 ``get`` 一次——避免把一条随时可能过期的实例交给事件循环。

    ``db`` 只用于 ``run_sync(..., prep.db, ...)``：编排函数需要它继续落库，而把它当实参
    往下传就会变成"事件循环线程上拿着请求会话"的形状。
    """

    db: Session
    session: InterviewSession
    provider: Any
    index: int
    answer_id: int


@dataclass(frozen=True)
class QuestionTurn:
    """要下一题所需的三样东西：会话行、provider、worker 里读好的材料快照。

    单独包一层是为了让"要下一题"这一步只吃一个对象：``generate_question`` 需要
    ``session`` 与材料，而把 ``session`` 裸传下去会让事件循环看起来像在直接使唤
    ORM 对象（见 ``tests/test_async_route_thread_boundary.py`` 的判据）。
    """

    session: InterviewSession
    provider: Any
    material: SessionMaterial


@dataclass(frozen=True)
class FinishPrep:
    """「结束并出报告」的准备结果：要么已有报告（``detail`` 直接返回），要么带着 provider 继续。"""

    db: Session
    session: InterviewSession
    provider: Any = None
    needs_close: bool = False
    detail: InterviewDetail | None = None


def prepare_answer(
    db: Session,
    session_id: int,
    content: str,
    *,
    require_provider: RequireProvider,
) -> AnswerPrep:
    """校验状态 + 落库本轮回答 + 读出 provider 与轮次序号：一个完整工作单元。"""
    session = _session_or_404(db, session_id)
    if session.status != INTERVIEW_STATUS_ACTIVE:
        raise HTTPException(status_code=409, detail="这场面试已经结束")
    provider, _model = require_provider(db)

    answer = _record_answer(session, content)
    _commit_and_refresh(db, session)
    return AnswerPrep(
        db=db,
        session=session,
        provider=provider,
        index=answered_rounds(session),
        answer_id=int(answer.id),
    )


def prepare_stream_answer(
    db: Session,
    session_id: int,
    content: str,
    client_turn_id: str | None,
    *,
    require_provider: RequireProvider,
) -> AnswerPrep:
    """流式端点的准备段：与 ``prepare_answer`` 同形，但走带幂等键的落库入口。

    ``record_stream_answer`` 在同一轮已经有生成流在跑时抛 409——"不重复计轮、不重复生成"
    这条语义只在流式链路上成立，所以两条入口各自保留自己的落库函数。
    """
    session = _session_or_404(db, session_id)
    if session.status != INTERVIEW_STATUS_ACTIVE:
        raise HTTPException(status_code=409, detail="这场面试已经结束")
    provider, _model = require_provider(db)

    answer = record_stream_answer(session, content, client_turn_id)
    _commit_and_refresh(db, session)
    return AnswerPrep(
        db=db,
        session=session,
        provider=provider,
        index=answered_rounds(session),
        answer_id=int(answer.id),
    )


def prepare_finish(
    db: Session, session_id: int, *, require_provider: RequireProvider
) -> FinishPrep:
    """读出会话、判掉"已有报告 / 一题没答"两条短路，并解析 provider（一个工作单元）。"""
    session = _session_or_404(db, session_id)
    # 只有 ``camera`` 段的 report 不算"已有报告"（F18）：镜头分析可能先于报告完成，
    # 若这里按真值判断就会直接返回一份没有分数与维度的报告。
    if has_real_report(session.report):
        return FinishPrep(db=db, session=session, detail=_to_detail(session))
    if answered_rounds(session) == 0:
        raise HTTPException(status_code=400, detail="还没有回答任何问题，无法生成报告")
    provider, _model = require_provider(db)
    # 报告要读整场转录（``session.messages``）：在 worker 里读热，别让事件循环懒加载。
    _warm_messages(session)
    return FinishPrep(
        db=db,
        session=session,
        provider=provider,
        needs_close=session.status != INTERVIEW_STATUS_FINISHED,
    )


def commit_report(db: Session, session: InterviewSession, report: dict[str, Any]) -> None:
    """把报告写进会话并收盘 + 提交刷新：一个完整工作单元。

    ``mark_finished`` 一起放在这里：出报告与"这场面试已结束"是同一件事，分开写会让
    调用方有机会只做一半（历史上就出现过"报告生成了但状态还是 active"）。
    """
    session.report = report
    mark_finished(session)
    _commit_and_refresh(db, session)


def add_interviewer_message(
    db: Session,
    session: InterviewSession,
    content: str,
    context: dict[str, Any],
) -> None:
    """落一条面试官消息并提交刷新（工作单元）。"""
    add_message(session, role="interviewer", content=content, context=context)
    _commit_and_refresh(db, session)


def close_session(session: InterviewSession, closing: str = "") -> None:
    """**收盘**（纯内存变更）：插收尾说明 + 把状态置为 finished。不出报告。

    收盘与出报告是两件事（需求 4）：轮数用尽 / 模型 ``done`` 只该收盘，报告由用户在
    决策卡上点「结束并生成报告」时才生成。这样"面试结束"与"报告已生成"才是两个独立
    的事实，也让**报告前追问**成为可能（追问接口只要求 ``status == FINISHED``）。

    只改对象、不碰会话：落库由 ``close_and_commit`` / ``commit_report`` 那个工作单元做。
    """
    if closing.strip():
        add_message(session, role="note", content=closing.strip())
    mark_finished(session)


def close_and_commit(db: Session, session: InterviewSession, reply: str = "") -> None:
    """收盘（可选地先落一条收尾回应）+ 提交刷新：整段是一个工作单元。"""
    if reply:
        add_message(session, role="interviewer", content=reply, context={"closing": True})
    close_session(session)
    _commit_and_refresh(db, session)


def has_closing_remark(messages) -> bool:
    """这场面试是否已经落过收尾回应（``_auto_close`` 的幂等判据）。"""
    return any(
        item.role == "interviewer" and bool((item.context or {}).get("closing"))
        for item in messages
    )


def refresh_session(db: Session, session: InterviewSession) -> None:
    """只刷新 + 读热关系（没有待提交的改动时用）。"""
    db.refresh(session)
    _warm_messages(session)


def discard_session(db: Session, session: InterviewSession) -> None:
    """删掉一条"开不起来"的空会话（模型失败 / 客户端断在开场），并提交。"""
    db.delete(session)
    db.commit()


def record_opening(db: Session, session: InterviewSession, question: str) -> InterviewDetail:
    """落开场题 + 提交刷新 + 组装响应：一个完整工作单元。"""
    record_opening_question(session, question)
    _commit_and_refresh(db, session)
    return _to_detail(session)


def mark_answer_interrupted(db: Session, answer_id: int) -> None:
    """取消路径的收口：按 id 把这一轮标成未完成（保留用户那条消息）。"""
    _mark_interrupted_by_id(db, answer_id)


# ===== 流式轮次控制面（自 ``interview_voice`` 下沉）=====
#
# 这里是**进程内状态**，不进数据库：谁在生成、要不要停、停在哪里。cancel 走独立的 HTTP
# 请求（`POST /api/interview/voice/turns/cancel`），生成器只在 delta 边界检查一次，
# 所以普通 bool + 锁就够，不需要 asyncio.Event（测试里 cancel 可能来自另一个线程）。


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


__all__ = [
    "AnswerPrep",
    "FinishPrep",
    "QuestionTurn",
    "RequireProvider",
    "TurnControl",
    "active_turn_count",
    "add_interviewer_message",
    "cancel_active_turns",
    "commit_report",
    "discard_session",
    "is_turn_active",
    "mark_answer_interrupted",
    "prepare_answer",
    "prepare_finish",
    "prepare_stream_answer",
    "record_opening",
    "record_stream_answer",
    "refresh_session",
    "register_turn",
    "unregister_turn",
]
