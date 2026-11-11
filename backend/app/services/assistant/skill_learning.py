# SPDX-License-Identifier: Apache-2.0
"""#31D/#31E/#31F 从对话生成技能：触发判定、四段草稿、近义去重、版本与验证闭环。

#31 的三档记忆里，程序记忆（assistant_skill）原来只有 name/description/prompt 三段，
而且没有任何"从对话到技能"的写入策略。本模块把策略收成**纯函数 + 单事务写入**：

31D 生成触发（**不满足就不提议**，对应调研结论"证据不足的偶发故障不应触发学习"）：
- 同一工具序列在 >=2 个不同对话里重复出现；
- 用户明确说「以后都这么做」一类持久规则；
- 一次任务里连续 >=5 步工具调用全部成功。
生成内容四段齐全（name/description/when_to_use/steps/pitfalls）；**默认待验证**
（generated=True、validation_status=pending），不会自动启用、不会自动写知识文件。

31E 去重/版本：
- 写入前做近义检测（name 的字符二元组 Jaccard 与序列相似度取最大）：超阈值就
  返回"提议更新已有技能"而不是新建——技能库腐烂（Skill Library Rot）的第一道闸；
- 技能 version 自增；assistant_conversation_skill.skill_version 记启用时引用版本，
  避免父技能悄悄吃到子技能的新版本（组合漂移）；
- 90 天未被加载 → 只**提示归档**，不自动删除（用户可能只是暂时不用）。

31F 验证闭环：
- 只从**成功轨迹**生成（失败/取消任一条即整条轨迹不合格）；
- 自动生成只产出 prompt（steps/pitfalls 渲染），**不写 assistant_skill_file**；
- 首次被加载并完成任务后由 accept/validate 端点标记 validated。
"""

from __future__ import annotations

import difflib
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ...models.assistant import AssistantConversationSkill, AssistantSkill, ChatMessage
from ...models.profile import utcnow

#: 生成触发条件（#31D）。
SKILL_GENERATION_MIN_REPEATS = 2
MIN_CONSECUTIVE_SUCCESS_STEPS = 5
#: 近义检测阈值（#31E）：Jaccard 与序列相似度取最大后与之比较。
NEAR_DUPLICATE_THRESHOLD = 0.82
#: 90 天未加载 → 提示归档（#31E），不自动删。
ARCHIVE_PROMPT_DAYS = 90

#: 验证状态（与 migration 0016 的取值一致）。
SKILL_VALIDATION_PENDING = "pending"
SKILL_VALIDATION_VALIDATED = "validated"

MAX_NAME_CHARS = 64
MAX_DESCRIPTION_CHARS = 255
MAX_STEP_CHARS = 200
MAX_STEPS = 20
MAX_PITFALL_CHARS = 200
MAX_PITFALLS = 10

#: 检测窗口：最近多少条消息 / 多少个对话。
_DETECT_RECENT_MESSAGES = 60
_DETECT_RECENT_CONVERSATIONS = 20

#: 用户明确要求"以后都这样"的说法（中文；属于防呆词表，不是界面文案）。
_PERSISTENT_RULE_PHRASES = (
    "以后都",
    "以后照这个",
    "以后按这个",
    "每次都这样",
    "都这么做",
    "以后就这么",
)


@dataclass(frozen=True)
class SkillDraft:
    """一份四段齐全的技能草稿（#31D）。"""

    name: str
    description: str
    when_to_use: str
    steps: tuple[str, ...]
    pitfalls: tuple[str, ...]


def _clean(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _normalize(text: str) -> str:
    return "".join(_clean(text, 400).split()).casefold()


def _bigrams(text: str) -> set[str]:
    term = _normalize(text)
    if len(term) < 2:
        return {term} if term else set()
    return {term[index : index + 2] for index in range(len(term) - 1)}


def similarity(left: str, right: str) -> float:
    """近义检测打分：字符二元组 Jaccard 与序列相似度取最大（0–1）。"""
    if not left.strip() or not right.strip():
        return 0.0
    left_grams = _bigrams(left)
    right_grams = _bigrams(right)
    union = left_grams | right_grams
    jaccard = len(left_grams & right_grams) / len(union) if union else 0.0
    sequence = difflib.SequenceMatcher(None, _normalize(left), _normalize(right)).ratio()
    return round(max(jaccard, sequence), 4)


def detect_repeat_workflow(signatures: Sequence[Sequence[str]]) -> bool:
    """同一工具序列在 >=2 个不同对话里重复出现 → 视为可复用工作流（#31D）。"""
    seen: dict[tuple[str, ...], int] = {}
    for signature in signatures:
        key = tuple(str(item) for item in signature if str(item).strip())
        if not key:
            continue
        seen[key] = seen.get(key, 0) + 1
    return any(count >= SKILL_GENERATION_MIN_REPEATS for count in seen.values())


def user_requested_persistent_rule(texts: Sequence[str]) -> bool:
    """用户是否明确说「以后都这么做」一类持久规则（#31D 触发条件二）。"""
    return any(
        phrase in "".join(_clean(text, 500).split())
        for text in texts
        for phrase in _PERSISTENT_RULE_PHRASES
    )


def long_success_trajectory(step_results: Sequence[bool]) -> bool:
    """一次任务里连续 >=5 步全部成功（#31D 触发条件三）；任一失败步打断连续计数。"""
    run = 0
    for result in step_results:
        if result:
            run += 1
            if run >= MIN_CONSECUTIVE_SUCCESS_STEPS:
                return True
        else:
            run = 0
    return False


def parse_skill_draft(payload: Any) -> SkillDraft | None:
    """校验四段内容：name/description/when_to_use 非空、steps 非空数组、pitfalls 数组。

    任何一段缺失或类型不对都返回 None（调用方按"证据不足"处理，不写库）——
    半份技能比没有技能更危险：它会被当成完整指令注入系统提示。
    """
    if not isinstance(payload, dict):
        return None
    name = _clean(payload.get("name"), MAX_NAME_CHARS)
    description = _clean(payload.get("description"), MAX_DESCRIPTION_CHARS)
    when_to_use = _clean(payload.get("when_to_use"), MAX_DESCRIPTION_CHARS)
    raw_steps = payload.get("steps")
    raw_pitfalls = payload.get("pitfalls")
    if not name or not description or not when_to_use:
        return None
    if not isinstance(raw_steps, list) or not raw_steps:
        return None
    if not isinstance(raw_pitfalls, list):
        return None
    steps = tuple(
        _clean(item, MAX_STEP_CHARS)
        for item in raw_steps[:MAX_STEPS]
        if _clean(item, MAX_STEP_CHARS)
    )
    pitfalls = tuple(
        _clean(item, MAX_PITFALL_CHARS)
        for item in raw_pitfalls[:MAX_PITFALLS]
        if _clean(item, MAX_PITFALL_CHARS)
    )
    if not steps:
        return None
    return SkillDraft(
        name=name,
        description=description,
        when_to_use=when_to_use,
        steps=steps,
        pitfalls=pitfalls,
    )


def draft_to_prompt(draft: SkillDraft) -> str:
    """把四段内容渲染成注入系统提示的"要求"正文（只写 prompt，不写知识文件）。"""
    lines = [f"适用场景：{draft.description}", f"何时使用：{draft.when_to_use}", "步骤："]
    lines.extend(f"{index}. {step}" for index, step in enumerate(draft.steps, start=1))
    if draft.pitfalls:
        lines.append("注意事项与反例：")
        lines.extend(f"- {pitfall}" for pitfall in draft.pitfalls)
    return "\n".join(lines)


def draft_to_dict(draft: SkillDraft) -> dict[str, Any]:
    return {
        "name": draft.name,
        "description": draft.description,
        "when_to_use": draft.when_to_use,
        "steps": list(draft.steps),
        "pitfalls": list(draft.pitfalls),
    }


def draft_from_trajectory(tool_names: Sequence[str]) -> SkillDraft | None:
    """确定性兜底草稿：没有模型时也能从成功轨迹生成一份可读的四段技能。

    这只是**兜底**：更高质量的四段内容应由模型生成后走 accept 端点。兜底的边界是
    "只讲步骤，不编造业务规则"——steps 就是真实调用过的工具名，pitfalls 固定写
    "未经验证、先确认再复用"。
    """
    names = [str(name).strip() for name in tool_names if str(name).strip()]
    if len(names) < MIN_CONSECUTIVE_SUCCESS_STEPS:
        return None
    label = "、".join(dict.fromkeys(names))[:MAX_NAME_CHARS]
    return SkillDraft(
        name=f"复用流程：{label}"[:MAX_NAME_CHARS],
        description="从一次成功完成的任务里整理出的工具调用流程。",
        when_to_use="用户再次提出与那次任务相似的要求时。",
        steps=tuple(f"调用工具 {name}" for name in names[:MAX_STEPS]),
        pitfalls=("这是自动整理的草稿，未经验证，先确认结果再当作固定流程。",),
    )


def near_duplicate_skill(
    db: Session, draft: SkillDraft, *, threshold: float = NEAR_DUPLICATE_THRESHOLD
) -> AssistantSkill | None:
    """找现有技能里与草稿近义的一条（#31E）：返回最相似且超阈值的那条。"""
    best: tuple[float, AssistantSkill] | None = None
    for skill in db.query(AssistantSkill).all():
        score = similarity(
            draft.name + " " + draft.description,
            (skill.name or "") + " " + (skill.description or ""),
        )
        if best is None or score > best[0]:
            best = (score, skill)
    if best is None or best[0] < threshold:
        return None
    return best[1]


def next_version(skill: AssistantSkill | None) -> int:
    """技能版本自增（#31E）：新技能从 1 开始。"""
    if skill is None:
        return 1
    return int(skill.version or 1) + 1


def mark_skill_loaded(
    db: Session, skills: Sequence[AssistantSkill], conversation_id: int | None
) -> None:
    """记录"这些技能被加载过"（#31E 90 天提示的数据来源 + 版本快照）。

    只 flush 不 commit：调用方（系统提示装配）处在一个更大的请求事务里，
    由请求收尾统一提交；单独 commit 会在只读请求里制造写事务。
    """
    if not skills:
        return
    now = utcnow()
    for skill in skills:
        skill.last_loaded_at = now
    if conversation_id is not None:
        rows = (
            db.query(AssistantConversationSkill)
            .filter(
                AssistantConversationSkill.conversation_id == conversation_id,
                AssistantConversationSkill.skill_id.in_([int(skill.id) for skill in skills]),
            )
            .all()
        )
        versions = {int(skill.id): int(skill.version or 1) for skill in skills}
        for row in rows:
            row.skill_version = versions.get(int(row.skill_id), row.skill_version)
    db.flush()


def accept_draft(
    db: Session,
    draft: SkillDraft,
    *,
    existing_skill: AssistantSkill | None = None,
    conversation_id: int | None = None,
) -> tuple[AssistantSkill, str]:
    """把一份四段草稿落成"待验证"技能（#31D 提案卡确认后的动作）。

    - 新建：generated=True、validation_status=pending、version=1；**不**自动挂到任何
      对话（默认不启用），也不写知识文件；
    - 更新已有（#31E 近义命中）：内容替换、version 自增、重新标 pending；
    - 返回 (skill, "create"|"update")。
    名称冲突（不是同一 id 的另同名技能）时抛 ValueError，由路由转 422。
    """
    target_name = draft.name
    if existing_skill is None:
        if db.query(AssistantSkill).filter(AssistantSkill.name == target_name).first() is not None:
            raise ValueError(f"已存在同名技能「{target_name}」，请提议更新已有技能或换一个名称")
        skill = AssistantSkill(name=target_name, source_name="对话生成（待验证）")
        db.add(skill)
        mode = "create"
    else:
        skill = existing_skill
        duplicate = (
            db.query(AssistantSkill)
            .filter(AssistantSkill.name == target_name, AssistantSkill.id != skill.id)
            .first()
        )
        if duplicate is not None:
            raise ValueError(f"已存在同名技能「{target_name}」")
        skill.name = target_name
        skill.source_name = skill.source_name or "对话生成（待验证）"
        mode = "update"
    skill.description = draft.description
    skill.prompt = draft_to_prompt(draft)
    skill.when_to_use = draft.when_to_use
    skill.steps = "\n".join(draft.steps)
    skill.pitfalls = "\n".join(draft.pitfalls)
    skill.version = next_version(skill if mode == "update" else None)
    skill.generated = True
    skill.validation_status = SKILL_VALIDATION_PENDING
    db.add(skill)
    db.commit()
    db.refresh(skill)
    return skill, mode


def mark_validated(db: Session, skill: AssistantSkill) -> AssistantSkill:
    """首次被加载并完成任务后才标记"已验证"（#31F 的验证闭环落点）。"""
    skill.validation_status = SKILL_VALIDATION_VALIDATED
    skill.updated_at = utcnow()
    db.commit()
    db.refresh(skill)
    return skill


def archive_candidates(
    db: Session, *, now: datetime | None = None, days: int = ARCHIVE_PROMPT_DAYS
) -> list[AssistantSkill]:
    """90 天未被加载的自动生成技能（#31E）：**只提示归档，不自动删除**。"""
    reference = now or utcnow()
    cutoff = reference - timedelta(days=days)
    rows = db.query(AssistantSkill).filter(AssistantSkill.generated.is_(True)).all()
    candidates: list[AssistantSkill] = []
    for skill in rows:
        last_seen = skill.last_loaded_at or skill.created_at
        if last_seen is None or last_seen < cutoff:
            candidates.append(skill)
    return candidates


def _tool_records(context: Any) -> list[dict[str, Any]]:
    if not isinstance(context, dict):
        return []
    records = context.get("tool_calls")
    if not isinstance(records, list):
        return []
    return [record for record in records if isinstance(record, dict)]


def _tool_names(records: Sequence[dict[str, Any]]) -> tuple[str, ...]:
    return tuple(str(record.get("name") or "") for record in records if record.get("name"))


def _all_steps_succeeded(records: Sequence[dict[str, Any]]) -> bool:
    """失败/取消任一条即整条轨迹不合格（#31F：不从失败轨迹生成）。"""
    return bool(records) and all(bool(record.get("ok")) for record in records)


def detect_from_conversation(db: Session, conversation_id: int) -> dict[str, Any]:
    """检测一个对话里是否出现了可生成技能的信号（#31D 三个触发条件）。

    返回 triggers 清单与（可能的）确定性兜底草稿；前端/助手据此决定是否弹提案卡。
    没有信号时 triggers 为空、draft 为 None——**证据不足不提议**。
    """
    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.id.desc())
        .limit(_DETECT_RECENT_MESSAGES)
        .all()
    )
    messages.reverse()
    triggers: list[str] = []
    tool_sequences: list[tuple[str, ...]] = []
    step_results: list[bool] = []
    for message in messages:
        records = _tool_records(message.context)
        if records and message.role == "assistant" and _all_steps_succeeded(records):
            # 31F：失败/取消轨迹不参与生成（只收集全程成功的轨迹）。
            tool_sequences.append(_tool_names(records))
            step_results.extend(bool(record.get("ok")) for record in records)
    if detect_repeat_workflow([tool_sequences[-1]] if tool_sequences else []):
        # 单对话内重复同一序列也算（用户在同一会话里做了两遍同样的事）。
        triggers.append("repeat_workflow")
    # 跨对话重复：最近若干对话的成功序列里出现同一条。
    recent_conversations = [
        row[0]
        for row in db.query(ChatMessage.conversation_id)
        .filter(ChatMessage.conversation_id != conversation_id)
        .order_by(ChatMessage.id.desc())
        .limit(_DETECT_RECENT_MESSAGES)
        .all()
    ]
    cross_ids = list(dict.fromkeys(recent_conversations))[:_DETECT_RECENT_CONVERSATIONS]
    cross_sequences: list[tuple[str, ...]] = []
    for other_id in cross_ids:
        other = (
            db.query(ChatMessage)
            .filter(ChatMessage.conversation_id == other_id, ChatMessage.role == "assistant")
            .order_by(ChatMessage.id.desc())
            .limit(_DETECT_RECENT_MESSAGES)
            .all()
        )
        for message in other:
            records = _tool_records(message.context)
            if records and _all_steps_succeeded(records):
                cross_sequences.append(_tool_names(records))
    signatures = ([tool_sequences[-1]] if tool_sequences else []) + cross_sequences
    if detect_repeat_workflow(signatures):
        trigger = "repeat_workflow"
        if trigger not in triggers:
            triggers.append(trigger)
    user_texts = [message.content or "" for message in messages if message.role == "user"]
    if user_requested_persistent_rule(user_texts):
        triggers.append("persistent_rule")
    if long_success_trajectory(step_results):
        triggers.append("long_success_trajectory")
    draft = draft_from_trajectory(tool_sequences[-1]) if tool_sequences and triggers else None
    return {
        "conversation_id": conversation_id,
        "triggers": triggers,
        "draft": draft_to_dict(draft) if draft is not None else None,
    }


__all__ = [
    "ARCHIVE_PROMPT_DAYS",
    "MAX_DESCRIPTION_CHARS",
    "MAX_NAME_CHARS",
    "MIN_CONSECUTIVE_SUCCESS_STEPS",
    "NEAR_DUPLICATE_THRESHOLD",
    "SKILL_GENERATION_MIN_REPEATS",
    "SKILL_VALIDATION_PENDING",
    "SKILL_VALIDATION_VALIDATED",
    "SkillDraft",
    "accept_draft",
    "archive_candidates",
    "detect_from_conversation",
    "detect_repeat_workflow",
    "draft_from_trajectory",
    "draft_to_dict",
    "draft_to_prompt",
    "long_success_trajectory",
    "mark_skill_loaded",
    "mark_validated",
    "near_duplicate_skill",
    "next_version",
    "parse_skill_draft",
    "similarity",
    "user_requested_persistent_rule",
]
