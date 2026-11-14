# SPDX-License-Identifier: Apache-2.0
"""助手记忆的读模型与注入：生效记忆查询、按当前消息挑相关记忆、系统提示区块渲染。

纯搬迁自 ``memory.py``（写入语义与校验留在原模块）：注入链只读不写，读模型与写模型
分开后各自有明确的职责边界。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.assistant import ChatConversation, ChatMessage
from ...models.assistant_memory import (
    MEMORY_KIND_LABELS,
    MEMORY_STATUS_ACTIVE,
    AssistantMemory,
)

#: 注入上限（#31B）：按当前用户消息相关性取 top 5，不全塞。
INJECTION_TOP_N = 5


def active_memories(db: Session, *, kinds: list[str] | None = None) -> list[AssistantMemory]:
    """当前生效（status=active）的记忆；可按 kind 收窄。"""
    query = db.query(AssistantMemory).filter(AssistantMemory.status == MEMORY_STATUS_ACTIVE)
    if kinds:
        query = query.filter(AssistantMemory.kind.in_(kinds))
    return query.order_by(AssistantMemory.updated_at.desc(), AssistantMemory.id.desc()).all()


def _tokens(text: str) -> list[str]:
    """相关性判定用的最小词元：整句 + 双字滑窗（中文无空格时最便宜的近似）。"""
    term = (text or "").strip().casefold()
    if not term:
        return []
    tokens = [term] if len(term) <= 6 else []
    tokens.extend(term[index : index + 2] for index in range(max(0, len(term) - 1)))
    return list(dict.fromkeys(tokens))


def relevant_memories(
    db: Session, message: str, *, top: int = INJECTION_TOP_N
) -> list[AssistantMemory]:
    """#31B：按当前用户消息挑 top N 条记忆；一条都不相关时返回空（不全塞）。

    相关 = 消息词元命中记忆的 kind 展示名 / key / value。排序：命中数降序，
    同分时最近的在前。空消息或没有生效记忆都返回空列表。
    """
    tokens = _tokens(message)
    if not tokens:
        return []
    scored: list[tuple[int, AssistantMemory]] = []
    for memory in active_memories(db):
        label = MEMORY_KIND_LABELS.get(memory.kind, memory.kind)
        haystack = f"{label} {memory.key} {memory.value}".casefold()
        score = sum(1 for token in tokens if token in haystack)
        if score > 0:
            scored.append((score, memory))
    scored.sort(key=lambda row: (-row[0], -row[1].updated_at.timestamp(), -row[1].id))
    return [memory for _score, memory in scored[: max(1, top)]]


def latest_user_message(db: Session, conversation_id: int | None) -> ChatMessage | None:
    if conversation_id is None:
        return None
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.conversation_id == conversation_id, ChatMessage.role == "user")
        .order_by(ChatMessage.id.desc())
        .first()
    )


def conversation_memory_off(db: Session, conversation_id: int | None) -> bool:
    """这段会话是否「本次不记忆」（F34）：注入与抽取两条链路的唯一判定入口。

    会话不存在（草稿 / 已被彻底删除）按"正常记忆"处理：这时没有可归属的记忆来源，
    挡住的收益为零；真正需要挡的是用户明确打开开关的那段对话。
    """
    if not conversation_id or int(conversation_id) <= 0:
        return False
    conversation = db.get(ChatConversation, int(conversation_id))
    return bool(conversation is not None and conversation.memory_off)


def render_memory_block(db: Session, conversation_id: int | None) -> str:
    """把相关记忆渲染成系统提示里的固定区块；没有相关记忆时返回空串。

    位置在系统提示的 base 段（求职偏好之后、本地时间之前）：它是"用户说过的事实"，
    不是系统规则，也不是技能规范。
    """
    # 临时对话（F34）：不注入任何已有记忆；已保存的记忆一行都不动。
    if conversation_memory_off(db, conversation_id):
        return ""
    message = latest_user_message(db, conversation_id)
    if message is None:
        return ""
    memories = relevant_memories(db, message.content or "")
    if not memories:
        return ""
    lines = [
        "【关于用户的长期记忆】",
        "以下是用户此前明确表达过的偏好或约束（按与本条消息的相关性挑选，最多 5 条）。",
        "只在与当前任务相关时参考，不要罗列、不要主动复述；与本轮无关的条目直接忽略。",
    ]
    for memory in memories:
        label = MEMORY_KIND_LABELS.get(memory.kind, memory.kind)
        lines.append(f"- {label}：{memory.value}")
    return "\n".join(lines)
