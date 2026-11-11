# SPDX-License-Identifier: Apache-2.0
"""#31D/#31E/#31F 技能学习端点：检测信号、接受四段草稿、标记验证、归档提示。

与既有 `/api/assistant/skills` 的分工：那边管"用户导入/手写/启停/删除"，
这边只管"从对话里学到的技能"的生命周期——检测 → 提案草稿 → 接受（待验证）→
验证 → 90 天未加载提示归档。接受后的技能仍然是普通 assistant_skill 行，
因此技能工作台、对话启用接口、注入链路全部照旧复用。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.assistant import AssistantSkill
from ..services.assistant import skill_learning

router = APIRouter(prefix="/api/assistant/skills/learning", tags=["assistant"])


class SkillDraftPayload(BaseModel):
    """四段内容（#31D）：缺任一段都由服务层判非法（422）。"""

    name: str = Field(min_length=1, max_length=skill_learning.MAX_NAME_CHARS)
    description: str = Field(min_length=1, max_length=skill_learning.MAX_DESCRIPTION_CHARS)
    when_to_use: str = Field(min_length=1, max_length=skill_learning.MAX_DESCRIPTION_CHARS)
    steps: list[str] = Field(min_length=1, max_length=skill_learning.MAX_STEPS)
    pitfalls: list[str] = Field(default_factory=list, max_length=skill_learning.MAX_PITFALLS)


class AcceptDraftRequest(BaseModel):
    draft: SkillDraftPayload
    #: 近义命中的已有技能 id（#31E：提议更新而不是新建）。
    existing_skill_id: int | None = Field(default=None, ge=1)


class SkillLearningOut(BaseModel):
    skill_id: int
    name: str
    mode: str
    version: int
    generated: bool
    validation_status: str
    near_duplicate_skill_id: int | None = None


class ArchiveCandidateOut(BaseModel):
    skill_id: int
    name: str
    last_loaded_at: str | None = None


def _to_out(
    skill: AssistantSkill, mode: str, duplicate: AssistantSkill | None = None
) -> SkillLearningOut:
    return SkillLearningOut(
        skill_id=int(skill.id),
        name=skill.name,
        mode=mode,
        version=int(skill.version or 1),
        generated=bool(skill.generated),
        validation_status=skill.validation_status or "",
        near_duplicate_skill_id=int(duplicate.id) if duplicate is not None else None,
    )


@router.get("/detect")
def detect_skill_candidate(conversation_id: int = Query(ge=1), db: Session = Depends(get_db)):
    """检测一个对话是否出现 #31D 的生成信号；证据不足时 triggers 为空、draft=null。"""
    return skill_learning.detect_from_conversation(db, conversation_id)


@router.post("/accept", response_model=SkillLearningOut, status_code=201)
def accept_skill_draft(payload: AcceptDraftRequest, db: Session = Depends(get_db)):
    """接受一份四段草稿：生成"待验证"技能（默认不启用），或更新近义的已有技能。"""
    draft = skill_learning.parse_skill_draft(payload.draft.model_dump())
    if draft is None:
        raise HTTPException(
            status_code=422, detail="技能内容四段不齐：需要名称、说明、何时使用与至少一步"
        )
    existing: AssistantSkill | None = None
    if payload.existing_skill_id is not None:
        existing = db.get(AssistantSkill, payload.existing_skill_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="要更新的技能不存在或已被删除")
    else:
        existing = skill_learning.near_duplicate_skill(db, draft)
    try:
        skill, mode = skill_learning.accept_draft(
            db, draft, existing_skill=existing, conversation_id=None
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _to_out(skill, mode, existing if mode == "update" else None)


@router.post("/{skill_id}/validate", response_model=SkillLearningOut)
def validate_skill(skill_id: int, db: Session = Depends(get_db)):
    """标记"已验证"（#31F）：首次被加载并完成任务后由界面/助手调用。"""
    skill = db.get(AssistantSkill, skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="技能不存在或已被删除")
    updated = skill_learning.mark_validated(db, skill)
    return _to_out(updated, "validate")


@router.get("/archive-candidates", response_model=list[ArchiveCandidateOut])
def read_archive_candidates(db: Session = Depends(get_db)):
    """90 天未被加载的自动生成技能（#31E）：只提示归档，不自动删除。"""
    return [
        ArchiveCandidateOut(
            skill_id=int(skill.id),
            name=skill.name,
            last_loaded_at=skill.last_loaded_at.isoformat() if skill.last_loaded_at else None,
        )
        for skill in skill_learning.archive_candidates(db)
    ]


__all__ = ["router"]
