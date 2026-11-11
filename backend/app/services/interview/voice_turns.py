# SPDX-License-Identifier: Apache-2.0
"""模拟面试实时语音 P0 的纯逻辑：轮次幂等、打断回滚、下一轮上下文提示。

#26 P0 把"双工 / 保守断句 / 可插话"里**服务端**该记的那部分收在这里，
``api/interview_stream.py`` 只负责把它接进 SSE 流（不碰数据库语义，也不解析模型输出）。

三件事，各有自己的不变量：

1. **``client_turn_id`` 幂等**：同一轮重复请求不重复计轮，也不重复生成。重复请求分两种：
   上一轮已经答完（后面跟着面试官回应）→ 直接回放 ``done``；上一轮被中断 → 复用那条
   用户消息重新生成（与既有「重新回答」同一条链路），**不会写出第二条一样的用户消息**。
2. **打断回滚**：用户插话时模型往往已经流出大半段回答。只保留"用户真正看到/听到"的那
   一部分（``played_chars``），其余丢掉——下一轮上下文里不能出现用户没听过的内容。
3. **下一轮上下文**：把「上一轮你的回应被候选人打断，只说到 X」写进提示词，否则模型会
   以为自己讲完了，继续引用用户没听过的内容。

## 为什么"已播出"按字符算

P0 没有 TTS：面试官的话就是界面上的文字，逐字到达（``question_delta``）。所以"用户看到
哪个字"等于服务端已经 flush 出去的字符数；P1 接 TTS 后由播放器上报更精确的播放位置，
本模块的接口不用改（``played_chars`` 一直是入参）。

## 为什么回滚文本带一句"被打断"标记

报告是拿整场转录再跑一次模型生成的（``build_report_messages`` 只读消息 ``content``，
看不到 ``context``）。把标记写进那条面试官消息的正文，报告才知道这一轮不完整、不会把
用户没听过的内容当成"面试官说过的话"引用。UI 那边由 ``context.interrupted`` 判断是否
显示打断提示，不依赖这句标记。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.interview import MESSAGE_PHASE_INTERVIEW, InterviewMessage, InterviewSession
from .interview import (
    MESSAGE_STATUS_COMPLETE,
    add_message,
    message_phase,
    reuse_interrupted_answer,
)

# client_turn_id 的长度上限：前端用 ``crypto.randomUUID()``（36 字符），留足余量但不
# 允许把长文本塞进 JSON 列。
CLIENT_TURN_ID_MAX_CHARS = 64

# 回滚后写回正文的最大长度：被打断的那一段本来就不该太长，超过它只说明模型吐得太快，
# 继续膨胀只会让下一轮提示词和报告都变重。
MAX_ROLLED_BACK_CHARS = 2_000

# 拼进下一轮系统提示的"被打断"通知里引用的最长正文（防止把整段长回答塞进提示词）。
MAX_NOTICE_QUOTE_CHARS = 500

# 写在那条"被打断的面试官消息"正文末尾的标记：报告/转录靠它知道这一轮不完整。
INTERRUPTED_MARKER = "（这段被候选人打断，未说完）"

# 上一轮被打断的通知放在**最近几条**消息里：更早的中断已经被后续轮次接上，
# 再翻出来提示只会让模型反复纠结。
RECENT_WINDOW = 3


def normalize_client_turn_id(raw: str | None) -> str | None:
    """把请求里的幂等键收敛成空串或去空白后的字符串。

    不做正则校验：它只是不透明键（前端生成 UUID），校验格式只会挡住合法的调用方；
    长度由 schema 的 ``max_length`` 拦，这里只去空白。
    """
    text = (raw or "").strip()
    return text[:CLIENT_TURN_ID_MAX_CHARS] or None


def _turn_context(message: InterviewMessage) -> dict:
    return message.context if isinstance(message.context, dict) else {}


def find_turn_answer(
    session: InterviewSession, client_turn_id: str | None
) -> InterviewMessage | None:
    """找到这个幂等键对应的那条候选人回答；没有就返回 ``None``。"""
    if not client_turn_id:
        return None
    for item in session.messages:
        if item.role != "user" or message_phase(item) != MESSAGE_PHASE_INTERVIEW:
            continue
        if _turn_context(item).get("client_turn_id") == client_turn_id:
            return item
    return None


def _same_message(left: InterviewMessage, right: InterviewMessage) -> bool:
    if left is right:
        return True
    return left.id is not None and right.id is not None and left.id == right.id


def turn_completed(session: InterviewSession, answer: InterviewMessage) -> bool:
    """这条回答后面是否**已经**跟着面试官回应（= 这一轮早就跑完了）。

    只用来识别"重复提交同一轮"：已经跑完就不该再花一次模型调用。判断按消息顺序做，
    不看状态——被中断的那一轮状态也是 ``interrupted``，但它后面没有面试官回应。
    """
    seen = False
    for item in session.messages:
        if not seen:
            seen = _same_message(item, answer)
            continue
        if item.role == "interviewer" and message_phase(item) == MESSAGE_PHASE_INTERVIEW:
            return True
    return False


def response_after(session: InterviewSession, answer: InterviewMessage) -> InterviewMessage | None:
    """紧跟在这条回答后面的面试官消息（重复提交回放点评时用）。"""
    seen = False
    for item in session.messages:
        if not seen:
            seen = _same_message(item, answer)
            continue
        if item.role == "interviewer" and message_phase(item) == MESSAGE_PHASE_INTERVIEW:
            return item
    return None


def record_answer_for_turn(
    session: InterviewSession,
    content: str,
    client_turn_id: str | None = None,
) -> InterviewMessage:
    """把这一轮的候选人回答落库（流式端点专用；非流式端点仍走 ``_record_answer``）。

    * 没有幂等键：与既有行为逐字一致（上一次被中断的回答会被复用）；
    * 有幂等键且命中已存在的回答：
      - 这一轮已经跑完 → 原样返回，生成器直接回放 ``done``，**不重复生成**；
      - 这一轮被中断/正在生成 → 复用并更新内容（不追加第二条用户消息）。
    """
    key = normalize_client_turn_id(client_turn_id)
    if key is None:
        reused = reuse_interrupted_answer(session, content)
        if reused is not None:
            return reused
        return add_message(session, role="user", content=content)

    existing = find_turn_answer(session, key)
    if existing is not None:
        if turn_completed(session, existing):
            return existing
        # 被中断（或极端情况下重入）的一轮：复用同一个消息，内容以本次提交为准。
        existing.content = content
        existing.status = MESSAGE_STATUS_COMPLETE
        existing.error = ""
        return existing
    return add_message(
        session,
        role="user",
        content=content,
        context={"client_turn_id": key},
    )


def rollback_text(sent_text: str, played_chars: int | None) -> tuple[str, int]:
    """把"已生成文本"截到"已播出"为止，返回 ``(保留文本, 回滚字数)``。

    ``played_chars`` 为 ``None`` 表示调用方没有上报播放位置（P0 纯文字模式：服务端
    已 flush 的即为用户看到的），按"全部已播出"处理；越界值夹到 ``[0, len(sent_text)]``。
    """
    text = sent_text or ""
    played = len(text) if played_chars is None else max(0, min(int(played_chars), len(text)))
    return text[:played], len(text) - played


def build_interruption_notice(played_text: str) -> str:
    """拼下一轮系统提示：告诉模型上一轮被打断、它只讲到了哪里。"""
    quote = (played_text or "").strip()[:MAX_NOTICE_QUOTE_CHARS]
    if not quote:
        return "【上一轮被打断】你上一轮的回答刚开口就被候选人打断了，候选人没有听到实质内容。"
    return (
        "【上一轮被打断】你上一轮的回答被候选人打断，只说到下面这些内容；"
        "后面的内容候选人没有听到，不要假设他听过、也不要把没说完的部分当作已回答："
        f"「{quote}」"
    )


def store_interrupted_response(
    session: InterviewSession,
    *,
    index: int,
    played_text: str,
    played_chars: int,
    generated_chars: int,
) -> InterviewMessage | None:
    """把"被打断为止已播出"的面试官回应写回记录；一个字都没播出时不写。

    正文 = 播出的那部分 + 一行"被打断"标记（报告据此知道这一轮不完整）。
    ``context`` 里同时留 ``played_chars`` / ``rolled_back_chars``，供观测与回放使用。
    """
    kept = (played_text or "").strip()
    if not kept:
        return None
    kept = kept[:MAX_ROLLED_BACK_CHARS]
    rolled_back = max(0, int(generated_chars) - int(played_chars))
    return add_message(
        session,
        role="interviewer",
        content=f"{kept}\n\n{INTERRUPTED_MARKER}",
        context={
            "index": index,
            "rounds": session.rounds,
            "feedback": "",
            "interrupted": True,
            "partial": True,
            "played_chars": int(played_chars),
            "generated_chars": int(generated_chars),
            "rolled_back_chars": rolled_back,
        },
    )


def recent_interrupted_response(
    session: InterviewSession, window: int = RECENT_WINDOW
) -> InterviewMessage | None:
    """最近几条消息里"被打断的面试官回应"；没有就返回 ``None``。

    只看最后 ``window`` 条：更早的中断已经被后续轮次接上，不该再影响当前提示词。
    """
    for item in list(session.messages)[-window:]:
        if item.role == "interviewer" and _turn_context(item).get("interrupted"):
            return item
    return None


def append_interruption_notice(
    messages: list[dict[str, str]], session: InterviewSession
) -> list[dict[str, str]]:
    """给本轮模型消息追加一条"上一轮被打断"的系统提示（没有就原样返回）。

    追加而不是塞进 ``build_interview_messages``：那个函数属于服务层主流程，语音线只在
    自己的生成入口做这一层补充，纯文字链路一行不变。
    """
    interrupted = recent_interrupted_response(session)
    if interrupted is None:
        return messages
    # 正文 = 已播出部分 + 标记；引号里只放"播出到哪"，不把标记当成面试官说过的话。
    played = str(interrupted.content or "")
    if INTERRUPTED_MARKER in played:
        played = played.split(INTERRUPTED_MARKER, 1)[0]
    return [*messages, {"role": "system", "content": build_interruption_notice(played)}]


def mark_barge_in(answer: InterviewMessage) -> None:
    """在候选人那条回答上标一句"这一轮是被插话打断的"，让界面区分于"停止本轮"。

    只改 ``context``（JSON 列必须整体赋值才会被 SQLAlchemy 认为脏），不动 ``status``：
    状态仍由 ``_mark_interrupted`` 统一写，两处各写一半会让状态含义漂移。
    """
    context = dict(_turn_context(answer))
    context["barge_in"] = True
    answer.context = context


def record_barge_in(
    db: Session,
    session: InterviewSession,
    answer: InterviewMessage,
    *,
    index: int,
    played_text: str,
    played_chars: int,
    generated_chars: int,
) -> InterviewMessage | None:
    """打断收口（回滚 + 标记插话 + 落库）：cancel 分支唯一入口。

    返回写回的"被打断的面试官回应"（没播出任何内容时返回 ``None``）；调用方负责再调
    ``_mark_interrupted`` 收口用户回答——那一层自己会 commit 写库异常。
    """
    mark_barge_in(answer)
    stored = store_interrupted_response(
        session,
        index=index,
        played_text=played_text,
        played_chars=played_chars,
        generated_chars=generated_chars,
    )
    if stored is not None:
        try:
            db.flush()
        except Exception:  # noqa: BLE001 - 打断路径不能因为落库失败变成 500
            db.rollback()
            return None
    return stored


__all__ = [
    "CLIENT_TURN_ID_MAX_CHARS",
    "INTERRUPTED_MARKER",
    "MAX_ROLLED_BACK_CHARS",
    "append_interruption_notice",
    "build_interruption_notice",
    "find_turn_answer",
    "mark_barge_in",
    "normalize_client_turn_id",
    "recent_interrupted_response",
    "record_answer_for_turn",
    "record_barge_in",
    "response_after",
    "rollback_text",
    "store_interrupted_response",
    "turn_completed",
]
