# SPDX-License-Identifier: Apache-2.0
"""会话收尾、状态汇总与「另开一条会话」的生命周期。

本模块原先只管纯函数式的状态汇总；`drop_empty_session` / `loaded_for_model` 是从
``api/drill.py`` 搬进来的——那两处的共同点是"请求会话已经关掉（模型调用期间不能占着
连接池），回来时得再开一条"，属于服务层的会话策略，不该由路由直接摸 ``SessionLocal``。
"""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from sqlalchemy.orm import Session

from ...models.drill import (
    DRILL_STATUS_FINISHED,
    EVIDENCE_PARTIAL,
    EVIDENCE_STATUSES,
    EVIDENCE_UNVERIFIED,
    EVIDENCE_VERIFIED,
    DrillContract,
    DrillSession,
)
from ...schemas.drill import DrillContractOut, DrillSessionOut, DrillTurnOut


def finish_session(session: DrillSession, review: dict[str, Any]) -> None:
    session.review = review
    session.status = DRILL_STATUS_FINISHED


def pending_contract(session: DrillSession) -> DrillContract | None:
    """当前等待回答的那道题；没有则返回 None。

    判据是**这道题有没有问完**，而不是"轮次里有没有没回答的问题"：追问的问题与用户的
    回答都记在同一轮上（回答时把答案写回那一轮），所以"有问题没答案"这个条件只在
    刚创建、还没回答过的时候成立，追问之后就永远不成立了。

    真正的分界由 :func:`apply_verdict` 写下的 ``answered`` 决定：每轮记下"这道题还需要
    继续吗"，最后一轮说不需要就是问完了。
    """
    if not session.contracts:
        return None
    contract = session.contracts[-1]
    # 刚建好、还没有任何轮次：问题就在契约自己身上，正在等用户回答。
    if not session.turns:
        return contract
    last_turn = session.turns[-1]
    if last_turn.contract_id != contract.id:
        return None
    # 上一轮说了"还要追问"（``next_question`` 有值）→ 在等用户回答这一问；
    # 说了"问完了" → 这道题结束。
    return contract if last_turn.next_question else None


def session_summary(session: DrillSession) -> dict[str, Any]:
    """会话的计数汇总，供界面显示。"""
    counts = {status: 0 for status in EVIDENCE_STATUSES}
    for contract in session.contracts:
        counts[contract.status] = counts.get(contract.status, 0) + 1
    return {
        "questions": len(session.contracts),
        "verified_count": counts.get(EVIDENCE_VERIFIED, 0),
        "partial_count": counts.get(EVIDENCE_PARTIAL, 0),
        "unverified_count": counts.get(EVIDENCE_UNVERIFIED, 0),
        "contradictory_count": counts.get("contradictory", 0),
        "status_counts": counts,
    }

def session_out(record: DrillSession) -> DrillSessionOut:
    """深挖记录的响应视图（含契约、轮次、复盘、汇总与"当前这一问"）。

    原先长在 ``api/drill.py``：路由要在**会话关闭之前**把它构造好（``contracts`` /
    ``turns`` 是延迟加载的，出了会话就 detached），而服务层自己管会话，视图自然跟着走。
    """
    pending = pending_contract(record)
    return DrillSessionOut(
        id=record.id,
        title=record.title,
        job_id=record.job_id,
        job_title=record.job_title,
        company=record.company,
        status=record.status,
        feedback_policy=record.feedback_policy,
        max_questions=record.max_questions,
        current_index=record.current_index,
        created_at=record.created_at,
        contracts=[DrillContractOut.model_validate(item) for item in record.contracts],
        turns=[
            DrillTurnOut(
                id=turn.id,
                contract_id=turn.contract_id,
                question=turn.question,
                answer=turn.answer,
                status=turn.status,
                feedback=turn.feedback,
                created_at=turn.created_at,
            )
            for turn in record.turns
        ],
        review=record.review or {},
        summary=session_summary(record),
        pending=DrillContractOut.model_validate(pending) if pending else None,
    )


def list_sessions(db: Session, *, status: str = "") -> list[DrillSession]:
    """按创建时间倒序列出深挖会话；status 为空表示不限。

    为什么放服务层：会话列表是深挖域的主读路径，状态过滤口径与详情/收尾共用同一处，
    路由只该做状态白名单校验。
    """
    query = db.query(DrillSession)
    if status:
        query = query.filter(DrillSession.status == status)
    return query.order_by(DrillSession.created_at.desc()).all()


def drop_empty_session(session_id: int) -> None:
    """删掉一条"问不出题"的空会话（第一题生成失败时用）。

    另开一条会话：调用点手里那条请求会话已经关了。记录不存在就什么都不做。
    """
    from ...database import SessionLocal

    with SessionLocal() as cleanup_db:
        stored = cleanup_db.get(DrillSession, session_id)
        if stored is not None:
            cleanup_db.delete(stored)
            cleanup_db.commit()


@contextmanager
def loaded_for_model(session_id: int) -> Iterator[DrillSession | None]:
    """开一条会话读深挖记录，并**在 yield 期间保持打开**；记录不存在时 yield ``None``。

    不能用普通 ``with SessionLocal()`` 就返回记录：模型调用要读 ``record.contracts`` /
    ``record.turns``，这些关系是延迟加载的，会话一关再访问就抛 ``DetachedInstanceError``，
    最后被翻成一句含糊的"内部错误"。所以生命周期交给这个上下文，调用方在模型调用
    **结束之后**自然退出。进上下文时先主动读一遍，把契约与轮次装进内存，避免 await
    期间触发懒加载。
    """
    from ...database import SessionLocal

    db = SessionLocal()
    try:
        record = db.get(DrillSession, session_id)
        if record is None:  # pragma: no cover - 并发删除
            yield None
            return
        for contract in record.contracts:
            _ = (
                contract.required_evidence,
                contract.followup_triggers,
                contract.evidence_found,
                contract.missing,
                contract.contradictions,
            )
        _ = [turn.question for turn in record.turns]
        yield record
    finally:
        db.close()
