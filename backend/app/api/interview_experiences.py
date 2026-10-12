"""面经知识库接口（prefix ``/api/interview-experiences``）。

真实面经的增删改查：正文 + 真实问题清单 + 标签，可绑定岗位。删除走软删除
（``trash.live_only`` 列表里不再出现），彻底删除在回收站里另做。
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.interview_experience import EXPERIENCE_SOURCES, InterviewExperience
from ..schemas.common import Page
from ..schemas.interview_experience import (
    MAX_EXPERIENCE_EXCERPT_CHARS,
    InterviewExperienceBatchDeleteResult,
    InterviewExperienceBatchRequest,
    InterviewExperienceCreate,
    InterviewExperienceOut,
    InterviewExperienceSummary,
    InterviewExperienceUpdate,
)
from ..services import trash
from ..services.interview.interview_experience_service import (
    create_experience,
    delete_experience,
    experience_or_none,
    list_experiences,
    list_experiences_page,
    update_experience,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/interview-experiences", tags=["interview-experiences"])


@router.get("", response_model=list[InterviewExperienceOut])
def read_experiences(
    keyword: str = Query(default=""),
    company: str = Query(default=""),
    source: str = Query(default=""),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    return list_experiences(db, keyword=keyword, company=company, source=source, limit=limit)


@router.get("/sources", response_model=list[str])
def read_sources():
    """来源白名单：前端下拉与筛选共用后端唯一取值。"""
    return list(EXPERIENCE_SOURCES)


def _experience_summary(row) -> InterviewExperienceSummary:
    """列表行摘要：正文只带 200 字截断，问题清单折成计数（全文走详情端点）。"""
    return InterviewExperienceSummary(
        id=row.id,
        title=row.title,
        company=row.company,
        position=row.position,
        job_id=row.job_id,
        source=row.source,
        difficulty=row.difficulty,
        round_type=row.round_type,
        interview_date=row.interview_date,
        tags=list(row.tags or []),
        question_count=len(row.questions or []),
        content_excerpt=(row.content or "")[:MAX_EXPERIENCE_EXCERPT_CHARS],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/page", response_model=Page[InterviewExperienceSummary])
def read_experiences_page(
    keyword: str = Query(default=""),
    company: str = Query(default=""),
    source: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """分页列出面经（RF-08 续）：过滤与排序与旧端点同源，列表行不带正文全文。

    旧端点 ``GET /api/interview-experiences`` 每行都携带 10 万字符级的正文与最多
    200 条的问题清单，面经上百后 Listy 全渲染既拖响应也拖渲染；本端点按页取且行
    DTO 只带摘要。**声明在 ``/{experience_id}`` 之前**（字面量段排在参数段前面）。
    """
    rows, total = list_experiences_page(
        db, keyword=keyword, company=company, source=source, page=page, page_size=page_size
    )
    return Page(items=[_experience_summary(row) for row in rows], total=total)


@router.post("", response_model=InterviewExperienceOut, status_code=201)
def create_experience_entry(payload: InterviewExperienceCreate, db: Session = Depends(get_db)):
    return create_experience(db, payload)


@router.post("/batch-delete", response_model=InterviewExperienceBatchDeleteResult)
def batch_delete_experiences(
    payload: InterviewExperienceBatchRequest, db: Session = Depends(get_db)
):
    """批量移入回收站（软删除）：单次上限 500，与简历批量删除同一口径。

    语义对齐单条 ``DELETE /{experience_id}``：任何一条 id 不存在或已在回收站里
    即整体 404 并附缺失 id 清单，不做"删一半"。**声明在 ``/{experience_id}``
    之前**（字面量段排在参数段前面，同 ``/sources``）。
    """
    experiences: list[InterviewExperience] = []
    missing: list[int] = []
    for experience_id in payload.experience_ids:
        experience = trash.get_live(db, InterviewExperience, experience_id)
        if experience is None:
            missing.append(experience_id)
        else:
            experiences.append(experience)
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"以下面经不存在或已被删除：{'、'.join(map(str, missing))}",
        )
    for experience in experiences:
        trash.soft_delete(db, "interview_experience", experience)
    db.commit()
    return InterviewExperienceBatchDeleteResult(deleted=len(experiences))


@router.get("/{experience_id}", response_model=InterviewExperienceOut)
def read_experience(experience_id: int, db: Session = Depends(get_db)):
    experience = experience_or_none(db, experience_id)
    if experience is None:
        raise HTTPException(status_code=404, detail="面经不存在或已被删除")
    return experience


@router.put("/{experience_id}", response_model=InterviewExperienceOut)
def save_experience(
    experience_id: int, payload: InterviewExperienceUpdate, db: Session = Depends(get_db)
):
    experience = experience_or_none(db, experience_id)
    if experience is None:
        raise HTTPException(status_code=404, detail="面经不存在或已被删除")
    return update_experience(db, experience, payload)


@router.delete("/{experience_id}", status_code=204)
def remove_experience(experience_id: int, db: Session = Depends(get_db)):
    if not delete_experience(db, experience_id):
        raise HTTPException(status_code=404, detail="面经不存在或已被删除")
