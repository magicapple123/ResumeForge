"""简历导出与脱敏端点（域⑧）：导出闸门 + 管线委托 + GET/POST 导出 + 脱敏预览。

从原 ``api/resumes.py`` 原样搬运（纯切片，无 patch 读取点）；`_get_live_resume` 与两个
PDF 响应头常量改从 ``_shared`` 导入。
"""

import logging
import zipfile
from dataclasses import asdict
from io import BytesIO
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import Request as HTTPRequest
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ...database import get_db
from ...middleware.loopback_origin import is_non_cross_site_request
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
    build_export,
    build_export_delivery,
    effective_format_config,
)
from ...services.export_save_location import save_artifact, validate_directory
from ...services.pdf_exporter import ResumePDFError
from ...services.privacy import RedactionOptions as PrivacyRedactionOptions
from ...services.privacy import redact
from ...services.resume.resume_completeness import find_incomplete, incomplete_detail
from ...services.resume.resume_delivery import (
    canonical_content_sha256,
    freeze_delivery,
)
from ...services.resume.resume_record import record_format_config
from ...services.resume.resume_template_store import (
    resolve_style_config,
    resolve_style_template,
)
from ...services.settings_service import get_export_save_location
from ...services.watermark import WatermarkError
from .. import settings as settings_api
from ._shared import (
    PDF_ENGINE_HEADER,
    PDF_ENGINE_NAME,
    PDF_PAGE_LIMIT_HEADER,
    PDF_PAGES_HEADER,
    RESUME_OVERFLOW_HEADER,
    _get_live_resume,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _require_local_export_request(request: HTTPRequest) -> None:
    """Resume exports expose private profile data and are a loopback-only capability."""
    if not settings_api._is_loopback_request(request) or not is_non_cross_site_request(request):
        raise HTTPException(status_code=403, detail="简历导出仅允许从本机前端访问")


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
    的投递快照（「正式投递存档」语义）。**默认不落**——预览导出零膨胀。新调用方
    请走 ``POST /export``（GET 上的该参数仅为兼容保留，见 ADR-0002）。

    存档口径（PR-09 可信交付账本）：存档 content 与下载产物**同源**（脱敏导出存
    脱敏后内容）；``render_context`` / ``request_params`` 记录**实际生效**的请求
    参数（覆盖值按生效规则折算，不是记录默认值）；``source_content_sha256`` 与
    ``artifact_sha256`` 分开回答"存的是哪份内容"与"产出的文件是哪份"。
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
        if request.format == "pdf":
            # 只有真的由 PDF 引擎渲染时才声称引擎名：html/json/md/txt 根本没有 PDF 引擎，
            # 给它们也回一个 "fpdf2" 是假话。
            headers[PDF_ENGINE_HEADER] = PDF_ENGINE_NAME
        # overflow 只在"有分页引擎"的格式（pdf/docx）里有意义，而 artifact.pages 非空
        # 正是这一条件。标志不许说谎：它必须与上面两行的页数结论一致。
        headers[RESUME_OVERFLOW_HEADER] = "true" if artifact.overflow else "false"
    if artifact.page_limit is not None:
        headers[PDF_PAGE_LIMIT_HEADER] = str(artifact.page_limit)
    # 「生成内容保存位置」：设置非空且目录合法时，把同一份产物再落盘一份。**best-effort**：
    # 写失败只记日志、不阻断下载——用户已经等了一次生成，不能因为本地磁盘的问题白等。
    saved_location = get_export_save_location(db)
    if saved_location and validate_directory(saved_location) is None:
        try:
            final_path = save_artifact(artifact.content, saved_location, artifact.filename)
        except (OSError, ValueError) as exc:
            logger.warning("导出产物落盘到「%s」失败：%s", saved_location, exc)
        else:
            # 头的值做 URL 编码（路径里可能有中文/反斜杠等非 latin-1 字符），前端解码还原。
            headers["X-Saved-To"] = quote(final_path, safe="")
    if record_delivery:
        # 实际导出的那份内容（PR-09）：脱敏导出存脱敏内容，保证存档与下载产物同源——
        # 与管线内部 ``build_export`` 的脱敏前置是同一条规则、同一份实现（privacy.redact）。
        effective_resume = redact(resume, request.redact_options) if request.redact else resume
        effective_content = effective_resume.model_dump()
        # 实际生效的渲染上下文（PR-09）：请求覆盖值按 build_export 的生效规则折算——
        # 修复"请求 page_limit=2、存档里却是记录默认 1"的错位。
        effective_render_context = {
            "template": context.template,
            "template_html": context.template_html,
            "style_config": context.style_config or {},
            # 生效后的版式：记录值 + 本次请求的草稿覆盖，与 build_export 渲染用的是同一份。
            "format_config": effective_format_config(request, context),
            "page_limit": request.page_limit
            if request.page_limit is not None
            else (record.page_limit or 1),
            "font_scale": request.font_scale or context.font_scale or "standard",
            "margin_mm": request.margin_mm,
            "include_photo": request.include_photo,
        }
        # 实际生效的请求参数（PR-09）：从实际执行的导出调用取，不是默认值拼凑；
        # 凭它 + render_context 可以重放导出（见 resume_delivery.replay_delivery_export）。
        effective_request_params = {
            "format": request.format,
            "watermark": request.watermark,
            "redact": request.redact,
            "redact_options": (asdict(request.redact_options) if request.redact_options else None),
            "margin_mm": request.margin_mm,
            "font_scale": effective_render_context["font_scale"],
            "page_limit": effective_render_context["page_limit"],
            "format_config": effective_render_context["format_config"],
            "include_photo": request.include_photo,
        }
        # 显式存档：哈希原样沿用 ExportDelivery 的产出，库里证据与响应头逐字一致。
        # 幂等键（PR-09）：同一份产物（同简历 + 同字节）只留一份存档——重复点击/
        # 重试不会刷出一堆一模一样的证据；改过内容后重导出的字节不同，是新的存档。
        freeze_delivery(
            db,
            record=record,
            source="export",
            export_format=request.format,
            filename=artifact.filename,
            pages=artifact.pages,
            content_sha256=delivery.content_sha256,
            rendered_config_sha256=delivery.rendered_config_sha256,
            content=effective_content,
            render_context=effective_render_context,
            request_params=effective_request_params,
            source_content_sha256=canonical_content_sha256(effective_content),
            artifact_sha256=delivery.content_sha256,
            idempotency_key=f"export:{record.id}:{delivery.content_sha256}",
        )
        db.commit()
    return Response(artifact.content, media_type=artifact.media_type, headers=headers)


@router.get("/{resume_id}/export")
def export_resume(
    request: HTTPRequest,
    resume_id: int,
    format: str = Query(..., pattern="^(json|md|html|pdf)$"),
    allow_incomplete: bool = Query(
        default=False,
        description="为真时允许导出仍含未完成标记的草稿；默认拦下并说明是哪几处",
    ),
    record_delivery: bool = Query(
        default=False,
        description="【deprecated】仅为兼容保留：为真时把这次导出冻结成投递快照。"
        "新调用方请改用 POST /export（body 里 record_delivery=true），语义不变",
    ),
    db: Session = Depends(get_db),
):
    """兼容旧的 GET 导出：仍限四种格式，内部委托管线。全参数导出走 ``POST``。

    ``record_delivery=true`` 的旧行为原样保留（最小破坏兼容，见 ADR-0002）：
    它仍会落存档，但**推荐所有新调用方走 POST 端点**承担"导出并记录交付"，
    GET 保持纯下载语义。
    """
    _require_local_export_request(request)
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
    request: HTTPRequest,
    resume_id: int,
    payload: ExportRequestSchema,
    db: Session = Depends(get_db),
):
    """全参数导出（R-16 / R-17）：格式、水印、脱敏、页边距、字号、页数、照片。

    脱敏作为管线前置步骤（``redact`` 是唯一实现），脱敏版是**独立导出文件**，不回写、
    不落库副本。响应头保留 ``X-Resume-Pages`` / ``X-Resume-Page-Limit``。
    """
    _require_local_export_request(request)
    record = _get_live_resume(db, resume_id)
    privacy_options = PrivacyRedactionOptions(**payload.redact_options.model_dump())
    export_options = ExportRequest(
        format=payload.format,
        watermark=payload.watermark,
        redact=payload.redact,
        redact_options=privacy_options,
        margin_mm=payload.margin_mm,
        font_scale=payload.font_scale,
        page_limit=payload.page_limit,
        format_config=payload.format_config,
        include_photo=payload.include_photo,
    )
    return _export_record(
        db,
        record,
        export_options,
        allow_incomplete=payload.allow_incomplete,
        record_delivery=payload.record_delivery,
    )


@router.get("/{resume_id}/share-zip")
def share_resume_zip(request: HTTPRequest, resume_id: int, db: Session = Depends(get_db)):
    """离线分享包（R3）：一个 zip，内含单文件 HTML + PDF + 打开说明。

    为什么是 zip 而不是链接：接收方可能是招聘方或朋友，没有这个应用、也不该被要求
    装一个。HTML 双击就能看（样式与照片全内嵌），PDF 直接转发；说明里写清怎么打开、
    怎么打印成 A4。**PDF 生成失败不影响整包**（例如本机没有中文字体）：这时只带 HTML
    并在说明里写明原因——比"打包失败"更有用。
    """
    _require_local_export_request(request)
    record = _get_live_resume(db, resume_id)
    resume = ResumeContent.model_validate(record.content)
    export_template, export_html = resolve_style_template(db, record.template)
    context = RenderContext(
        template=export_template,
        template_html=export_html,
        style_config=resolve_style_config(db, record.template),
        page_limit=record.page_limit,
        font_scale=record.font_scale,
        format_config=record_format_config(db, record),
    )
    html = build_export(ExportRequest(format="html"), resume, context)
    pdf_bytes: bytes | None = None
    pdf_note = ""
    try:
        pdf_bytes = build_export(ExportRequest(format="pdf"), resume, context).content
    except (ResumePDFError, ValueError) as exc:
        logger.warning("分享包未能生成 PDF（用 HTML 兜底）：%s", exc)
        pdf_note = f"（本机未能生成 PDF：{exc}）"

    stem = (resume.name or "简历").strip()[:48] or "简历"
    readme = "\n".join(
        [
            f"{stem} · 简历离线包",
            "",
            "1. 双击「简历.html」用浏览器打开即可查看（样式与照片都在这一个文件里）。",
            "2. 「简历.pdf」可以直接转发或打印；如需 A4 打印，选择「实际大小 / 100%」。",
            "3. HTML 与 PDF 由同一份版式生成，排版一致。",
            "",
            "这份包只包含这份简历本身，不含账号、其他数据或个人资料库。",
            pdf_note,
        ]
    ).strip()

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("简历.html", html.content)
        if pdf_bytes is not None:
            archive.writestr("简历.pdf", pdf_bytes)
        archive.writestr("说明.txt", readme.encode("utf-8"))

    filename = f"{stem}-离线包.zip"
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
        "Cache-Control": "no-store",
    }
    return Response(buffer.getvalue(), media_type="application/zip", headers=headers)


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
