# SPDX-License-Identifier: Apache-2.0
"""简历的离线分享包与脱敏预览端点（从 export_routes.py 拆出：单文件 500 行预算）。

两者都是**导出的只读衍生**：分享包 = HTML + PDF + 说明的 zip；脱敏预览 = v2 文档 JSON。
共用 export_routes 的版本收口（_document_for_request）与本地访问闸门，不在本文件重写。
"""

import logging
import zipfile
from io import BytesIO
from urllib.parse import quote

from fastapi import APIRouter, Depends
from fastapi import Request as HTTPRequest
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ...database import get_db
from ...schemas.export import RedactionOptions as RedactionOptionsSchema
from ...services.export_pipeline import ExportRequest, RenderContext, build_export
from ...services.pdf_exporter import ResumePDFError
from ...services.privacy import RedactionOptions as PrivacyRedactionOptions
from ...services.privacy import redact_document
from ...services.resume.document_view import header_text
from ...services.resume.resume_labels import DEFAULT_RESUME_LANGUAGE
from ...services.resume.resume_record import record_format_config
from ...services.resume.resume_template_store import resolve_style_config, resolve_style_template
from ._shared import _get_live_resume
from .export_routes import _document_for_request, _require_local_export_request

logger = logging.getLogger(__name__)

router = APIRouter()


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
    document = _document_for_request(db, record, None)
    export_template, export_html = resolve_style_template(db, record.template)
    context = RenderContext(
        template=export_template,
        template_html=export_html,
        style_config=resolve_style_config(db, record.template),
        page_limit=record.page_limit,
        font_scale=record.font_scale,
        format_config=record_format_config(db, record),
        # 分享包里的 HTML/PDF 也是"发给别人看的那一份"，语言必须跟着记录走。
        language=record.language or DEFAULT_RESUME_LANGUAGE,
    )
    html = build_export(ExportRequest(format="html"), document, context)
    pdf_bytes: bytes | None = None
    pdf_note = ""
    try:
        pdf_bytes = build_export(ExportRequest(format="pdf"), document, context).content
    except (ResumePDFError, ValueError) as exc:
        logger.warning("分享包未能生成 PDF（用 HTML 兜底）：%s", exc)
        pdf_note = f"（本机未能生成 PDF：{exc}）"

    stem = (header_text(document, "name") or "简历").strip()[:48] or "简历"
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


@router.post("/{resume_id}/redact", response_model=dict)
def redact_resume_preview(
    resume_id: int,
    payload: RedactionOptionsSchema,
    db: Session = Depends(get_db),
):
    """脱敏预览：返回脱敏后的 **v2 文档 JSON**，不落库、不改动原记录。"""
    record = _get_live_resume(db, resume_id)
    document = _document_for_request(db, record, None)
    options = PrivacyRedactionOptions(**payload.model_dump())
    return redact_document(document, options)
