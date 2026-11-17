# SPDX-License-Identifier: Apache-2.0
"""压缩后重挂「本会话最近用过的技能」提示（T24）。

为什么需要它：T24 起技能提示词挂在**用户消息自己的正文之前**（``context.skill_prompt``）。
L2 摘要会把旧轮次整段换成一张状态卡，那些消息连同它们的技能提示一起消失——用户会
发现"前面一直按我的技能要求在写，压过一次之后就不听话了"。所以摘要生成时按"本会话
最近用过的技能"重新拼一段，跟在摘要块之后（不新建消息：摘要块必须固定在 ``messages[1]``，
见 ``assistant_compaction.summary_block_present``）。

口径（常量可调）：
- 取最近 ``COMPACTION_SKILL_RECENT_MESSAGES`` 条**用户消息**的 ``context.skills``，
  按最近出现先后去重；
- 每个技能只取提示词前 ``COMPACTION_SKILL_PROMPT_PER_SKILL_CHARS`` 字符；
- 整段不超过 ``COMPACTION_SKILL_PROMPT_MAX_CHARS`` 字符（表头计入，超出的技能整块跳过）。

这段文字只来自库里已有的技能定义，不读请求参数；压缩失败时整条链路照旧降级，
不因为拼技能而阻断发送。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ...models.assistant import AssistantSkill, ChatMessage
from .assistant_compaction import content_text, summary_block_present
from .assistant_skill_prompt import _SKILL_PROMPT_HEADER, _skill_block

#: 往回看多少条用户消息（20 条 ≈ 最近十轮问答）。
COMPACTION_SKILL_RECENT_MESSAGES = 20
#: 单个技能提示词进这段文字的字数上限（只截提示词，表头/包装另算）。
COMPACTION_SKILL_PROMPT_PER_SKILL_CHARS = 5_000
#: 整段技能提示的字符预算（含固定表头）；超出的技能整块跳过。
COMPACTION_SKILL_PROMPT_MAX_CHARS = 25_000


def recent_skill_names(db: Session, conversation_id: int) -> list[str]:
    """最近用过的技能名（按最近出现先后去重）。

    只读用户消息的 ``context.skills``（T24 起才有），旧数据里的助手 ``context.skills``
    是名字数组、语义不同，这里不碰。脏数据（非列表 / 非字典元素）逐项跳过。
    """
    rows = (
        db.query(ChatMessage.context)
        .filter(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.role == "user",
        )
        .order_by(ChatMessage.id.desc())
        .limit(COMPACTION_SKILL_RECENT_MESSAGES)
        .all()
    )
    names: list[str] = []
    seen: set[str] = set()
    for (context,) in rows:
        entries = context.get("skills") if isinstance(context, dict) else None
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name") or "").strip()
            if name and name not in seen:
                seen.add(name)
                names.append(name)
    return names


def build_compaction_skill_prompt(db: Session, conversation_id: int) -> str:
    """拼出压缩后要重挂的技能提示；没有可用技能时返回空串。"""
    names = recent_skill_names(db, conversation_id)
    if not names:
        return ""
    rows = db.query(AssistantSkill).filter(AssistantSkill.name.in_(names)).all()
    by_name = {skill.name: skill for skill in rows}
    blocks: list[str] = []
    used = len(_SKILL_PROMPT_HEADER)
    for name in names:
        skill = by_name.get(name)
        if skill is None:
            continue
        block, _truncated = _skill_block(skill, COMPACTION_SKILL_PROMPT_PER_SKILL_CHARS)
        if used + len(block) > COMPACTION_SKILL_PROMPT_MAX_CHARS:
            break
        blocks.append(block)
        used += len(block)
    if not blocks:
        return ""
    return "\n\n".join([_SKILL_PROMPT_HEADER, *blocks])


def attach_compaction_skill_prompt(
    messages: list[dict[str, Any]], skill_prompt: str
) -> list[dict[str, Any]]:
    """把技能提示接在摘要块正文之后（摘要块位置不变，仍是 ``messages[1]``）。

    没有摘要块、或提示为空时原样返回——这段文字只在"历史已经被压掉"时才需要，
    其它情况由各条用户消息自己的 ``skill_prompt`` 负责。
    """
    if not skill_prompt or len(messages) < 2 or not summary_block_present(messages):
        return messages
    block = dict(messages[1])
    body = content_text(block.get("content"))
    block["content"] = f"{body}\n\n{skill_prompt}"
    return [messages[0], block, *messages[2:]]


__all__ = [
    "COMPACTION_SKILL_PROMPT_MAX_CHARS",
    "COMPACTION_SKILL_PROMPT_PER_SKILL_CHARS",
    "COMPACTION_SKILL_RECENT_MESSAGES",
    "attach_compaction_skill_prompt",
    "build_compaction_skill_prompt",
    "recent_skill_names",
]
