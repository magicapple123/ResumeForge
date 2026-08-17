"""简历接口：流式生成（SSE）、历史记录、预览渲染与导出。"""
import json
import logging
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import cast, or_, String
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.job import Job
from ..models.resume import ResumeRecord
from ..schemas.common import Page
from ..schemas.job import JobOut
from ..schemas.resume import (
    GenerateRequest,
    ResumeBrief,
    ResumeContent,
    ResumeOut,
    ResumeRenderRequest,
)
from ..services.exporter import build_filename, export_json, export_markdown, render_html
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.profile_service import get_profile_detail, to_profile_out
from ..services.resume_generator import ResumeGenerator
from ..services.settings_service import get_llm_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/resumes", tags=["resumes"])

# 支持的导出格式
_EXPORT_FORMATS = {"json": "application/json", "md": "text/markdown; charset=utf-8", "html": "text/html; charset=utf-8"}


def _format_sse(payload: dict) -> str:
    """把事件转成 SSE 数据帧。"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/generate")
async def generate_resume(payload: GenerateRequest, db: Session = Depends(get_db)):
    """流式生成简历（SSE）。

    事件类型见 services/resume_generator.py 文档；生成成功后自动落库，
    并追加一个 saved 事件携带记录 id。
    """
    job = db.get(Job, payload.job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")

    profile = get_profile_detail(db)
    if (
        not profile.name
        and not profile.projects
        and not profile.experiences
        and not profile.campus_experiences
    ):
        raise HTTPException(status_code=400, detail="请先在「我的资料」页完善个人信息")

    config = get_llm_config(db)
    if not config.base_url or not config.model:
        raise HTTPException(status_code=400, detail="请先在「设置」页配置大模型 API")

    generator = ResumeGenerator(create_provider(config))
    job_out = JobOut.model_validate(job)
    profile_out = to_profile_out(profile)

    async def event_stream():
        raw_parts: list[str] = []
        parsed: dict | None = None
        warnings: list[str] = []
        try:
            async for event in generator.generate(profile_out, job_out, payload.options):
                if event["type"] == "delta":
                    raw_parts.append(event["text"])
                if event["type"] == "done":
                    parsed = event["resume"]
                    warnings = event["warnings"]
                yield _format_sse(event)
            if parsed is not None:
                record = _save_record(
                    db, parsed, warnings, job_out, "".join(raw_parts), generator.provider.config.model, payload.options.tone
                )
                yield _format_sse({"type": "saved", "record_id": record.id})
        except LLMError as exc:
            logger.warning("简历生成失败（模型错误）：%s", exc)
            yield _format_sse({"type": "error", "message": str(exc)})
        except Exception:  # noqa: BLE001 - 流式接口必须兜底，异常转为事件而非中断连接
            logger.exception("简历生成发生内部错误")
            yield _format_sse({"type": "error", "message": "生成过程中发生内部错误，请查看后端日志"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _save_record(
    db: Session, content: dict, warnings: list[str], job: JobOut, raw: str, model: str, tone: str
) -> ResumeRecord:
    """生成结果落库（在流结束后的同一请求内调用）。"""
    name = content.get("name") or "简历"
    title = f"{name}-{job.title}-{datetime.now().strftime('%Y%m%d%H%M')}"
    record = ResumeRecord(
        title=title,
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        content=content,
        warnings=warnings,
        model=model,
        tone=tone,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    logger.info("简历生成完成 record_id=%s model=%s job=%s", record.id, model, job.title)
    return record


def _to_resume_out(record: ResumeRecord) -> ResumeOut:
    return ResumeOut(
        id=record.id,
        title=record.title,
        job_title=record.job_title,
        company=record.company,
        model=record.model,
        tone=record.tone,
        created_at=record.created_at,
        content=ResumeContent.model_validate(record.content),
        warnings=record.warnings or [],
        parse_error=record.parse_error,
    )


@router.get("", response_model=Page[ResumeBrief])
def list_resumes(
    db: Session = Depends(get_db),
    keyword: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    query = db.query(ResumeRecord)
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
    if record is None:
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    return _to_resume_out(record)


@router.put("/{resume_id}", response_model=ResumeOut)
def update_resume(resume_id: int, payload: ResumeContent, db: Session = Depends(get_db)):
    """保存用户对生成简历的手工修改。"""
    record = db.get(ResumeRecord, resume_id)
    if record is None:
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")

    record.content = payload.model_dump()
    # AI 生成阶段的告警不再适用于用户已手工确认过的内容。
    record.warnings = []
    record.parse_error = ""
    db.commit()
    db.refresh(record)
    return _to_resume_out(record)


@router.delete("/{resume_id}", status_code=204)
def delete_resume(resume_id: int, db: Session = Depends(get_db)):
    record = db.get(ResumeRecord, resume_id)
    if record is None:
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    db.delete(record)
    db.commit()


@router.post("/render")
def render_resume(payload: ResumeRenderRequest):
    """渲染为 HTML（生成完成后、未落库前的即时预览也走这里）。"""
    return Response(render_html(payload.content), media_type="text/html; charset=utf-8")


@router.get("/{resume_id}/export")
def export_resume(resume_id: int, format: str = Query(..., pattern="^(json|md|html)$"), db: Session = Depends(get_db)):
    record = db.get(ResumeRecord, resume_id)
    if record is None:
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    resume = ResumeContent.model_validate(record.content)
    if format == "json":
        content, media_type = export_json(resume), "application/json; charset=utf-8"
    elif format == "md":
        content, media_type = export_markdown(resume), "text/markdown; charset=utf-8"
    else:
        content, media_type = render_html(resume), "text/html; charset=utf-8"
    filename = build_filename(resume, format)
    return Response(
        content,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}"},
    )
