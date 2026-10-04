"""简历接口子模块共享件：PDF 响应头常量与三个跨域 helper。

从原 ``api/resumes.py`` 原样搬运（Wave5 拆分）：常量与 helper 的实现逻辑零改动，
仅随文件移动改变导入路径。
"""
import json

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models.resume import ResumeRecord
from ..schemas.resume import ResumeContent, ResumeOut
from ..services import trash
from ..services.resume.resume_templates import DEFAULT_FONT_SCALE, DEFAULT_TEMPLATE

# 服务端 PDF 的实际页数与用户选定的上限。前端靠它们提示"下载下来的页数和你选的不一样"，
# 因此这两个响应头必须出现在 CORS 的 expose_headers 里（见 application.py）。
PDF_PAGES_HEADER = "X-Resume-Pages"
PDF_PAGE_LIMIT_HEADER = "X-Resume-Page-Limit"


def _format_sse(payload: dict) -> str:
    """把事件转成 SSE 数据帧。"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _to_resume_out(record: ResumeRecord) -> ResumeOut:
    return ResumeOut(
        id=record.id,
        title=record.title,
        job_id=record.job_id,
        job_title=record.job_title,
        company=record.company,
        source=record.source or "ai",
        favorite=record.favorite,
        model=record.model,
        enhancement_enabled=record.enhancement_enabled,
        enhancement_level=record.enhancement_level,
        note=record.note or "",
        template=record.template or DEFAULT_TEMPLATE,
        format_name=record.format_name or "",
        # 这个字段漏了不会报错，只会让保存成功却读不回来——界面上表现为"按了没反应"。
        format_config=record.format_config or {},
        page_limit=record.page_limit or 1,
        font_scale=record.font_scale or DEFAULT_FONT_SCALE,
        created_at=record.created_at,
        content=ResumeContent.model_validate(record.content),
        warnings=record.warnings or [],
        parse_error=record.parse_error,
        rationale=record.rationale or "",
        coverage_notes=record.coverage_notes or [],
    )


def _get_live_resume(db: Session, resume_id: int) -> ResumeRecord:
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    return record
