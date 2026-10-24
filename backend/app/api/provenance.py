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
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.resume import ResumeRecord
from ..schemas.provenance import (
    BlockLinkOut,
    FactLockCreateRequest,
    FactLockListOut,
    FactLockOut,
    LinkCreateRequest,
    ResumeProvenanceOut,
    SourceChainOut,
    SourceImpactOut,
    SourceOut,
)
from ..services import trash
from ..services.resume import document_provenance as write_side
from ..services.resume import document_provenance_view as view_side
from ..services.resume import fact_locks

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
