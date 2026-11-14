# SPDX-License-Identifier: Apache-2.0
"""外部简历接口（前缀 `/api/external-resumes`，清单 `21.4–21.5）。

**只读快照的边界要在接口层就能看出来**：这里没有"编辑正文 / 导出 / 版式 / 制作台"
任何入口，只有上传、列表、详情、改名与关联岗位、原件、软删、文本检查。外部简历的 id
永远进不了 `/api/resumes/*`（两张表 id 空间独立，服务层没有任何交叉访问）。

错误形状与其它回收站/材料接口一致：404 = 不存在或已删除（含回收站），422 = 参数或
文件内容有问题（原因直接可读），413 = 文件超出 10 MB。

上传是 `multipart` + **上传即解析**：`prepare_upload`（校验 + 本地提取）是同步 CPU/IO
重活，下沉线程池；`create_external_resume` 在主线程做落盘与建行，不跨线程持有会话。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.external_resume import ExternalResume
from ..models.user_file import UserFile
from ..schemas.external_resume import (
    MAX_EXTERNAL_RESUME_BYTES,
    ExternalResumeAnalysisOut,
    ExternalResumeDetail,
    ExternalResumeListOut,
    ExternalResumeUpdateInput,
)
from ..services import external_resumes as service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/external-resumes", tags=["external-resumes"])

# 列表单页上限：本机界面，一次不需要看更多。
_MAX_PAGE_SIZE = 100
_NOT_FOUND = "外部简历不存在或已删除"


def _get_or_404(db: Session, resume_id: int) -> ExternalResume:
    """未删除的外部简历；已进回收站的当作不存在（列表里也看不到它）。"""
    row = service.get_external_resume(db, resume_id)
    if row is None:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return row


def _job_title(db: Session, row: ExternalResume) -> str:
    if row.job_id is None:
        return ""
    return service.job_titles(db, [row.job_id]).get(row.job_id, "")


def _detail_of(db: Session, row: ExternalResume) -> ExternalResumeDetail:
    """详情回显：关联岗位标题 + 原件 MIME 一起带上（前端据此选预览形态）。"""
    mime = service.user_file_mimes(db, [row.file_id]).get(row.file_id, "")
    return service.detail_of(row, job_title=_job_title(db, row), mime=mime)


@router.post("", response_model=ExternalResumeDetail, status_code=201)
async def upload_external_resume(
    file: UploadFile = File(...),
    name: str = Form(default=""),
    job_id: int | None = Form(default=None),
    db: Session = Depends(get_db),
):
    """上传一份外部简历：本地提取正文、登记文件、建行；扫描件也建行但正文为空。"""
    raw = await file.read()
    original_name = file.filename or ""
    if not raw:
        raise HTTPException(status_code=422, detail="文件是空的")
    if len(raw) > MAX_EXTERNAL_RESUME_BYTES:
        size_mb = MAX_EXTERNAL_RESUME_BYTES // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"文件超过 {size_mb} MB，无法上传")
    try:
        # 解析 PDF/docx 是同步 CPU/IO 活：下沉线程池，别占住事件循环。
        extracted = await run_in_threadpool(service.prepare_upload, original_name, raw)
        row, warnings = service.create_external_resume(
            db,
            content=raw,
            original_name=original_name,
            mime=file.content_type or "",
            name=name,
            job_id=job_id,
            extracted=extracted,
        )
    except ValueError as exc:
        # detail 只写原因（文件坏了 / 没有文字层之外的问题）；动作由前端补。
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    out = _detail_of(db, row)
    out.warnings = warnings
    return out


@router.get("", response_model=ExternalResumeListOut)
def list_external_resumes(
    keyword: str = Query(default=""),
    job_id: int | None = Query(default=None, ge=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    """List live snapshots by name, live job title/company, and optional job."""
    rows, total = service.list_external_resumes(
        db, keyword=keyword, job_id=job_id, page=page, page_size=page_size
    )
    titles = service.job_titles(db, [row.job_id for row in rows if row.job_id is not None])
    mimes = service.user_file_mimes(db, [row.file_id for row in rows])
    items = [
        service.brief_of(
            row,
            job_title=titles.get(row.job_id, "") if row.job_id else "",
            mime=mimes.get(row.file_id, ""),
        )
        for row in rows
    ]
    return ExternalResumeListOut(items=items, total=total, page=page, page_size=page_size)


@router.get("/{resume_id}", response_model=ExternalResumeDetail)
def read_external_resume(resume_id: int, db: Session = Depends(get_db)):
    """详情：含上传时提取的正文（界面「查看文本」直接用它）。"""
    row = _get_or_404(db, resume_id)
    return _detail_of(db, row)


@router.patch("/{resume_id}", response_model=ExternalResumeDetail)
def update_external_resume(
    resume_id: int, payload: ExternalResumeUpdateInput, db: Session = Depends(get_db)
):
    """改名 / 关联岗位（只读快照**没有正文编辑**这一路）。"""
    row = _get_or_404(db, resume_id)
    try:
        row = service.update_external_resume(db, row, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    logger.info("外部简历已更新 id=%s", resume_id)
    return _detail_of(db, row)


@router.delete("/{resume_id}", status_code=204)
def delete_external_resume(resume_id: int, db: Session = Depends(get_db)):
    """软删进回收站（恢复走 `/api/trash/external_resume/{id}/restore`）。

    **不删物理文件**：同一份内容可能被资料照片 / 聊天附件等其它入口引用，删了别人的
    原件是不可挽回的；彻底删除（清空回收站）同样不碰磁盘。
    """
    row = _get_or_404(db, resume_id)
    service.delete_external_resume(db, row)
    logger.info("外部简历已移入回收站 id=%s", resume_id)


@router.get("/{resume_id}/file")
def read_external_resume_file(resume_id: int, db: Session = Depends(get_db)) -> FileResponse:
    """原件（inline）：PDF 可直接嵌 iframe，图片/文本交给浏览器。"""
    row = _get_or_404(db, resume_id)
    try:
        path = service.resolve_original_path(db, row)
    except service.ExternalResumeFileMissing as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    user_file = db.get(UserFile, row.file_id)
    return FileResponse(
        path,
        media_type=(user_file.mime if user_file is not None else "") or "application/octet-stream",
        filename=(user_file.original_name if user_file is not None else "") or path.name,
        content_disposition_type="inline",
    )


@router.get("/{resume_id}/analysis", response_model=ExternalResumeAnalysisOut)
def analyze_external_resume(resume_id: int, db: Session = Depends(get_db)):
    """文本级检查（纯规则、不调模型、**没有总分**）；关联岗位时附关键词覆盖。"""
    row = _get_or_404(db, resume_id)
    return service.analyze(db, row)


__all__ = ["router"]
