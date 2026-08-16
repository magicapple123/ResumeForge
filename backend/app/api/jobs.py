"""岗位接口：列表/新增/编辑/删除、抓取、抓取源元信息。"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.job import Job
from ..schemas.common import Page
from ..schemas.job import JobCreate, JobOut, JobUpdate, ScrapeRequest, ScrapeResult, SourceInfo
from ..services.jd_parser import parse_jd
from ..services.scrapers import get_source, list_sources

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _to_out(job: Job) -> JobOut:
    return JobOut.model_validate(job)


@router.get("", response_model=Page[JobOut])
def list_jobs(
    db: Session = Depends(get_db),
    keyword: str = Query(default="", description="按标题/公司/城市/描述模糊匹配"),
    source: str = Query(default=""),
    job_type: str = Query(default=""),
    status: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    query = db.query(Job)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(
            or_(Job.title.like(like), Job.company.like(like), Job.location.like(like), Job.description.like(like))
        )
    if source:
        query = query.filter(Job.source == source)
    if job_type:
        query = query.filter(Job.job_type == job_type)
    if status:
        query = query.filter(Job.status == status)
    total = query.count()
    jobs = query.order_by(Job.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return Page(items=[_to_out(job) for job in jobs], total=total)


@router.post("", response_model=JobOut, status_code=201)
def create_job(payload: JobCreate, db: Session = Depends(get_db)):
    job = Job(**payload.model_dump())
    # 入库时解析一次技能标签，列表页/详情页直接读取
    job.keywords = [tag.model_dump() for tag in parse_jd(f"{job.description}\n{job.requirements}")["skills"]]
    db.add(job)
    db.commit()
    db.refresh(job)
    return _to_out(job)


@router.get("/meta/sources", response_model=list[SourceInfo])
def job_sources():
    """已注册的抓取源列表（供前端下拉选择）。"""
    return [
        SourceInfo(name=s.name, display_name=s.display_name, description=s.description)
        for s in list_sources()
    ]


@router.post("/scrape", response_model=ScrapeResult)
def scrape_jobs(payload: ScrapeRequest, db: Session = Depends(get_db)):
    source = get_source(payload.source)
    if source is None:
        raise HTTPException(status_code=400, detail=f"未知的抓取源：{payload.source}")
    try:
        fetched = source.fetch(keyword=payload.keyword, limit=payload.limit)
    except Exception as exc:  # noqa: BLE001 - 外部网络调用必须兜底，转为友好提示
        logger.exception("抓取源 %s 抓取失败", source.name)
        raise HTTPException(status_code=502, detail=f"抓取失败：{exc}") from exc

    created, skipped = [], 0
    for item in fetched:
        exists = (
            db.query(Job)
            .filter(Job.title == item.title, Job.company == item.company, Job.source == source.name)
            .first()
        )
        if exists:
            skipped += 1
            continue
        job = Job(
            **item.model_dump(),
            source=source.name,
            keywords=[tag.model_dump() for tag in parse_jd(f"{item.description}\n{item.requirements}")["skills"]],
        )
        db.add(job)
        created.append(job)
    db.commit()
    for job in created:
        db.refresh(job)
    return ScrapeResult(created=len(created), skipped=skipped, jobs=[_to_out(job) for job in created])


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")
    return _to_out(job)


@router.put("/{job_id}", response_model=JobOut)
def update_job(job_id: int, payload: JobUpdate, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(job, field, value)
    # JD 内容变化时重新解析技能标签
    if "description" in data or "requirements" in data:
        job.keywords = [tag.model_dump() for tag in parse_jd(f"{job.description}\n{job.requirements}")["skills"]]
    db.commit()
    db.refresh(job)
    return _to_out(job)


@router.delete("/{job_id}", status_code=204)
def delete_job(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")
    db.delete(job)
    db.commit()
