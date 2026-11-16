# SPDX-License-Identifier: Apache-2.0
"""深挖路由的同步工作单元：准备读取、落库与分支决策（RF-02 续）。

``api/drill.py`` 只做 HTTP 边界：``await`` 模型调用、映射错误、组装响应。真正碰同步
SQLAlchemy 的每一段都在这里，由 ``run_sync`` 在 worker 线程里跑。

## 为什么"把 commit 提前"不够

模型调用可能几十秒。调用期间如果手里还握着一条 Session，钉住的是**连接池里的一条
连接 + 一个 WAL 读快照**——不是写锁。判定结果的写事务在 ``apply_verdict`` 之后就已经
提交，把那次提交再往前提是 no-op；真正要收的是"读事务在 ``await`` 期间不结束"。
所以每个单元都在返回前把会话关掉，跨 ``await`` 传的是冻结值（messages / id / DTO）。

## 三段式

读与决策在 worker 里（``load_judge_prompt`` / ``apply_answer``），模型调用在事件循环上
（路由里的 ``provider.chat``），落库再回 worker（``open_next_contract`` /
``persist_drill_review``）。``build_*_messages`` 与 ``parse_*`` 都是纯函数，所以"拼消息"
与"解析结果"也能留在 worker 里，路由上只剩一个真正的 ``await``。

## 打桩点

``get_config`` / ``make_provider`` 由路由以参数注入：测试打桩的是 ``app.api.drill``
命名空间上的 ``get_llm_config`` / ``create_provider``，若在这里直接 import 服务层符号，
补丁就落不到调用点上。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models.claim import ClaimRecord
from ..models.drill import (
    DRILL_STATUS_ACTIVE,
    EVIDENCE_NOT_COVERED,
    DrillSession,
)
from ..schemas.drill import DrillCreate, DrillSessionOut
from ..services.drill import (
    Verdict,
    apply_verdict,
    build_contract_messages,
    build_evaluate_messages,
    build_review_messages,
    current_question,
    finish_session,
    loaded_for_model,
    local_review,
    open_contract,
    parse_plan,
    pending_contract,
    select_claims,
)
from ..services.drill import (
    session_out as _session_out,
)
from ..services.drill.session import SESSION_NOT_FOUND_DETAIL, drop_empty_session
from ..services.drill.session_open import (
    DrillSessionDraft,
    prepare_drill_session,
)
from ..services.session_scope import fresh_session
from ..services.text_extraction import llm_is_configured


def session_or_404(db: Session, session_id: int) -> DrillSession:
    """按 id 取一场深挖；不存在时抛 404（文案与各处的并发删除窗口共用一份）。"""
    record = db.get(DrillSession, session_id)
    if record is None:
        # 文案的唯一来源在服务层（助手动作 get_drill_report 用的是同一句）。
        raise HTTPException(status_code=404, detail=SESSION_NOT_FOUND_DETAIL)
    return record


# ===== 开场 =====


@dataclass(frozen=True)
class DrillOpenPrep:
    """开场第一段的结果：已提交的会话草稿 + 冻结的模型配置快照。"""

    draft: DrillSessionDraft
    config: Any


def prepare_drill_open(db: Session, payload: DrillCreate, get_config: Any) -> DrillOpenPrep:
    """（工作单元）挑主张、建会话行、提交刷新、读模型配置，并在模型调用前放掉连接。

    事务边界在这里：会话行必须先提交再调模型——模型调用期间不占着请求会话的连接池。
    """
    draft = prepare_drill_session(db, payload)
    db.commit()
    db.refresh(draft.session)
    config = get_config(db)
    db.close()
    return DrillOpenPrep(draft=draft, config=config)


def discard_open_draft(session_id: int) -> None:
    """（工作单元）删掉"开不起来"的空会话：另开一条会话，请求会话早已关掉。"""
    drop_empty_session(session_id)


def drill_detail(db: Session, session_id: int) -> DrillSessionOut:
    """（工作单元）按 id 读一场深挖并序列化（关系在会话内读齐，响应在会话关闭前构造好）。"""
    return _session_out(session_or_404(db, session_id))


# ===== 判定（answer）=====


@dataclass(frozen=True)
class DrillAnswerPrep:
    """判定的前置条件：待答契约 id、反馈口径、provider。"""

    contract_id: int
    feedback_policy: str
    provider: Any


def prepare_drill_answer(
    db: Session, session_id: int, get_config: Any, make_provider: Any
) -> DrillAnswerPrep:
    """（工作单元）校验会话与待答契约、解析 provider，并在模型调用前放掉连接。"""
    session = session_or_404(db, session_id)
    if session.status != DRILL_STATUS_ACTIVE:
        raise HTTPException(status_code=409, detail="这场深挖已经结束了")
    contract = pending_contract(session)
    if contract is None:
        raise HTTPException(status_code=409, detail="当前没有等待回答的问题")

    config = get_config(db)
    if not llm_is_configured(config):
        raise HTTPException(status_code=400, detail="尚未配置大模型")

    prep = DrillAnswerPrep(
        contract_id=int(contract.id),
        feedback_policy=session.feedback_policy,
        provider=make_provider(config),
    )
    db.close()
    return prep


@dataclass(frozen=True)
class DrillJudgePrompt:
    """一次判定的全部输入：拼好的消息 + "这一答之前"的状态。

    不存契约对象本身：跨 ``await`` 之后它可能已经过期，判定结果要用
    ``previous_status`` 做状态机校验，而这个值必须在读会话时取下来。
    """

    messages: list[dict[str, Any]]
    previous_status: str


def load_judge_prompt(session_id: int, contract_id: int, answer: str) -> DrillJudgePrompt:
    """（工作单元）读出契约与问答记录、拼好判定消息，退出时把会话关掉。

    判定要读契约与问答记录，两者都必须来自**重载后**的会话：请求会话已经关掉，继续用
    它上面挂着的对象会 detached。这里没有任何 ``await``，所以 ``loaded_for_model`` 的
    生命周期正好落在这个 worker 里，不会跨到模型调用上。
    """
    with loaded_for_model(session_id) as reloaded:
        if reloaded is None:  # pragma: no cover - 并发删除
            raise HTTPException(status_code=404, detail=SESSION_NOT_FOUND_DETAIL)
        live_contract = (
            reloaded.contracts[-1]
            if reloaded.contracts and reloaded.contracts[-1].id == contract_id
            else None
        )
        if live_contract is None:  # pragma: no cover - 并发改动
            raise HTTPException(status_code=409, detail="这场深挖的进度已经变化")
        return DrillJudgePrompt(
            messages=build_evaluate_messages(reloaded, live_contract, answer),
            previous_status=live_contract.status or EVIDENCE_NOT_COVERED,
        )


@dataclass(frozen=True)
class DrillReviewPrompt:
    """复盘的全部输入：拼好的消息 + **同一份会话状态**下算好的本地汇总。

    提前算 fallback 是因为模型失败时那条会话已经关了：那时再想读 ``contracts`` 只会拿到
    detached 对象，而"复盘失败就退回本地汇总"这条降级必须保住（已有的判定都在数据里）。
    """

    messages: list[dict[str, Any]]
    fallback: dict[str, Any]


@dataclass(frozen=True)
class DrillNextPlan:
    """要开的下一题：主张 id + 拼好的契约消息（路由上只差一次 chat）。"""

    claim_id: int
    messages: list[dict[str, Any]]


@dataclass(frozen=True)
class DrillAnswerStep:
    """一轮落库之后的岔路（三选一）：可以返回了 / 先出下一题 / 先出复盘。"""

    outcome: DrillSessionOut | DrillNextPlan | DrillReviewPrompt
    finished: bool


def apply_answer(
    session_id: int, contract_id: int, verdict: Verdict, answer: str
) -> DrillAnswerStep:
    """（工作单元）把这一轮的判定写回，并算清接下来要走哪条岔路。

    写事务在这里提交（与重构前同一个位置），之后的"下一题 / 复盘"都要靠模型，所以本单元
    返回的是**待办**而不是结果：会话在返回前关闭，模型调用不占连接。
    """
    with fresh_session() as db:
        stored = db.get(DrillSession, session_id)
        if stored is None:  # pragma: no cover - 并发删除
            raise HTTPException(status_code=404, detail=SESSION_NOT_FOUND_DETAIL)
        current = stored.contracts[-1] if stored.contracts else None
        if current is None or current.id != contract_id:
            raise HTTPException(status_code=409, detail="这场深挖的进度已经变化")
        apply_verdict(
            stored,
            current,
            verdict,
            # 被回答的是"上一次判定生成的那一问"，没有就退回契约上的第一问。
            question=current_question(stored, current),
            answer=answer,
        )
        db.commit()

        # 这道题还要追问：不需要模型，直接把刷新后的状态作为响应。
        if not verdict.done:
            db.refresh(stored)
            return DrillAnswerStep(outcome=_session_out(stored), finished=False)

        # 这道题问完了：要么开下一题（新契约），要么收尾出复盘。
        next_plan = _next_plan(db, stored)
        if next_plan is not None:
            return DrillAnswerStep(outcome=next_plan, finished=False)
        if stored.status != DRILL_STATUS_ACTIVE:
            # 会话已被别处结束：不再重复生成一份复盘。
            db.refresh(stored)
            return DrillAnswerStep(outcome=_session_out(stored), finished=True)
        return DrillAnswerStep(outcome=_review_prompt(stored), finished=True)


def _next_plan(db: Session, stored: DrillSession) -> DrillNextPlan | None:
    """还没问够时挑下一条主张，并顺手把契约消息拼好（挑主张要查库，消息不用）。"""
    if stored.current_index >= stored.max_questions:
        return None
    claims = select_claims(db, stored.claim_ids, stored.max_questions)
    asked = {contract.claim_id for contract in stored.contracts}
    nxt = next((item for item in claims if item.id not in asked), None)
    if nxt is None:
        return None
    return DrillNextPlan(
        claim_id=int(nxt.id),
        messages=build_contract_messages(nxt, job_title=stored.job_title, company=stored.company),
    )


def _review_prompt(stored: DrillSession) -> DrillReviewPrompt:
    """复盘的两份产出（消息 + 本地汇总）都从**同一份**会话状态算出来。"""
    return DrillReviewPrompt(
        messages=build_review_messages(stored),
        fallback=local_review(stored),
    )


def open_next_contract(session_id: int, claim_id: int, raw_plan: str) -> DrillSessionOut:
    """（工作单元）解析模型给的契约并落库，返回刷新后的会话视图。

    ``parse_plan`` 是纯函数，所以"解析"也留在 worker 里；解析失败抛 ``LLMError``，
    由路由按"下一题生成失败"处理（已有判定都在，收尾出复盘）。
    """
    plan = parse_plan(raw_plan)
    with fresh_session() as db:
        stored = db.get(DrillSession, session_id)
        claim = db.get(ClaimRecord, claim_id)
        if stored is None or claim is None:  # pragma: no cover - 并发删除
            raise HTTPException(status_code=404, detail=SESSION_NOT_FOUND_DETAIL)
        open_contract(stored, claim, plan)
        # 立刻 flush：契约的 id 要给后续轮次做外键，``None`` 会让"这轮属于哪道题"对不上。
        db.flush()
        db.commit()
        db.refresh(stored)
        # 响应必须在**这个会话关闭之前**构造好：``_session_out`` 要读延迟加载的关系。
        return _session_out(stored)


def close_after_plan_error(session_id: int) -> DrillSessionOut | DrillReviewPrompt:
    """（工作单元）下一题开不出来：已有的判定都在，收尾出复盘，不把这一场作废。

    返回详情表示"会话已被别处结束，不用再生成复盘"；返回 prompt 表示还得调一次模型。
    """
    with fresh_session() as db:
        stored = session_or_404(db, session_id)
        if stored.status != DRILL_STATUS_ACTIVE:
            return _session_out(stored)
        return _review_prompt(stored)


# ===== 收尾（finish）=====


@dataclass(frozen=True)
class DrillFinishPrep:
    """提前结束的两种结局：``detail`` 有值就直接返回，否则拿 ``provider`` 去生成复盘。"""

    detail: DrillSessionOut | None = None
    provider: Any = None


def prepare_drill_finish(
    db: Session, session_id: int, get_config: Any, make_provider: Any
) -> DrillFinishPrep:
    """（工作单元）判掉"已结束 / 没配模型"两条短路，解析 provider，并放掉连接。"""
    session = session_or_404(db, session_id)
    if session.status != DRILL_STATUS_ACTIVE:
        return DrillFinishPrep(detail=_session_out(session))

    config = get_config(db)
    if not llm_is_configured(config):
        # 没模型也要能收尾：复盘退回本地汇总（已有的判定都在），否则用户被卡在一场
        # 永远结束不了的深挖里。
        finish_session(session, local_review(session))
        db.commit()
        db.refresh(session)
        return DrillFinishPrep(detail=_session_out(session))

    provider = make_provider(config)
    db.close()
    return DrillFinishPrep(provider=provider)


def load_review_prompt(session_id: int) -> DrillReviewPrompt:
    """（工作单元）另开一条会话读整场深挖，拼好复盘消息与本地汇总后关掉。"""
    with fresh_session() as db:
        return _review_prompt(session_or_404(db, session_id))


def persist_drill_review(session_id: int, review: dict[str, Any]) -> DrillSessionOut:
    """（工作单元）把复盘写回并序列化：另开一条会话，请求会话在模型调用前已经关了。"""
    with fresh_session() as db:
        stored = db.get(DrillSession, session_id)
        if stored is None:  # pragma: no cover - 并发删除
            raise HTTPException(status_code=404, detail=SESSION_NOT_FOUND_DETAIL)
        finish_session(stored, review)
        db.commit()
        db.refresh(stored)
        # 响应必须在**这个会话关闭之前**构造好（关系是延迟加载的）。
        return _session_out(stored)


# ===== 复练（rehearse）=====


def prepare_drill_rehearse(
    db: Session, session_id: int, get_config: Any, make_provider: Any
) -> Any:
    """（工作单元）确认会话存在 + 解析 provider，并在模型调用前放掉连接。"""
    session_or_404(db, session_id)
    config = get_config(db)
    if not llm_is_configured(config):
        raise HTTPException(status_code=400, detail="尚未配置大模型")
    provider = make_provider(config)
    db.close()
    return provider


__all__ = [
    "DrillAnswerPrep",
    "DrillAnswerStep",
    "DrillFinishPrep",
    "DrillJudgePrompt",
    "DrillNextPlan",
    "DrillOpenPrep",
    "DrillReviewPrompt",
    "apply_answer",
    "close_after_plan_error",
    "discard_open_draft",
    "drill_detail",
    "load_judge_prompt",
    "load_review_prompt",
    "open_next_contract",
    "persist_drill_review",
    "prepare_drill_answer",
    "prepare_drill_finish",
    "prepare_drill_open",
    "prepare_drill_rehearse",
    "session_or_404",
]
