# SPDX-License-Identifier: Apache-2.0
"""#31A 会话空闲后的语义记忆抽取：提示词、响应校验、异步落库与触发判定。

写入时机是**会话空闲 5 分钟后在后台跑一次**（不是每轮）：输入最近 N 轮对话 + 现有
生效记忆（用于判重），模型输出 ADD/UPDATE/SUPERSEDE/NOOP 四类操作，落库交给
assistant.memory.apply_operations。接 ai_task 执行器（kind=assistant_memory_extract），
不占生成请求关键路径。

安全边界（31F）：
- 默认关闭（AppSetting assistant_memory_auto_extract=false）——31C 的可见可改界面
  就位前不自动写入；
- 只从**已完成**的对话里抽，不从失败/取消轨迹抽；
- 抽取失败只记日志由下次空闲重试，不向用户报错。
"""

from __future__ import annotations

import json
import logging
from datetime import timedelta
from typing import Any

from sqlalchemy.orm import Session

from ...models.ai_task import (
    AI_TASK_ACTIVE_STATUSES,
    AI_TASK_KIND_ASSISTANT_MEMORY,
    AiTask,
)
from ...models.assistant import ChatMessage
from ...models.profile import utcnow
from ...models.setting import AppSetting
from . import memory

logger = logging.getLogger(__name__)

#: 抽取输入：最近多少条消息（一轮 = user + assistant，取 24 条 ≈ 12 轮）。
RECENT_MESSAGES = 24
#: 每条消息截断长度（只给模型看"说了什么"，不喂长文）。
MAX_TURN_CHARS = 600

_SYSTEM_PROMPT = (
    "你是用户求职偏好的记忆整理器。从给定对话里抽取**用户明确表达过的稳定事实**，"
    "只输出一个 JSON 数组，不要解释、不要 Markdown 代码块。每个元素形如："
    '{"op": "ADD|UPDATE|SUPERSEDE|NOOP", "kind": "...", "key": "...", "value": "...", '
    '"confidence": 0.0-1.0}'
    "\nkind 只允许这七类：target_role（目标岗位）、city（意向城市）、"
    "salary_floor（薪资底线）、avoid_company（不考虑的公司）、work_mode（远程/混合等）、"
    "skill_tag（反复提到的技术栈）、constraint（时间等约束）。"
    "\n规则：① 只记用户**自己说的**事实，不要从助手的推测里提炼；"
    "② 用户没说清或只随口提一次的，不要记；③ 与现有记忆同类不同值用 SUPERSEDE，"
    "同类同义补充细节用 UPDATE，完全重复用 NOOP；④ value 是一句不超过 60 字的陈述；"
    "⑤ 不记手机号、身份证号、密钥等敏感信息；⑥ 没有可记的就输出 []。"
)


def build_extraction_messages(
    turns: list[dict[str, str]], memories_text: str
) -> list[dict[str, Any]]:
    """拼一次抽取调用：系统 schema + 现有记忆 + 最近对话。"""
    user_parts = [f"【现有记忆】\n{memories_text or '（空）'}", "【最近对话】"]
    for turn in turns:
        role = "用户" if turn.get("role") == "user" else "助手"
        user_parts.append(f"{role}：{turn.get('content', '')}")
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": "\n".join(user_parts)},
    ]


def _extract_json_array(text: str) -> list[Any] | None:
    """从模型输出里捞出第一个 JSON 数组（容忍围栏与前后废话）。"""
    if not isinstance(text, str) or not text.strip():
        return None
    candidate = text.strip()
    start = candidate.find("[")
    end = candidate.rfind("]")
    if start < 0 or end <= start:
        return None
    try:
        payload = json.loads(candidate[start : end + 1])
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    return payload if isinstance(payload, list) else None


def parse_extraction_response(text: str) -> list[dict[str, Any]] | None:
    """校验模型输出：非法 JSON 返回 None；合法条目原样返回（逐条校验在 apply 里）。"""
    payload = _extract_json_array(text)
    if payload is None:
        return None
    operations: list[dict[str, Any]] = []
    for item in payload[:50]:
        if isinstance(item, dict):
            operations.append(item)
    return operations


def recent_turns(
    db: Session, conversation_id: int, *, limit: int = RECENT_MESSAGES
) -> list[dict[str, str]]:
    """最近 N 条已完成消息（pending/失败的消息不进抽取输入）。"""
    rows = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.status == "complete",
        )
        .order_by(ChatMessage.id.desc())
        .limit(limit)
        .all()
    )
    turns = [
        {
            "role": row.role,
            "content": " ".join((row.content or "").split())[:MAX_TURN_CHARS],
        }
        for row in reversed(rows)
        if (row.content or "").strip()
    ]
    return turns


def _cursor_key(conversation_id: int) -> str:
    return f"assistant_memory_extracted_until:{int(conversation_id)}"


def read_cursor(db: Session, conversation_id: int) -> int:
    """这段对话已经抽取到哪条消息（防止每次空闲都重抽同一段）。"""
    row = db.get(AppSetting, _cursor_key(conversation_id))
    if row is None:
        return 0
    try:
        return int(json.loads(row.value))
    except (TypeError, ValueError):
        return 0


def mark_extracted(db: Session, conversation_id: int, message_id: int | None) -> None:
    """抽取成功后推进 cursor（只前移不回退）。"""
    if message_id is None:
        return
    current = read_cursor(db, conversation_id)
    if message_id <= current:
        return
    key = _cursor_key(conversation_id)
    row = db.get(AppSetting, key)
    serialized = json.dumps(int(message_id), ensure_ascii=False)
    if row is None:
        db.add(AppSetting(key=key, value=serialized))
    else:
        row.value = serialized
    db.commit()


def _existing_memories_text(db: Session) -> str:
    rows = memory.active_memories(db)
    if not rows:
        return ""
    return "\n".join(f"- [{row.kind}] {row.value}" for row in rows[:50])


def should_schedule(db: Session, conversation_id: int) -> bool:
    """空闲 5 分钟后是否需要抽一次：开关打开 + 足够空闲 + 没有在跑的同对话任务。

    "足够空闲"用**上一条助手回复的时间**判定：本次调用发生在用户新的交互里，
    此时刚保存的是用户新消息；若上一条助手回复已经过去 >= 5 分钟，说明上一段对话
    已经结束——这正是抽取的时机。cursor 保证一段对话只抽一次。
    """
    # 无会话（conversation_id=None）的调用路径（系统提示被独立装配的测试/场景）直接不调度。
    if not conversation_id or int(conversation_id) <= 0:
        return False
    # 临时对话（F34）：这段对话不产生任何新记忆，空闲多久都不排抽取。
    if memory.conversation_memory_off(db, conversation_id):
        return False
    if not memory.auto_extract_enabled(db):
        return False
    last_assistant = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.role == "assistant",
            ChatMessage.status == "complete",
        )
        .order_by(ChatMessage.id.desc())
        .first()
    )
    if last_assistant is None:
        return False
    gap = utcnow() - (last_assistant.created_at or utcnow())
    if gap < timedelta(seconds=memory.AUTO_EXTRACT_IDLE_SECONDS):
        return False
    latest_id = (
        db.query(ChatMessage.id)
        .filter(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.id.desc())
        .limit(1)
        .scalar()
    )
    if latest_id is None or int(latest_id) <= read_cursor(db, conversation_id):
        return False
    active = (
        db.query(AiTask)
        .filter(
            AiTask.kind == AI_TASK_KIND_ASSISTANT_MEMORY,
            AiTask.status.in_(AI_TASK_ACTIVE_STATUSES),
        )
        .all()
    )
    for task in active:
        if int((task.payload or {}).get("conversation_id") or 0) == int(conversation_id):
            return False
    return True


def schedule_extraction(db: Session, conversation_id: int) -> AiTask | None:
    """登记一次后台抽取任务；不满足条件时返回 None（不写库）。"""
    if not conversation_id or int(conversation_id) <= 0:
        return None
    if not should_schedule(db, conversation_id):
        return None
    task = AiTask(
        kind=AI_TASK_KIND_ASSISTANT_MEMORY,
        payload={"conversation_id": int(conversation_id)},
        label="整理助手记忆",
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    # **登记完必须真的启动执行器**（2026-11-13 修）：只写一行 pending 而不 `start`，
    # 任务永远不会跑——页头那条「正在进行 · 整理助手记忆 · 生成中…」会永久停在那里，
    # 用户点取消也只是把它标成 canceled，看起来像"关不掉"。`POST /ai-tasks` 建完也
    # 是同一句 `start`，这里漏了纯粹是两处写法不一致。
    try:
        # 局部导入：执行器会反过来 import handler 注册表，模块顶层引会绕成环。
        from ..ai_task_runner import get_ai_task_runner

        get_ai_task_runner().start(task.id)
    except Exception:  # noqa: BLE001 - 启动失败不能挡住本轮对话
        logger.warning("助手记忆抽取任务启动失败 conversation=%s", conversation_id, exc_info=True)
        # 不留幽灵行：否则它既不会被跑，也不会自己终态，页头一直挂着。
        try:
            get_ai_task_runner().mark_failed(task.id, "后台执行器启动失败")
        except Exception:  # noqa: BLE001 - 连收尾都失败时只记日志
            logger.warning("助手记忆抽取任务收尾失败 task=%s", task.id, exc_info=True)
    logger.info("已登记助手记忆抽取任务 conversation=%s", conversation_id)
    return task


async def run_extraction(db: Session, *, conversation_id: int, provider: Any) -> dict[str, Any]:
    """跑一次抽取：读轮次 → 调模型 → 解析 → 落库。返回计数（写进任务 result_ref）。

    provider 只要有 ``async def chat(messages) -> str`` 即可；测试用假 provider。
    解析失败返回 ``{"parsed": False}`` —— 由调用方决定是否算任务失败。
    """
    # 第二道闸（F34）：任务是空闲时入队的，用户可能在执行前把「本次不记忆」打开。
    # 与开关同理，执行体必须自己再判一次，否则"开了临时对话仍写进记忆"。
    if memory.conversation_memory_off(db, conversation_id):
        return {"parsed": False, "reason": "memory_off"}
    turns = recent_turns(db, conversation_id)
    if not turns:
        return {"parsed": False, "reason": "empty_conversation"}
    messages = build_extraction_messages(turns, _existing_memories_text(db))
    response = await provider.chat(messages)
    operations = parse_extraction_response(response)
    if operations is None:
        return {"parsed": False, "reason": "invalid_response"}
    last_message_id = (
        db.query(ChatMessage.id)
        .filter(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.id.desc())
        .limit(1)
        .scalar()
    )
    counts = memory.apply_operations(
        db,
        operations,
        source_conversation_id=conversation_id,
        source_message_id=int(last_message_id) if last_message_id is not None else None,
    )
    # 解析成功就推进 cursor：同一段对话不再重复抽取（模型答 [] 也算"已处理"）。
    mark_extracted(
        db, conversation_id, int(last_message_id) if last_message_id is not None else None
    )
    counts["parsed"] = True
    return counts


__all__ = [
    "MAX_TURN_CHARS",
    "RECENT_MESSAGES",
    "build_extraction_messages",
    "mark_extracted",
    "parse_extraction_response",
    "read_cursor",
    "recent_turns",
    "run_extraction",
    "schedule_extraction",
    "should_schedule",
]
