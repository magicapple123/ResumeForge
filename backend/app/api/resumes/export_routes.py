"""简历导出与脱敏端点（域⑧）：导出闸门 + 管线委托 + GET/POST 导出 + 脱敏预览。

从原 ``api/resumes.py`` 原样搬运（纯切片，无 patch 读取点）；`_get_live_resume` 与两个
PDF 响应头常量改从 ``_shared`` 导入。
"""
import logging
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ...database import get_db
from ...models.resume import ResumeRecord
from ...schemas.export import (
    ExportRequest as ExportRequestSchema,
)
from ...schemas.export import (
    RedactionOptions as RedactionOptionsSchema,
)
from ...schemas.resume import ResumeContent
from ...services.export_pipeline import (
    ExportRequest,
    RenderContext,
    build_export_delivery,
)
from ...services.export_save_location import save_artifact, validate_directory
from ...services.pdf_exporter import ResumePDFError
from ...services.privacy import RedactionOptions as PrivacyRedactionOptions
from ...services.privacy import redact
from ...services.resume.resume_completeness import find_incomplete, incomplete_detail
from ...services.resume.resume_delivery import freeze_delivery
from ...services.resume.resume_record import record_format_config
from ...services.resume.resume_template_store import (
    resolve_style_config,
    resolve_style_template,
)
from ...services.settings_service import get_export_save_location
from ...services.watermark import WatermarkError
from ._shared import PDF_PAGE_LIMIT_HEADER, PDF_PAGES_HEADER, _get_live_resume

logger = logging.getLogger(__name__)

router = APIRouter()


def _export_record(
    db: Session,
    record: ResumeRecord,
    request: ExportRequest,
    *,
    allow_incomplete: bool,
    record_delivery: bool = False,
) -> Response:
    """导出闸门 + 管线委托 + 响应头，是 GET / POST 两条导出路径的共用出口。

    ``record_delivery``（RF-17）：为真时把这次导出冻结成一份 ``source="export"``
    的投递快照（「正式投递存档」语义）。**默认不落**——预览导出零膨胀。
    """
    resume = ResumeContent.model_validate(record.content)
    # 导出闸门：正文里还留着【待补】之类的标记时拦下来。带占位符的简历投出去，
    # 用户往往直到面试被问起才发现——这道检查的价值全在"导出那一刻"。
    if not allow_incomplete:
        incomplete = find_incomplete(resume)
        if incomplete:
            raise HTTPException(status_code=409, detail=incomplete_detail(incomplete))
    # 样式模板解析一次，json/md 用不到也不多花一次查询；html/pdf/docx 复用同一份解析结果。
    export_template, export_html = resolve_style_template(db, record.template)
    context = RenderContext(
        template=export_template,
        template_html=export_html,
        style_config=resolve_style_config(db, record.template),
        page_limit=record.page_limit,
        font_scale=record.font_scale,
        format_config=record_format_config(db, record),
    )
    try:
        # 带交付标识的出口（RF-16）：内容指纹 + 渲染配置指纹与响应头同源。
        delivery = build_export_delivery(request, resume, context, source_resume_id=record.id)
        artifact = delivery.artifact
    except ResumePDFError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except WatermarkError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    headers: dict[str, str] = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(artifact.filename, safe='')}",
        # 交付指纹（RF-17）：用户可拿它核对"下载到的文件"与库里快照的一致性。
        "X-Content-Sha256": delivery.content_sha256,
        "X-Render-Config-Sha256": delivery.rendered_config_sha256,
    }
    # 服务端 PDF/Word 用的是自己那套排版，页数未必等于用户选的上限（内容多时会多出一页）。
    # 把实际页数带回去，让界面能提示，而不是让用户下载完才发现。
    if artifact.pages is not None:
        headers[PDF_PAGES_HEADER] = str(artifact.pages)
    if artifact.page_limit is not None:
        headers[PDF_PAGE_LIMIT_HEADER] = str(artifact.page_limit)
    # 「生成内容保存位置」：设置非空且目录合法时，把同一份产物再落盘一份。**best-effort**：
    # 写失败只记日志、不阻断下载——用户已经等了一次生成，不能因为本地磁盘的问题白等。
    saved_location = get_export_save_location(db)
    if saved_location and validate_directory(saved_location) is None:
        try:
            final_path = save_artifact(artifact.content, saved_location, artifact.filename)
        except OSError as exc:
            logger.warning("导出产物落盘到「%s」失败：%s", saved_location, exc)
        else:
            # 头的值做 URL 编码（路径里可能有中文/反斜杠等非 latin-1 字符），前端解码还原。
            headers["X-Saved-To"] = quote(final_path, safe="")
    if record_delivery:
        # 显式存档：哈希原样沿用 ExportDelivery 的产出，库里证据与响应头逐字一致。
        freeze_delivery(
            db,
            record=record,
            source="export",
            export_format=request.format,
            filename=artifact.filename,
            pages=artifact.pages,
            content_sha256=delivery.content_sha256,
            rendered_config_sha256=delivery.rendered_config_sha256,
        )
        db.commit()
    return Response(artifact.content, media_type=artifact.media_type, headers=headers)


@router.get("/{resume_id}/export")
def export_resume(
    resume_id: int,
    format: str = Query(..., pattern="^(json|md|html|pdf)$"),
    allow_incomplete: bool = Query(
        default=False,
        description="为真时允许导出仍含未完成标记的草稿；默认拦下并说明是哪几处",
    ),
    record_delivery: bool = Query(
        default=False,
        description="为真时把这次导出冻结成一份投递快照（正式投递存档）；默认不落库",
    ),
    db: Session = Depends(get_db),
):
    """兼容旧的 GET 导出：仍限四种格式，内部委托管线。全参数导出走 ``POST``。"""
    record = _get_live_resume(db, resume_id)
    return _export_record(
        db,
        record,
        ExportRequest(format=format),
        allow_incomplete=allow_incomplete,
        record_delivery=record_delivery,
    )


@router.post("/{resume_id}/export")
def export_resume_with_options(
    resume_id: int,
    payload: ExportRequestSchema,
    db: Session = Depends(get_db),
):
    """全参数导出（R-16 / R-17）：格式、水印、脱敏、页边距、字号、页数、照片。

    脱敏作为管线前置步骤（``redact`` 是唯一实现），脱敏版是**独立导出文件**，不回写、
    不落库副本。响应头保留 ``X-Resume-Pages`` / ``X-Resume-Page-Limit``。
    """
    record = _get_live_resume(db, resume_id)
    privacy_options = PrivacyRedactionOptions(**payload.redact_options.model_dump())
    request = ExportRequest(
        format=payload.format,
        watermark=payload.watermark,
        redact=payload.redact,
        redact_options=privacy_options,
        margin_mm=payload.margin_mm,
        font_scale=payload.font_scale,
        page_limit=payload.page_limit,
        include_photo=payload.include_photo,
    )
    return _export_record(db, record, request, allow_incomplete=payload.allow_incomplete,
                          record_delivery=payload.record_delivery)


@router.post("/{resume_id}/redact", response_model=ResumeContent)
def redact_resume_preview(
    resume_id: int,
    payload: RedactionOptionsSchema,
    db: Session = Depends(get_db),
):
    """脱敏预览：返回脱敏后的 ``ResumeContent``，不落库、不改动原记录。"""
    record = _get_live_resume(db, resume_id)
    resume = ResumeContent.model_validate(record.content)
    options = PrivacyRedactionOptions(**payload.model_dump())
    return redact(resume, options)
