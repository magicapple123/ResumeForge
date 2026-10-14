"""Discover immutable historical delivery evidence even after its source has been deleted."""

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, load_only

from ...database import get_db
from ...models.resume_delivery import ResumeDeliveryRecord
from ...schemas.common import Page
from ...schemas.resume import DeliverySummary
from ...services.search_matching import LIKE_ESCAPE, like_pattern

router = APIRouter()


@router.get("/deliveries", response_model=Page[DeliverySummary])
def list_delivery_archive(
    keyword: str = Query(default="", max_length=200),
    source: Literal["", "apply", "track", "export"] = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(ResumeDeliveryRecord)
    if source:
        query = query.filter(ResumeDeliveryRecord.source == source)
    if keyword:
        pattern = like_pattern(keyword)
        query = query.filter(
            or_(
                *(
                    column.like(pattern, escape=LIKE_ESCAPE)
                    for column in (
                        ResumeDeliveryRecord.resume_title,
                        ResumeDeliveryRecord.company,
                        ResumeDeliveryRecord.job_title,
                    )
                )
            )
        )
    total = query.count()
    fields = [getattr(ResumeDeliveryRecord, name) for name in DeliverySummary.model_fields]
    rows = (
        query.options(load_only(*fields))
        .order_by(ResumeDeliveryRecord.created_at.desc(), ResumeDeliveryRecord.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return Page(items=[DeliverySummary.model_validate(row) for row in rows], total=total)
