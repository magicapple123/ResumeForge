# SPDX-License-Identifier: Apache-2.0
"""W17 私有表达资产接口（前端消费方 fe-content）。

全部本地操作：不调用模型、不自动外发；正文不写日志。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.resume_assets import (
    PhraseCollectRequest,
    PhraseIn,
    PhraseInsertOut,
    PhraseInsertRequest,
    PhraseListOut,
    PhraseOut,
    PhraseUpdate,
    PhraseUpdateOut,
)
from ..services import trash
from ..services.resume import resume_assets
from ..services.resume.document_save import RevisionConflict, revision_conflict_response
from .resumes._shared import _to_resume_out

router = APIRouter(prefix="/api/resume-phrases", tags=["resume-phrases"])


def _phrase_or_404(db: Session, phrase_id: int):
    phrase = resume_assets.get_phrase(db, phrase_id)
    if phrase is None:
        raise HTTPException(status_code=404, detail="表达资产不存在")
    return phrase


@router.get("", response_model=PhraseListOut)
def list_phrases(
    kind: str | None = Query(default=None, max_length=16),
    language: str | None = Query(default=None, max_length=16),
    tag: str | None = Query(default=None, max_length=32),
    keyword: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> PhraseListOut:
    rows, next_cursor = resume_assets.list_phrases(
        db,
        kind=kind,
        language=language,
        tag=tag,
        keyword=keyword,
        limit=limit,
        cursor=cursor,
    )
    return PhraseListOut(
        items=[PhraseOut.model_validate(resume_assets.phrase_brief(row)) for row in rows],
        next_cursor=next_cursor,
    )


@router.post("", response_model=PhraseOut, status_code=201)
def create_phrase(payload: PhraseIn, db: Session = Depends(get_db)) -> PhraseOut:
    try:
        phrase = resume_assets.create_phrase(db, **payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PhraseOut.model_validate(resume_assets.phrase_brief(phrase))


@router.post("/collect", response_model=PhraseOut, status_code=201)
def collect_phrase(payload: PhraseCollectRequest, db: Session = Depends(get_db)) -> PhraseOut:
    """从简历选中一句收藏成资产；path 解析不到就 422（不猜）。"""
    try:
        phrase = resume_assets.collect_phrase(
            db,
            resume_id=payload.resume_id,
            path=payload.path,
            job_tags=payload.job_tags,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return PhraseOut.model_validate(resume_assets.phrase_brief(phrase))


@router.patch("/{phrase_id}", response_model=PhraseUpdateOut)
def update_phrase(
    phrase_id: int, payload: PhraseUpdate, db: Session = Depends(get_db)
) -> PhraseUpdateOut:
    """更新资产；响应带**更新前快照**（previous），供「更新先看差异」本地对比。"""
    phrase = _phrase_or_404(db, phrase_id)
    previous = PhraseOut.model_validate(resume_assets.phrase_brief(phrase))
    try:
        phrase = resume_assets.update_phrase(db, phrase, **payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PhraseUpdateOut(
        **resume_assets.phrase_brief(phrase),
        previous=previous,
    )


@router.delete("/{phrase_id}", status_code=204)
def delete_phrase(phrase_id: int, db: Session = Depends(get_db)) -> Response:
    """软删进回收站（第 17 类）；彻底删除走既有的回收站 purge 接口。"""
    phrase = _phrase_or_404(db, phrase_id)
    # trash.soft_delete 只设置 deleted_at，不 commit（事务边界由调用方决定）。
    trash.soft_delete(db, "phrase", phrase)
    db.commit()
    return Response(status_code=204)


@router.post("/{phrase_id}/insert", response_model=PhraseInsertOut)
def insert_phrase(phrase_id: int, payload: PhraseInsertRequest, db: Session = Depends(get_db)):
    """把资产插入简历：新 object_id/point_id + 条件写；usage_count 只在成功后 +1。"""
    phrase = _phrase_or_404(db, phrase_id)
    try:
        saved, object_id, point_id = resume_assets.insert_phrase(
            db,
            phrase,
            resume_id=payload.resume_id,
            section=payload.section,
            entry_id=payload.entry_id,
            point_index=payload.point_index,
            expected_revision=payload.expected_revision,
        )
    except RevisionConflict as exc:
        return revision_conflict_response(exc.current_revision)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PhraseInsertOut(
        resume=_to_resume_out(saved),
        phrase=PhraseOut.model_validate(resume_assets.phrase_brief(phrase)),
        inserted_object_id=object_id,
        inserted_point_id=point_id,
    )
