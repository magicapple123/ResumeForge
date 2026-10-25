# SPDX-License-Identifier: Apache-2.0
"""W12 来源/事实锁接口（后端契约；前端消费方是后续批次的 fe-content）。

路径全部走独立前缀 /api/provenance：不塞进 /api/resumes 的参数段下面，避免与
GET /api/resumes/{resume_id} 的整数路径参数互相抢路由，也不动既有路由的 include 顺序。

错误语义：
- 404：简历/来源/关联/事实锁不存在；
- 400：目标块在当前正文里解析不到、或来源类型/引用不合法；
- 409 + code=fact_lock_conflict：AI 落库路径被事实锁拒绝（含 violations 明细）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.provenance import ResumeBlockSource
from ..models.resume import ResumeRecord
from ..schemas.provenance import (
    BlockLinkOut,
    FactLockCreateRequest,
    FactLockListOut,
    FactLockOut,
    LinkAdoptOut,
    LinkAdoptRequest,
    LinkCreateRequest,
    LinkFromSourceRequest,
    ManualSourceCreateRequest,
    ManualSourceOut,
    ResumeProvenanceOut,
    SourceChainOut,
    SourceImpactOut,
    SourceListOut,
    SourceOut,
    SourceRevisionItemOut,
    SourceRevisionsOut,
    SourceRevisionTextOut,
)
from ..services import trash
from ..services.resume import document_provenance as write_side
from ..services.resume import document_provenance_adopt as adopt_side
from ..services.resume import document_provenance_source_text as source_text_side
from ..services.resume import document_provenance_view as view_side
from ..services.resume import fact_locks
from ..services.resume.document_save import RevisionConflict, revision_conflict_response

router = APIRouter(prefix="/api/provenance", tags=["provenance"])


def _resume_or_404(db: Session, resume_id: int) -> ResumeRecord:
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    return record


def _link_out(link, source) -> BlockLinkOut:
    return BlockLinkOut(
        link_id=link.id,
        source_id=link.source_id,
        object_id=link.object_id,
        point_id=link.point_id,
        path=link.path,
        field=link.field,
        source_fingerprint=link.source_fingerprint,
        status=write_side.link_status(source, link),
    )


@router.get("/resumes/{resume_id}", response_model=ResumeProvenanceOut)
def read_provenance(resume_id: int, db: Session = Depends(get_db)) -> ResumeProvenanceOut:
    """一份简历的来源视图；objects 里 link=None 表示未关联（不猜）。"""
    record = _resume_or_404(db, resume_id)
    return ResumeProvenanceOut.model_validate(view_side.provenance_view(db, record))


@router.post("/resumes/{resume_id}/links", response_model=BlockLinkOut, status_code=201)
def create_link(
    resume_id: int, payload: LinkCreateRequest, db: Session = Depends(get_db)
) -> BlockLinkOut:
    """用户显式建立"这个块来自这条资料"的持久关联（重复调用刷新关联指纹）。"""
    record = _resume_or_404(db, resume_id)
    try:
        snapshot = write_side.upsert_source(
            db,
            kind=payload.source.kind,
            external_ref=payload.source.external_ref,
            title=payload.source.title,
            payload=payload.source.payload,
            metadata=payload.source.metadata,
        )
        link = write_side.create_link(
            db,
            record=record,
            snapshot=snapshot,
            object_id=payload.object_id,
            point_id=payload.point_id,
            path=payload.path,
            field=payload.field,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _link_out(link, snapshot.source)


@router.delete("/resumes/{resume_id}/links/{link_id}", status_code=204)
def delete_link(resume_id: int, link_id: int, db: Session = Depends(get_db)) -> Response:
    """解除关联（用户选择"保持原稿、不采纳来源更新"时调用）。"""
    record = _resume_or_404(db, resume_id)
    if not write_side.delete_link(db, resume_id=record.id, link_id=link_id):
        raise HTTPException(status_code=404, detail="来源关联不存在")
    return Response(status_code=204)


@router.get("/resumes/{resume_id}/chain", response_model=SourceChainOut)
def read_chain(
    resume_id: int,
    object_id: str | None = Query(default=None, max_length=32),
    point_id: str | None = Query(default=None, max_length=32),
    path: str | None = Query(default=None, max_length=256),
    db: Session = Depends(get_db),
) -> SourceChainOut:
    """某个块的来源链：关联来源 + 每条来源的修订历史。"""
    record = _resume_or_404(db, resume_id)
    if object_id is None and not path:
        raise HTTPException(status_code=400, detail="需要 object_id 或 path 指定块")
    return SourceChainOut.model_validate(
        view_side.source_chain(db, record, object_id=object_id, point_id=point_id, path=path)
    )


@router.get("/sources/{source_id}", response_model=SourceOut)
def read_source(source_id: int, db: Session = Depends(get_db)) -> SourceOut:
    data = view_side.source_detail(db, source_id)
    if data is None:
        raise HTTPException(status_code=404, detail="来源不存在")
    return SourceOut.model_validate(data)


@router.get("/sources/{source_id}/impact", response_model=SourceImpactOut)
def read_impact(source_id: int, db: Session = Depends(get_db)) -> SourceImpactOut:
    """来源变了之后：哪些简历的哪些块可能受影响（stale 标记等用户逐条采纳）。"""
    data = view_side.source_impact(db, source_id)
    if data is None:
        raise HTTPException(status_code=404, detail="来源不存在")
    return SourceImpactOut.model_validate(data)


@router.get("/resumes/{resume_id}/fact-locks", response_model=FactLockListOut)
def list_fact_locks(resume_id: int, db: Session = Depends(get_db)) -> FactLockListOut:
    record = _resume_or_404(db, resume_id)
    locks = fact_locks.list_fact_locks(db, record.id)
    return FactLockListOut(
        resume_id=record.id,
        revision=int(record.revision or 0),
        locks=[
            FactLockOut(
                id=lock.id,
                resume_id=lock.resume_id,
                kind=lock.lock_kind,
                object_id=lock.object_id,
                point_id=lock.point_id,
                path=lock.path,
                field=lock.field,
                locked_value=lock.locked_value,
                label=lock.label,
                created_at=lock.created_at,
            )
            for lock in locks
        ],
    )


@router.post("/resumes/{resume_id}/fact-locks", response_model=FactLockOut, status_code=201)
def create_fact_lock(
    resume_id: int, payload: FactLockCreateRequest, db: Session = Depends(get_db)
) -> FactLockOut:
    """锁住当前位置的值；AI 改写/翻译/插入/优化器随后都必须遵守它。"""
    record = _resume_or_404(db, resume_id)
    try:
        lock = fact_locks.create_fact_lock(
            db,
            record,
            kind=payload.kind,
            object_id=payload.object_id,
            point_id=payload.point_id,
            path=payload.path,
            label=payload.label,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FactLockOut(
        id=lock.id,
        resume_id=lock.resume_id,
        kind=lock.lock_kind,
        object_id=lock.object_id,
        point_id=lock.point_id,
        path=lock.path,
        field=lock.field,
        locked_value=lock.locked_value,
        label=lock.label,
        created_at=lock.created_at,
    )


@router.delete("/resumes/{resume_id}/fact-locks/{lock_id}", status_code=204)
def delete_fact_lock(resume_id: int, lock_id: int, db: Session = Depends(get_db)) -> Response:
    record = _resume_or_404(db, resume_id)
    if not fact_locks.delete_fact_lock(db, resume_id=record.id, lock_id=lock_id):
        raise HTTPException(status_code=404, detail="事实锁不存在")
    return Response(status_code=204)


# ===== W12 可达性补充：已有来源的列表 / 手工登记 / 修订 / 关联 / 采纳 =====


@router.get("/sources", response_model=SourceListOut)
def list_sources(
    kind: str | None = Query(default=None, max_length=16),
    keyword: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=view_side.DEFAULT_SOURCE_LIST_LIMIT, ge=1, le=200),
    db: Session = Depends(get_db),
) -> SourceListOut:
    """可挑选的来源清单（建立来源关联时用）：只有展示元信息，不含任何正文。"""
    return SourceListOut.model_validate(
        view_side.list_sources(db, kind=kind, keyword=keyword, limit=limit)
    )


@router.post("/sources", response_model=ManualSourceOut, status_code=201)
def create_manual_source(
    payload: ManualSourceCreateRequest, db: Session = Depends(get_db)
) -> ManualSourceOut:
    """手工登记一条外部资料（没有稳定业务行可复用，每次新建一条来源）。"""
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="来源标题不能为空")
    snapshot = write_side.upsert_source(
        db,
        kind=payload.kind,
        external_ref=None,
        title=title,
        payload={"title": title},
        metadata={},
    )
    return ManualSourceOut(
        id=snapshot.source.id,
        kind=snapshot.source.kind,
        title=snapshot.source.title,
        revision=SourceRevisionItemOut(
            id=snapshot.revision.id,
            revision_no=snapshot.revision.revision_no,
            summary=snapshot.revision.summary,
            captured_at=snapshot.revision.captured_at,
        ),
    )


@router.get("/sources/{source_id}/revisions", response_model=SourceRevisionsOut)
def read_source_revisions(source_id: int, db: Session = Depends(get_db)) -> SourceRevisionsOut:
    """一条来源的修订列表（界面显示「来源第 N 版」，不返回正文）。"""
    data = view_side.source_revisions(db, source_id)
    if data is None:
        raise HTTPException(status_code=404, detail="来源不存在")
    return SourceRevisionsOut.model_validate(data)


@router.get("/sources/{source_id}/revision-text", response_model=SourceRevisionTextOut)
def read_source_revision_text(
    source_id: int,
    revision_no: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> SourceRevisionTextOut:
    """按 external_ref 现场解析来源原文（只读、不落库、不写日志）。

    采纳前前端用它预填文本：``resolvable=true`` 时 text 是业务表当前正文、fingerprint 是
    所选修订的真实指纹；``fingerprint_matched=false`` 说明正文与建立关联时的 payload 表示
    不一致（例如台账用"原始事实"建的关系、这里回退到"简历表述"），界面应提示核对。
    历史修订的正文无法回溯，返回 ``historical_revision_not_stored`` 而不是现正文伪装。
    """
    source = write_side.get_source(db, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="来源不存在")
    revisions = source_text_side.list_revisions(db, source.id)
    if not revisions:
        return SourceRevisionTextOut(
            source_id=source.id,
            kind=source.kind,
            external_ref=source.external_ref,
            resolvable=False,
            reason=source_text_side.REASON_NO_REVISION,
        )
    if revision_no is None:
        revision = revisions[-1]
    else:
        revision = next((item for item in revisions if item.revision_no == revision_no), None)
        if revision is None:
            raise HTTPException(status_code=404, detail="来源修订不存在")
    is_latest = revision.id == revisions[-1].id
    if not is_latest:
        return SourceRevisionTextOut(
            source_id=source.id,
            kind=source.kind,
            external_ref=source.external_ref,
            revision_no=revision.revision_no,
            fingerprint=revision.fingerprint,
            resolvable=False,
            is_latest=False,
            reason=source_text_side.REASON_HISTORICAL,
        )
    lookup = source_text_side.resolve_source_texts(db, source)
    if not lookup.resolvable:
        # 不可解析时不给 revision_no（Lead 契约为 null）：这是"没有可对照的正文"，
        # 给出修订号只会让前端以为拿到了某一版。
        return SourceRevisionTextOut(
            source_id=source.id,
            kind=source.kind,
            external_ref=source.external_ref,
            revision_no=None,
            is_latest=True,
            resolvable=False,
            reason=lookup.reason or source_text_side.REASON_UNRESOLVABLE,
        )
    text, matched = source_text_side.pick_text_for_fingerprint(lookup, revision.fingerprint or "")
    return SourceRevisionTextOut(
        source_id=source.id,
        kind=source.kind,
        external_ref=source.external_ref,
        revision_no=revision.revision_no,
        text=text,
        fingerprint=revision.fingerprint,
        resolvable=True,
        fingerprint_matched=matched,
        is_latest=True,
    )



@router.post("/links", response_model=BlockLinkOut, status_code=201)
def link_existing_source(
    payload: LinkFromSourceRequest, db: Session = Depends(get_db)
) -> BlockLinkOut:
    """把**已有的**来源（可选某一版修订）关联到简历块；同一来源 + 同一块去重刷新。"""
    record = _resume_or_404(db, payload.resume_id)
    source = write_side.get_source(db, payload.source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="来源不存在")
    revision = None
    if payload.source_revision_id is not None:
        revision = write_side.get_revision(db, payload.source_revision_id)
        if revision is None or revision.source_id != source.id:
            raise HTTPException(status_code=404, detail="来源修订不存在或不属于这条来源")
    try:
        link = write_side.link_source(
            db,
            record=record,
            source=source,
            revision=revision,
            object_id=payload.object_id,
            point_id=payload.point_id,
            path=payload.path,
            field=payload.field,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _link_out(link, source)


@router.post("/links/{link_id}/adopt", response_model=LinkAdoptOut)
def adopt_source_update(
    link_id: int, payload: LinkAdoptRequest, db: Session = Depends(get_db)
):
    """来源更新 → 采纳写正文：锁闸门 + 条件写；冲突 409，被锁 409 violations。"""
    link = db.get(ResumeBlockSource, link_id)
    if link is None:
        raise HTTPException(status_code=404, detail="来源关联不存在")
    record = _resume_or_404(db, link.resume_id)
    try:
        result = adopt_side.adopt_source_text(
            db,
            record=record,
            link=link,
            text=payload.text,
            expected_revision=payload.expected_revision,
            source_revision_id=payload.source_revision_id,
            path=payload.path,
        )
    except adopt_side.SourceRevisionStale as exc:
        return JSONResponse(
            status_code=409,
            content={
                "detail": str(exc),
                "code": adopt_side.SOURCE_REVISION_STALE_CODE,
                "expected_fingerprint": exc.expected_fingerprint,
            },
        )
    except fact_locks.FactLockError as exc:
        return fact_locks.fact_lock_conflict_response(exc.violations)
    except RevisionConflict as exc:
        return revision_conflict_response(exc.current_revision)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    source = write_side.get_source(db, link.source_id)
    return LinkAdoptOut(
        resume_id=result["resume_id"],
        revision=result["revision"],
        content=result["content"],
        applied_path=result["applied_path"],
        source_revision_no=result["source_revision_no"],
        link=_link_out(link, source),
    )
