# SPDX-License-Identifier: Apache-2.0
"""助手记忆的读模型与注入：生效记忆查询、按当前消息挑相关记忆、系统提示区块渲染。

纯搬迁自 ``memory.py``（写入语义与校验留在原模块）：注入链只读不写，读模型与写模型
分开后各自有明确的职责边界。"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ...models.assistant import ChatConversation, ChatMessage
from ...models.assistant_memory import (
    MEMORY_KIND_LABELS,
    MEMORY_STATUS_ACTIVE,
    AssistantMemory,
)
from ...models.setting import AppSetting

#: 记忆注入总开关（T23）。**默认 true**：缺行时保持升级前的注入行为。
INJECT_SETTING_KEY = "assistant_memory_inject"

#: 注入上限（#31B）：按当前用户消息相关性取 top 5，不全塞。
INJECTION_TOP_N = 5
#: 相关性命中阈值：只命中一个双字滑窗不足以说明相关（「岗位」这类双字可能只是
#: 记忆值里任意相邻两个字）。两个独立命中、或一个 ≥4 字的命中才算相关。
MIN_HITS = 2
MIN_HIT_TOKEN_CHARS = 4
#: 完整命中记忆值也算强信号：城市名多为两字（「上海」），靠双字滑窗永远凑不到
#: 两个命中，但消息里完整出现「上海」和碰巧共享两个字是两回事。
MIN_VERBATIM_VALUE_CHARS = 2


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

    相关 = 消息词元命中记忆的 **key / value**。**kind 展示名不参与计分**：标签
    「目标岗位」里的「岗位」两个字会让「这个岗位怎么样」给所有 target_role 各记
    一分，结果是"记了什么都往里塞"——这与"少而准"的取舍相反。
    排序：命中数降序，同分时最近的在前。空消息或没有生效记忆都返回空列表。

    已知限制：不做近义/语义召回（「江浙」召回不了「只看杭州和上海」）。那是 RAG
    的活，规则层只认字面命中。
    """
    tokens = _tokens(message)
    if not tokens:
        return []
    folded_message = (message or "").strip().casefold()
    scored: list[tuple[int, AssistantMemory]] = []
    for memory in active_memories(db):
        haystack = f"{memory.key} {memory.value}".strip().casefold()
        if not haystack:
            continue
        hits = [token for token in tokens if token in haystack]
        if not hits:
            continue
        value = (memory.value or "").strip().casefold()
        verbatim = len(value) >= MIN_VERBATIM_VALUE_CHARS and value in folded_message
        if (
            len(hits) < MIN_HITS
            and not verbatim
            and max(len(token) for token in hits) < MIN_HIT_TOKEN_CHARS
        ):
            continue
        scored.append((len(hits), memory))
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


def memory_injection_enabled(db: Session) -> bool:
    """全局记忆注入开关（T23）：缺行 = 默认开，脏值也按开处理。

    与「本次不记忆」（``conversation_memory_off``）是**与**关系：两个开关任一关闭就
    不注入。默认开是刻意的——升级不能让已有用户突然失去记忆能力。
    """
    row = db.get(AppSetting, INJECT_SETTING_KEY)
    if row is None:
        return True
    try:
        return bool(json.loads(row.value))
    except (TypeError, ValueError):
        return True


def set_memory_injection(db: Session, enabled: bool) -> bool:
    """保存全局记忆注入开关（设置页）。返回保存后的值。"""
    row = db.get(AppSetting, INJECT_SETTING_KEY)
    serialized = json.dumps(bool(enabled), ensure_ascii=False)
    if row is None:
        db.add(AppSetting(key=INJECT_SETTING_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()
    return bool(enabled)


def injected_memories(db: Session, conversation_id: int | None) -> list[AssistantMemory]:
    """本轮真正会被注入的记忆——开关判定与相关性挑选的唯一实现。

    注入链路（``render_memory_block``）与消息快照（助手消息的 ``context.memories``）
    都走这里，两处不会出现"注入 5 条、却告诉用户 3 条"的分叉。
    """
    if not memory_injection_enabled(db) or conversation_memory_off(db, conversation_id):
        return []
    message = latest_user_message(db, conversation_id)
    if message is None:
        return []
    return relevant_memories(db, message.content or "")


def render_memory_block(db: Session, conversation_id: int | None) -> str:
    """把相关记忆渲染成系统提示里的固定区块；没有相关记忆时返回空串。

    位置在系统提示的 base 段（求职偏好之后、本地时间之前）：它是"用户说过的事实"，
    不是系统规则，也不是技能规范。
    """
    # 全局注入开关（T23）与「本次不记忆」（F34）在与关系下都由 injected_memories 判：
    # 任一关闭就返回空串；已保存的记忆一行都不动。
    memories = injected_memories(db, conversation_id)
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
