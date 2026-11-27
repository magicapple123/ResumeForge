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
from .. import trash
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
from ..resume.resume_inline_style import strip_style_markers
from ..resume_ref import CODE_INVALID_REF, CODE_NOT_FOUND, ResolvedResume, resolve_resume_ref
from .assistant_error_detail import AssistantInputError

MAX_JOB_CONTEXT_CHARS = 6_000
MAX_PROFILE_CONTEXT_CHARS = 10_000
MAX_RESUME_CONTEXT_CHARS = 12_000
# 引用写错 / 指向已删记录时的固定文案（`AssistantInputError.detail` 必须是字面量：
# 异常文本会外发，不能把它变成"把用户输入拼进响应"的通道）。
RESUME_REF_INVALID_DETAIL = "简历引用写法不对：应为 internal:12（内部简历）或 external:7（外部简历）"
RESUME_REF_MISSING_DETAIL = "选择的简历不存在或已被删除"
# 本地上下文的**总预算**：单块上限相加（6k+12k+10k）在"岗位+简历+资料"全选时会把
# 单轮 prompt 推高到 4 万字符量级（实测助手单轮 prompt 约 5.8 万 token，主因之一）。
# 预算按 岗位 → 简历 → 资料 的顺序分配：先保岗位针对性，再保用户显式选中的简历，
# 最后用剩余额度给资料。单块上限保持不变语义（某一类最多多少），总预算封顶无界增长。
MAX_LOCAL_CONTEXT_CHARS = 24_000


def trim(value: str, max_chars: int) -> str:
    return value if len(value) <= max_chars else f"{value[:max_chars].rstrip()}…"


def strip_marks_deep(value: Any) -> Any:
    """递归剥掉 JSON 里的行内样式标记（DF-6）：模型不需要看到 `{@color=…}`。

    复用 `strip_style_markers`（保守剥离：未闭合 / 越界标记原样保留），不另写一份解析。
    `**` 不在这里处理——助手读到的 Markdown 加粗是可读语义，不是泄漏。
    """
    if isinstance(value, str):
        return strip_style_markers(value)
    if isinstance(value, list):
        return [strip_marks_deep(item) for item in value]
    if isinstance(value, dict):
        return {key: strip_marks_deep(item) for key, item in value.items()}
    return value


def resume_context(record: ResumeRecord, *, max_chars: int = MAX_RESUME_CONTEXT_CHARS) -> str:
    content = strip_marks_deep(dict(record.content or {}))
    content.pop("photo", None)
    payload = {
        "id": record.id,
        "title": strip_style_markers(record.title or ""),
        "target_job": strip_style_markers(record.job_title or ""),
        "company": strip_style_markers(record.company or ""),
        "source": record.source,
        "content": content,
    }
    serialized = json.dumps(payload, ensure_ascii=False)
    return f"[已选简历开始]\n{trim(serialized, max_chars)}\n[已选简历结束]"


def resume_ref_context(
    resolved: ResolvedResume, *, max_chars: int = MAX_RESUME_CONTEXT_CHARS
) -> str:
    """一张「已选简历」块，来源是 :func:`resolve_resume_ref` 的解析结果（T29）。

    两种情况都用这一块：

    - 外部简历（正文取自上传时本地提取的 ``external_resume.text``）；
    - **记录在、但给不出正文**（扫描件没有文字层、空草稿）。

    第二种为什么不报错：用户确实选了这一份，只是它读不出字。报 4xx 会让助手"看起来
    坏了"，而模型据 ``available: false`` + ``reason`` 能给出"这份是扫描件，先做一次文本
    检查或换一份带文字层的 PDF"这种真正有用的回答。反之如果这里塞一段空正文，模型会
    自信地分析一片空白——那是最坏的结果。
    """
    payload: dict[str, Any] = {
        "resume_ref": resolved.ref,
        "kind": resolved.kind,
        "name": resolved.name,
    }
    if resolved.ok:
        payload["text"] = trim(resolved.text or "", max_chars)
    else:
        payload["available"] = False
        payload["reason"] = resolved.reason
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
            raise AssistantInputError(404, "选择的岗位不存在或已被删除")
        # 标题快照（F36）：context 里只有 id 时，岗位改名/删除后界面只能显示 `#12`。
        # 这里只在查到对象时补写展示字段，`job_id` 保持原样供跳转与重放使用。
        metadata["job_title"] = job.title
        metadata["job_company"] = job.company
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
    resume_ref_value = (payload.resume_ref or "").strip()
    if payload.resume_id is not None and not resume_ref_value:
        # 旧通道：只发单表 id 的客户端 / 旧会话重放走这里（行为与 T29 之前逐字相同）。
        resume = db.get(ResumeRecord, payload.resume_id)
        if resume is None:
            raise AssistantInputError(404, RESUME_REF_MISSING_DETAIL)
        metadata["resume_title"] = resume.title
        take(resume_context(resume, max_chars=min(MAX_RESUME_CONTEXT_CHARS, max(remaining, 0))))
    if resume_ref_value:
        # T29：复合引用**优先**于 resume_id（旧客户端只发 resume_id，两条路各走各的）。
        resolved = resolve_resume_ref(db, resume_ref_value, "text")
        # 「写错」与「记录没了」是客户端错误（用户在界面上指了一个不存在的东西）；
        # 「记录在但读不出正文」不是——那一段要交给模型如实转述（见 resume_ref_context）。
        if resolved.code == CODE_INVALID_REF:
            raise AssistantInputError(422, RESUME_REF_INVALID_DETAIL)
        if resolved.code == CODE_NOT_FOUND:
            raise AssistantInputError(404, RESUME_REF_MISSING_DETAIL)
        metadata["resume_ref"] = resolved.ref
        metadata["resume_kind"] = resolved.kind
        metadata["resume_title"] = resolved.name
        # 外部简历的 id 绝不写进 `resume_id`：两张表的 id 会撞号，前端拿它去开内部简历
        # 详情会打开别人的记录。
        metadata["resume_id"] = resolved.id if resolved.kind == "internal" else None
        budget = min(MAX_RESUME_CONTEXT_CHARS, max(remaining, 0))
        if resolved.ok and resolved.kind == "internal":
            # 内部简历给完整文档（与只发 resume_id 时逐字同一份），模型做改写/定位都要它。
            record = trash.get_live(db, ResumeRecord, resolved.id)
            if record is None:
                raise AssistantInputError(404, RESUME_REF_MISSING_DETAIL)
            take(resume_context(record, max_chars=budget))
        else:
            take(resume_ref_context(resolved, max_chars=budget))
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
    "RESUME_REF_INVALID_DETAIL",
    "RESUME_REF_MISSING_DETAIL",
    "trim",
    "resume_context",
    "resume_ref_context",
    "profile_context",
    "load_local_context",
]
