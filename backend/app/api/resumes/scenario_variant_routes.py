# SPDX-License-Identifier: Apache-2.0
"""A5：按职业场景派生已有简历变体的三个端点（创建 / 预览候选 / 采纳）。

路径挂在 /api/resumes 下（resumes 聚合门面负责 include 顺序）：

- POST /{resume_id}/scenario-variants
- POST /{resume_id}/variants/{variant_id}/scenario-preview
- POST /{resume_id}/variants/{variant_id}/scenario-adopt

边界：源简历零写入；预览不落库；采纳只写这条变体且做内容指纹 + 场景上下文双条件写。
模型调用只发生在预览；创建/采纳在未配置模型时也能工作（用户可只创建空变体后自己写）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ...database import get_db
from ...models.job import Job
from ...schemas.job import JobOut
from ...schemas.scenario_variants import (
    ScenarioVariantAdoptRequest,
    ScenarioVariantCreateRequest,
    ScenarioVariantPreviewOut,
    ScenarioVariantPreviewRequest,
)
from ...schemas.versions import VariantDetailOut, VariantOut
from ...services import trash
from ...services.career_scenarios.resolve import CareerContextError, resolve_context
from ...services.llm.base import LLMError
from ...services.resume import document_variants as variants
from ...services.resume import scenario_variant as service
from ...services.resume.document_versions import VersionNotFound
from ...services.resume.resume_delivery import canonical_content_sha256
from ...services.resume.resume_diff import build_resume_diff
from .. import resumes as _api
from .._disconnect import client_gone, run_until_disconnect
from ._shared import _get_live_resume

router = APIRouter(tags=["resumes"])


def _variant_or_404(db: Session, resume_id: int, variant_id: int):
    try:
        return variants.get_variant(db, resume_id, variant_id)
    except VersionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _job_out(db: Session, record) -> JobOut | None:
    if record.job_id is None:
        return None
    job = db.get(Job, record.job_id)
    if job is None or trash.is_deleted(job):
        return None
    return JobOut.model_validate(job)


@router.post("/{resume_id}/scenario-variants", response_model=VariantOut, status_code=201)
def create_scenario_variant(
    resume_id: int,
    payload: ScenarioVariantCreateRequest,
    db: Session = Depends(get_db),
) -> VariantOut | JSONResponse:
    """先派生独立变体（源简历零写入）。场景未知/版本不符 → 明确 4xx。"""
    record = _get_live_resume(db, resume_id)
    try:
        variant, _snapshot = service.create_scenario_variant(
            db,
            record,
            name=payload.name,
            career_context=payload.career_context,
            base_version_id=payload.base_version_id,
        )
    except CareerContextError as exc:
        return exc.to_response()
    except VersionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return VariantOut.model_validate(variants.variant_brief(variant))


@router.post(
    "/{resume_id}/variants/{variant_id}/scenario-preview",
    response_model=ScenarioVariantPreviewOut,
)
async def preview_scenario_variant(
    resume_id: int,
    variant_id: int,
    payload: ScenarioVariantPreviewRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ScenarioVariantPreviewOut | JSONResponse:
    """按场景表达指南生成候选（不落库、不写源简历）。"""
    record = _get_live_resume(db, resume_id)
    variant = _variant_or_404(db, record.id, variant_id)
    try:
        snapshot = resolve_context(db, payload.career_context)
    except CareerContextError as exc:
        return exc.to_response()
    if snapshot is None:  # schema 已强制必填；类型收窄兜底
        raise HTTPException(status_code=400, detail="缺少职业场景引用")
    config = _api.get_llm_config(db)
    if not config.base_url or not config.model:
        raise HTTPException(status_code=400, detail="尚未配置大模型 API")
    provider = _api.create_provider(config)
    try:
        candidate = await run_until_disconnect(
            request,
            service.preview_scenario_candidate(
                provider,
                record=record,
                variant=variant,
                job=_job_out(db, record),
                snapshot=snapshot,
                instructions=payload.instructions,
            ),
            what="场景候选生成",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"生成场景候选失败：{exc}") from exc
    if candidate is None:
        raise client_gone("场景候选生成")
    candidate_dump = candidate.model_dump()
    return ScenarioVariantPreviewOut(
        variant=VariantOut.model_validate(variants.variant_brief(variant)),
        candidate_content=candidate_dump,
        base_content_sha256=canonical_content_sha256(variant.content or {}),
        candidate_content_sha256=canonical_content_sha256(candidate_dump),
        context_snapshot=snapshot.model_dump(),
        context_sha256=str(snapshot.context_sha256 or ""),
        content_diff=build_resume_diff(
            variant.id,
            variant.name or "当前变体",
            variant.content or {},
            0,
            "场景候选",
            candidate_dump,
        ),
    )


@router.post(
    "/{resume_id}/variants/{variant_id}/scenario-adopt",
    response_model=VariantDetailOut,
)
def adopt_scenario_variant(
    resume_id: int,
    variant_id: int,
    payload: ScenarioVariantAdoptRequest,
    db: Session = Depends(get_db),
) -> VariantDetailOut | JSONResponse:
    """采纳候选到这条变体（双条件写）；源简历一个字段都不写。"""
    record = _get_live_resume(db, resume_id)
    variant = _variant_or_404(db, record.id, variant_id)
    try:
        snapshot = resolve_context(db, payload.career_context)
    except CareerContextError as exc:
        return exc.to_response()
    if snapshot is None:
        raise HTTPException(status_code=400, detail="缺少职业场景引用")
    try:
        updated = service.adopt_scenario_candidate(
            db,
            record=record,
            variant=variant,
            content=payload.content,
            expected_content_sha256=payload.expected_content_sha256,
            expected_context_sha256=payload.expected_context_sha256,
            snapshot=snapshot,
        )
    except service.ScenarioVariantError as exc:
        content: dict = {"detail": exc.detail, "code": exc.code}
        if exc.violations:
            content["violations"] = exc.violations
        return JSONResponse(status_code=exc.status_code, content=content)
    return VariantDetailOut.model_validate(variants.variant_detail(updated))


__all__ = ["router"]
