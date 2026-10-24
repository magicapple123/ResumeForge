# SPDX-License-Identifier: Apache-2.0
"""W13 命名版本 / 岗位变体接口。

语义见 services/resume/document_versions.py 的模块 docstring：
- 创建版本 = 不可变快照；冻结只是显式标记；
- 恢复 = 条件写当前简历（revision+1）+ 新建一条 restore 版本，历史版本不改；
- 变体独立；选择性同步只改列出的变体/路径。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...database import get_db
from ...models.resume import ResumeRecord
from ...schemas.versions import (
    AdoptTranslationOut,
    AdoptTranslationRequest,
    TranslateVariantOut,
    TranslateVariantRequest,
    VariantCreateRequest,
    VariantDetailOut,
    VariantListOut,
    VariantOut,
    VariantPatchRequest,
    VariantSyncOut,
    VariantSyncRequest,
    VersionCompareOut,
    VersionCreateRequest,
    VersionDetailOut,
    VersionFreezeRequest,
    VersionListOut,
    VersionOut,
    VersionRestoreOut,
    VersionRestoreRequest,
)
from ...services import trash
from ...services.llm.base import LLMError
from ...services.resume import bilingual_variants, fact_locks
from ...services.resume import document_variants as variants
from ...services.resume import document_versions as versions
from ...services.resume.document_save import RevisionConflict, revision_conflict_response
from ._shared import _to_resume_out

router = APIRouter()


def _resume_or_404(db: Session, resume_id: int) -> ResumeRecord:
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    return record


def _version_not_found(exc: versions.VersionNotFound) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc) or "版本不存在")


@router.post("/{resume_id}/versions", response_model=VersionOut, status_code=201)
def create_version(
    resume_id: int, payload: VersionCreateRequest, db: Session = Depends(get_db)
) -> VersionOut:
    """给当前简历拍一份命名版本（内容 + 排版 + 岗位快照，不可变）。"""
    record = _resume_or_404(db, resume_id)
    try:
        version = versions.create_version(
            db,
            record,
            name=payload.name,
            change_summary=payload.change_summary,
            parent_version_id=payload.parent_version_id,
        )
    except versions.VersionNotFound as exc:
        raise _version_not_found(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return VersionOut.model_validate(versions.version_brief(version))


@router.get("/{resume_id}/versions", response_model=VersionListOut)
def list_versions(resume_id: int, db: Session = Depends(get_db)) -> VersionListOut:
    record = _resume_or_404(db, resume_id)
    return VersionListOut(
        items=[
            VersionOut.model_validate(versions.version_brief(version))
            for version in versions.list_versions(db, record.id)
        ]
    )


@router.get("/{resume_id}/versions/{version_id}", response_model=VersionDetailOut)
def get_version(resume_id: int, version_id: int, db: Session = Depends(get_db)) -> VersionDetailOut:
    record = _resume_or_404(db, resume_id)
    try:
        version = versions.get_version(db, record.id, version_id)
    except versions.VersionNotFound as exc:
        raise _version_not_found(exc) from exc
    return VersionDetailOut.model_validate(versions.version_detail(version))


@router.post("/{resume_id}/versions/{version_id}/freeze", response_model=VersionOut)
def freeze_version(
    resume_id: int,
    version_id: int,
    payload: VersionFreezeRequest,
    db: Session = Depends(get_db),
) -> VersionOut:
    """冻结/解冻一个版本（冻结 = 已投递/已定稿；内容本来就不可变）。"""
    record = _resume_or_404(db, resume_id)
    try:
        version = versions.freeze_version(db, record.id, version_id, frozen=payload.frozen)
    except versions.VersionNotFound as exc:
        raise _version_not_found(exc) from exc
    return VersionOut.model_validate(versions.version_brief(version))


@router.get("/{resume_id}/versions/{base_id}/compare/{against}", response_model=VersionCompareOut)
def compare_versions(
    resume_id: int, base_id: int, against: str, db: Session = Depends(get_db)
) -> VersionCompareOut:
    """比较两个版本；against 可传版本 id 或 "current"（当前简历）。"""
    record = _resume_or_404(db, resume_id)
    try:
        data = versions.compare_versions(db, record, base_id, against)
    except versions.VersionNotFound as exc:
        raise _version_not_found(exc) from exc
    return VersionCompareOut.model_validate(data)


@router.post("/{resume_id}/versions/{version_id}/restore", response_model=VersionRestoreOut)
def restore_version(
    resume_id: int,
    version_id: int,
    payload: VersionRestoreRequest,
    db: Session = Depends(get_db),
):
    """恢复历史版本：产生**新的当前版本**（revision+1），历史版本与交付冻结记录不变。"""
    record = _resume_or_404(db, resume_id)
    try:
        saved, new_version = versions.restore_version(
            db, record, version_id, expected_revision=payload.expected_revision
        )
    except RevisionConflict as exc:
        return revision_conflict_response(exc.current_revision)
    except versions.VersionNotFound as exc:
        raise _version_not_found(exc) from exc
    return VersionRestoreOut(
        version=VersionOut.model_validate(versions.version_brief(new_version)),
        resume=_to_resume_out(saved),
        revision=int(saved.revision or 0),
    )


@router.post("/{resume_id}/variants", response_model=VariantOut, status_code=201)
def create_variant(
    resume_id: int, payload: VariantCreateRequest, db: Session = Depends(get_db)
) -> VariantOut:
    """派生岗位变体（独立内容/排版；之后与当前简历互不影响）。"""
    record = _resume_or_404(db, resume_id)
    try:
        variant = variants.create_variant(
            db,
            record,
            name=payload.name,
            job_id=payload.job_id,
            base_version_id=payload.base_version_id,
        )
        if payload.language or payload.variant_group_id is not None:
            variant = bilingual_variants.patch_variant(
                db,
                variant,
                language=payload.language,
                variant_group_id=payload.variant_group_id,
            )
    except versions.VersionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return VariantOut.model_validate(variants.variant_brief(variant))


@router.post("/{resume_id}/variants/sync", response_model=VariantSyncOut)
def sync_variants(
    resume_id: int, payload: VariantSyncRequest, db: Session = Depends(get_db)
) -> VariantSyncOut:
    """选择性同步：只改列出的变体 + 列出的路径，保留其余岗位定制。"""
    record = _resume_or_404(db, resume_id)
    try:
        items = variants.sync_variants(
            db,
            record,
            source_version_id=payload.source_version_id,
            variant_ids=payload.variant_ids,
            paths=payload.paths,
        )
    except versions.VersionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return VariantSyncOut.model_validate(
        {"source_version_id": payload.source_version_id, "items": items}
    )


@router.get("/{resume_id}/variants", response_model=VariantListOut)
def list_variants(resume_id: int, db: Session = Depends(get_db)) -> VariantListOut:
    record = _resume_or_404(db, resume_id)
    return VariantListOut(
        items=[
            VariantOut.model_validate(variants.variant_brief(variant))
            for variant in variants.list_variants(db, record.id)
        ]
    )


@router.get("/{resume_id}/variants/{variant_id}", response_model=VariantDetailOut)
def get_variant(resume_id: int, variant_id: int, db: Session = Depends(get_db)) -> VariantDetailOut:
    record = _resume_or_404(db, resume_id)
    try:
        variant = variants.get_variant(db, record.id, variant_id)
    except versions.VersionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return VariantDetailOut.model_validate(variants.variant_detail(variant))


@router.patch("/{resume_id}/variants/{variant_id}", response_model=VariantDetailOut)
def patch_variant(
    resume_id: int,
    variant_id: int,
    payload: VariantPatchRequest,
    db: Session = Depends(get_db),
) -> VariantDetailOut:
    """改变体名称/语言标签/分组（内容与排版各自独立，不改当前简历）。"""
    record = _resume_or_404(db, resume_id)
    try:
        variant = variants.get_variant(db, record.id, variant_id)
        variant = bilingual_variants.patch_variant(
            db,
            variant,
            name=payload.name,
            language=payload.language,
            variant_group_id=payload.variant_group_id,
        )
    except versions.VersionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return VariantDetailOut.model_validate(variants.variant_detail(variant))


@router.post("/{resume_id}/variants/{variant_id}/translate", response_model=TranslateVariantOut)
async def translate_variant(
    resume_id: int,
    variant_id: int,
    payload: TranslateVariantRequest,
    db: Session = Depends(get_db),
) -> TranslateVariantOut:
    """生成翻译候选（不写库）：逐字段翻译 + 术语锁定 + 事实锁校验。"""
    from app.api import resumes as _api

    record = _resume_or_404(db, resume_id)
    try:
        variant = variants.get_variant(db, record.id, variant_id)
    except versions.VersionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    config = _api.get_llm_config(db)
    if not config.base_url or not config.model:
        raise HTTPException(status_code=400, detail="尚未配置大模型 API")
    provider = _api.create_provider(config)
    try:
        data = await bilingual_variants.build_translation_candidate(
            db, provider, variant, target_language=payload.target_language
        )
    except bilingual_variants.BilingualError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"翻译失败：{exc}") from exc
    return TranslateVariantOut.model_validate(data)


@router.post("/{resume_id}/variants/{variant_id}/adopt", response_model=AdoptTranslationOut)
def adopt_translation(
    resume_id: int,
    variant_id: int,
    payload: AdoptTranslationRequest,
    db: Session = Depends(get_db),
) -> AdoptTranslationOut:
    """逐项采纳翻译到该变体（不覆盖当前简历/岗位定制）；任一项失败整批不落库。"""
    record = _resume_or_404(db, resume_id)
    try:
        variant = variants.get_variant(db, record.id, variant_id)
        variant, applied = bilingual_variants.adopt_translation(
            db, variant, [item.model_dump() for item in payload.items]
        )
    except versions.VersionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except fact_locks.FactLockError as exc:
        return fact_locks.fact_lock_conflict_response(exc.violations)
    except bilingual_variants.BilingualError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return AdoptTranslationOut(
        variant=VariantDetailOut.model_validate(variants.variant_detail(variant)),
        applied_paths=applied,
        content_sha256=variant.content_sha256 or "",
    )
