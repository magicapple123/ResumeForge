# SPDX-License-Identifier: Apache-2.0
"""Streaming interview events with injected session hooks.

#26 P0 实时语音：在**既有** SSE 端点上扩展三件事，不新开生成端点。

1. **``client_turn_id`` 幂等**（26D）：同一轮重复请求不重复计轮，也不重复生成。已经
   答完的一轮直接回放 ``done``；被中断的一轮复用那条用户消息重新生成。
2. **cancel / interrupted**（26D + 26E）：插话时客户端发一条独立的 cancel 请求，生成器在
   下一个 delta 边界停下，把"已播出"的那一段写回记录（``interrupted=true`），并把回滚
   字数写进 context；下一轮提示词由 ``append_interruption_notice`` 补一句"上一轮被打断"。
3. **观测**（26H）：每轮记 ``ttft_ms / endpoint 之外的生成耗时 / 是否打断 / 回滚字数``，
   **不记任何对话内容**（模型输出与候选人回答都不进日志）。

取消为什么用"独立 HTTP 请求 + delta 边界检查"而不是 EventSource：现有链路是 POST SSE
（``fetch` + ``consumeSSE``），同一条连接上没法再发控制帧。本地单用户应用里 cancel 用
一条独立请求最省事；生成器只在 delta 边界检查一次——LLM 流式通常 50–200ms 一个 delta，
所以打断延迟就落在这个量级，这也正是 26H 要观测的那个数。
"""

import json
import logging
import re
import time
from collections.abc import AsyncIterator

from sqlalchemy.orm import Session

from ..models.interview import (
    INTERVIEW_STATUS_FINISHED,
    InterviewMessage,
    InterviewSession,
)
from ..schemas.interview import (
    InterviewAnswerResult,
)
from ..services.interview.interview import (
    add_message,
    build_interview_messages,
    parse_turn,
)
from ..services.interview.voice_turns import (
    append_interruption_notice,
    record_barge_in,
    response_after,
    rollback_text,
    turn_completed,
)
from ..services.llm.base import LLMError
from .interview_voice import TurnControl, register_turn, unregister_turn

logger = logging.getLogger(__name__)


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


def _client_turn_id_of(answer: InterviewMessage) -> str | None:
    context = answer.context if isinstance(answer.context, dict) else {}
    value = context.get("client_turn_id")
    return str(value) if value else None


def _replay_result(
    session: InterviewSession,
    answer: InterviewMessage,
    to_detail,
) -> InterviewAnswerResult:
    """重复提交回放：结果与这一轮当时真正跑完后返回的 ``done`` 同形状。"""
    finished = session.status == INTERVIEW_STATUS_FINISHED
    response = response_after(session, answer)
    context = (response.context or {}) if response is not None else {}
    return InterviewAnswerResult(
        session=to_detail(session),
        feedback=str(context.get("feedback") or ""),
        finished=finished,
        needs_report=finished and not (session.report or {}),
    )


def _log_turn(
    control: TurnControl,
    *,
    index: int,
    completed: bool,
    interrupted: bool,
    generated_chars: int,
    played_chars: int,
    rolled_back_chars: int,
) -> None:
    """26H：一轮的结构化观测。只记数字与状态，**不记任何对话内容**。"""
    ttft_ms = (
        int((control.first_delta_at - control.started_at) * 1000)
        if control.first_delta_at is not None
        else -1
    )
    total_ms = int((time.perf_counter() - control.started_at) * 1000)
    logger.info(
        "interview_voice turn session=%d index=%d ttft_ms=%d total_ms=%d "
        "completed=%s interrupted=%s generated_chars=%d played_chars=%d rolled_back_chars=%d",
        control.session_id,
        index,
        ttft_ms,
        total_ms,
        completed,
        interrupted,
        generated_chars,
        played_chars,
        rolled_back_chars,
    )


def make_answer_stream(
    _close_session, _to_detail, _resume_text, _session_job_text, _mark_interrupted
):
    """收尾钩子由调用方注入（``api/interview.py`` 传的是"只收盘"的 ``_auto_close``）。

    钩子签名固定 ``(db, session, provider)``：需求 4 之后它不再生成报告，但仍然收
    provider，这样以后要改回"收盘即出报告"时调用点不用动。
    """

    async def _answer_stream_events(
        db: Session,
        session: InterviewSession,
        provider,
        index: int,
        answer: InterviewMessage,
    ) -> AsyncIterator[str]:
        """流式生成一轮回答的 SSE 事件流。

        ``answer`` 是这一轮刚写库的候选人回答。只有"面试官那句回应真的落库了"、或者
        "轮数用尽/模型收尾这类**正常答完**"才算这一轮走完（``completed``）；中途被取消
        （客户端断开、用户点「停止本轮」、用户插话）或模型这一轮失败时，``finally`` 把这条
        回答标成 ``interrupted``——**不删它**，用户可以重答。
        """
        client_turn_id = _client_turn_id_of(answer)
        # ① 幂等回放：同一轮重复提交（这一轮早就答完）→ 不重新生成，直接回放 done。
        if client_turn_id is not None and turn_completed(session, answer):
            replayed = _replay_result(session, answer, _to_detail)
            logger.info(
                "interview_voice replay session=%d index=%d client_turn=%s",
                session.id,
                index,
                client_turn_id,
            )
            yield _sse(
                {
                    "type": "done",
                    "replayed": True,
                    "result": json.loads(replayed.model_dump_json()),
                }
            )
            return

        control = register_turn(session.id, client_turn_id)
        if control is None:
            # ② 同一轮已经有一条生成流在跑：不重复计轮、不重复生成，也不动库。
            yield _sse({"type": "error", "detail": "这一轮正在生成中，请稍候"})
            return

        completed = False
        interrupted = False
        generated_chars = 0
        played_chars = 0
        rolled_back_chars = 0
        try:
            if index >= session.rounds:
                # 轮数用尽：**只收盘、不出报告**（需求 4）。报告由用户在决策卡上确认，
                # 所以这里不再推 ``phase: finishing``——那一句等于告诉用户"正在生成报告"，
                # 而此刻并没有在生成。
                #
                # 这条分支是"最后那一答**答完了**"，不是中断：面试官不会再接话（已经收盘），
                # 但这跟"面试官没接上话"是两件事。``completed`` 必须在 return 之前置真，
                # 否则 ``finally`` 会把这条答完的回答标成 interrupted，界面上出现一个点了
                # 必然 409（面试已结束）的「重新回答」。
                completed = True
                await _close_session(db, session, provider)
                result = InterviewAnswerResult(
                    session=_to_detail(session), feedback="", finished=True, needs_report=True
                )
                yield _sse({"type": "done", "result": json.loads(result.model_dump_json())})
                return

            extractor = _QuestionDeltaExtractor()
            parts: list[str] = []
            try:
                messages = build_interview_messages(
                    session,
                    index=index,
                    resume_text=_resume_text(db, session),
                    job_text=_session_job_text(db, session),
                )
                # 26E：上一轮被打断时，本轮补一句"只说到 X"；没有中断时原样返回。
                messages = append_interruption_notice(messages, session)
                async for delta in provider.stream_chat_events(messages):
                    if control.cancelled:
                        break
                    if delta.text:
                        if control.first_delta_at is None and delta.text.strip():
                            control.first_delta_at = time.perf_counter()
                        parts.append(delta.text)
                        piece = extractor.feed(delta.text)
                        if piece:
                            control.sent_text += piece
                            yield _sse({"type": "question_delta", "text": piece})
                    # yield 让出控制权期间可能收到 cancel：恢复后立刻检查。
                    if control.cancelled:
                        break

                if control.cancelled:
                    # ③ 插话（26C/26E）：停下生成，回滚到"已播出"，写回一条带标记的
                    #    部分回应。用户回答的 interrupted 状态交给 finally 统一收口。
                    interrupted = True
                    generated = control.sent_text
                    generated_chars = len(generated)
                    played_text, rolled_back_chars = rollback_text(
                        generated, control.played_chars
                    )
                    played_chars = len(played_text)
                    record_barge_in(
                        db,
                        session,
                        answer,
                        index=index,
                        played_text=played_text,
                        played_chars=played_chars,
                        generated_chars=generated_chars,
                    )
                    yield _sse(
                        {
                            "type": "interrupted",
                            "played_chars": played_chars,
                            "generated_chars": generated_chars,
                            "rolled_back_chars": rolled_back_chars,
                            "text": played_text,
                        }
                    )
                    return

                question, feedback, done = parse_turn("".join(parts))
            except LLMError:
                # Provider errors are deliberately reduced to a fixed public message;
                # model responses and validation details can contain private resume data.
                # 这一轮没走完（回答已落库、下一问没生成）：由 finally 标成 interrupted。
                yield _sse({"type": "error", "detail": "面试助手暂时无法完成本轮"})
                return

            # ``done`` 时这句 question 按提示词约定就是收尾语：标记出来，``_close_session``
            # 之后的 ``_auto_close`` 才不会以为还没收尾、再补一段告别。
            add_message(
                session,
                role="interviewer",
                content=question,
                context={
                    "index": index,
                    "rounds": session.rounds,
                    "feedback": feedback,
                    **({"closing": True} if done else {}),
                },
            )
            db.commit()
            # 面试官这句回应落库了 → 这一轮就结束了。之后再被取消（比如正赶上出报告）只是
            # "报告没来得及生成"，属于另一件事：面试官已经接上话，不该再让用户重答这一轮。
            completed = True
            if done:
                # 模型提前收尾：question 按提示词约定是收尾语。同样只收盘、不出报告
                # （需求 4）：报告要等用户在决策卡上点「结束并生成报告」。
                await _close_session(db, session, provider)
                result = InterviewAnswerResult(
                    session=_to_detail(session),
                    feedback=feedback,
                    finished=True,
                    needs_report=True,
                )
            else:
                db.refresh(session)
                result = InterviewAnswerResult(
                    session=_to_detail(session), feedback=feedback, finished=False
                )
            yield _sse({"type": "done", "result": json.loads(result.model_dump_json())})
        finally:
            unregister_turn(control)
            if not completed:
                _mark_interrupted(db, answer)
            _log_turn(
                control,
                index=index,
                completed=completed,
                interrupted=interrupted,
                generated_chars=generated_chars,
                played_chars=played_chars,
                rolled_back_chars=rolled_back_chars,
            )

    return _answer_stream_events
