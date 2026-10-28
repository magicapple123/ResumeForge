# SPDX-License-Identifier: Apache-2.0
"""模拟面试接口：开场、逐轮问答、结束评分与报告归档。

不流式：一轮请求要同时拿到"对上一答的点评"和"下一题"，流式会让界面出现半成品状态。
"""

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator
from typing import get_args

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.claim import ClaimRecord, can_enter_final
from ..models.interview import (
    INTERVIEW_STATUS_ACTIVE,
    INTERVIEW_STATUS_FINISHED,
    InterviewMessage,
    InterviewSession,
)
from ..models.job import Job
from ..models.resume import ResumeRecord
from ..schemas.interview import (
    InterviewAnalysisOut,
    InterviewAnalysisRequest,
    InterviewAnswerCreate,
    InterviewAnswerResult,
    InterviewBrief,
    InterviewCreate,
    InterviewDetail,
    InterviewDurationUpdate,
    InterviewMessageOut,
    InterviewOptimizeOut,
    InterviewOptimizeRequest,
    InterviewQuestionAnswerOut,
    InterviewQuestionAnswerRequest,
    InterviewQuestionGenerateRequest,
    InterviewStatus,
    QuestionBankOut,
)
from ..schemas.material import MaterialCreate, MaterialOut
from ..schemas.resume import ResumeContent
from ..services import trash
from ..services.interview import interview_questions as interview_questions_service
from ..services.interview.interview import (
    add_message,
    answered_rounds,
    build_interview_messages,
    generate_question,
    generate_report,
    mark_answer_interrupted,
    mark_finished,
    parse_turn,
    reuse_interrupted_answer,
    session_persona,
)
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.materials import create_material as create_material_record
from ..services.profile.profile_relevance import build_job_prompt_text
from ..services.resume.resume_suggestions import serialize_resume_prompt_data
from ..services.settings_service import get_llm_config
from ._disconnect import client_gone, run_until_disconnect

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
        return serialize_resume_prompt_data(ResumeContent.model_validate(record.content or {}))
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


def _claims_json(db: Session) -> str:
    """已确认的事实台账基线，序列化后进题库/思路提示词。

    只用 ``已确认`` 状态：它们是可以进入正式材料的唯一事实来源，与生成链路一致。
    """
    claims = [
        item
        for item in db.query(ClaimRecord).filter(trash.live_only(ClaimRecord)).all()
        if can_enter_final(item.verification_status)
    ]
    if not claims:
        return ""
    return json.dumps(
        [
            {
                "title": item.title,
                "category": item.category,
                "subject": item.subject,
                "candidate_wording": item.candidate_wording,
                "responsibility_level": item.responsibility_level,
                "boundary": item.boundary,
                "interview_details": item.interview_details or {},
                "risk_notes": item.risk_notes or [],
            }
            for item in claims
        ],
        ensure_ascii=False,
    )


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


def _report_markdown(session: InterviewSession) -> str:
    """把面试记录与报告整理成一份 Markdown，存进资料箱当复盘材料。"""
    report = session.report or {}
    lines = [
        f"# {session.title or '模拟面试'}",
        "",
        f"- 面试类型：{session.interview_type}",
        f"- 难度：{session.difficulty}",
        f"- 面试官风格：{session.interviewer_style}",
        f"- 目标岗位：{session.job_title or '未关联'}"
        + (f" @ {session.company}" if session.company else ""),
        # 自动轮数模式：总轮数本来就不固定，如实记"自动收尾"（硬上限是实现细节，不进报告）。
        (
            f"- 问答轮数：{answered_rounds(session)} 轮（自动收尾）"
            if session.rounds_min is not None
            else f"- 问答轮数：{answered_rounds(session)} / {session.rounds}"
        ),
    ]
    if report.get("score"):
        lines.append(f"- 总评分：{report['score']}")
    lines.extend(["", "## 问答记录", ""])
    for item in session.messages:
        if item.role == "interviewer":
            lines.append(f"**面试官**：{item.content}")
        elif item.role == "user":
            lines.append(f"**我**：{item.content}")
        else:
            lines.append(f"（{item.content}）")
        lines.append("")
    if report.get("dimensions") or report.get("summary"):
        lines.extend(["## 评分报告", ""])
        for item in report.get("dimensions") or []:
            lines.append(
                f"- **{item.get('name')}**：{item.get('score')} 分 —— {item.get('comment', '')}"
            )
        if report.get("strengths"):
            lines.extend(["", "### 做得好", *[f"- {text}" for text in report["strengths"]]])
        if report.get("improvements"):
            lines.extend(["", "### 可以改进", *[f"- {text}" for text in report["improvements"]]])
        if report.get("summary"):
            lines.extend(["", f"> {report['summary']}"])
    return "\n".join(lines).rstrip() + "\n"


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


@router.post("/questions", response_model=QuestionBankOut)
async def generate_question_bank(
    payload: InterviewQuestionGenerateRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """生成个性化题库（三类：基础/项目深挖/反问 HR），**即时计算、不落库**。"""
    provider, _model = _require_provider(db)
    job = db.get(Job, payload.job_id) if payload.job_id else None

    resume_record = None
    resume_json = ""
    if payload.resume_id is not None:
        resume_record = _resume_record_or_none(db, payload.resume_id)
        if resume_record is None:
            raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
        resume_json = serialize_resume_prompt_data(
            ResumeContent.model_validate(resume_record.content or {})
        )

    job_text = (
        build_job_prompt_text(job, MAX_JOB_CONTEXT_FOR_INTERVIEW)
        if job is not None
        else _job_text(db, resume_record.job_id if resume_record is not None else None)
    )
    claims_json = _claims_json(db)
    db.close()
    try:
        # 客户端断开就真的停：题库是一次十几秒的生成，人走了没人收这份结果。
        result = await run_until_disconnect(
            request,
            interview_questions_service.generate_question_bank(
                provider,
                job_text=job_text,
                resume_json=resume_json,
                claims_json=claims_json,
            ),
            what="面试题库生成",
        )
        if result is None:
            raise client_gone("面试题库生成")
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"生成题库失败：{exc}") from exc
    return QuestionBankOut(
        job_id=job.id if job is not None else None,
        job_title=job.title if job is not None else "",
        company=job.company if job is not None else "",
        resume_id=payload.resume_id,
        groups=result["groups"],
        llm_used=True,
        notes=result["notes"],
    )


@router.post("/analyze", response_model=InterviewAnalysisOut)
async def analyze_question(
    payload: InterviewAnalysisRequest, request: Request, db: Session = Depends(get_db)
):
    """输入一道真实问题，分析答题思路（框架/要点/追问/误区）。"""
    provider, _model = _require_provider(db)

    parts: list[str] = []
    if payload.job_id is not None:
        job = db.get(Job, payload.job_id)
        if job is not None:
            parts.append(
                f"## 目标岗位\n{build_job_prompt_text(job, MAX_JOB_CONTEXT_FOR_INTERVIEW)}"
            )
    if payload.resume_id is not None:
        record = _resume_record_or_none(db, payload.resume_id)
        if record is None:
            raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
        parts.append(
            "## 候选人简历\n"
            + serialize_resume_prompt_data(ResumeContent.model_validate(record.content or {}))
        )
    claims_json = _claims_json(db)
    if claims_json:
        parts.append(f"## 事实台账\n{claims_json}")
    if payload.context.strip():
        parts.append(f"## 用户补充\n{payload.context.strip()}")

    context = "\n\n".join(parts)
    db.close()
    try:
        analysis = await run_until_disconnect(
            request,
            interview_questions_service.analyze_question(
                provider, question=payload.question, context=context
            ),
            what="答题思路分析",
        )
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"分析答题思路失败：{exc}") from exc
    if analysis is None:
        raise client_gone("答题思路分析")
    return analysis


@router.post("/questions/answer", response_model=InterviewQuestionAnswerOut)
async def generate_question_answer_entry(
    payload: InterviewQuestionAnswerRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """为单道题生成详细参考答案（正文 + 要点 + 话术），**即时计算、不落库**。"""
    provider, _model = _require_provider(db)

    job_payload = ""
    if payload.job_id is not None:
        job = db.get(Job, payload.job_id)
        if job is not None:
            job_payload = build_job_prompt_text(job, MAX_JOB_CONTEXT_FOR_INTERVIEW)

    resume_text = ""
    if payload.resume_id is not None:
        record = _resume_record_or_none(db, payload.resume_id)
        if record is None:
            raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
        resume_text = serialize_resume_prompt_data(
            ResumeContent.model_validate(record.content or {})
        )

    db.close()
    try:
        answer = await run_until_disconnect(
            request,
            interview_questions_service.generate_question_answer(
                provider,
                question=payload.question,
                job_payload=job_payload,
                resume_text=resume_text,
            ),
            what="参考答案生成",
        )
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"生成参考答案失败：{exc}") from exc
    if answer is None:
        raise client_gone("参考答案生成")
    return answer


@router.post("/optimize-resume", response_model=InterviewOptimizeOut)
async def optimize_resume(
    payload: InterviewOptimizeRequest, request: Request, db: Session = Depends(get_db)
):
    """把面试暴露的短板与高频追问反向转成简历改写建议（**只产出建议、不改正文**）。"""
    provider, _model = _require_provider(db)
    record = _resume_record_or_none(db, payload.resume_id)
    if record is None:
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    resume = ResumeContent.model_validate(record.content or {})

    job = (
        db.get(Job, payload.job_id)
        if payload.job_id
        else (db.get(Job, record.job_id) if record.job_id else None)
    )
    job_text = build_job_prompt_text(job, MAX_JOB_CONTEXT_FOR_INTERVIEW) if job is not None else ""
    weaknesses = [str(item).strip() for item in payload.weaknesses if str(item).strip()]
    follow_ups = [str(item).strip() for item in payload.follow_ups if str(item).strip()]
    db.close()
    try:
        suggestions = await run_until_disconnect(
            request,
            interview_questions_service.optimize_resume(
                provider,
                resume=resume,
                job_text=job_text,
                weaknesses=weaknesses,
                follow_ups=follow_ups,
            ),
            what="面试反向优化",
        )
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"反向优化失败：{exc}") from exc
    if suggestions is None:
        raise client_gone("面试反向优化")
    return InterviewOptimizeOut(
        resume_id=payload.resume_id,
        suggestions=suggestions,
        llm_used=True,
        notes=[],
    )


# ===== 流式提交回答（AI 提速）：问题像打字一样逐字出现 =====
#
# 此前的回答端点是非流式的：模型把"点评 + 下一题"的 JSON 全部生成完，界面才一次性
# 显示，感知等待 = 全程生成时间。流式版本用同一个提示词与解析（parse_turn），只是在
# 收集过程中把 ``question`` 字段的明文增量先推给前端——JSON 收齐后仍走原有解析与
# 存档，协议与数据完全一致。同时这类结构化调用固定 ``thinking=False``（方案 1）。


class _QuestionDeltaExtractor:
    """从模型输出流里增量提取 ``question`` 字段的明文。

    维护原始缓冲与"已下发明文对应的 raw 指针"：每次 feed 返回新解码出来的部分。
    尾部可能悬着半个转义序列（反斜杠、反斜杠加 u 的四角数字），那种片段留到下一个 delta 再处理，
    绝不下发半截转义。question 在提示词里固定是第一个键，输出形状稳定。
    """

    _KEY_RE = re.compile(r'"question"\s*:\s*"')
    # \n 在 JSON 里表示换行；值的形态是"反转义后的目标字符"。
    _SIMPLE_ESCAPES = {
        "n": "\n",
        "t": "\t",
        "r": "\r",
        "b": "\b",
        "f": "\f",
        '"': '"',
        "\\": "\\",
        "/": "/",
    }

    def __init__(self) -> None:
        self._buffer = ""
        self._raw_ptr = 0
        self._value_start: int | None = None
        self._finished = False

    def feed(self, delta: str) -> str:
        if self._finished:
            return ""
        self._buffer += delta
        if self._value_start is None:
            match = self._KEY_RE.search(self._buffer)
            if not match:
                return ""
            self._value_start = match.end()
            self._raw_ptr = self._value_start
        out: list[str] = []
        i = max(self._raw_ptr, self._value_start)
        while i < len(self._buffer):
            ch = self._buffer[i]
            if ch == "\\":
                if i + 1 >= len(self._buffer):
                    break
                esc = self._buffer[i + 1]
                if esc in self._SIMPLE_ESCAPES:
                    out.append(self._SIMPLE_ESCAPES[esc])
                    i += 2
                elif esc == "u":
                    hex4 = self._buffer[i + 2 : i + 6]
                    if len(hex4) < 4:
                        break
                    out.append(chr(int(hex4, 16)))
                    i += 6
                else:
                    break
            elif ch == '"':
                self._finished = True
                break
            else:
                out.append(ch)
                i += 1
        self._raw_ptr = i
        return "".join(out)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _answer_stream_events(
    db: Session,
    session: InterviewSession,
    provider,
    index: int,
    answer: InterviewMessage,
) -> AsyncIterator[str]:
    """流式生成一轮回答的 SSE 事件流。

    ``answer`` 是这一轮刚写库的候选人回答。只有"面试官那句回应真的落库了"才算这一轮
    走完（``completed``）；中途被取消（客户端断开、用户点「停止本轮」）或模型这一轮
    失败时，``finally`` 把这条回答标成 ``interrupted``——**不删它**，用户可以重答。
    """
    completed = False
    try:
        if index >= session.rounds:
            # 先说一句"进入收尾"，再花十几秒生成报告：否则界面会一直显示"正在思考下一个
            # 问题"，用户根本不知道这场面试已经结束了（见 phase 事件的用途）。
            yield _sse({"type": "phase", "phase": "finishing"})
            await _finish_with_report(db, session, provider)
            result = InterviewAnswerResult(session=_to_detail(session), feedback="", finished=True)
            yield _sse({"type": "done", "result": json.loads(result.model_dump_json())})
            return

        extractor = _QuestionDeltaExtractor()
        parts: list[str] = []
        try:
            messages = build_interview_messages(
                session,
                index=index,
                resume_text=_resume_text(db, session),
                job_text=_job_text(db, session.job_id),
            )
            async for delta in provider.stream_chat_events(messages):
                if delta.text:
                    parts.append(delta.text)
                    piece = extractor.feed(delta.text)
                    if piece:
                        yield _sse({"type": "question_delta", "text": piece})
            question, feedback, done = parse_turn("".join(parts))
        except LLMError:
            # Provider errors are deliberately reduced to a fixed public message;
            # model responses and validation details can contain private resume data.
            # 这一轮没走完（回答已落库、下一问没生成）：由 finally 标成 interrupted。
            yield _sse({"type": "error", "detail": "面试助手暂时无法完成本轮"})
            return

        add_message(
            session,
            role="interviewer",
            content=question,
            context={"index": index, "rounds": session.rounds, "feedback": feedback},
        )
        db.commit()
        # 面试官这句回应落库了 → 这一轮就结束了。之后再被取消（比如正赶上出报告）只是
        # "报告没来得及生成"，属于另一件事：面试官已经接上话，不该再让用户重答这一轮。
        completed = True
        if done:
            # 模型提前收尾：question 按提示词约定是收尾语。同样先报"进入收尾"，
            # 再生成报告（报告是整场转录再跑一次模型，最慢的一段）。
            yield _sse({"type": "phase", "phase": "finishing"})
            await _finish_with_report(db, session, provider)
            result = InterviewAnswerResult(
                session=_to_detail(session), feedback=feedback, finished=True
            )
        else:
            db.refresh(session)
            result = InterviewAnswerResult(
                session=_to_detail(session), feedback=feedback, finished=False
            )
        yield _sse({"type": "done", "result": json.loads(result.model_dump_json())})
    finally:
        if not completed:
            _mark_interrupted(db, answer)


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
