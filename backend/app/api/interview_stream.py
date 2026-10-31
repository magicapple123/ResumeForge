# SPDX-License-Identifier: Apache-2.0
"""Streaming interview events with injected session hooks."""

import json
import re
from collections.abc import AsyncIterator

from sqlalchemy.orm import Session

from ..models.interview import (
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
from ..services.llm.base import LLMError


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


def make_answer_stream(_finish_with_report, _to_detail, _resume_text, _job_text, _mark_interrupted):
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
                result = InterviewAnswerResult(
                    session=_to_detail(session), feedback="", finished=True
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

    return _answer_stream_events
