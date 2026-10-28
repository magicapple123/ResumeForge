# SPDX-License-Identifier: Apache-2.0
"""岗位匹配分析所需的个人资料与简历来源快照。

**唯一的取数口径**：`services.profile.ai_profile.load_ai_profile`——「我的资料」页
**当前选中的组** + **未隐藏字段**。单岗匹配、批量匹配、横向对比都走这里，因此三者看到
的资料永远一致；用户切组后新发起的分析自动跟随，已生成结论不受影响。

历史说明：F2 曾让三链外消费者读 `load_all_consumed_profile`（不按组限制，R-64）。
2026-10-28 用户要求统一为"当前组 + 去隐藏"，本模块随之切换；旧入口仍保留给网申重叠值
裁决等确实需要全量分区的场景，**AI 取数不得再直接使用它**。
"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ...models.job import Job
from ...models.profile import UserProfile
from ...schemas.profile import ProfileOut
from ...schemas.profile_projection import ConsumedProfile
from ..apply import apply_service
from ..profile.ai_profile import load_ai_profile
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


def job_resume_text(db: Session, job: Job) -> str:
    """岗位对应简历（绑定/默认）的序列化文本；没有简历时是空串。

    单岗匹配与批量匹配共用这一处序列化，避免两条链路对"模型看到的简历"出现差异。
    """
    resume = apply_service.resolve_resume(db, job.id, None)
    if resume is None:
        return ""
    return json.dumps(
        {"title": resume.title, "job_title": resume.job_title, "content": resume.content},
        ensure_ascii=False,
    )


def match_source_texts(
    db: Session, job: Job, *, profile: ProfileOut | UserProfile | None = None
) -> tuple[ProfileOut | UserProfile, str, str]:
    """返回岗位匹配所需的资料文本与岗位对应简历文本（当前组 + 去隐藏）。"""
    current = profile or load_ai_profile(db)
    return current, profile_text(current), job_resume_text(db, job)


__all__ = ["job_resume_text", "match_source_texts", "profile_is_empty", "profile_text"]
