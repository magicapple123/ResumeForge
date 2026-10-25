# SPDX-License-Identifier: Apache-2.0
"""岗位匹配分析所需的个人资料与简历来源快照。

F2 起资料来源改成新模型的消费快照（`load_all_consumed_profile`，**不按当前组限制**，
R-64）：hidden 字段已被 reader 剔除、旧资料六表不再读取，返回给调用方的仍是旧形状
`ProfileOut`（接口形状不变，只换来源）。批量匹配（job_match_batch）仍传旧 ORM 资料，
这里继续兼容，待生成/网申链路同批迁移后自然收敛。
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ...models.job import Job
from ...models.profile import UserProfile
from ...schemas.profile import ProfileOut
from ...schemas.profile_projection import ConsumedProfile
from ..apply import apply_service
from ..profile.profile_reader import load_all_consumed_profile
from ..profile.profile_service import (
    legacy_profile_is_empty,
    project_legacy_profile_from_consumed,
    to_profile_out,
)


def _is_empty_user_profile(profile: UserProfile) -> bool:
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


def profile_is_empty(profile: ProfileOut | UserProfile | ConsumedProfile) -> bool:
    """判断用户是否完全没有可用于匹配的资料（旧协议口径，三种来源同一答案）。"""
    if isinstance(profile, ConsumedProfile):
        return legacy_profile_is_empty(project_legacy_profile_from_consumed(profile))
    if isinstance(profile, ProfileOut):
        return legacy_profile_is_empty(profile)
    return _is_empty_user_profile(profile)


def profile_text(profile: ProfileOut | UserProfile | ConsumedProfile) -> str:
    """序列化匹配需要的个人资料，排除照片等无关字段（旧协议字段名，提示词不变）。"""
    if isinstance(profile, ConsumedProfile):
        profile = project_legacy_profile_from_consumed(profile)
    snapshot = profile if isinstance(profile, ProfileOut) else to_profile_out(profile)
    return json.dumps(
        snapshot.model_dump(mode="json", exclude={"photo"}),
        ensure_ascii=False,
    )


def match_source_texts(
    db: Session, job: Job, *, profile: UserProfile | None = None
) -> tuple[ProfileOut | UserProfile, str, str]:
    """返回岗位匹配所需的资料文本与岗位对应简历文本（资料来自新模型消费快照）。"""
    current = profile or project_legacy_profile_from_consumed(load_all_consumed_profile(db))
    personal_text = profile_text(current)
    resume = apply_service.resolve_resume(db, job.id, None)
    resume_text = ""
    if resume is not None:
        resume_text = json.dumps(
            {"title": resume.title, "job_title": resume.job_title, "content": resume.content},
            ensure_ascii=False,
        )
    return current, personal_text, resume_text


__all__ = ["match_source_texts", "profile_is_empty", "profile_text"]
