"""简历 CRUD 端点（域⑤）：手写保存、列表、读取、正文修改、重命名、备注、收藏与软删除。

从原 ``api/resumes.py`` 原样搬运（纯切片，无 patch 读取点）；`_to_resume_out` 改从
``_shared`` 导入。
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import cast, or_, String
from sqlalchemy.orm import Session

from ...database import get_db
from ...models.job import Job
from ...models.resume import ResumeRecord
from ...schemas.common import Page
from ...schemas.resume import (
    ManualResumeRequest,
    ResumeBrief,
    ResumeContent,
    ResumeFavoriteUpdate,
    ResumeNoteUpdate,
    ResumeOut,
    ResumeTitleUpdate,
)
from ...services import trash
from ...services.resume.resume_record import build_manual_title
from ._shared import _to_resume_out

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/manual", response_model=ResumeOut, status_code=201)
def create_manual_resume(payload: ManualResumeRequest, db: Session = Depends(get_db)):
    """保存用户自行编写的简历，并可选关联岗位。"""
    job = db.get(Job, payload.job_id) if payload.job_id is not None else None
    if payload.job_id is not None and (job is None or trash.is_deleted(job)):
        raise HTTPException(status_code=404, detail="关联岗位不存在或已被删除")

    content = payload.content.model_dump()
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
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    logger.info("用户手写简历已保存 record_id=%s job=%s", record.id, record.job_title)
    return _to_resume_out(record)


@router.get("", response_model=Page[ResumeBrief])
def list_resumes(
    db: Session = Depends(get_db),
    keyword: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    job_id: int | None = Query(default=None, ge=1),
    favorite: bool | None = Query(default=None),
    has_job: bool | None = Query(default=None),
):
    """列出简历。``has_job=false`` 只返回通用简历（未关联任何岗位）。"""
    query = db.query(ResumeRecord).filter(trash.live_only(ResumeRecord))
    if job_id is not None:
        query = query.filter(ResumeRecord.job_id == job_id)
    if has_job is not None:
        query = query.filter(
            ResumeRecord.job_id.is_not(None) if has_job else ResumeRecord.job_id.is_(None)
        )
    if favorite is not None:
        query = query.filter(ResumeRecord.favorite == favorite)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(
            or_(
                ResumeRecord.title.like(like),
                ResumeRecord.job_title.like(like),
                ResumeRecord.company.like(like),
                cast(ResumeRecord.content, String).like(like),
            )
        )
    total = query.count()
    records = query.order_by(ResumeRecord.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return Page(items=[ResumeBrief.model_validate(r) for r in records], total=total)


@router.get("/{resume_id}", response_model=ResumeOut)
def get_resume(resume_id: int, db: Session = Depends(get_db)):
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    return _to_resume_out(record)


@router.put("/{resume_id}", response_model=ResumeOut)
def update_resume(resume_id: int, payload: ResumeContent, db: Session = Depends(get_db)):
    """保存用户对生成简历的手工修改。"""
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")

    record.content = payload.model_dump()
    # AI 生成阶段的告警不再适用于用户已手工确认过的内容。
    record.warnings = []
    record.parse_error = ""
    db.commit()
    db.refresh(record)
    return _to_resume_out(record)


@router.patch("/{resume_id}", response_model=ResumeOut)
def rename_resume(
    resume_id: int,
    payload: ResumeTitleUpdate,
    db: Session = Depends(get_db),
):
    """只更新简历名称；正文与生成告警都不受影响。"""
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    record.title = payload.title
    db.commit()
    db.refresh(record)
    return _to_resume_out(record)


@router.patch("/{resume_id}/note", response_model=ResumeOut)
def update_resume_note(
    resume_id: int,
    payload: ResumeNoteUpdate,
    db: Session = Depends(get_db),
):
    """只更新简历备注（列表默认可见、详情可编辑）。"""
    record = trash.get_live(db, ResumeRecord, resume_id)
    if record is None:
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    record.note = payload.note
    db.commit()
    db.refresh(record)
    return _to_resume_out(record)


@router.patch("/{resume_id}/favorite", response_model=ResumeOut)
def update_resume_favorite(
    resume_id: int,
    payload: ResumeFavoriteUpdate,
    db: Session = Depends(get_db),
):
    """切换简历收藏状态，不修改简历正文。"""
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    record.favorite = payload.favorite
    db.commit()
    db.refresh(record)
    return _to_resume_out(record)


@router.delete("/{resume_id}", status_code=204)
def delete_resume(resume_id: int, db: Session = Depends(get_db)):
    """移入回收站（软删除）。

    简历记录里有生成正文、版式覆盖与警告信息，是用户花了模型调用换来的；误删的代价远大于
    多留一行。彻底删除在「回收站」里单独提供（不可恢复，需二次确认）。
    """
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    trash.soft_delete(db, "resume", record)
    db.commit()
