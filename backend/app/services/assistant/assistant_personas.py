# SPDX-License-Identifier: Apache-2.0
"""助手多视角 preset（18C / T26）：三个角色，一套工具。

设计取舍（关键）：**不是三个新工具，也不是三套独立后端**。每个视角只是"往系统提示里
换一段视角与输出结构的说明"，工具集完全不变。

T26 之前的实现把视角当成"一条内置技能挂到当前对话"，因此视角会跟用户的技能共用同一张
关联表、同一份字数预算、同一套"按消息启用"的语义（T24）。那三条都不属于视角：
视角是**会话属性**。现在：

- 会话列 `chat_conversation.persona_id` 是唯一真相（迁移 0021 把历史行搬了进来）；
- 视角提示词在 `build_skill_prompt` **之后**单独拼接，与请求里的 `skill_ids` 无关；
- 内置视角技能行保留在库里，但技能列表接口按名字前缀过滤掉（界面不再出现「视角 · X」）。

红线（写进每个 prompt 文件）：三者的结论都必须引用简历字段 / JD 原文 / 系统给出的
**定性**匹配结论；不允许空口评价，也不允许编数字评分（助手工具返回里本来就没有数字分）。

**一个版本的回退读取**：升级后第一次读到老会话时，若列是空串而关联行里还挂着视角技能
（例如用户跳过了迁移、或从旧备份恢复），`current_persona_id` 仍按技能名认一次。写入路径
（`apply_persona`）会顺手清掉这些老关联行，保证"切回通用"不会被回退逻辑复活。
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ...models.assistant import AssistantConversationSkill, AssistantSkill, ChatConversation
from .assistant_skills import PERSONA_SKILL_PREFIX, list_conversation_skill_ids

#: 视角 prompt 目录：app/prompts/personas/<id>.md。
_PROMPT_DIR = Path(__file__).resolve().parents[2] / "prompts" / "personas"
#: 内置视角技能的名字前缀。技能列表据此过滤；迁移 0021 与它逐字一致。
SKILL_NAME_PREFIX = PERSONA_SKILL_PREFIX


@dataclass(frozen=True)
class Persona:
    """一个视角 preset：id、界面标签（后端只用于技能名）、prompt 文件名。"""

    id: str
    label: str
    summary: str


PERSONAS: tuple[Persona, ...] = (
    Persona(
        id="hr_scan",
        label="HR 六秒扫描",
        summary="模拟招聘方 6 秒初筛：前 1/3 能读到哪 3 个关键词、命中/缺失、一句话结论",
    ),
    Persona(
        id="interviewer",
        label="面试官追问",
        summary="按 JD 与简历出 10 个必问 + 3 个大概率答不上来 + 每题考察点",
    ),
    Persona(
        id="headhunter",
        label="猎头判断",
        summary="该投/别投 + 投入产出（补什么、优先级），不复述匹配分",
    ),
)
PERSONA_IDS: tuple[str, ...] = tuple(persona.id for persona in PERSONAS)
_BY_ID = {persona.id: persona for persona in PERSONAS}


def normalize_persona_id(value: str) -> str:
    """空串表示"无视角"（关闭），白名单外一律 ValueError（不静默当默认）。"""
    persona_id = str(value or "").strip()
    if not persona_id:
        return ""
    if persona_id not in _BY_ID:
        allowed = " / ".join(PERSONA_IDS)
        raise ValueError(f"未知的助手视角：{persona_id}；可用视角：{allowed}")
    return persona_id


def get_persona(persona_id: str) -> Persona:
    normalized = normalize_persona_id(persona_id)
    if not normalized:
        raise ValueError("需要提供视角 id")
    return _BY_ID[normalized]


@lru_cache(maxsize=8)
def persona_prompt(persona_id: str) -> str:
    """读视角 prompt 正文（读盘失败时抛 ValueError，不返回半份提示）。"""
    persona = get_persona(persona_id)
    path = _PROMPT_DIR / f"{persona.id}.md"
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError as exc:  # pragma: no cover - 发布包里文件必然存在（preflight 之外）
        raise ValueError(f"视角提示词文件缺失：{path.name}") from exc
    if not text:
        raise ValueError(f"视角提示词文件是空的：{path.name}")
    return text


def skill_name_of(persona: Persona) -> str:
    return f"{SKILL_NAME_PREFIX}{persona.label}"


def persona_skill_names() -> dict[str, str]:
    """技能名 → 视角 id（识别"对话里启用的技能哪几个是视角"的唯一映射）。"""
    return {skill_name_of(persona): persona.id for persona in PERSONAS}


def persona_of_skill_name(name: str) -> str:
    return persona_skill_names().get(str(name or "").strip(), "")


def _persona_skill_ids(db: Session) -> dict[int, str]:
    """技能 id → 视角 id（只用于回退读取历史关联行）。"""
    ids: dict[int, str] = {}
    for skill in db.query(AssistantSkill).all():
        persona_id = persona_of_skill_name(skill.name)
        if persona_id:
            ids[int(skill.id)] = persona_id
    return ids


def _stored_persona_id(conversation: ChatConversation | None) -> str:
    """列里的值：只认白名单，脏值当"通用"（读取不该抛错）。"""
    raw = str(getattr(conversation, "persona_id", "") or "").strip()
    return raw if raw in _BY_ID else ""


def current_persona_id(db: Session, conversation_id: int | None) -> str:
    """这个对话当前的视角 id；没有视角时返回空串。

    先读会话列；列是空的才回退到老的关联行（一个版本）。回退只在**读**路径上存在。
    """
    if conversation_id is None:
        return ""
    conversation = db.get(ChatConversation, int(conversation_id))
    stored = _stored_persona_id(conversation)
    if stored:
        return stored
    # 一个版本的回退：老数据/旧备份恢复的会话，视角还挂在对话技能行上。
    mapping = _persona_skill_ids(db)
    for skill_id in list_conversation_skill_ids(db, conversation_id):
        persona_id = mapping.get(int(skill_id))
        if persona_id:
            return persona_id
    return ""


def apply_persona(db: Session, conversation_id: int, persona_id: str) -> str:
    """把视角切到 persona_id（空串 = 关闭），写会话列；返回生效后的视角 id。

    顺带清掉"视角"的老关联行：否则用户在把视角切回通用之后，回退读取又把旧视角读回来。
    用户自己导入的其它技能行**一条不动**。
    """
    normalized = normalize_persona_id(persona_id)
    conversation = db.get(ChatConversation, int(conversation_id))
    if conversation is None:
        raise ValueError("对话不存在或已被删除")
    conversation.persona_id = normalized
    mapping = _persona_skill_ids(db)
    stale = [
        int(skill_id)
        for skill_id in list_conversation_skill_ids(db, conversation_id)
        if int(skill_id) in mapping
    ]
    if stale:
        db.query(AssistantConversationSkill).filter(
            AssistantConversationSkill.conversation_id == int(conversation_id),
            AssistantConversationSkill.skill_id.in_(stale),
        ).delete(synchronize_session=False)
    db.commit()
    return normalized


#: 视角提示词的小标题。与技能段并列出现时，模型才能分清"技能=写作规范、视角=看问题方式"。
PERSONA_PROMPT_HEADER = "## 本次回答使用的视角"


def build_persona_prompt(db: Session, conversation_id: int | None) -> str:
    """视角提示词（没有视角时返回空串）；**与请求里的 skill_ids 无关**。

    每个请求重读 prompt 文件（`persona_prompt` 有 lru_cache），升级提示词后不必重启，
    也不需要像旧实现那样"再去同步一条技能行的 prompt"。
    """
    persona_id = current_persona_id(db, conversation_id)
    if not persona_id:
        return ""
    return f"{PERSONA_PROMPT_HEADER}\n\n{persona_prompt(persona_id)}"


def persona_catalog() -> list[dict[str, Any]]:
    """给接口的视角清单：只给协议值（id）；显示名与说明在前端语言包里。

    中文 label/summary 会用作内置技能名（那是数据，不是界面文案），但接口只回 id，
    避免同一句文案在前后端各维护一份。
    """
    return [{"id": persona.id} for persona in PERSONAS]


__all__ = [
    "PERSONAS",
    "PERSONA_IDS",
    "Persona",
    "PERSONA_PROMPT_HEADER",
    "SKILL_NAME_PREFIX",
    "apply_persona",
    "build_persona_prompt",
    "current_persona_id",
    "get_persona",
    "normalize_persona_id",
    "persona_catalog",
    "persona_of_skill_name",
    "persona_prompt",
    "persona_skill_names",
    "skill_name_of",
]
