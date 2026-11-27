# SPDX-License-Identifier: Apache-2.0
"""外部简历的**在线改字**接口：能改哪些块（`/blocks`）与改字落新版本（`/edit`）。

## 为什么单独一个模块

`external_resumes.py` 已经贴着 500 行硬闸门（`test_file_size_budget`，含注释与 docstring）。
"浏览 / 原件 / 收藏 / 笔记"那半边与"改字"这半边没有共享状态——后者只用到同一组 DTO 组装
函数（`_get_or_404` / `_file_meta` / `_detail_of` / `_revision_out`）与改字服务。整体搬出来
之后，两边都能各自再长一截；反过来继续往一个文件里塞，下次任何改动都得先做一次拆分，
而边界往往是在赶工时定的。

## 线程边界（这里最容易踩的坑）

`POST /{id}/edit` 是 ``async``：它要 ``await run_sync`` 把"解析 PDF、写新版本"送进 worker
线程（PDF 改写是纯 CPU 活，放事件循环上会把整个应用的其它请求一起卡住）。由此带来一条硬规矩：
**这个 async 函数体里不能出现任何 Session 操作**——连"先查一行看看存不存在"都不行。
`app/runtime/blocking.py` 的规则不看代价大小，只看线程，`test_async_route_thread_boundary`
会精确点名到行。所以取行与干活是一个整体（`_edit_work_unit`），由 `run_sync` 一起送进线程；
404 仍从线程里抛出来，FastAPI 照样转成响应。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.external_resume import ExternalResume
from ..runtime.blocking import run_sync
from ..schemas.external_resume import (
    ExternalResumeBlockOut,
    ExternalResumeBlocksOut,
    ExternalResumeEditInput,
    ExternalResumeEditOut,
)
from ..services import external_resume_edit as edit_service
from ..services import external_resume_versions as versions
from ..services.external_resume_pdf_scan import PdfEditError
from .external_resume_shared import detail_of, file_meta, get_or_404, revision_out

router = APIRouter(prefix="/api/external-resumes", tags=["external-resumes"])


@router.get("/{resume_id}/blocks", response_model=ExternalResumeBlocksOut)
def read_external_resume_blocks(resume_id: int, db: Session = Depends(get_db)):
    """编辑视图：这份文件能改哪些块 / 段落。

    能力探测失败（扫描件 / 转曲 / 加密 / 表单 / 旋转页 / 不支持的后缀）一律 422，
    ``detail`` 是面向用户的完整句子（含原因码），前端直接展示并引导下载。
    """
    row = get_or_404(db, resume_id)
    name, _mime = file_meta(db, row.file_id)
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


@router.post("/{resume_id}/edit", response_model=ExternalResumeEditOut)
async def edit_external_resume(
    resume_id: int, payload: ExternalResumeEditInput, db: Session = Depends(get_db)
):
    """把某一块 / 某一段改成新文字，另存为新版本（**绝不覆盖原件**）。

    422 = 这一块不能改（能力探测失败 / 块已不存在 / 新文字放不下）；
    404 = 简历或它当前的文件已不存在。
    """
    try:
        return await run_sync(_edit_work_unit, db, resume_id, payload)
    except versions.RevisionFileMissing as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (PdfEditError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _edit_work_unit(
    db: Session, resume_id: int, payload: ExternalResumeEditInput
) -> ExternalResumeEditOut:
    """取行 + 改字 + 存新版本（**整体在 worker 线程里跑**，见模块注释的线程边界）。"""
    row = get_or_404(db, resume_id)
    return _apply_edit(db, row, payload)


def _apply_edit(
    db: Session, row: ExternalResume, payload: ExternalResumeEditInput
) -> ExternalResumeEditOut:
    """改字 + 存新版本的完整工作单元（在 worker 线程里跑，别占事件循环）。

    返回的是**物化好的 DTO**：``row`` 出不了这个函数——会话一关它就成了 detached，
    ``_detail_of`` 里任何一个没加载过的列都会抛 ``DetachedInstanceError``。
    """
    name, mime = file_meta(db, row.file_id)
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
        resume=detail_of(db, row),
        revision=revision_out(revision, row),
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
