# SPDX-License-Identifier: Apache-2.0
"""W16 数据集级术语表接口。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.glossary import (
    GlossaryImportOut,
    GlossaryImportRequest,
    GlossaryListOut,
    GlossaryTermIn,
    GlossaryTermOut,
    GlossaryTermUpdate,
)
from ..services.resume import resume_glossary

router = APIRouter(prefix="/api/glossary-terms", tags=["glossary"])


def _term_or_404(db: Session, term_id: int):
    term = resume_glossary.get_term(db, term_id)
    if term is None:
        raise HTTPException(status_code=404, detail="术语不存在")
    return term


@router.get("", response_model=GlossaryListOut)
def list_terms(
    language_to: str | None = Query(default=None, max_length=16),
    category: str | None = Query(default=None, max_length=16),
    keyword: str | None = Query(default=None, max_length=128),
    db: Session = Depends(get_db),
) -> GlossaryListOut:
    rows = resume_glossary.list_terms(
        db, language_to=language_to, category=category, keyword=keyword
    )
    return GlossaryListOut(
        items=[GlossaryTermOut.model_validate(resume_glossary.term_brief(row)) for row in rows]
    )


@router.post("", response_model=GlossaryTermOut, status_code=201)
def create_term(payload: GlossaryTermIn, db: Session = Depends(get_db)) -> GlossaryTermOut:
    try:
        term = resume_glossary.create_term(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GlossaryTermOut.model_validate(resume_glossary.term_brief(term))


@router.post("/import", response_model=GlossaryImportOut)
def import_terms(
    payload: GlossaryImportRequest, db: Session = Depends(get_db)
) -> GlossaryImportOut:
    try:
        result = resume_glossary.import_terms(db, [item.model_dump() for item in payload.items])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return GlossaryImportOut.model_validate(result)


@router.patch("/{term_id}", response_model=GlossaryTermOut)
def update_term(
    term_id: int, payload: GlossaryTermUpdate, db: Session = Depends(get_db)
) -> GlossaryTermOut:
    term = _term_or_404(db, term_id)
    try:
        term = resume_glossary.update_term(db, term, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GlossaryTermOut.model_validate(resume_glossary.term_brief(term))


@router.delete("/{term_id}", status_code=204)
def delete_term(term_id: int, db: Session = Depends(get_db)) -> Response:
    term = _term_or_404(db, term_id)
    resume_glossary.delete_term(db, term)
    db.commit()
    return Response(status_code=204)
