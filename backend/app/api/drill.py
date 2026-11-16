# SPDX-License-Identifier: Apache-2.0
"""按事实台账深挖的面试接口（prefix ``/api/drill``）。

**契约先锁、再提问**是这里唯一的顺序要求：``POST /{id}/answer`` 走的是"读出现有契约 →
按它判定 → 写回结论"，而不是"先看答案再定标准"。这条顺序在实现里体现为
``open_contract()`` 必须在返回问题给用户**之前**被调用。

路由顺序：固定路径（``/claims``）要排在 ``/{session_id}`` 之前。

## RF-02：三段式（读 → 关会话 → 只 chat → 再开会话落库）

四条写端点的形状都是「读请求会话 → 调模型 → 落库」。同步段全部收进
``app/api/drill_units.py`` 的**完整工作单元**，由 ``run_sync`` 在 worker 里跑；跨
``await`` 传的是冻结值（messages / id / DTO），不是懒加载的 ORM 对象。于是事件循环上
既不持有 Session，也不留一个 WAL 读快照，只剩 ``provider.chat(...)`` 这一个 ``await``。

``build_*_messages`` 与 ``parse_*`` 是纯函数，所以"拼消息"与"解析结果"也都在 worker 里
（``load_judge_prompt`` / ``apply_answer`` / ``open_next_contract``），路由只做错误映射
与响应组装。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.drill import (
    EVIDENCE_STATUSES,
    FEEDBACK_DEFERRED,
    FEEDBACK_IMMEDIATE,
    REHEARSE_LABELS,
    REHEARSE_VARIANT,
    DrillSession,
)
from ..runtime.blocking import run_sync
from ..schemas.drill import (
    DrillAnswerRequest,
    DrillAnswerResult,
    DrillCreate,
    DrillRehearseOut,
    DrillRehearseRequest,
    DrillSessionOut,
)
from ..services.actions import add_action_route
from ..services.actions.catalog import all_actions
from ..services.drill import Verdict, load_prompt, parse_review, parse_verdict
from ..services.drill.session import (
    SESSION_NOT_FOUND_DETAIL,
    DrillSessionReadError,
    list_session_briefs,
)
from ..services.drill.session_open import (
    DrillSessionOpenError,
    open_drill_session,
)
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.settings_service import get_llm_config
from ._disconnect import run_or_gone
from .drill_units import (
    DrillJudgePrompt,
    DrillNextPlan,
    DrillReviewPrompt,
    apply_answer,
    close_after_plan_error,
    discard_open_draft,
    drill_detail,
    load_judge_prompt,
    load_review_prompt,
    open_next_contract,
    persist_drill_review,
    prepare_drill_answer,
    prepare_drill_finish,
    prepare_drill_open,
    prepare_drill_rehearse,
    session_or_404,
)

router = APIRouter(prefix="/api/drill", tags=["drill"])
logger = logging.getLogger(__name__)


add_action_route(router, all_actions()["list_drill_sessions"], route_path="")


def list_sessions(
    status: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """列出深挖记录；``status`` 可选 active / finished。

    薄壳：状态白名单与出口视图都在 ``services.drill.session.list_session_briefs``
    （助手动作 ``list_drill_sessions`` 调同一个函数），"未知状态给 422"只判一处。
    """
    try:
        return list_session_briefs(db, status=status)
    except DrillSessionReadError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@dataclass(frozen=True)
class _TurnResult:
    """一轮回答的最终结果：响应视图 + 是否收尾 + 提前收尾的原因（空串=正常）。"""

    session: DrillSessionOut
    finished: bool
    note: str = ""


async def _judge(request: Request, provider: Any, judge: DrillJudgePrompt) -> Verdict:
    """拿这一轮的判定：模型调用与解析在同一个 try 里，失败一律映射成 502。

    ``thinking=False`` 与重构前 ``evaluate_answer`` 一致：判定要的是严格 JSON，思考模式
    对准确率没有增益，却会让调用慢上几倍。
    """
    try:
        raw = await run_or_gone(
            request, provider.chat(judge.messages, thinking=False), what="深挖判定"
        )
        return await run_sync(parse_verdict, raw, previous_status=judge.previous_status)
    except LLMError as exc:
        logger.warning("面试深挖判定失败：%s", exc)
        raise HTTPException(status_code=502, detail=f"判定这一轮失败：{exc}") from exc
    except Exception:  # noqa: BLE001 - 外部模型异常不能变成 500
        logger.exception("面试深挖判定发生内部错误")
        raise HTTPException(status_code=502, detail="判定这一轮失败") from None


async def _persist_review(
    request: Request, session_id: int, provider: Any, prompt: DrillReviewPrompt
) -> DrillSessionOut:
    """出复盘并落库：模型或解析失败都退回**worker 里预先算好的**本地汇总。

    提前算好的原因是那条会话已经关了——失败时再去读 ``contracts`` 只会拿到 detached
    对象。已有的判定都在数据里，所以降级不会丢信息。

    ``thinking=False`` 与重构前 ``generate_review`` 一致：复盘是结构化输出。
    """
    try:
        raw = await run_or_gone(
            request, provider.chat(prompt.messages, thinking=False), what="深挖复盘生成"
        )
        review = await run_sync(parse_review, raw)
    except LLMError as exc:
        logger.warning("生成复盘失败，改用本地汇总：%s", exc)
        review = prompt.fallback
    except Exception:  # noqa: BLE001
        logger.exception("生成复盘发生内部错误，改用本地汇总")
        review = prompt.fallback
    return await run_sync(persist_drill_review, session_id, review)


async def _advance(
    request: Request, session_id: int, provider: Any, plan: DrillNextPlan
) -> _TurnResult:
    """要下一题：模型只在这一处被调用一次；开不出来就提前收尾，不把这一场作废。

    ``thinking=False`` 与重构前 ``generate_plan`` 一致：契约是结构化输出。
    """
    try:
        raw = await run_or_gone(
            request, provider.chat(plan.messages, thinking=False), what="深挖下一题"
        )
        session_out = await run_sync(open_next_contract, session_id, plan.claim_id, raw)
    except LLMError as exc:
        note = str(exc)
        logger.warning("生成下一题的契约失败，提前收尾：%s", exc)
    except Exception:  # noqa: BLE001
        note = "内部错误"
        logger.exception("生成下一题的契约发生内部错误，提前收尾")
    else:
        return _TurnResult(session=session_out, finished=False)
    # 下一题开不出来：会话可能已被别处结束（那样直接给详情），否则先出复盘再收尾。
    review = await run_sync(close_after_plan_error, session_id)
    session_out = (
        review
        if isinstance(review, DrillSessionOut)
        else await _persist_review(request, session_id, provider, review)
    )
    return _TurnResult(session=session_out, finished=True, note=note)


@router.post("", response_model=DrillSessionOut, status_code=201)
async def create_session(payload: DrillCreate, request: Request, db: Session = Depends(get_db)):
    """开一场深挖：先选出要验证的主张，再为第一条生成**评分契约**。

    契约在这一步就落库了——用户看到问题的时候，判定标准已经定下来。

    T2：挑主张/建会话/生成契约已下沉到 `services/drill/session_open.py`；本层只做
    事务收尾（提交会话行、失败时删掉空会话）、HTTP 错误映射与响应组装。
    RF-02：事务收尾与配置读取在 worker 里（``prepare_drill_open``），模型调用期间
    事件循环不持有请求会话。
    """
    try:
        # get_llm_config / create_provider 以参数注入：打桩点在本模块命名空间。
        prep = await run_sync(prepare_drill_open, db, payload, get_llm_config)
    except DrillSessionOpenError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    try:
        session_id = await open_drill_session(
            prep.draft,
            config=prep.config,
            create_provider=create_provider,
            run_plan=lambda coro: run_or_gone(request, coro, what="深挖第一题"),
        )
    except DrillSessionOpenError as exc:
        if exc.discard_session:
            # 会话行已经提交，但第一题开不出来：删掉它，别留一条"问不出题"的记录。
            await run_sync(discard_open_draft, prep.draft.session.id)
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    # 服务返回时请求会话已关闭（模型调用期间不占连接池），按 id 重新读一次再序列化。
    return await run_sync(drill_detail, db, session_id)


add_action_route(router, all_actions()["get_drill_report"], route_path="/{session_id}")


@router.post("/{session_id}/answer", response_model=DrillAnswerResult)
async def answer(
    session_id: int, payload: DrillAnswerRequest, request: Request, db: Session = Depends(get_db)
):
    """回答当前这一问：按**已锁定的契约**判定，然后要么追问，要么问下一题。"""
    prep = await run_sync(prepare_drill_answer, db, session_id, get_llm_config, create_provider)
    judge = await run_sync(load_judge_prompt, session_id, prep.contract_id, payload.answer)
    verdict = await _judge(request, prep.provider, judge)

    # 落库与决策在 worker 里：它返回"接下来要什么"，而不是替我们等模型。
    step = await run_sync(apply_answer, session_id, prep.contract_id, verdict, payload.answer)
    next_plan_error = ""
    finished = step.finished
    if isinstance(step.outcome, DrillNextPlan):
        turn = await _advance(request, session_id, prep.provider, step.outcome)
        session_out, finished, next_plan_error = turn.session, turn.finished, turn.note
    elif isinstance(step.outcome, DrillReviewPrompt):
        session_out = await _persist_review(request, session_id, prep.provider, step.outcome)
    else:
        # 已经没有要等的模型调用了：这一步的响应是 worker 里序列化好的。
        session_out = step.outcome

    feedback = verdict.feedback if prep.feedback_policy == FEEDBACK_IMMEDIATE else ""
    if next_plan_error:
        # 提前收尾的原因要如实说，否则"这场怎么突然结束了"会成为一个疑问。
        note = f"（下一题生成失败，已提前收尾：{next_plan_error}）"
        feedback = f"{feedback} {note}".strip() if feedback else note
    return DrillAnswerResult(
        status=verdict.status,
        evidence_found=verdict.evidence_found,
        missing=verdict.missing,
        contradictions=verdict.contradictions,
        # 真实模拟模式下不在每题后念判定——那会让人按判分标准答题，而不像真面试。
        feedback=feedback,
        finished=finished,
        session=session_out,
    )


@router.post("/{session_id}/finish", response_model=DrillSessionOut)
async def finish(session_id: int, request: Request, db: Session = Depends(get_db)):
    """提前结束并出复盘。已经结束的再调一次不会重复生成。

    RF-02：形状与 ``answer`` 相同——``prepare_drill_finish`` 判掉"已结束 / 没配模型"
    两条短路并放掉连接，``load_review_prompt`` 在 worker 里拼好复盘消息**与**本地汇总
    （失败降级要用它，那时会话已经关了），事件循环上只剩一次 ``provider.chat``，落库
    再回 worker（``persist_drill_review``）。

    幂等靠 ``prep.detail``：已结束时直接回那条会话，不会二次生成复盘。
    """
    prep = await run_sync(prepare_drill_finish, db, session_id, get_llm_config, create_provider)
    if prep.detail is not None:
        return prep.detail
    prompt = await run_sync(load_review_prompt, session_id)
    return await _persist_review(request, session_id, prep.provider, prompt)


@router.post("/{session_id}/rehearse", response_model=DrillRehearseOut)
async def rehearse(
    session_id: int, payload: DrillRehearseRequest, request: Request, db: Session = Depends(get_db)
):
    """把复练队列里的一条变成一个**可回答的新问题**（不落库）。

    复练的关键是"不原题重复"：同一条主张换一个角度再问一次，才检验得出他是不是真的
    会了——把上次的答案背一遍不算。
    """
    # 先确认这一场存在（不存在时给 404 而不是让后面报一个看不懂的错），并解析 provider。
    provider = await run_sync(
        prepare_drill_rehearse, db, session_id, get_llm_config, create_provider
    )

    kind_note = REHEARSE_LABELS.get(payload.kind, REHEARSE_LABELS[REHEARSE_VARIANT])
    instruction = (
        "候选人要把一条主张再练一遍。请**换一个角度**出一道新题——"
        "不要重复他上次被问到的问题。\n"
        f"题型：{kind_note}\n"
        f"这条主张：{payload.claim_title}\n"
        f"上次暴露的缺口：{payload.why or '（未记录）'}\n\n"
        "只输出一个 JSON 对象，不要解释或 Markdown 围栏：\n"
        '{"question": "一个新问题（一次只问一个）", "expect": "这道题在要求什么，'
        '让人知道该往哪个方向答"}'
    )
    try:
        messages = [
            {"role": "system", "content": load_prompt("drill_contract.md")},
            {"role": "user", "content": instruction},
        ]
        raw = await run_or_gone(request, provider.chat(messages), what="深挖复练题")
        from ..services.llm.structured_output import parse_json_object

        data = parse_json_object(raw, label="面试深挖", max_chars=20_000)
    except LLMError as exc:
        logger.warning("生成复练题失败：%s", exc)
        raise HTTPException(status_code=502, detail=f"生成复练题失败：{exc}") from exc

    question = str(data.get("question") or "").strip()[:1_000]
    if not question:
        raise HTTPException(status_code=502, detail="生成复练题失败：模型没有给出问题")
    return DrillRehearseOut(
        claim_title=payload.claim_title,
        kind=payload.kind,
        question=question,
        expect=str(data.get("expect") or "").strip()[:1_000],
    )


@router.get("/{session_id}/rehearsal", response_model=list[dict])
def list_rehearsal(session_id: int, db: Session = Depends(get_db)):
    """复练队列：只含"部分验证 / 未验证 / 存在矛盾"的主张。"""
    session = session_or_404(db, session_id)
    items = (session.review or {}).get("rehearsal") or []
    return [
        {
            **item,
            "kind_label": REHEARSE_LABELS.get(item.get("kind", ""), ""),
        }
        for item in items
        if isinstance(item, dict)
    ]


@router.delete("/{session_id}", status_code=204)
def delete_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(DrillSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=SESSION_NOT_FOUND_DETAIL)
    db.delete(session)
    db.commit()
    return None


__all__ = ["router", "EVIDENCE_STATUSES", "FEEDBACK_DEFERRED", "FEEDBACK_IMMEDIATE"]
