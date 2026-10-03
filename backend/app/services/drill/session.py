"""会话收尾与状态汇总。"""

from __future__ import annotations

from typing import Any

from ...models.drill import (
    DRILL_STATUS_FINISHED,
    EVIDENCE_PARTIAL,
    EVIDENCE_STATUSES,
    EVIDENCE_UNVERIFIED,
    EVIDENCE_VERIFIED,
    DrillContract,
    DrillSession,
)


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

