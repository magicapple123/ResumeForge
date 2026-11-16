# SPDX-License-Identifier: Apache-2.0
"""模拟面试接口：开场、逐轮问答、结束评分与报告归档。

不流式：一轮请求要同时拿到"对上一答的点评"和"下一题"，流式会让界面出现半成品状态。

本模块只保留**流程控制**（什么时候收尾、什么时候出报告）与这些流程对应的路由；
进/出 schema 的转换、材料取数、回答落库与中断标记都搬去了 ``interview_shared``
（#41 加"材料导入 / 追问分相"时这支已经贴着 500 行预算）。材料上传与追问两个端点
在 ``interview_material_routes`` 里，用 ``register_*`` 挂到同一个 router 上。

## RF-02：编排只看准备结果

每个入口都切成「准备 → 模型 → 落库」三段，其中"准备"和"落库"是同步工作单元，住在
``interview_units``，一律经 ``run_sync`` 在 worker 里跑。本模块的编排函数（
``_ask_next_question`` / ``_auto_close`` / ``_ensure_report`` / ``_answer_after_recording``）
因此**只吃一个冻结对象**（``QuestionTurn`` / ``AnswerPrep`` / ``FinishPrep``），不再把
``db`` / ``session`` 当实参往下传——事件循环上不该出现"拿着请求会话"的形状。落库靠
``run_sync(..., prep.db, ...)``，取消与断流的终态额外用 ``asyncio.shield`` 包住。
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
)
from ..runtime.blocking import run_sync
from ..schemas.interview import (
    InterviewAnswerCreate,
    InterviewAnswerResult,
    InterviewCreate,
    InterviewDetail,
)
from ..services.actions import add_action_route
from ..services.actions.catalog import all_actions
from ..services.interview import interview_questions as interview_questions_service  # noqa: F401
from ..services.interview.interview import (
    answered_rounds,
    close_with_closing_remark,
    generate_question,
    generate_report,
)
from ..services.interview.interview_camera import has_real_report
from ..services.interview.interview_context import _claims_json
from ..services.interview.interview_read import (
    list_session_briefs,
)
from ..services.interview.session_open import (
    InterviewSessionOpenError,
    prepare_interview_session,
)
from ..services.llm.base import LLMError
from ._disconnect import client_gone, run_until_disconnect
from .interview_camera import register_camera_routes
from .interview_material_routes import register_followup_routes, register_material_routes
from .interview_question_routes import register_question_routes
from .interview_revise import register_revise_routes
from .interview_session_routes import register_session_routes
from .interview_shared import (
    MAX_JOB_CONTEXT_FOR_INTERVIEW,  # noqa: F401  (re-export：interview_answer_review 从本模块取)
    _commit_and_refresh,
    _job_text,
    _mark_interrupted,
    _require_provider,
    _resume_record_or_none,
    _resume_text,
    _session_job_text,
    _session_material,
    _session_or_404,
    _to_detail,
)
from .interview_stream import _QuestionDeltaExtractor as _QuestionDeltaExtractor
from .interview_stream import make_answer_stream
from .interview_units import (
    AnswerPrep,
    FinishPrep,
    QuestionTurn,
    add_interviewer_message,
    commit_report,
    discard_session,
    mark_answer_interrupted,
    prepare_answer,
    prepare_finish,
    prepare_stream_answer,
    record_opening,
    refresh_session,
)
from .interview_units import (
    close_and_commit as _close_and_commit,
)
from .interview_units import (
    close_session as _close_session,
)
from .interview_units import (
    has_closing_remark as _has_closing_remark,
)
from .interview_voice import register_voice_routes

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api/interview", tags=["interview"])


async def _ask_next_question(turn: QuestionTurn) -> tuple[str, str, bool]:
    """要下一题（开场时是"第一题"）。

    材料由调用方在 worker 里读好再传进来（``run_sync(_session_material, db, session)``）：
    ``_resume_text`` 会读简历文件、反序列化简历记录，那一段同步 IO 属于 worker 的活。
    RF-02 之前这里在事件循环上直接调 ``_resume_text(db, session)``，一次慢盘读就能把同
    进程的 SSE 与其他请求一起卡住（SQLite ``busy_timeout`` 是 5 秒）。

    参数收成一个 ``QuestionTurn``：这一步剩下的只有"把材料交给模型"，不该再把
    ``session`` / ``db`` 当实参往下传（见 ``interview_units`` 的纪律）。
    """
    return await generate_question(
        turn.provider,
        turn.session,
        resume_text=turn.material.resume_text,
        job_text=turn.material.job_text,
    )


async def _ensure_report(prep: FinishPrep) -> None:
    """确保这场面试有报告：已有就直接返回，否则现生成一份（幂等）。

    报告失败时留下说明而不是让整场面试不可用：重试要再烧一次整场转录的 token，而用户
    真正需要的是"记录还在、能复盘"。所以错误报告也算"已有报告"，不重复生成。
    """
    # 只带 ``camera`` 段的 report 不算"已有报告"：镜头分析可以在出报告之前完成
    # （用户先开镜头跑完整场、再点生成报告），那时若直接返回就会漏掉分数与维度。
    if has_real_report(prep.session.report):
        return
    # 出报告会整体替换 report：镜头段是独立写入的，不在这里带过去就被冲掉。
    camera = (prep.session.report or {}).get("camera")
    try:
        report = await generate_report(prep.provider, prep.session)
    except LLMError as exc:
        logger.warning("面试报告生成失败 session=%s：%s", prep.session.id, exc)
        report = {"summary": f"报告生成失败：{exc}", "error": True}
    if camera:
        report["camera"] = camera
    # 落库 + 收盘在 worker 里跑：``mark_finished`` 与提交刷新是同一件事。
    await run_sync(commit_report, prep.db, prep.session, report)


async def _auto_close(prep: AnswerPrep) -> None:
    """自动收尾：轮数用尽或模型 ``done`` 时**先让面试官接一句话，再收盘**。

    报告仍然留给用户决定（需求 4）；这里多做的只有"最后一答的回应"：
    直接收盘的话，界面上最后一句话是候选人的回答，紧跟着就是「本场正式问答已结束」，
    真实面试里不会这样。所以先用一次模型调用换一段"点评最后那段 + 收尾"（
    ``close_with_closing_remark``），把这条面试官消息落库，再收盘。

    失败不阻断：模型挂掉也照样收尾（前端会用本地化兜底文案补一句），否则用户会卡在
    一场永远结束不了的面试里。

    参数是 ``AnswerPrep``（会话行 + provider + 请求会话）：它既被非流式链路调用，也被
    ``interview_stream`` 当收盘钩子调用——两条链路本来就都拿着同一份准备结果。
    """
    # 幂等：重复调用（重试、流式与非流式都走到这里）不能写第二条收尾。
    if prep.session.status == INTERVIEW_STATUS_FINISHED or _has_closing_remark(
        prep.session.messages
    ):
        await run_sync(_close_and_commit, prep.db, prep.session)
        return

    reply = ""
    if prep.provider is not None:
        try:
            reply = await close_with_closing_remark(prep.provider, prep.session)
        except LLMError as exc:
            logger.warning("面试收尾回应生成失败 session=%s：%s", prep.session.id, exc)
            reply = ""
    await run_sync(_close_and_commit, prep.db, prep.session, reply)


# ===== R-11 题库 / 答题思路 / 反向优化 的共用读取（实现见 ``interview_shared``）=====


add_action_route(router, all_actions()["list_interview_sessions"], route_path="")


def list_sessions(limit: int = Query(default=50, ge=1, le=200), db: Session = Depends(get_db)):
    """会话列表；薄壳：实现在 ``services.interview.interview_read.list_session_briefs``。"""
    return list_session_briefs(db, limit)


@router.post("", response_model=InterviewDetail, status_code=201)
async def create_session(payload: InterviewCreate, request: Request, db: Session = Depends(get_db)):
    """开一场面试：先落库会话，再让面试官问第一个问题。

    每一侧材料都是**二选一**（记录 or 导入的文件，见 `InterviewCreate`）：面试官只会读
    这两份内容，所以指向一份已删除的简历/岗位时，与其开一场看不到材料的面试，不如直接
    告诉用户。导入的文件已经是提取好的文本（上传时就校验过），这里不再解析。

    T2：会话初始化（材料校验 + 建行）已下沉到 `services/interview/session_open.py`；
    模型调用的两个打桩点（`_require_provider` / `_ask_next_question`）与事务收尾留在本层。
    RF-02：初始化 + 提交刷新是一个 ``run_sync`` 工作单元，模型调用期间事件循环不持有
    任何待提交的写事务；材料在另一个工作单元里读成 ``SessionMaterial`` 快照。
    """
    try:
        draft = await run_sync(
            prepare_interview_session, db, payload, require_provider=_require_provider
        )
    except InterviewSessionOpenError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    # 先落库空会话再调模型：模型调用（十几秒到分钟级）期间不维持请求会话的写事务。
    await run_sync(_commit_and_refresh, db, draft.session)
    material = await run_sync(_session_material, db, draft.session)

    try:
        # 开场就要现场生成第一题（十几秒的模型调用）：客户端断开就停，别白烧 token。
        turn = await run_until_disconnect(
            request,
            _ask_next_question(
                QuestionTurn(session=draft.session, provider=draft.provider, material=material)
            ),
            what="模拟面试开场",
        )
    except LLMError:
        # 开场失败就删掉这条空会话：留一条没有任何内容的面试只会让列表变乱。
        await run_sync(discard_session, db, draft.session)
        raise HTTPException(status_code=502, detail="面试助手暂时无法开始本轮") from None
    if turn is None:
        # 客户端断在开场：同样删掉这条空会话，再报"没人收这个结果"。
        await run_sync(discard_session, db, draft.session)
        raise client_gone("模拟面试开场")
    question, _feedback, _done = turn
    detail = await run_sync(record_opening, db, draft.session, question)
    logger.info("模拟面试已开始 id=%s type=%s", draft.session.id, draft.session.interview_type)
    return detail


add_action_route(router, all_actions()["get_interview_report"], route_path="/{session_id}")


@router.post("/{session_id}/answers", response_model=InterviewAnswerResult)
async def submit_answer(
    session_id: int, payload: InterviewAnswerCreate, db: Session = Depends(get_db)
):
    """提交一轮回答：返回点评与下一题；满轮次时自动收尾并出报告。"""
    prep = await run_sync(
        prepare_answer, db, session_id, payload.content, require_provider=_require_provider
    )
    try:
        return await _answer_after_recording(prep)
    except asyncio.CancelledError:
        # 客户端断开：短任务没有"后台继续"的语义，这一轮标成未完成（回答保留，可重答）。
        # ``shield``：取消已经在传播，但"标未完成"必须落地——否则这条回答永远停在
        # "生成中"，用户连「重新回答」都点不到。
        await asyncio.shield(run_sync(mark_answer_interrupted, prep.db, prep.answer_id))
        raise


async def _answer_after_recording(prep: AnswerPrep) -> InterviewAnswerResult:
    """候选人回答已经落库之后的那一步：要下一题，或直接收尾出报告。"""
    session = prep.session
    provider = prep.provider
    index = prep.index
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
        await _auto_close(prep)
        return InterviewAnswerResult(
            session=await run_sync(_to_detail, session),
            feedback="",
            finished=True,
            needs_report=True,
        )

    material = await run_sync(_session_material, prep.db, session)
    try:
        question, feedback, done = await _ask_next_question(
            QuestionTurn(session=session, provider=provider, material=material)
        )
    except LLMError:
        # 回答已经存下来了，用户不会白写；只是这一轮的追问失败。标成未完成，界面上就有
        # 「重新回答」的入口，重答会复用这条回答（不会写出第二条一模一样的用户消息）。
        await run_sync(mark_answer_interrupted, prep.db, prep.answer_id)
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
    await run_sync(add_interviewer_message, prep.db, session, question, context)

    if done and early_close:
        logger.info(
            "面试官试图在第 %s 轮提前收尾（最早 %s 轮），已忽略 session=%s",
            answered_rounds(session),
            session.rounds_min,
            session.id,
        )
        done = False
    if done:
        await _auto_close(prep)
        return InterviewAnswerResult(
            session=await run_sync(_to_detail, session),
            feedback=feedback,
            finished=True,
            needs_report=True,
        )

    await run_sync(refresh_session, prep.db, session)
    return InterviewAnswerResult(
        session=await run_sync(_to_detail, session), feedback=feedback, finished=False
    )


@router.post("/{session_id}/finish", response_model=InterviewDetail)
async def finish_session(session_id: int, request: Request, db: Session = Depends(get_db)):
    """结束并出报告（候选人在决策卡上点「结束并生成报告」）。

    三个分支，一条共同的不变量：**同一场面试只会有一份报告**。

    · 还没收盘 → 收盘 + 生成报告（"提前结束"语义，收尾说明仍是"候选人主动结束"）；
    · 已收盘但没有报告 → **只生成报告**。自动收尾（轮数用尽 / 模型 done）走的就是这条：
      以前这里直接 return，会把报告整个吞掉，用户看到一片空白；
    · 已有报告 → 直接返回。重复点是幂等的，不会生成第二份。
    """
    prep = await run_sync(prepare_finish, db, session_id, require_provider=_require_provider)
    if prep.detail is not None:
        return prep.detail
    session = prep.session

    async def _generate() -> bool:
        # 只在真正"提前结束"时补收尾说明；自动收尾那场已经收盘，再加一条就成了重复的话。
        if prep.needs_close:
            _close_session(session, "（候选人主动结束了这场面试）")
        await _ensure_report(prep)
        return True

    # 报告是整场转录再跑一次模型（最慢的一段）：客户端断开就停，报告一个字也不写，
    # 用户回来点「结束并生成报告」可以再来一次。
    finished = await run_until_disconnect(request, _generate(), what="面试报告生成")
    if finished is None:
        raise client_gone("面试报告生成")
    return await run_sync(_to_detail, session)


# ===== 流式提交回答（AI 提速）：问题像打字一样逐字出现 =====
#
# 此前的回答端点是非流式的：模型把"点评 + 下一题"的 JSON 全部生成完，界面才一次性
# 显示，感知等待 = 全程生成时间。流式版本用同一个提示词与解析（parse_turn），只是在
# 收集过程中把 ``question`` 字段的明文增量先推给前端——JSON 收齐后仍走原有解析与
# 存档，协议与数据完全一致。同时这类结构化调用固定 ``thinking=False``（方案 1）。


def _answer_stream_events(db, prep: AnswerPrep) -> AsyncIterator[str]:
    # 收尾钩子与请求链路同一个：走到轮数上限时先让面试官回应最后一答、再收盘，
    # 报告仍交给决策卡（不在这里生成）。
    #
    # 跨 ``await`` 只传这一份准备结果（会话行 + provider + 轮次序号 + 回答 id），
    # 生成器按 id 自己收口；``db`` 显式保留在形参上，是因为它必须继续**只**作为
    # ``run_sync(...)`` 的第一实参出现（守卫 ``test_async_route_thread_boundary`` 盯的就是这条）。
    return make_answer_stream(
        _auto_close,
        _to_detail,
        _resume_text,
        _session_job_text,
        _mark_interrupted,
    )(db, prep)


@router.post("/{session_id}/answers/stream")
def submit_answer_stream(
    session_id: int, payload: InterviewAnswerCreate, db: Session = Depends(get_db)
):
    """流式提交一轮回答：``question_delta``（问题明文增量）→ ``done``（完整结果）。

    这个端点自身没有任何 ``await``（准备段是纯同步 IO，SSE 在生成器里推），所以写成
    ``def``：Starlette 会把整个 handler 丢进线程池，准备段一次都不占事件循环。
    """
    prep = prepare_stream_answer(
        db,
        session_id,
        payload.content,
        payload.client_turn_id,
        require_provider=_require_provider,
    )
    return StreamingResponse(
        _answer_stream_events(db, prep),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


register_revise_routes(
    router,
    session_or_404=_session_or_404,
    require_provider=lambda db: _require_provider(db),
    stream_events=_answer_stream_events,
    answered_rounds=answered_rounds,
    status_active=INTERVIEW_STATUS_ACTIVE,
)

register_question_routes(
    router,
    lambda db: _require_provider(db),
    lambda db, resume_id: _resume_record_or_none(db, resume_id),
    lambda db, job_id: _job_text(db, job_id),
    lambda db: _claims_json(db),
)

# #41：材料上传与面试后追问同一个 router、同样前缀与鉴权；校验与文案各自留在模块里。
register_material_routes(router, lambda db: _require_provider(db))
register_followup_routes(router, lambda db: _require_provider(db))
# #26 P0：语音取消端点（插话 → 中止生成 + 回滚）；
register_voice_routes(router)
# F18：镜头抽帧分析 + 录像上传/回放/删除；录像不进备份（见 interview_camera 与 coverage）。
register_camera_routes(router)
# 会话级端点（时长 / 删除 / 转资料）拆到 interview_session_routes（行数预算）。
register_session_routes(router)
