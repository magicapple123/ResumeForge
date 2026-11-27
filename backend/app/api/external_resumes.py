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
from ..models.user_file import UserFile
from ..runtime.blocking import run_sync
from ..schemas.external_resume import (
    MAX_EXTERNAL_RESUME_BYTES,
    ExternalResumeAnalysisOut,
    ExternalResumeDetail,
    ExternalResumeFavoriteInput,
    ExternalResumeListOut,
    ExternalResumeNoteInput,
    ExternalResumeRestoreOut,
    ExternalResumeRevisionsOut,
    ExternalResumeRevisionTextOut,
    ExternalResumeUpdateInput,
)
from ..services import external_resume_actions as actions
from ..services import external_resume_versions as versions
from ..services import external_resumes as service
from .external_resume_shared import NOT_FOUND_DETAIL, detail_of, get_or_404, revision_out

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/external-resumes", tags=["external-resumes"])

# 列表单页上限：本机界面，一次不需要看更多。
_MAX_PAGE_SIZE = 100


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
    带回事件循环，会话一关它就成了 detached，``detail_of`` 里任何一个没加载过的
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
    out = detail_of(db, row)
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
    row = get_or_404(db, resume_id)
    return detail_of(db, row)


@router.patch("/{resume_id}", response_model=ExternalResumeDetail)
def update_external_resume(
    resume_id: int, payload: ExternalResumeUpdateInput, db: Session = Depends(get_db)
):
    """改名 / 关联岗位（只读快照**没有正文编辑**这一路）。"""
    row = get_or_404(db, resume_id)
    try:
        row = actions.update_external_resume(db, row, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    logger.info("外部简历已更新 id=%s", resume_id)
    return detail_of(db, row)


@router.patch("/{resume_id}/favorite", response_model=ExternalResumeDetail)
def update_external_resume_favorite(
    resume_id: int,
    payload: ExternalResumeFavoriteInput,
    db: Session = Depends(get_db),
):
    """收藏 / 取消收藏（T28）：**只写标记，不改 `updated_at`**。

    与内部简历 `PATCH /api/resumes/{id}/favorite` 同一口径（唯一写入口
    `services/favorites.update_favorite`）。收藏不是编辑：列表的「最近更新」列若被
    它刷新，用户点一下星星那一行就跳到最前面——正是排查报告 R2 的"收藏错了行"。
    """
    row = get_or_404(db, resume_id)
    actions.set_favorite(db, row, payload.favorite)
    db.commit()
    db.refresh(row)
    return detail_of(db, row)


@router.patch("/{resume_id}/note", response_model=ExternalResumeDetail)
def update_external_resume_note(
    resume_id: int,
    payload: ExternalResumeNoteInput,
    db: Session = Depends(get_db),
):
    """写备注（T28）：空串 = 清空。备注是编辑，`updated_at` 正常刷新。"""
    row = get_or_404(db, resume_id)
    try:
        actions.set_note(db, row, payload.note)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return detail_of(db, row)


@router.delete("/{resume_id}", status_code=204)
def delete_external_resume(resume_id: int, db: Session = Depends(get_db)):
    """软删进回收站（恢复走 `/api/trash/external_resume/{id}/restore`）。

    **不删物理文件**：同一份内容可能被资料照片 / 聊天附件等其它入口引用，删了别人的
    原件是不可挽回的；彻底删除（清空回收站）同样不碰磁盘。
    """
    row = get_or_404(db, resume_id)
    service.delete_external_resume(db, row)
    logger.info("外部简历已移入回收站 id=%s", resume_id)


@router.get("/{resume_id}/file")
def read_external_resume_file(
    resume_id: int,
    revision_id: int | None = Query(default=None, ge=1),
    download: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> FileResponse:
    """原件：默认 inline（PDF 可直接嵌 iframe / pdf.js，图片/文本交给浏览器）。

    给了 ``revision_id`` 时返回该历史版本的文件——历史版本列表的「预览 / 下载」用它，
    不必为"看一版旧文件"再开一个端点。

    ``download=true``（T28「导出原件」）只改 ``Content-Disposition``：``attachment`` +
    ``filename=<上传时的原始文件名>``。**文件名与字节都原样**——不重新编码、不改扩展名，
    浏览器存下来的就是用户当初上传的那份（扩展名来自 ``user_file.original_name``，
    改名只改展示名 ``external_resume.name``，不影响这里）。
    """
    row = get_or_404(db, resume_id)
    file_id = row.file_id
    if revision_id is not None:
        revision = versions.get_revision(db, row, revision_id)
        if revision is None:
            raise HTTPException(status_code=404, detail=NOT_FOUND_DETAIL)
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
        content_disposition_type="attachment" if download else "inline",
    )


@router.get("/{resume_id}/revisions", response_model=ExternalResumeRevisionsOut)
def list_external_resume_revisions(resume_id: int, db: Session = Depends(get_db)):
    """历史版本（时间倒序）：时间、字数、有无文字、来源，当前版本标 ``current``。"""
    row = get_or_404(db, resume_id)
    rows = versions.list_revisions(db, row)
    return ExternalResumeRevisionsOut(
        resume_id=int(row.id),
        items=[revision_out(revision, row) for revision in rows],
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
    row = get_or_404(db, resume_id)
    revision = versions.get_revision(db, row, revision_id)
    if revision is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND_DETAIL)
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
    row = get_or_404(db, resume_id)
    revision = versions.get_revision(db, row, revision_id)
    if revision is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND_DETAIL)
    try:
        restored, warnings = versions.restore(db, row, revision)
    except versions.RevisionFileMissing as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    logger.info("外部简历已恢复 id=%s revision=%s", resume_id, revision_id)
    return ExternalResumeRestoreOut(
        resume=detail_of(db, row),
        revision=revision_out(restored, row),
        warnings=list(warnings),
    )


@router.get("/{resume_id}/analysis", response_model=ExternalResumeAnalysisOut)
def analyze_external_resume(resume_id: int, db: Session = Depends(get_db)):
    """文本级检查（纯规则、不调模型、**没有总分**）；关联岗位时附关键词覆盖。"""
    row = get_or_404(db, resume_id)
    return service.analyze(db, row)


__all__ = ["router"]
