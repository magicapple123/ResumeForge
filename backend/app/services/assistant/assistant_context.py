# SPDX-License-Identifier: Apache-2.0
"""求职助手的本地上下文组装与长度边界（从 ``api/assistant_context.py`` 下沉）。

这里全是"把资料拼成给模型看的文本"的纯服务逻辑：长度上限、总预算分配、放宽模式
下的身份字段放行。路由层只调用，不做拼接。

依赖方向：只依赖 ``models`` / ``schemas`` / ``services``，不含任何路由代码。
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from ...models.job import Job
from ...models.resume import ResumeRecord
from ...schemas.assistant import AssistantMessageCreate
from ...schemas.job import JobOut
from ..profile.ai_profile import load_ai_consumed_profile
from ..profile.profile_relevance import (
    build_job_prompt_text,
    build_llm_profile_prompt_data,
    build_profile_prompt_data,
    serialize_profile_prompt_data,
)
from ..profile.profile_service import (
    legacy_profile_has_entries,
    project_legacy_profile_from_consumed,
)

MAX_JOB_CONTEXT_CHARS = 6_000
MAX_PROFILE_CONTEXT_CHARS = 10_000
MAX_RESUME_CONTEXT_CHARS = 12_000
# 本地上下文的**总预算**：单块上限相加（6k+12k+10k）在"岗位+简历+资料"全选时会把
# 单轮 prompt 推高到 4 万字符量级（实测助手单轮 prompt 约 5.8 万 token，主因之一）。
# 预算按 岗位 → 简历 → 资料 的顺序分配：先保岗位针对性，再保用户显式选中的简历，
# 最后用剩余额度给资料。单块上限保持不变语义（某一类最多多少），总预算封顶无界增长。
MAX_LOCAL_CONTEXT_CHARS = 24_000


def trim(value: str, max_chars: int) -> str:
    return value if len(value) <= max_chars else f"{value[:max_chars].rstrip()}…"


def resume_context(record: ResumeRecord, *, max_chars: int = MAX_RESUME_CONTEXT_CHARS) -> str:
    content = dict(record.content or {})
    content.pop("photo", None)
    payload = {
        "id": record.id,
        "title": record.title,
        "target_job": record.job_title,
        "company": record.company,
        "source": record.source,
        "content": content,
    }
    serialized = json.dumps(payload, ensure_ascii=False)
    return f"[已选简历开始]\n{trim(serialized, max_chars)}\n[已选简历结束]"


def profile_context(
    db: Session, *, relaxed: bool = False, max_chars: int = MAX_PROFILE_CONTEXT_CHARS
) -> str:
    """个人资料上下文；``relaxed``（助手放宽模式）时携带姓名/电话/邮箱等身份字段。

    资料来源统一走 `load_ai_consumed_profile`：**「我的资料」当前选的组 + 未隐藏字段**
    （2026-10-28 用户口径）。切组后新会话自动跟随，历史消息里的旧上下文不受影响。
    放宽模式由用户在设置里显式开启（默认关），这里只做展示层的放行——私密链接
    兜底（token/private 标记）在任何模式下都生效；照片二进制任何模式都不发送。
    """
    if not legacy_profile_has_entries(db):
        return "[已选个人资料]\n当前尚未保存个人资料。"
    consumed = load_ai_consumed_profile(db)
    prompt_data = build_profile_prompt_data(project_legacy_profile_from_consumed(consumed))
    serialized = serialize_profile_prompt_data(
        build_llm_profile_prompt_data(prompt_data, include_identity=relaxed),
        max_chars,
    )
    return f"[已选个人资料开始]\n{serialized}\n[已选个人资料结束]"


def load_local_context(
    db: Session, payload: AssistantMessageCreate, *, relaxed: bool = False
) -> tuple[list[str], dict[str, Any]]:
    blocks: list[str] = []
    metadata: dict[str, Any] = {
        "job_id": payload.job_id,
        "resume_id": payload.resume_id,
        # 助手现在默认使用本地资料；保留元数据字段只是为了让旧会话仍能解释，值统一为 true。
        "include_profile": True,
        "web_search": payload.web_search,
        "sources": [],
    }
    remaining = MAX_LOCAL_CONTEXT_CHARS

    def take(block: str) -> None:
        """按剩余额度收下这一块；超出总预算时截断，保证单轮 prompt 不随资料量无界增长。"""
        nonlocal remaining
        if remaining <= 0:
            return
        blocks.append(trim(block, remaining))
        remaining -= min(len(block), remaining)

    if payload.job_id is not None:
        job = db.get(Job, payload.job_id)
        if job is None:
            raise ValueError("选择的岗位不存在或已被删除")
        job_out = JobOut.model_validate(job)
        summary = {
            "id": job.id,
            "title": job.title,
            "company": job.company,
            "location": job.location,
            "salary": job.salary,
            "job_type": job.job_type,
            "posted_at": job.posted_at,
            "source_url": job.source_url,
            "details": build_job_prompt_text(job_out, MAX_JOB_CONTEXT_CHARS),
        }
        take(f"[已选岗位开始]\n{json.dumps(summary, ensure_ascii=False)}\n[已选岗位结束]")
    if payload.resume_id is not None:
        resume = db.get(ResumeRecord, payload.resume_id)
        if resume is None:
            raise ValueError("选择的简历不存在或已被删除")
        take(resume_context(resume, max_chars=min(MAX_RESUME_CONTEXT_CHARS, max(remaining, 0))))
    # 个人资料是助手的默认本地上下文，不再由前端开关控制。这样用户直接问“按我的资料…”
    # 时不会因为忘记勾选而得到一份脱离真实资料的回答。放宽模式时携带身份字段（见 profile_context）。
    take(
        profile_context(
            db, relaxed=relaxed, max_chars=min(MAX_PROFILE_CONTEXT_CHARS, max(remaining, 0))
        )
    )
    return blocks, metadata


__all__ = [
    "MAX_JOB_CONTEXT_CHARS",
    "MAX_LOCAL_CONTEXT_CHARS",
    "MAX_PROFILE_CONTEXT_CHARS",
    "MAX_RESUME_CONTEXT_CHARS",
    "trim",
    "resume_context",
    "profile_context",
    "load_local_context",
]
