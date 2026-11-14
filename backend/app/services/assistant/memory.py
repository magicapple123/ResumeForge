# SPDX-License-Identifier: Apache-2.0
"""助手语义记忆（#31A/#31B/#31C + #18D 合并模型）：写入语义、相关性注入与读模型。

三档记忆里缺的那一档：情景记忆是 chat_message，程序记忆是 assistant_skill，语义记忆
（关于用户/世界的稳定事实）就是 assistant_memory。**只有这一张表**：手填画像（#18D）
source=manual、自动抽取（#31A）source=extracted。

三条硬语义：
1. **kind 白名单**：只记求职相关的七类，其余一律拒绝（数据层不建 CHECK，白名单在
   这里单源，API / 抽取器 / 设置页共用）；
2. **冲突不删除**：同类不同值时旧条置 superseded、新条 active，两条都留着——
   必须能回溯"当时说的是什么"；
3. **默认不开自动写入**：AppSetting assistant_memory_auto_extract 默认 false，
   31C 设置页「助手记忆」可见可改之后才允许打开（不可见不可改的记忆是负债）。
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from ...models.assistant import ChatConversation, ChatMessage
from ...models.assistant_memory import (
    MEMORY_KIND_LABELS,
    MEMORY_KINDS,
    MEMORY_SOURCE_EXTRACTED,
    MEMORY_SOURCE_MANUAL,
    MEMORY_SOURCES,
    MEMORY_STATUS_ACTIVE,
    MEMORY_STATUS_DELETED,
    MEMORY_STATUS_SUPERSEDED,
    MEMORY_STATUS_SUPPRESSED,
    AssistantMemory,
)
from ...models.assistant_memory_event import (
    MEMORY_EVENT_CREATE,
    MEMORY_EVENT_DELETE,
    MEMORY_EVENT_RESTORE,
    MEMORY_EVENT_SUPERSEDE,
    MEMORY_EVENT_SUPPRESS,
    MEMORY_EVENT_UPDATE,
)
from ...models.profile import utcnow
from ...models.setting import AppSetting
from . import memory_events

#: 单条记忆内容上限（一句话事实，不是笔记）。
MAX_MEMORY_VALUE_CHARS = 200
MAX_MEMORY_KEY_CHARS = 128
#: 注入上限（#31B）：按当前用户消息相关性取 top 5，不全塞。
INJECTION_TOP_N = 5
#: 自动抽取开关的 AppSetting key 与会话空闲秒数（#31A）。
AUTO_EXTRACT_SETTING_KEY = "assistant_memory_auto_extract"
AUTO_EXTRACT_IDLE_SECONDS = 300

#: 敏感信息护栏：记忆是长期注入上下文的数据，手机号/身份证/密钥一律不记。
_PHONE = re.compile(r"(?<![0-9])1[3-9][0-9]{9}(?![0-9])")
_ID_CARD = re.compile(r"(?<![0-9])[0-9]{17}[0-9Xx](?![0-9])")
_SECRET = re.compile(r"(sk-[A-Za-z0-9_-]{8,}|api[_-]?key\s*[:=])", re.IGNORECASE)


class MemoryValidationError(ValueError):
    """记忆内容不合法（kind 不在白名单 / 空值 / 疑似敏感信息）。"""


def _clean(value: Any, *, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def validate_memory(kind: str, value: str, key: str = "") -> tuple[str, str, str]:
    """校验并归一化一条记忆；不合法抛 MemoryValidationError。

    白名单之外的 kind、空内容、疑似手机号/身份证/密钥都会被拒绝——记错一条事实可以
    改，把这些东西长期注入每一轮上下文不行。
    """
    cleaned_kind = (kind or "").strip()
    if cleaned_kind not in MEMORY_KINDS:
        raise MemoryValidationError(f"不支持的记忆类型：{cleaned_kind or '（空）'}")
    cleaned_value = _clean(value, limit=MAX_MEMORY_VALUE_CHARS)
    if not cleaned_value:
        raise MemoryValidationError("记忆内容不能为空")
    haystack = f"{cleaned_value} {key}"
    if _PHONE.search(haystack) or _ID_CARD.search(haystack) or _SECRET.search(haystack):
        raise MemoryValidationError("记忆里不含手机号、身份证号或密钥一类敏感信息")
    cleaned_key = _clean(key, limit=MAX_MEMORY_KEY_CHARS)
    return cleaned_kind, cleaned_key, cleaned_value


def active_memories(db: Session, *, kinds: list[str] | None = None) -> list[AssistantMemory]:
    """当前生效（status=active）的记忆；可按 kind 收窄。"""
    query = db.query(AssistantMemory).filter(AssistantMemory.status == MEMORY_STATUS_ACTIVE)
    if kinds:
        query = query.filter(AssistantMemory.kind.in_(kinds))
    return query.order_by(AssistantMemory.updated_at.desc(), AssistantMemory.id.desc()).all()


def list_memories(
    db: Session, *, status: str | None = None, kind: str = "", limit: int = 200
) -> list[AssistantMemory]:
    """设置页列表：默认不含已删除（用户眼里的"删掉"），可按状态/类型筛选。"""
    query = db.query(AssistantMemory)
    if status:
        query = query.filter(AssistantMemory.status == status)
    else:
        query = query.filter(AssistantMemory.status != MEMORY_STATUS_DELETED)
    if kind.strip():
        query = query.filter(AssistantMemory.kind == kind.strip())
    return (
        query.order_by(AssistantMemory.updated_at.desc(), AssistantMemory.id.desc())
        .limit(max(1, min(limit, 500)))
        .all()
    )


def memory_or_none(
    db: Session, memory_id: int, *, include_deleted: bool = True
) -> AssistantMemory | None:
    memory = db.get(AssistantMemory, memory_id)
    if memory is None:
        return None
    if not include_deleted and memory.status == MEMORY_STATUS_DELETED:
        return None
    return memory


def _find_active(db: Session, kind: str, key: str) -> AssistantMemory | None:
    """同类同键的生效行（key 为空时按"同类唯一"处理）。"""
    query = db.query(AssistantMemory).filter(
        AssistantMemory.kind == kind,
        AssistantMemory.status == MEMORY_STATUS_ACTIVE,
    )
    if key:
        query = query.filter(AssistantMemory.key == key)
    return query.order_by(AssistantMemory.id.desc()).first()


def _find_suppressed(
    db: Session, kind: str, key: str, value: str
) -> AssistantMemory | None:
    """同类同键同值、且被用户停用的行（用于"停用过的别再抽出来"）。"""
    query = db.query(AssistantMemory).filter(
        AssistantMemory.kind == kind,
        AssistantMemory.status == MEMORY_STATUS_SUPPRESSED,
        AssistantMemory.value == value,
    )
    if key:
        query = query.filter(AssistantMemory.key == key)
    return query.order_by(AssistantMemory.id.desc()).first()


def _supersede(old: AssistantMemory, *, now: datetime) -> None:
    old.status = MEMORY_STATUS_SUPERSEDED
    old.updated_at = now


def _add(
    db: Session,
    *,
    kind: str,
    key: str,
    value: str,
    confidence: float,
    source: str,
    conversation_id: int | None,
    message_id: int | None,
) -> AssistantMemory:
    memory = AssistantMemory(
        kind=kind,
        key=key,
        value=value,
        confidence=max(0.0, min(1.0, float(confidence))),
        source=source,
        status=MEMORY_STATUS_ACTIVE,
        source_conversation_id=conversation_id,
        source_message_id=message_id,
    )
    db.add(memory)
    return memory


def create_memory(
    db: Session,
    *,
    kind: str,
    value: str,
    key: str = "",
    confidence: float = 1.0,
    source: str = MEMORY_SOURCE_MANUAL,
    conversation_id: int | None = None,
    message_id: int | None = None,
) -> AssistantMemory:
    """新增一条记忆（手动 #18D 与自动抽取共用）。冲突时旧的置 superseded、新的生效。"""
    cleaned_kind, cleaned_key, cleaned_value = validate_memory(kind, value, key)
    cleaned_source = source if source in MEMORY_SOURCES else MEMORY_SOURCE_MANUAL
    now = utcnow()
    existing = _find_active(db, cleaned_kind, cleaned_key)
    if existing is not None:
        if existing.value == cleaned_value:
            # 完全相同的事实不重复记：刷新置信度与来源即可。
            existing.confidence = max(existing.confidence, max(0.0, min(1.0, float(confidence))))
            existing.updated_at = now
            db.commit()
            db.refresh(existing)
            return existing
        _supersede(existing, now=now)
        memory_events.record_event(
            db, existing.id, MEMORY_EVENT_SUPERSEDE, before=existing.value, after=cleaned_value
        )
    else:
        # 手填的正是之前被「永不使用」的那条同一事实：恢复它，别新开一行。
        suppressed = _find_suppressed(db, cleaned_kind, cleaned_key, cleaned_value)
        if suppressed is not None:
            suppressed.status = MEMORY_STATUS_ACTIVE
            suppressed.updated_at = now
            memory_events.record_event(
                db, suppressed.id, MEMORY_EVENT_RESTORE, after=suppressed.value
            )
            db.commit()
            db.refresh(suppressed)
            return suppressed
    memory = _add(
        db,
        kind=cleaned_kind,
        key=cleaned_key,
        value=cleaned_value,
        confidence=confidence,
        source=cleaned_source,
        conversation_id=conversation_id,
        message_id=message_id,
    )
    db.flush()  # 拿到 id 才能写事件
    memory_events.record_event(db, memory.id, MEMORY_EVENT_CREATE, after=cleaned_value)
    db.commit()
    db.refresh(memory)
    return memory


def update_memory(
    db: Session,
    memory: AssistantMemory,
    *,
    value: str | None = None,
    key: str | None = None,
    confidence: float | None = None,
) -> AssistantMemory:
    """用户逐条编辑（#31C）：只改内容/键/置信度，不改 kind 与来源。"""
    target_value = memory.value if value is None else value
    target_key = memory.key if key is None else key
    _kind, cleaned_key, cleaned_value = validate_memory(memory.kind, target_value, target_key)
    previous_value = memory.value
    memory.key = cleaned_key
    memory.value = cleaned_value
    if previous_value != cleaned_value:
        memory_events.record_event(
            db, memory.id, MEMORY_EVENT_UPDATE, before=previous_value, after=cleaned_value
        )
    if confidence is not None:
        memory.confidence = max(0.0, min(1.0, float(confidence)))
    memory.updated_at = utcnow()
    db.commit()
    db.refresh(memory)
    return memory


def delete_memory(db: Session, memory: AssistantMemory) -> None:
    """用户删除：软删（status=deleted），不物理删除。

    「永不使用」不再是删除的别名（F33）——那会把"停用"和"忘记"混成一件事，
    用户既看不出区别，也没法把停用的条目恢复回来。停用走 `suppress_memory`。
    """
    memory.status = MEMORY_STATUS_DELETED
    memory.updated_at = utcnow()
    memory_events.record_event(db, memory.id, MEMORY_EVENT_DELETE, before=memory.value)
    db.commit()


def suppress_memory(db: Session, memory: AssistantMemory) -> AssistantMemory:
    """「永不使用」：停用但保留在列表（status=suppressed），之后可恢复。"""
    memory.status = MEMORY_STATUS_SUPPRESSED
    memory.updated_at = utcnow()
    memory_events.record_event(db, memory.id, MEMORY_EVENT_SUPPRESS, before=memory.value)
    db.commit()
    db.refresh(memory)
    return memory


def restore_memory(db: Session, memory: AssistantMemory) -> AssistantMemory:
    """「恢复使用」：只对 suppressed 生效；deleted 行不允许复活（与删除语义一致）。"""
    memory.status = MEMORY_STATUS_ACTIVE
    memory.updated_at = utcnow()
    memory_events.record_event(db, memory.id, MEMORY_EVENT_RESTORE, after=memory.value)
    db.commit()
    db.refresh(memory)
    return memory


def apply_operations(
    db: Session,
    operations: list[dict[str, Any]],
    *,
    source_conversation_id: int | None = None,
    source_message_id: int | None = None,
) -> dict[str, int]:
    """把抽取器输出的 ADD/UPDATE/SUPERSEDE/NOOP 落库（#31A）。

    - ADD：已有同类同键且值不同 → 旧条 superseded + 新条 active；值相同 → 视为 NOOP；
    - UPDATE：已有同类同键 → 就地改 value（保留原来源）；没有 → 当 ADD；
    - SUPERSEDE：显式替换（旧条 superseded + 新条 active）；
    - NOOP：什么都不做。

    任何一条不合法（kind 不在白名单 / 敏感内容）都只跳过这一条并计数，
    不影响同一批其他条——一次抽取里混进一条脏数据不该让整次学习失败。
    """
    counts = {"add": 0, "update": 0, "supersede": 0, "noop": 0, "invalid": 0}
    now = utcnow()
    for operation in operations:
        if not isinstance(operation, dict):
            counts["invalid"] += 1
            continue
        op = str(operation.get("op") or "").strip().upper()
        confidence = operation.get("confidence", 0.6)
        try:
            kind, key, value = validate_memory(
                str(operation.get("kind") or ""),
                str(operation.get("value") or ""),
                str(operation.get("key") or ""),
            )
        except MemoryValidationError:
            counts["invalid"] += 1
            continue
        if op == "NOOP":
            counts["noop"] += 1
            continue
        existing = _find_active(db, kind, key)
        # 停用过的同一事实不许被再次抽取出来：否则「永不使用」只生效到下一次对话。
        if existing is None and _find_suppressed(db, kind, key, value) is not None:
            counts["noop"] += 1
            continue
        if op == "UPDATE" and existing is not None:
            existing.value = value
            existing.confidence = max(existing.confidence, float(confidence or 0.6))
            existing.updated_at = now
            counts["update"] += 1
            continue
        if op in ("ADD", "UPDATE") and existing is not None and existing.value == value:
            counts["noop"] += 1
            continue
        if op not in ("ADD", "UPDATE", "SUPERSEDE"):
            counts["invalid"] += 1
            continue
        if existing is not None:
            _supersede(existing, now=now)
            memory_events.record_event(
                db, existing.id, MEMORY_EVENT_SUPERSEDE, before=existing.value, after=value
            )
        _add(
            db,
            kind=kind,
            key=key,
            value=value,
            confidence=float(confidence or 0.6),
            source=MEMORY_SOURCE_EXTRACTED,
            conversation_id=source_conversation_id,
            message_id=source_message_id,
        )
        counts["supersede" if existing is not None else "add"] += 1
    db.commit()
    return counts


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


def auto_extract_enabled(db: Session) -> bool:
    """自动抽取是否开启（#31A）。默认关——31C 设置页可见可改之后才允许打开。"""
    row = db.get(AppSetting, AUTO_EXTRACT_SETTING_KEY)
    if row is None:
        return False
    try:
        return bool(json.loads(row.value))
    except (TypeError, ValueError):
        return False


def set_auto_extract(db: Session, enabled: bool) -> bool:
    """打开/关闭自动抽取（设置页开关）。返回保存后的值。"""
    row = db.get(AppSetting, AUTO_EXTRACT_SETTING_KEY)
    serialized = json.dumps(bool(enabled), ensure_ascii=False)
    if row is None:
        db.add(AppSetting(key=AUTO_EXTRACT_SETTING_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()
    return bool(enabled)


__all__ = [
    "AUTO_EXTRACT_IDLE_SECONDS",
    "AUTO_EXTRACT_SETTING_KEY",
    "INJECTION_TOP_N",
    "MAX_MEMORY_KEY_CHARS",
    "MAX_MEMORY_VALUE_CHARS",
    "MemoryValidationError",
    "active_memories",
    "apply_operations",
    "auto_extract_enabled",
    "conversation_memory_off",
    "create_memory",
    "delete_memory",
    "latest_user_message",
    "list_memories",
    "memory_or_none",
    "relevant_memories",
    "render_memory_block",
    "set_auto_extract",
    "update_memory",
    "validate_memory",
]
