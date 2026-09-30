"""岗位匹配分析所需的个人资料与简历来源快照。"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ...models.job import Job
from ...models.profile import UserProfile
from ..apply import apply_service
from ..profile.profile_service import get_profile_detail, to_profile_out


def profile_is_empty(profile: UserProfile) -> bool:
    """判断用户是否完全没有可用于匹配的资料。"""
    return not any(
        [
            profile.name,
            profile.phone,
            profile.email,
            profile.summary,
            profile.job_intent,
            profile.educations,
            profile.experiences,
            profile.projects,
            profile.skills,
        ]
    )


def profile_text(profile: UserProfile) -> str:
    """序列化匹配需要的个人资料，排除照片等无关字段。"""
    return json.dumps(
        to_profile_out(profile).model_dump(mode="json", exclude={"photo"}),
        ensure_ascii=False,
    )


def match_source_texts(
    db: Session, job: Job, *, profile: UserProfile | None = None
) -> tuple[UserProfile, str, str]:
    """返回岗位匹配所需的资料文本与岗位对应简历文本。"""
    current_profile = profile or get_profile_detail(db)
    personal_text = profile_text(current_profile)
    resume = apply_service.resolve_resume(db, job.id, None)
    resume_text = ""
    if resume is not None:
        resume_text = json.dumps(
            {"title": resume.title, "job_title": resume.job_title, "content": resume.content},
            ensure_ascii=False,
        )
    return current_profile, personal_text, resume_text


__all__ = ["match_source_texts", "profile_is_empty", "profile_text"]
