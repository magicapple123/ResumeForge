# SPDX-License-Identifier: Apache-2.0
"""按事实台账深挖的面试接口（prefix ``/api/drill``）。

**契约先锁、再提问**是这里唯一的顺序要求：``POST /{id}/answer`` 走的是"读出现有契约 →
按它判定 → 写回结论"，而不是"先看答案再定标准"。这条顺序在实现里体现为
``open_contract()`` 必须在返回问题给用户**之前**被调用。

路由顺序：固定路径（``/claims``）要排在 ``/{session_id}`` 之前。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.drill import (
    DRILL_STATUS_ACTIVE,
    DRILL_STATUS_FINISHED,
    EVIDENCE_STATUSES,
    FEEDBACK_DEFERRED,
    FEEDBACK_IMMEDIATE,
    REHEARSE_LABELS,
    REHEARSE_VARIANT,
    DrillSession,
)
from ..schemas.drill import (
    DrillAnswerRequest,
    DrillAnswerResult,
    DrillCreate,
    DrillRehearseOut,
    DrillRehearseRequest,
    DrillSessionBrief,
    DrillSessionOut,
)
from ..services.actions import add_action_route
from ..services.actions.catalog import all_actions
from ..services.drill import (
    apply_verdict,
    current_question,
    evaluate_answer,
    finish_session,
    generate_plan,
    generate_review,
    load_prompt,
    loaded_for_model,
    local_review,
    open_contract,
    pending_contract,
    select_claims,
)
from ..services.drill import (
    list_sessions as list_drill_sessions,
)
from ..services.drill import (
    session_out as _session_out,
)
from ..services.drill.session_open import (
    DrillSessionOpenError,
    open_drill_session,
    prepare_drill_session,
)
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.session_scope import fresh_session
from ..services.settings_service import get_llm_config
from ..services.text_extraction import llm_is_configured
from ._disconnect import run_or_gone

router = APIRouter(prefix="/api/drill", tags=["drill"])
logger = logging.getLogger(__name__)


def _session_or_404(db: Session, session_id: int) -> DrillSession:
    record = db.get(DrillSession, session_id)
    if record is None:
        raise HTTPException(status_code=404, detail="这场深挖记录不存在或已被删除")
    return record


add_action_route(router, all_actions()["list_drill_sessions"], route_path="")
def list_sessions(
    status: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """列出深挖记录；``status`` 可选 active / finished。"""
    if status and status not in (DRILL_STATUS_ACTIVE, DRILL_STATUS_FINISHED):
        raise HTTPException(status_code=422, detail="未知的会话状态")
    return [
        DrillSessionBrief.model_validate(item)
        for item in list_drill_sessions(db, status=status)
    ]


@router.post("", response_model=DrillSessionOut, status_code=201)
async def create_session(payload: DrillCreate, request: Request, db: Session = Depends(get_db)):
    """开一场深挖：先选出要验证的主张，再为第一条生成**评分契约**。

    契约在这一步就落库了——用户看到问题的时候，判定标准已经定下来。

    T2：挑主张/建会话/生成契约已下沉到 `services/drill/session_open.py`；本层只做
    事务收尾（提交会话行、失败时删掉空会话）、HTTP 错误映射与响应组装。
    """
    draft = None
    try:
        draft = prepare_drill_session(db, payload)
        # 事务边界在本层：会话行先提交，模型调用期间不占请求会话（服务内会关掉它）。
        db.commit()
        db.refresh(draft.session)
        session_id = await open_drill_session(
            db,
            draft,
            load_llm_config=get_llm_config,
            create_provider=create_provider,
            run_plan=lambda coro: run_or_gone(request, coro, what="深挖第一题"),
        )
    except DrillSessionOpenError as exc:
        if exc.discard_session and draft is not None:
            db.delete(draft.session)
            db.commit()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    # 服务返回时请求会话已关闭（模型调用期间不占连接池），按 id 重新读一次再序列化。
    return _session_out(_session_or_404(db, session_id))


add_action_route(router, all_actions()["get_drill_report"], route_path="/{session_id}")
def read_session(session_id: int, db: Session = Depends(get_db)):
    return _session_out(_session_or_404(db, session_id))


@router.post("/{session_id}/answer", response_model=DrillAnswerResult)
async def answer(
    session_id: int, payload: DrillAnswerRequest, request: Request, db: Session = Depends(get_db)
):
    """回答当前这一问：按**已锁定的契约**判定，然后要么追问，要么问下一题。"""
    session = _session_or_404(db, session_id)
    if session.status != DRILL_STATUS_ACTIVE:
        raise HTTPException(status_code=409, detail="这场深挖已经结束了")
    contract = pending_contract(session)
    if contract is None:
        raise HTTPException(status_code=409, detail="当前没有等待回答的问题")

    config = get_llm_config(db)
    if not llm_is_configured(config):
        raise HTTPException(status_code=400, detail="尚未配置大模型")

    provider = create_provider(config)
    db.close()

    # ★ 判定要读契约与问答记录，两者都必须来自**重载后**的会话：请求会话已经关掉，
    #   继续用它上面挂着的对象会 detached（访问 JSON 字段就抛异常，最后被翻成
    #   一句含糊的"内部错误"）。会话的开关由 loaded_for_model 负责——它在 with 期间
    #   一直开着，正好盖住下面的模型调用。
    with loaded_for_model(session_id) as reloaded:
        if reloaded is None:  # pragma: no cover - 并发删除
            raise HTTPException(status_code=404, detail="这场深挖记录不存在或已被删除")
        live_contract = (
            reloaded.contracts[-1]
            if reloaded.contracts and reloaded.contracts[-1].id == contract.id
            else None
        )
        if live_contract is None:  # pragma: no cover - 并发改动
            raise HTTPException(status_code=409, detail="这场深挖的进度已经变化")
        try:
            verdict_coro = evaluate_answer(provider, reloaded, live_contract, payload.answer)
            verdict = await run_or_gone(request, verdict_coro, what="深挖判定")
        except LLMError as exc:
            logger.warning("面试深挖判定失败：%s", exc)
            raise HTTPException(status_code=502, detail=f"判定这一轮失败：{exc}") from exc
        except Exception:  # noqa: BLE001 - 外部模型异常不能变成 500
            logger.exception("面试深挖判定发生内部错误")
            raise HTTPException(status_code=502, detail="判定这一轮失败") from None

    with fresh_session() as write_db:
        stored = write_db.get(DrillSession, session_id)
        if stored is None:  # pragma: no cover
            raise HTTPException(status_code=404, detail="这场深挖记录不存在或已被删除")
        current = stored.contracts[-1] if stored.contracts else None
        if current is None or current.id != contract.id:
            raise HTTPException(status_code=409, detail="这场深挖的进度已经变化")
        apply_verdict(
            stored,
            current,
            verdict,
            # 被回答的是"上一次判定生成的那一问"，没有就退回契约上的第一问。
            question=current_question(stored, current),
            answer=payload.answer,
        )
        write_db.commit()

        # 这道题问完了：要么开下一题（新契约），要么收尾出复盘。
        finished = False
        next_plan_error = ""
        if verdict.done:
            if stored.current_index >= stored.max_questions:
                finished = True
            else:
                claims = select_claims(write_db, stored.claim_ids, stored.max_questions)
                nxt = next(
                    (c for c in claims if c.id not in {k.claim_id for k in stored.contracts}), None
                )
                if nxt is None:
                    finished = True
                else:
                    try:
                        plan = await generate_plan(
                            provider, nxt, job_title=stored.job_title, company=stored.company
                        )
                        open_contract(stored, nxt, plan)
                        # 同上一处：契约的 id 要先落下来，后面的轮次才挂得上。
                        write_db.flush()
                    except LLMError as exc:
                        # 下一题生成失败不该把这一场作废：已有的判定都在，直接收尾出复盘。
                        logger.warning("生成下一题的契约失败，提前收尾：%s", exc)
                        next_plan_error = str(exc)
                        finished = True
                    except Exception:  # noqa: BLE001
                        logger.exception("生成下一题的契约发生内部错误，提前收尾")
                        next_plan_error = "内部错误"
                        finished = True

        if finished and stored.status == DRILL_STATUS_ACTIVE:
            try:
                review = await generate_review(provider, stored)
            except LLMError as exc:
                logger.warning("生成复盘失败，改用本地汇总：%s", exc)
                review = local_review(stored)
            except Exception:  # noqa: BLE001
                logger.exception("生成复盘发生内部错误，改用本地汇总")
                review = local_review(stored)
            finish_session(stored, review)
        write_db.commit()
        write_db.refresh(stored)
        # ★ 响应必须在**这个会话关闭之前**构造好：`_session_out` 要读
        #   `stored.contracts` / `stored.turns`，而它们是延迟加载的——出了这个块
        #   对象就 detached，访问时抛 DetachedInstanceError，最后被翻成一句
        #   含糊的"内部错误"。
        session_out = _session_out(stored)

    feedback = verdict.feedback if session.feedback_policy == FEEDBACK_IMMEDIATE else ""
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
    """提前结束并出复盘。已经结束的再调一次不会重复生成。"""
    session = _session_or_404(db, session_id)
    if session.status != DRILL_STATUS_ACTIVE:
        return _session_out(session)

    config = get_llm_config(db)
    if not llm_is_configured(config):
        finish_session(session, local_review(session))
        db.commit()
        db.refresh(session)
        return _session_out(session)

    provider = create_provider(config)
    db.close()
    with loaded_for_model(session_id) as reloaded:
        if reloaded is None:  # pragma: no cover - 并发删除
            raise HTTPException(status_code=404, detail="这场深挖记录不存在或已被删除")
        try:
            review_coro = generate_review(provider, reloaded)
            review = await run_or_gone(request, review_coro, what="深挖复盘生成")
        except LLMError as exc:
            logger.warning("生成复盘失败，改用本地汇总：%s", exc)
            review = local_review(reloaded)
        except Exception:  # noqa: BLE001
            logger.exception("生成复盘发生内部错误，改用本地汇总")
            review = local_review(reloaded)

    with fresh_session() as write_db:
        stored = write_db.get(DrillSession, session_id)
        if stored is None:  # pragma: no cover
            raise HTTPException(status_code=404, detail="这场深挖记录不存在或已被删除")
        finish_session(stored, review)
        write_db.commit()
        write_db.refresh(stored)
        return _session_out(stored)


@router.post("/{session_id}/rehearse", response_model=DrillRehearseOut)
async def rehearse(
    session_id: int, payload: DrillRehearseRequest, request: Request, db: Session = Depends(get_db)
):
    """把复练队列里的一条变成一个**可回答的新问题**（不落库）。

    复练的关键是"不原题重复"：同一条主张换一个角度再问一次，才检验得出他是不是真的
    会了——把上次的答案背一遍不算。
    """
    # 先确认这一场存在（不存在时给 404 而不是让后面报一个看不懂的错）。
    _session_or_404(db, session_id)
    config = get_llm_config(db)
    if not llm_is_configured(config):
        raise HTTPException(status_code=400, detail="尚未配置大模型")

    provider = create_provider(config)
    db.close()

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
    session = _session_or_404(db, session_id)
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
        raise HTTPException(status_code=404, detail="这场深挖记录不存在或已被删除")
    db.delete(session)
    db.commit()
    return None


__all__ = ["router", "EVIDENCE_STATUSES", "FEEDBACK_DEFERRED", "FEEDBACK_IMMEDIATE"]