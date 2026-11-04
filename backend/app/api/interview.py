# SPDX-License-Identifier: Apache-2.0
"""模拟面试接口：开场、逐轮问答、结束评分与报告归档。

不流式：一轮请求要同时拿到"对上一答的点评"和"下一题"，流式会让界面出现半成品状态。

本模块只保留**流程控制**（什么时候收尾、什么时候出报告）与这些流程对应的路由；
进/出 schema 的转换、材料取数、回答落库与中断标记都搬去了 ``interview_shared``
（#41 加"材料导入 / 追问分相"时这支已经贴着 500 行预算）。材料上传与追问两个端点
在 ``interview_material_routes`` 里，用 ``register_*`` 挂到同一个 router 上。
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.interview import (
    INTERVIEW_STATUS_ACTIVE,
    INTERVIEW_STATUS_FINISHED,
    InterviewMessage,
    InterviewSession,
)
from ..models.job import Job
from ..schemas.interview import (
    InterviewAnswerCreate,
    InterviewAnswerResult,
    InterviewBrief,
    InterviewCreate,
    InterviewDetail,
    InterviewDurationUpdate,
)
from ..schemas.material import MaterialCreate, MaterialOut
from ..services import trash
from ..services.interview import interview_questions as interview_questions_service  # noqa: F401
from ..services.interview.interview import (
    add_message,
    answered_rounds,
    close_with_closing_remark,
    generate_question,
    generate_report,
    mark_finished,
    session_persona,
)
from ..services.interview.interview_context import _claims_json
from ..services.interview.interview_report_markdown import _report_markdown
from ..services.llm.base import LLMError
from ..services.materials import create_material as create_material_record
from ._disconnect import client_gone, run_until_disconnect
from .interview_material_routes import register_followup_routes, register_material_routes
from .interview_question_routes import register_question_routes
from .interview_shared import (
    MAX_JOB_CONTEXT_FOR_INTERVIEW,  # noqa: F401  (re-export：interview_answer_review 从本模块取)
    _default_title,
    _job_text,
    _mark_interrupted,
    _record_answer,
    _require_provider,
    _resume_record_or_none,
    _resume_text,
    _session_job_text,
    _session_or_404,
    _to_detail,
    _to_out,
)
from .interview_stream import _QuestionDeltaExtractor as _QuestionDeltaExtractor
from .interview_stream import make_answer_stream

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/interview", tags=["interview"])


async def _ask_next_question(
    db: Session, session: InterviewSession, provider
) -> tuple[str, str, bool]:
    return await generate_question(
        provider,
        session,
        resume_text=_resume_text(db, session),
        job_text=_session_job_text(db, session),
    )


def _close_session(session: InterviewSession, closing: str = "") -> None:
    """**收盘**：插收尾说明 + 把状态置为 finished。不出报告。

    收盘与出报告是两件事（需求 4）：轮数用尽 / 模型 ``done`` 只该收盘，报告由用户在
    决策卡上点「结束并生成报告」时才生成。这样"面试结束"与"报告已生成"才是两个独立
    的事实，也让**报告前追问**成为可能（追问接口只要求 ``status == FINISHED``）。
    """
    if closing.strip():
        add_message(session, role="note", content=closing.strip())
    mark_finished(session)


async def _ensure_report(db: Session, session: InterviewSession, provider) -> None:
    """确保这场面试有报告：已有就直接返回，否则现生成一份（幂等）。

    报告失败时留下说明而不是让整场面试不可用：重试要再烧一次整场转录的 token，而用户
    真正需要的是"记录还在、能复盘"。所以错误报告也算"已有报告"，不重复生成。
    """
    if session.report:
        return
    try:
        session.report = await generate_report(provider, session)
    except LLMError as exc:
        logger.warning("面试报告生成失败 session=%s：%s", session.id, exc)
        session.report = {"summary": f"报告生成失败：{exc}", "error": True}
    # 兜一层：调用方可能只要求出报告、还没收盘（历史数据 / 直连测试）。
    mark_finished(session)
    db.commit()
    db.refresh(session)


async def _auto_close(db: Session, session: InterviewSession, provider=None) -> None:
    """自动收尾：轮数用尽或模型 ``done`` 时**先让面试官接一句话，再收盘**。

    报告仍然留给用户决定（需求 4）；这里多做的只有"最后一答的回应"：
    直接收盘的话，界面上最后一句话是候选人的回答，紧跟着就是「本场正式问答已结束」，
    真实面试里不会这样。所以先用一次模型调用换一段"点评最后那段 + 收尾"（
    ``close_with_closing_remark``），把这条面试官消息落库，再收盘。

    失败不阻断：模型挂掉也照样收尾（前端会用本地化兜底文案补一句），否则用户会卡在
    一场永远结束不了的面试里。
    """
    # 幂等：重复调用（重试、流式与非流式都走到这里）不能写第二条收尾。
    if session.status == INTERVIEW_STATUS_FINISHED or _has_closing_remark(session):
        _close_session(session)
        db.commit()
        db.refresh(session)
        return

    if provider is not None:
        try:
            reply = await close_with_closing_remark(provider, session)
        except LLMError as exc:
            logger.warning("面试收尾回应生成失败 session=%s：%s", session.id, exc)
            reply = ""
        if reply:
            add_message(session, role="interviewer", content=reply, context={"closing": True})

    _close_session(session)
    db.commit()
    db.refresh(session)


def _has_closing_remark(session: InterviewSession) -> bool:
    return any(
        item.role == "interviewer" and bool((item.context or {}).get("closing"))
        for item in session.messages
    )


# ===== R-11 题库 / 答题思路 / 反向优化 的共用读取（实现见 ``interview_shared``）=====


@router.get("", response_model=list[InterviewBrief])
def list_sessions(limit: int = Query(default=50, ge=1, le=200), db: Session = Depends(get_db)):
    sessions = (
        db.query(InterviewSession).order_by(InterviewSession.created_at.desc()).limit(limit).all()
    )
    return [_to_out(item) for item in sessions]


@router.post("", response_model=InterviewDetail, status_code=201)
async def create_session(payload: InterviewCreate, request: Request, db: Session = Depends(get_db)):
    """开一场面试：先落库会话，再让面试官问第一个问题。

    每一侧材料都是**二选一**（记录 or 导入的文件，见 ``InterviewCreate``）：面试官只会读
    这两份内容，所以指向一份已删除的简历/岗位时，与其开一场看不到材料的面试，不如直接
    告诉用户。导入的文件已经是提取好的文本（上传时就校验过），这里不再解析。
    """
    provider, model = _require_provider(db)
    job = db.get(Job, payload.job_id) if payload.job_id is not None else None
    if payload.job_material is None and payload.job_id is None:
        # 缺来源与"指向的已被删除"是两件事：前者是用户少选了一步，后者是数据变了，
        # 说清是哪一种，用户才知道该去补选还是重选。
        raise HTTPException(
            status_code=422, detail="这场面试缺少岗位材料：既没有选记录，也没有导入文件"
        )
    if payload.job_material is None and (job is None or trash.is_deleted(job)):
        raise HTTPException(status_code=404, detail="关联岗位不存在或已被删除")
    record = (
        _resume_record_or_none(db, payload.resume_id) if payload.resume_id is not None else None
    )
    if payload.resume_material is None and payload.resume_id is None:
        raise HTTPException(
            status_code=422, detail="这场面试缺少简历材料：既没有选记录，也没有导入文件"
        )
    if payload.resume_material is None and record is None:
        raise HTTPException(status_code=404, detail="关联简历不存在或已被删除")
    session = InterviewSession(
        title=_default_title(payload, job),
        job_id=job.id if job is not None else None,
        job_title=(job.title if job is not None else ""),
        company=(job.company if job is not None else ""),
        resume_id=record.id if record is not None else None,
        resume_title=(record.title[:256] if record is not None else ""),
        # 导入的材料是快照：文件名进列表，正文进提示词（#41）。
        job_material_name=(payload.job_material.name if payload.job_material else ""),
        job_material_text=(payload.job_material.text if payload.job_material else ""),
        resume_material_name=(payload.resume_material.name if payload.resume_material else ""),
        resume_material_text=(payload.resume_material.text if payload.resume_material else ""),
        interview_type=payload.interview_type,
        difficulty=payload.difficulty,
        interviewer_style=payload.interviewer_style,
        rounds=payload.rounds,
        rounds_min=payload.rounds_min,
        persona=payload.persona.strip(),
        focus=payload.focus.strip(),
        model=model,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    try:
        # 开场就要现场生成第一题（十几秒的模型调用）：客户端断开就停，别白烧 token。
        turn = await run_until_disconnect(
            request, _ask_next_question(db, session, provider), what="模拟面试开场"
        )
    except LLMError:
        # 开场失败就删掉这条空会话：留一条没有任何内容的面试只会让列表变乱。
        db.delete(session)
        db.commit()
        raise HTTPException(status_code=502, detail="面试助手暂时无法开始本轮") from None
    if turn is None:
        # 客户端断在开场：同样删掉这条空会话，再报"没人收这个结果"。
        db.delete(session)
        db.commit()
        raise client_gone("模拟面试开场")
    question, _feedback, _done = turn
    add_message(
        session,
        role="interviewer",
        content=question,
        context={"index": 1, "rounds": session.rounds, "persona": session_persona(session)},
    )
    db.commit()
    db.refresh(session)
    logger.info("模拟面试已开始 id=%s type=%s", session.id, session.interview_type)
    return _to_detail(session)


@router.get("/{session_id}", response_model=InterviewDetail)
def read_session(session_id: int, db: Session = Depends(get_db)):
    return _to_detail(_session_or_404(db, session_id))


@router.put("/{session_id}/duration", response_model=InterviewBrief)
def update_duration(
    session_id: int, payload: InterviewDurationUpdate, db: Session = Depends(get_db)
):
    """上报累计的**有效面试时长**（秒）。

    前端每累计一段就整份上报"本次已累计秒数"（离开页面暂停、回来点「继续面试」后
    接着累计），所以这里是绝对值而不是增量。取 ``max()`` 是为了让乱序到达或重试的
    旧请求不会把时长往回拨。
    """
    session = _session_or_404(db, session_id)
    session.duration_seconds = max(session.duration_seconds, payload.elapsed_seconds)
    db.commit()
    db.refresh(session)
    return _to_out(session)


@router.post("/{session_id}/answers", response_model=InterviewAnswerResult)
async def submit_answer(
    session_id: int, payload: InterviewAnswerCreate, db: Session = Depends(get_db)
):
    """提交一轮回答：返回点评与下一题；满轮次时自动收尾并出报告。"""
    session = _session_or_404(db, session_id)
    if session.status != INTERVIEW_STATUS_ACTIVE:
        raise HTTPException(status_code=409, detail="这场面试已经结束")
    provider, _model = _require_provider(db)

    answer = _record_answer(session, payload.content)
    db.commit()
    index = answered_rounds(session)

    try:
        return await _answer_after_recording(db, session, provider, index, answer)
    except asyncio.CancelledError:
        # 客户端断开：短任务没有"后台继续"的语义，这一轮标成未完成（回答保留，可重答）。
        _mark_interrupted(db, answer)
        raise


async def _answer_after_recording(
    db: Session,
    session: InterviewSession,
    provider,
    index: int,
    answer: InterviewMessage,
) -> InterviewAnswerResult:
    """候选人回答已经落库之后的那一步：要下一题，或直接收尾出报告。"""
    # 已经答满轮数就**先收尾**，不再去要下一题。这一步必须排在模型调用之前，否则：
    #   · 会多存一道永远不会被回答的问题，它还会进报告和资料箱里的转录；
    #   · 传给模型的 index 变成 rounds + 1，提示词里出现"第 13 / 12 轮"这种自相矛盾的信息，
    #     模型自然不知道该收尾；
    #   · rounds 取到上限（MAX_INTERVIEW_ROUNDS）时 index 越界，generate_question 直接抛错，
    #     最后一答变成 502，面试卡在 active 状态回不来。
    # 最后一答的点评不会丢：报告基于完整问答记录生成，那一答也在里面。
    #
    # 只收盘、不出报告（需求 4）：出报告要整场转录再跑一次模型，而用户在这之后可能还想
    # 追问几轮——报告一旦先生成，追问就落不到评分里（设计如此），顺序也说不清。交给
    # 决策卡上的「结束并生成报告」。
    if index >= session.rounds:
        await _auto_close(db, session, provider)
        return InterviewAnswerResult(
            session=_to_detail(session), feedback="", finished=True, needs_report=True
        )

    try:
        question, feedback, done = await _ask_next_question(db, session, provider)
    except LLMError:
        # 回答已经存下来了，用户不会白写；只是这一轮的追问失败。标成未完成，界面上就有
        # 「重新回答」的入口，重答会复用这条回答（不会写出第二条一模一样的用户消息）。
        _mark_interrupted(db, answer)
        raise HTTPException(status_code=502, detail="面试助手暂时无法完成本轮") from None

    # 模型提前结束（done）：这里的 question 按提示词约定是收尾语，存下来给用户看。
    #
    # 「自动」档还有个**下限**：`rounds_min` 之前不允许收尾。提示词是建议不是约束——实测
    # 模型会在第 3、4 轮就宣称"聊得差不多了"。所以这里兜一层：没到最早轮数时忽略 done，
    # 把它当普通一轮继续（question 仍作为下一题，用户不会因此卡住）。不重新调模型：
    # 那样既贵又可能死循环，而且模型给的这句话本身通常还是能接着聊的。
    #
    # `early_close` 必须在落库**之前**算：落库时的 context 要标出"这句就是收尾语"，
    # 否则 `_auto_close` 会以为还没收尾，再补一段收尾回应，界面上就出现两句告别。
    early_close = session.rounds_min is not None and answered_rounds(session) < session.rounds_min
    context: dict[str, Any] = {"index": index, "rounds": session.rounds, "feedback": feedback}
    if done and not early_close:
        context["closing"] = True
    add_message(session, role="interviewer", content=question, context=context)
    db.commit()

    if done and early_close:
        logger.info(
            "面试官试图在第 %s 轮提前收尾（最早 %s 轮），已忽略 session=%s",
            answered_rounds(session),
            session.rounds_min,
            session.id,
        )
        done = False
    if done:
        await _auto_close(db, session, provider)
        return InterviewAnswerResult(
            session=_to_detail(session), feedback=feedback, finished=True, needs_report=True
        )

    db.refresh(session)
    return InterviewAnswerResult(session=_to_detail(session), feedback=feedback, finished=False)


@router.post("/{session_id}/finish", response_model=InterviewDetail)
async def finish_session(session_id: int, request: Request, db: Session = Depends(get_db)):
    """结束并出报告（候选人在决策卡上点「结束并生成报告」）。

    三个分支，一条共同的不变量：**同一场面试只会有一份报告**。

    · 还没收盘 → 收盘 + 生成报告（"提前结束"语义，收尾说明仍是"候选人主动结束"）；
    · 已收盘但没有报告 → **只生成报告**。自动收尾（轮数用尽 / 模型 done）走的就是这条：
      以前这里直接 return，会把报告整个吞掉，用户看到一片空白；
    · 已有报告 → 直接返回。重复点是幂等的，不会生成第二份。
    """
    session = _session_or_404(db, session_id)
    if session.report:
        return _to_detail(session)
    if answered_rounds(session) == 0:
        raise HTTPException(status_code=400, detail="还没有回答任何问题，无法生成报告")
    provider, _model = _require_provider(db)

    async def _generate() -> bool:
        # 只在真正"提前结束"时补收尾说明；自动收尾那场已经收盘，再加一条就成了重复的话。
        if session.status != INTERVIEW_STATUS_FINISHED:
            _close_session(session, "（候选人主动结束了这场面试）")
        await _ensure_report(db, session, provider)
        return True

    # 报告是整场转录再跑一次模型（最慢的一段）：客户端断开就停，报告一个字也不写，
    # 用户回来点「结束并生成报告」可以再来一次。
    finished = await run_until_disconnect(request, _generate(), what="面试报告生成")
    if finished is None:
        raise client_gone("面试报告生成")
    return _to_detail(session)


@router.delete("/{session_id}", status_code=204)
def delete_session(session_id: int, db: Session = Depends(get_db)):
    session = _session_or_404(db, session_id)
    db.delete(session)
    db.commit()


@router.post("/{session_id}/to-material", response_model=MaterialOut, status_code=201)
def report_to_material(session_id: int, db: Session = Depends(get_db)):
    """把这场面试的记录与报告存进资料箱（面试复盘）。"""
    session = _session_or_404(db, session_id)
    return create_material_record(
        db,
        MaterialCreate(
            title=f"面试复盘：{session.title or session.interview_type}"[:256],
            category="面试复盘",
            content=_report_markdown(session),
            note=f"来自模拟面试 #{session.id}",
        ),
    )


# ===== 流式提交回答（AI 提速）：问题像打字一样逐字出现 =====
#
# 此前的回答端点是非流式的：模型把"点评 + 下一题"的 JSON 全部生成完，界面才一次性
# 显示，感知等待 = 全程生成时间。流式版本用同一个提示词与解析（parse_turn），只是在
# 收集过程中把 ``question`` 字段的明文增量先推给前端——JSON 收齐后仍走原有解析与
# 存档，协议与数据完全一致。同时这类结构化调用固定 ``thinking=False``（方案 1）。


def _answer_stream_events(db, session, provider, index, answer) -> AsyncIterator[str]:
    # 收尾钩子与请求链路同一个：走到轮数上限时先让面试官回应最后一答、再收盘，
    # 报告仍交给决策卡（不在这里生成）。
    return make_answer_stream(
        _auto_close,
        _to_detail,
        _resume_text,
        _session_job_text,
        _mark_interrupted,
    )(db, session, provider, index, answer)


@router.post("/{session_id}/answers/stream")
async def submit_answer_stream(
    session_id: int, payload: InterviewAnswerCreate, db: Session = Depends(get_db)
):
    """流式提交一轮回答：``question_delta``（问题明文增量）→ ``done``（完整结果）。"""
    session = _session_or_404(db, session_id)
    if session.status != INTERVIEW_STATUS_ACTIVE:
        raise HTTPException(status_code=409, detail="这场面试已经结束")
    provider, _model = _require_provider(db)

    answer = _record_answer(session, payload.content)
    db.commit()
    index = answered_rounds(session)

    return StreamingResponse(
        _answer_stream_events(db, session, provider, index, answer),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


register_question_routes(
    router,
    lambda db: _require_provider(db),
    lambda db, resume_id: _resume_record_or_none(db, resume_id),
    lambda db, job_id: _job_text(db, job_id),
    lambda db: _claims_json(db),
)

# #41：材料上传（multipart）与面试结束后的追问。挂到同一个 router 上，前缀与鉴权
# 完全一致；两块的校验与错误文案各自留在自己的模块里（见模块文档）。
register_material_routes(router, lambda db: _require_provider(db))
register_followup_routes(router, lambda db: _require_provider(db))
