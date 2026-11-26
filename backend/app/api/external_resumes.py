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
from ..models.external_resume import ExternalResume, ExternalResumeRevision
from ..models.user_file import UserFile
from ..runtime.blocking import run_sync
from ..schemas.external_resume import (
    MAX_EXTERNAL_RESUME_BYTES,
    ExternalResumeAnalysisOut,
    ExternalResumeBlockOut,
    ExternalResumeBlocksOut,
    ExternalResumeDetail,
    ExternalResumeEditInput,
    ExternalResumeEditOut,
    ExternalResumeListOut,
    ExternalResumeRestoreOut,
    ExternalResumeRevisionOut,
    ExternalResumeRevisionsOut,
    ExternalResumeRevisionTextOut,
    ExternalResumeUpdateInput,
)
from ..services import external_resume_edit as edit_service
from ..services import external_resume_versions as versions
from ..services import external_resumes as service
from ..services.external_resume_pdf_scan import PdfEditError

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


def _file_meta(db: Session, file_id: int) -> tuple[str, str]:
    """(原始文件名, MIME)：编辑要按后缀选路，也让回显带上正确的内容类型。"""
    user_file = db.get(UserFile, file_id)
    if user_file is None:
        return "", ""
    return user_file.original_name or "", user_file.mime or ""


def _revision_out(
    revision: ExternalResumeRevision, row: ExternalResume
) -> ExternalResumeRevisionOut:
    """版本回显；``current`` 用"指向的仍是简历当前文件"判定，不另存标记。"""
    return ExternalResumeRevisionOut(
        id=int(revision.id),
        file_id=int(revision.file_id),
        text_chars=int(revision.text_chars or 0),
        has_text=bool(revision.has_text),
        source=revision.source or "",
        created_at=revision.created_at,
        current=int(revision.file_id) == int(row.file_id),
    )


def _persist_upload(
    db: Session,
    raw: bytes,
    *,
    original_name: str,
    mime: str,
    name: str,
    job_id: int | None,
    extracted: object,
) -> ExternalResumeDetail:
    """上传的落库段：登记文件、建行、拼详情回显——三段都碰请求会话。

    一次放进同一个 worker 做完：``row`` 是 ORM 实例，若把它跨线程/跨 ``await``
    带回事件循环，会话一关它就成了 detached，``_detail_of`` 里任何一个没加载过的
    列都会抛 ``DetachedInstanceError``。这里就在会话还活着的时候把 DTO 物化好。
    """
    try:
        row, warnings = service.create_external_resume(
            db,
            content=raw,
            original_name=original_name,
            mime=mime,
            name=name,
            job_id=job_id,
            extracted=extracted,  # type: ignore[arg-type]
        )
    except ValueError as exc:
        # detail 只写原因（文件坏了 / 没有文字层之外的问题）；动作由前端补。
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    out = _detail_of(db, row)
    out.warnings = warnings
    return out


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
    except ValueError as exc:
        # detail 只写原因（文件坏了 / 没有文字层之外的问题）；动作由前端补。
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # 落库段（登记文件 + 建行 + 详情回显）是在一次读事务之外的另一段同步工作，
    # 同样交给 worker：解析已经做完，这里不必再持有事件循环线程。
    return await run_sync(
        _persist_upload,
        db,
        raw,
        original_name=original_name,
        mime=file.content_type or "",
        name=name,
        job_id=job_id,
        extracted=extracted,
    )


@router.get("", response_model=ExternalResumeListOut)
def list_external_resumes(
    keyword: str = Query(default=""),
    job_id: int | None = Query(default=None, ge=1),
    include_general: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=_MAX_PAGE_SIZE),
    sort: service.ExternalResumeSortKey = Query(default=service.DEFAULT_EXTERNAL_SORT_KEY),
    order: service.ExternalResumeSortOrder = Query(default=service.DEFAULT_EXTERNAL_SORT_ORDER),
    db: Session = Depends(get_db),
):
    """List live snapshots by name, live job title/company, and optional job.

    ``include_general``（T6）：给了 ``job_id`` 时把它扩成 ``job_id == ? OR job_id IS
    NULL``，与 ``GET /api/resumes`` 的内部简历口径逐字一致。求职进度选"使用的简历"
    时要的就是这个范围（本岗位 + 通用），默认 ``false`` 保持既有调用方行为不变。

    ``sort`` / ``order``（T09）：``name`` / ``job_title`` / ``created_at`` /
    ``text_chars`` 各配升降序，默认 ``created_at desc``（与改造前逐字一致）。
    两个参数都是 ``Literal``，非法值由 FastAPI 直接给 422，不进服务层。
    """
    rows, total = service.list_external_resumes(
        db,
        keyword=keyword,
        job_id=job_id,
        include_general=include_general,
        page=page,
        page_size=page_size,
        sort=sort,
        order=order,
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
def read_external_resume_file(
    resume_id: int,
    revision_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> FileResponse:
    """原件（inline）：PDF 可直接嵌 iframe，图片/文本交给浏览器。

    给了 ``revision_id`` 时返回该历史版本的文件——历史版本列表的「预览 / 下载」用它，
    不必为"看一版旧文件"再开一个端点。
    """
    row = _get_or_404(db, resume_id)
    file_id = row.file_id
    if revision_id is not None:
        revision = versions.get_revision(db, row, revision_id)
        if revision is None:
            raise HTTPException(status_code=404, detail=_NOT_FOUND)
        file_id = revision.file_id
    try:
        path = versions.path_of_file(db, file_id)
    except versions.RevisionFileMissing as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    user_file = db.get(UserFile, file_id)
    return FileResponse(
        path,
        media_type=(user_file.mime if user_file is not None else "") or "application/octet-stream",
        filename=(user_file.original_name if user_file is not None else "") or path.name,
        content_disposition_type="inline",
    )


@router.get("/{resume_id}/blocks", response_model=ExternalResumeBlocksOut)
def read_external_resume_blocks(resume_id: int, db: Session = Depends(get_db)):
    """编辑视图：这份文件能改哪些块 / 段落。

    能力探测失败（扫描件 / 转曲 / 加密 / 表单 / 旋转页 / 不支持的后缀）一律 422，
    ``detail`` 是面向用户的完整句子（含原因码），前端直接展示并引导下载。
    """
    row = _get_or_404(db, resume_id)
    name, _mime = _file_meta(db, row.file_id)
    try:
        document = edit_service.list_blocks(
            name, versions.path_of_file(db, row.file_id).read_bytes()
        )
    except versions.RevisionFileMissing as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (PdfEditError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ExternalResumeBlocksOut(
        resume_id=int(row.id),
        kind=document.kind,
        page_count=document.page_count,
        page_width=document.page_width,
        page_height=document.page_height,
        blocks=[
            ExternalResumeBlockOut(
                block_id=block.block_id,
                page=block.page,
                text=block.text,
                editable=block.editable,
                reason=block.reason,
                x0=block.x0,
                y0=block.y0,
                x1=block.x1,
                y1=block.y1,
                size=block.size,
                leading=block.leading,
                align=block.align,
            )
            for block in document.blocks
        ],
        warnings=list(document.warnings),
    )


def _apply_edit(
    db: Session, row: ExternalResume, payload: ExternalResumeEditInput
) -> ExternalResumeEditOut:
    """改字 + 存新版本的完整工作单元（在 worker 线程里跑，别占事件循环）。

    返回的是**物化好的 DTO**：``row`` 出不了这个函数——会话一关它就成了 detached，
    ``_detail_of`` 里任何一个没加载过的列都会抛 ``DetachedInstanceError``。
    """
    name, mime = _file_meta(db, row.file_id)
    data = versions.path_of_file(db, row.file_id).read_bytes()
    outcome = edit_service.replace(
        name,
        data,
        block_id=payload.block_id,
        new_text=payload.text,
        shift_below=payload.shift_below,
    )
    revision, warnings = versions.persist_edit(
        db, row, content=outcome.content, original_name=name, mime=mime
    )
    return ExternalResumeEditOut(
        resume=_detail_of(db, row),
        revision=_revision_out(revision, row),
        kind=outcome.kind,
        block_id=outcome.block_id,
        page=outcome.page,
        delta_pt=outcome.delta_pt,
        overflow=outcome.overflow,
        scaled=outcome.scaled,
        shifted=outcome.shifted,
        lines_before=outcome.lines_before,
        lines_after=outcome.lines_after,
        warnings=list(dict.fromkeys([*warnings, *outcome.warnings])),
    )


@router.post("/{resume_id}/edit", response_model=ExternalResumeEditOut)
async def edit_external_resume(
    resume_id: int, payload: ExternalResumeEditInput, db: Session = Depends(get_db)
):
    """把某一块 / 某一段改成新文字，另存为新版本（**绝不覆盖原件**）。

    422 = 这一块不能改（能力探测失败 / 块已不存在 / 新文字放不下）；
    404 = 简历或它当前的文件已不存在。
    """
    row = _get_or_404(db, resume_id)
    try:
        return await run_sync(_apply_edit, db, row, payload)
    except versions.RevisionFileMissing as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (PdfEditError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{resume_id}/revisions", response_model=ExternalResumeRevisionsOut)
def list_external_resume_revisions(resume_id: int, db: Session = Depends(get_db)):
    """历史版本（时间倒序）：时间、字数、有无文字、来源，当前版本标 ``current``。"""
    row = _get_or_404(db, resume_id)
    rows = versions.list_revisions(db, row)
    return ExternalResumeRevisionsOut(
        resume_id=int(row.id),
        items=[_revision_out(revision, row) for revision in rows],
        total=len(rows),
    )


@router.get(
    "/{resume_id}/revisions/{revision_id}/text",
    response_model=ExternalResumeRevisionTextOut,
)
def get_external_resume_revision_text(
    resume_id: int, revision_id: int, db: Session = Depends(get_db)
):
    """某一版历史版本的**正文**：T12「对比」用（原版 / 新版两侧都要有字）。

    历史版本表只存 ``text_chars``，不存正文，所以这里按需从那一版的文件重新提取一次。
    正常路径上没有"每份简历都有历史版本"这个前提：``revision_id`` 必须属于这份简历，
    否则 404（别的简历的版本一律当不存在，与 ``restore`` 同一口径）。
    """
    row = _get_or_404(db, resume_id)
    revision = versions.get_revision(db, row, revision_id)
    if revision is None:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    try:
        text = versions.revision_text(db, row, revision)
    except versions.RevisionFileMissing as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ExternalResumeRevisionTextOut(
        revision_id=int(revision.id),
        text=text,
        text_chars=int(revision.text_chars or 0),
        has_text=bool(revision.has_text),
    )


@router.post(
    "/{resume_id}/revisions/{revision_id}/restore",
    response_model=ExternalResumeRestoreOut,
)
def restore_external_resume_revision(
    resume_id: int, revision_id: int, db: Session = Depends(get_db)
):
    """恢复到某个历史版本：**再写一条** `source=restore` 的新版本，不改写历史。"""
    row = _get_or_404(db, resume_id)
    revision = versions.get_revision(db, row, revision_id)
    if revision is None:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    try:
        restored, warnings = versions.restore(db, row, revision)
    except versions.RevisionFileMissing as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    logger.info("外部简历已恢复 id=%s revision=%s", resume_id, revision_id)
    return ExternalResumeRestoreOut(
        resume=_detail_of(db, row),
        revision=_revision_out(restored, row),
        warnings=list(warnings),
    )


@router.get("/{resume_id}/analysis", response_model=ExternalResumeAnalysisOut)
def analyze_external_resume(resume_id: int, db: Session = Depends(get_db)):
    """文本级检查（纯规则、不调模型、**没有总分**）；关联岗位时附关键词覆盖。"""
    row = _get_or_404(db, resume_id)
    return service.analyze(db, row)


__all__ = ["router"]
