# SPDX-License-Identifier: Apache-2.0
"""助手多视角 preset（18C）：三个角色，一套工具。

设计取舍（关键）：**不是三个新工具，也不是三套独立后端**。每个视角只是"往系统提示里
换一段视角与输出结构的说明"，工具集完全不变。实现上复用已有的「对话技能」通道：
把视角 prompt 作为一条内置技能挂到当前对话（build_skill_prompt 拼进 system 段），
因此：

- 不需要改系统提示装配（assistant_system_prompt.py 一行不用动）；
- 视角随对话切换、可被用户看见（菜单里是一条技能）与取消；
- 切换视角不碰工具注册表，18E 的工具调用序列评测不受影响。

红线（写进每个 prompt 文件）：三者的结论都必须引用简历字段 / JD 原文 / 系统给出的
**定性**匹配结论；不允许空口评价，也不允许编数字评分（助手工具返回里本来就没有数字分）。
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ...models.assistant import AssistantSkill
from .assistant_skills import (
    create_skill,
    find_skill,
    list_conversation_skill_ids,
    set_conversation_skills,
    update_skill,
)

#: 视角 prompt 目录：app/prompts/personas/<id>.md。
_PROMPT_DIR = Path(__file__).resolve().parents[2] / "prompts" / "personas"
#: 内置视角技能的名字前缀：用户可辨认，也用于从对话技能里认出"这几个是视角"。
SKILL_NAME_PREFIX = "视角 · "


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


def _ensure_skill(db: Session, persona: Persona) -> AssistantSkill:
    """确保内置视角技能存在，且 prompt 与当前文件一致（升级后自动同步、不改启用状态）。"""
    name = skill_name_of(persona)
    prompt = persona_prompt(persona.id)
    existing = find_skill(db, name)
    if existing is None:
        return create_skill(
            db,
            name=name,
            description=f"内置视角：{persona.summary}（工具集不变，只换视角与输出结构）",
            prompt=prompt,
            enabled=True,
        )
    if (existing.prompt or "").strip() != prompt:
        updated = update_skill(db, existing.id, prompt=prompt)
        assert updated is not None  # find_skill 刚取到，删除竞争不在本函数职责内
        return updated
    return existing


def _persona_skill_ids(db: Session) -> dict[int, str]:
    ids: dict[int, str] = {}
    for skill in db.query(AssistantSkill).all():
        persona_id = persona_of_skill_name(skill.name)
        if persona_id:
            ids[int(skill.id)] = persona_id
    return ids


def current_persona_id(db: Session, conversation_id: int | None) -> str:
    """这个对话当前启用的视角 id；没有视角时返回空串。"""
    if conversation_id is None:
        return ""
    mapping = _persona_skill_ids(db)
    for skill_id in list_conversation_skill_ids(db, conversation_id):
        persona_id = mapping.get(int(skill_id))
        if persona_id:
            return persona_id
    return ""


def apply_persona(db: Session, conversation_id: int, persona_id: str) -> list[int]:
    """把视角切到 persona_id（空串 = 关闭）：保留用户其它技能，只替换视角那一条。"""
    normalized = normalize_persona_id(persona_id)
    mapping = _persona_skill_ids(db)
    kept = [
        int(skill_id)
        for skill_id in list_conversation_skill_ids(db, conversation_id)
        if int(skill_id) not in mapping
    ]
    if normalized:
        skill = _ensure_skill(db, _BY_ID[normalized])
        kept.append(int(skill.id))
    return set_conversation_skills(db, conversation_id, kept)


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
    "SKILL_NAME_PREFIX",
    "apply_persona",
    "current_persona_id",
    "get_persona",
    "normalize_persona_id",
    "persona_catalog",
    "persona_of_skill_name",
    "persona_prompt",
    "persona_skill_names",
    "skill_name_of",
]
