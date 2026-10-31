# SPDX-License-Identifier: Apache-2.0
"""模拟面试接口：开场、逐轮问答、结束评分与报告归档。

不流式：一轮请求要同时拿到"对上一答的点评"和"下一题"，流式会让界面出现半成品状态。
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import get_args

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
from ..models.resume import ResumeRecord
from ..schemas.interview import (
    InterviewAnswerCreate,
    InterviewAnswerResult,
    InterviewBrief,
    InterviewCreate,
    InterviewDetail,
    InterviewDurationUpdate,
    InterviewMessageOut,
    InterviewStatus,
)
from ..schemas.material import MaterialCreate, MaterialOut
from ..services import trash
from ..services.interview import interview_questions as interview_questions_service  # noqa: F401
from ..services.interview.interview import (
    add_message,
    answered_rounds,
    generate_question,
    generate_report,
    mark_answer_interrupted,
    mark_finished,
    reuse_interrupted_answer,
    session_persona,
)
from ..services.interview.interview_context import _claims_json
from ..services.interview.interview_report_markdown import _report_markdown
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.materials import create_material as create_material_record
from ..services.profile.profile_relevance import build_job_prompt_text
from ..services.resume import document_io
from ..services.resume.document_view import document_text
from ..services.settings_service import get_llm_config
from ._disconnect import client_gone, run_until_disconnect
from .interview_question_routes import register_question_routes
from .interview_stream import _QuestionDeltaExtractor as _QuestionDeltaExtractor
from .interview_stream import make_answer_stream

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/interview", tags=["interview"])

MAX_JOB_CONTEXT_FOR_INTERVIEW = 6_000


def _session_or_404(db: Session, session_id: int) -> InterviewSession:
    session = db.get(InterviewSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="面试不存在或已被删除")
    return session


def _require_provider(db: Session):
    """模拟面试每一轮都要调用模型，所以必须已配置。"""
    config = get_llm_config(db)
    if not config.base_url.strip() or not config.model.strip():
        raise HTTPException(status_code=400, detail="尚未配置大模型 API")
    return create_provider(config), config.model


def _resume_text(db: Session, session: InterviewSession) -> str:
    """把这场面试**关联的那份简历**序列化成文本，作为面试官唯一的候选人材料。

    面试官拿到的就是"候选人提交的简历 + 岗位 JD"这两份东西（真实面试的边界），
    所以这里既不再读个人资料，也不跨简历读取。
    """
    if session.resume_id is None:
        return ""
    record = _resume_record_or_none(db, session.resume_id)
    if record is None:
        # 简历被彻底删除：会话仍可用（只按岗位 JD 提问），不阻断面试。
        return ""
    try:
        return document_text(document_io.document_for_record(db, record)[0])
    except Exception:  # noqa: BLE001 - 简历形状异常不该让整场面试 500
        logger.warning("序列化关联简历失败 session=%s", session.id, exc_info=True)
        return ""


def _job_text(db: Session, job_id: int | None) -> str:
    if job_id is None:
        return ""
    job = db.get(Job, job_id)
    if job is None:
        return ""
    return build_job_prompt_text(job, MAX_JOB_CONTEXT_FOR_INTERVIEW)


_INTERVIEW_STATUS_VALUES: tuple[InterviewStatus, ...] = get_args(InterviewStatus)


def _as_interview_status(value: str) -> InterviewStatus:
    """模型层 ``status`` 是 ``str``，出口处收窄为 schema 的 ``Literal``。

    取值由开场 / 结束链路用常量写入，正常不会走到兜底；万一库里出现未知值，在这里
    大声失败（与 pydantic Literal 字段的校验语义一致——以前响应模型校验也会在同一
    位置拦下它），不悄悄把非法状态发给前端。
    """
    if value not in _INTERVIEW_STATUS_VALUES:
        raise ValueError(f"未知的面试状态：{value!r}")
    return value


def _to_out(session: InterviewSession) -> InterviewBrief:
    return InterviewBrief(
        id=session.id,
        title=session.title,
        job_id=session.job_id,
        job_title=session.job_title,
        company=session.company,
        resume_id=session.resume_id,
        resume_title=session.resume_title,
        duration_seconds=session.duration_seconds,
        interview_type=session.interview_type,
        difficulty=session.difficulty,
        interviewer_style=session.interviewer_style,
        rounds=session.rounds,
        rounds_min=session.rounds_min,
        status=_as_interview_status(session.status),
        created_at=session.created_at,
        updated_at=session.updated_at,
        answered_rounds=answered_rounds(session),
    )


def _to_detail(session: InterviewSession) -> InterviewDetail:
    return InterviewDetail(
        **_to_out(session).model_dump(),
        persona=session.persona,
        focus=session.focus,
        model=session.model,
        report=session.report or {},
        messages=[InterviewMessageOut.model_validate(item) for item in session.messages],
    )


def _default_title(payload: InterviewCreate, job: Job | None) -> str:
    if payload.title.strip():
        return payload.title.strip()[:128]
    if job is not None and job.title:
        return f"{job.title} 模拟面试"[:128]
    return f"{payload.interview_type}模拟面试"[:128]


async def _ask_next_question(
    db: Session, session: InterviewSession, provider
) -> tuple[str, str, bool]:
    return await generate_question(
        provider,
        session,
        resume_text=_resume_text(db, session),
        job_text=_job_text(db, session.job_id),
    )


async def _finish_with_report(
    db: Session, session: InterviewSession, provider, *, closing: str = ""
) -> None:
    """结束面试并写入报告；报告失败时留下说明而不是让整场面试不可用。"""
    if closing.strip():
        add_message(session, role="note", content=closing.strip())
    try:
        session.report = await generate_report(provider, session)
    except LLMError as exc:
        logger.warning("面试报告生成失败 session=%s：%s", session.id, exc)
        session.report = {"summary": f"报告生成失败：{exc}", "error": True}
    mark_finished(session)
    db.commit()
    db.refresh(session)


def _record_answer(session: InterviewSession, content: str) -> InterviewMessage:
    """把这一轮的候选人回答落库。

    上一次被中断（客户端断开 / 用户点「停止本轮」/ 模型这一轮失败）会留下一条
    ``status=interrupted`` 的回答；重答时**复用它**，不再追加第二条同样的用户消息
    ——重答走的就是同一条提问链路，同一句话不该在记录里出现两遍（详见
    ``reuse_interrupted_answer``）。
    """
    reused = reuse_interrupted_answer(session, content)
    if reused is not None:
        logger.info("重答复用被中断的一轮 session=%s message=%s", session.id, reused.id)
        return reused
    return add_message(session, role="user", content=content)


def _mark_interrupted(db: Session, answer: InterviewMessage) -> None:
    """把"这一轮没答完"写进记录：**只改状态，绝不删除用户那条消息**。

    放在收尾/取消路径上调用，所以自己吞掉写库异常：中断标记失败只该降级成"这轮看起来
    没答完但没标出来"，不能因为写状态把客户端断开这件事变成 500。
    """
    if not mark_answer_interrupted(answer):
        return
    try:
        db.commit()
        logger.info("面试一轮被中断 message=%s（用户回答保留，可重答）", answer.id)
    except Exception:  # noqa: BLE001 - 取消路径不能再抛
        logger.warning("标记面试中断状态失败 message=%s", answer.id, exc_info=True)
        db.rollback()


# ===== R-11 题库 / 答题思路 / 反向优化 的共用读取 =====


def _resume_record_or_none(db: Session, resume_id: int) -> ResumeRecord | None:
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        return None
    return record


@router.get("", response_model=list[InterviewBrief])
def list_sessions(limit: int = Query(default=50, ge=1, le=200), db: Session = Depends(get_db)):
    sessions = (
        db.query(InterviewSession).order_by(InterviewSession.created_at.desc()).limit(limit).all()
    )
    return [_to_out(item) for item in sessions]


@router.post("", response_model=InterviewDetail, status_code=201)
async def create_session(payload: InterviewCreate, request: Request, db: Session = Depends(get_db)):
    """开一场面试：先落库会话，再让面试官问第一个问题。

    关联岗位与关联简历都是必填且必须**仍然存在**：面试官只会读这两份内容，指向一份
    已删除的简历或岗位时，与其开一场看不到材料的面试，不如直接告诉用户。
    """
    provider, model = _require_provider(db)
    job = db.get(Job, payload.job_id)
    if job is None or trash.is_deleted(job):
        raise HTTPException(status_code=404, detail="关联岗位不存在或已被删除")
    record = _resume_record_or_none(db, payload.resume_id)
    if record is None:
        raise HTTPException(status_code=404, detail="关联简历不存在或已被删除")
    session = InterviewSession(
        title=_default_title(payload, job),
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        resume_id=record.id,
        resume_title=record.title[:256],
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
    if index >= session.rounds:
        await _finish_with_report(db, session, provider)
        return InterviewAnswerResult(session=_to_detail(session), feedback="", finished=True)

    try:
        question, feedback, done = await _ask_next_question(db, session, provider)
    except LLMError:
        # 回答已经存下来了，用户不会白写；只是这一轮的追问失败。标成未完成，界面上就有
        # 「重新回答」的入口，重答会复用这条回答（不会写出第二条一模一样的用户消息）。
        _mark_interrupted(db, answer)
        raise HTTPException(status_code=502, detail="面试助手暂时无法完成本轮") from None

    add_message(
        session,
        role="interviewer",
        content=question,
        context={"index": index, "rounds": session.rounds, "feedback": feedback},
    )
    db.commit()

    # 模型提前结束（done）：这里的 question 按提示词约定是收尾语，存下来给用户看。
    #
    # 「自动」档还有个**下限**：`rounds_min` 之前不允许收尾。提示词是建议不是约束——实测
    # 模型会在第 3、4 轮就宣称"聊得差不多了"。所以这里兜一层：没到最早轮数时忽略 done，
    # 把它当普通一轮继续（question 仍作为下一题，用户不会因此卡住）。不重新调模型：
    # 那样既贵又可能死循环，而且模型给的这句话本身通常还是能接着聊的。
    early_close = session.rounds_min is not None and answered_rounds(session) < session.rounds_min
    if done and early_close:
        logger.info(
            "面试官试图在第 %s 轮提前收尾（最早 %s 轮），已忽略 session=%s",
            answered_rounds(session),
            session.rounds_min,
            session.id,
        )
        done = False
    if done:
        await _finish_with_report(db, session, provider)
        return InterviewAnswerResult(session=_to_detail(session), feedback=feedback, finished=True)

    db.refresh(session)
    return InterviewAnswerResult(session=_to_detail(session), feedback=feedback, finished=False)


@router.post("/{session_id}/finish", response_model=InterviewDetail)
async def finish_session(session_id: int, request: Request, db: Session = Depends(get_db)):
    """提前结束并出报告（用户点"结束面试"）。"""
    session = _session_or_404(db, session_id)
    if session.status == INTERVIEW_STATUS_FINISHED:
        return _to_detail(session)
    if answered_rounds(session) == 0:
        raise HTTPException(status_code=400, detail="还没有回答任何问题，无法生成报告")
    provider, _model = _require_provider(db)

    async def _generate() -> bool:
        await _finish_with_report(db, session, provider, closing="（候选人主动结束了这场面试）")
        return True

    # 报告是整场转录再跑一次模型（最慢的一段）：客户端断开就停，报告一个字也不写，
    # 用户回来点「结束面试」可以再来一次。
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
    return make_answer_stream(
        _finish_with_report,
        _to_detail,
        _resume_text,
        _job_text,
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
