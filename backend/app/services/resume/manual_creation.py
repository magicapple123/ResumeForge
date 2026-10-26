# SPDX-License-Identifier: Apache-2.0
"""手写简历创建流程（F4 契约 §1/§6）：从 crud_routes 等价提取 + 创建态资料快照。

**为什么单独成模块**：POST /api/resumes/manual 是"新建流程"的唯一落库入口，F4 要在
同一事务里附带创建态快照（profile_usage_snapshot）。把它留在路由文件里会让 crud_routes
既做路由又做事务编排，也放不下预算；提取后**行为逐字节等价**（job 校验、内容校验、
format_config 物化、logger、提交点都不变）。

**创建态快照（F4 §6 / Lead 2026-10-25 口径）**：请求可带 profile_context
{snapshot_token, participating_keys, layout}。服务端不信任客户端传的 layout：
snapshot_token 必须等于**当前投影**的 PaperProjectionOut.snapshot_token（同一份
ConsumedProfile + 同一套照片解析器重算，避免第二份照片解析）。一致时随简历同事务写
一行 profile_usage_snapshot（resume_id 关联、layout/participating/revision 冻结，
复用 F3 generate_snapshot 的 freeze/persist 单源）；不一致 → 409
code=profile_snapshot_stale，让前端重新读取来源，而不是把旧布局写进追溯。

**旧客户端**：不带 profile_context → 不写快照、响应形状不变（新增字段可选）。
"""

from __future__ import annotations

import logging

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ...models.job import Job
from ...models.resume import ResumeRecord
from ...schemas.resume import ManualResumeRequest
from ...services import trash
from ...services.resume.document_identity import DocumentIdentityError, validate_document_ids
from ...services.resume.resume_record import build_manual_title
from ...services.resume.resume_sections import default_section_order_config
from ...services.resume.resume_template_format import validated_format_config
from .generate_snapshot import (
    GenerationSnapshot,
    detach_snapshot_resume,
    freeze_generation_snapshot,
    persist_generation_snapshot,
)

logger = logging.getLogger(__name__)

# 与 resume_revision_conflict 同一错误契约：HTTP 409 + 响应体顶层 code，前端
# ApiError.businessCode 已按这个形状读取，不新建第二套。
PROFILE_SNAPSHOT_STALE_CODE = "profile_snapshot_stale"
PROFILE_SNAPSHOT_STALE_DETAIL = (
    "资料或当前组已变化，本次新建的来源布局已过期：请重新打开新建面板后再保存。"
)


class ProfileSnapshotStale(Exception):
    """创建请求带着过期投影 token：要求前端重新读取当前来源。"""


def profile_snapshot_stale_response() -> JSONResponse:
    """把过期快照转成 409 响应体（{detail, code}）。"""
    return JSONResponse(
        status_code=409,
        content={"detail": PROFILE_SNAPSHOT_STALE_DETAIL, "code": PROFILE_SNAPSHOT_STALE_CODE},
    )


def create_manual_resume_record(db: Session, payload: ManualResumeRequest) -> ResumeRecord:
    """按旧流程创建手写简历（不提交）；带 profile_context 时同事务挂创建态快照。

    调用方负责 db.commit()/db.refresh() 与响应组装——提交点保持原样，快照行与简历行
    因此天然同事务。
    """
    job = _resolve_job(db, payload.job_id)
    content = _validated_content(payload)
    frozen = _freeze_creation_snapshot(db, payload)
    # P0-5：板块顺序在创建时物化（先资料顺序、再请求体显式覆盖）。与提取前逐行一致。
    format_config = {
        **(default_section_order_config(db) or {}),
        **validated_format_config(payload.format_config),
    }
    record = ResumeRecord(
        title=build_manual_title(payload.content, job, payload.title),
        job_id=job.id if job else None,
        job_title=job.title if job else payload.content.job_intent,
        company=job.company if job else "",
        content=content,
        warnings=[],
        source="manual",
        model="",
        enhancement_enabled=False,
        enhancement_level="balanced",
        parse_error="",
        format_config=format_config,
        draft=payload.draft,
        language=payload.language,
    )
    db.add(record)
    db.flush()  # 先拿到 record.id，快照行的 resume_id 才能在同一事务里回写
    if frozen is not None:
        snapshot = persist_generation_snapshot(db, frozen)
        # SQLite 会复用被彻底删除简历的 rowid：老库可能留下同 resume_id 的悬空快照行，
        # 直接回写会撞 profile_usage_snapshot.resume_id 的 UNIQUE（用户 644 的 P0）。
        # 先把历史引用解绑（快照行本身保留），再绑定本次简历。
        detach_snapshot_resume(db, record.id, keep_snapshot_id=snapshot.id)
        snapshot.resume_id = record.id
    return record


def _resolve_job(db: Session, job_id: int | None) -> Job | None:
    if job_id is None:
        return None
    job = db.get(Job, job_id)
    if job is None or trash.is_deleted(job):
        raise HTTPException(status_code=404, detail="关联岗位不存在或已被删除")
    return job


def _validated_content(payload: ManualResumeRequest) -> dict:
    """与 api/resumes/_shared.py::_validated_content 同口径（W01 对象标识校验）。"""
    data = payload.content.model_dump()
    try:
        validate_document_ids(data)
    except DocumentIdentityError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return data


def _freeze_creation_snapshot(
    db: Session, payload: ManualResumeRequest
) -> GenerationSnapshot | None:
    """校验 snapshot_token 并返回冻结来源；无 profile_context 时返回 None。"""
    context = payload.profile_context
    if context is None:
        return None
    frozen = freeze_generation_snapshot(db)
    if context.snapshot_token != _current_snapshot_token(db, frozen):
        raise ProfileSnapshotStale()
    return frozen


def _current_snapshot_token(db: Session, frozen: GenerationSnapshot) -> str:
    """重算当前投影 token（与 GET /api/profile/current/projection 完全同源）。

    照片解析器复用投影端点的实现：带照片的资料来源在两端必须得到同一份 content，
    否则 token 永远是过期。延迟导入是为了不在模块加载期把 api 层拉进服务层。
    """
    from ...api.profile_workspace import _photo_resolver
    from ..profile.paper_projection import project_paper_content, snapshot_token

    content = project_paper_content(frozen.consumed, resolve_photo=_photo_resolver(db))
    return snapshot_token(frozen.consumed, content)


__all__ = [
    "PROFILE_SNAPSHOT_STALE_CODE",
    "PROFILE_SNAPSHOT_STALE_DETAIL",
    "ProfileSnapshotStale",
    "create_manual_resume_record",
    "profile_snapshot_stale_response",
]
