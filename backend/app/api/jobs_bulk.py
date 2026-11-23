# SPDX-License-Identifier: Apache-2.0
"""岗位批量操作与 CSV 导入导出（从 ``api/jobs.py`` 拆出的同前缀路由）。

**为什么单独成文件**：``api/jobs.py`` 的行数预算已经用满（T9 一改动就顶穿 500 行硬闸门），
而这一组端点与"识别/解析"那条链路没有共享状态——它们只碰批量状态、回收站和 CSV。
拆法沿用 ``api/apply_extra.py`` 的先例：本模块提供 :func:`register_jobs_bulk_routes`，由
``api/jobs.py`` 在原来的注册位置调用一次，**路由顺序与拆分前逐条一致**。这里不用
``from .jobs_bulk import bulk_router``：导入方向守卫（``test_import_direction``）只把
「``router`` / ``register_*_routes``」认作子路由装配，``bulk_router`` 两个条件都不满足。

端点清单（**前端只用这些，不要在本模块偷偷加**）：

===============================  ==========================================
``POST /batch-status``           批量改岗位状态
``POST /batch-delete``           批量移入回收站（软删除）
``POST /export``                 把勾选的岗位导出成 CSV
``POST /import/preview``         解析上传的 CSV（不落库）
``POST /import``                 提交导入（逐行容错）
===============================  ==========================================
"""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session
from starlette.responses import Response

from ..database import get_db
from ..models.job import JOB_STATUSES, Job
from ..schemas.job import (
    JobBatchDeleteResult,
    JobBatchRequest,
    JobBatchStatusRequest,
    JobBatchStatusResult,
    JobCreate,
    JobImportPreview,
    JobImportRequest,
    JobImportResult,
    JobImportRow,
)
from ..services import trash
from ..services.job.job_csv import (
    MAX_IMPORT_FILE_CHARS,
    decode_csv_bytes,
    jobs_to_csv_text,
    parse_job_csv,
    row_to_payload,
)
from ..services.job.job_queries import jobs_by_ids
from ..services.job.job_service import create_job_record, find_job_by_identity

bulk_router = APIRouter(tags=["jobs"])


def _get_jobs_or_404(db: Session, job_ids: list[int]) -> list[Job]:
    jobs, missing_ids = jobs_by_ids(db, job_ids)
    if missing_ids:
        missing = "、".join(str(job_id) for job_id in missing_ids)
        raise HTTPException(status_code=404, detail=f"以下岗位不存在或已被删除：{missing}")
    return jobs


def _commit_batch(db: Session) -> None:
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise


@bulk_router.post("/batch-status", response_model=JobBatchStatusResult)
def batch_update_job_status(payload: JobBatchStatusRequest, db: Session = Depends(get_db)):
    if payload.status not in JOB_STATUSES:
        allowed = "、".join(JOB_STATUSES)
        raise HTTPException(status_code=400, detail=f"无效的岗位状态，可选值：{allowed}")

    jobs = _get_jobs_or_404(db, payload.job_ids)
    for job in jobs:
        job.status = payload.status
    _commit_batch(db)
    return JobBatchStatusResult(updated=len(jobs))


@bulk_router.post("/batch-delete", response_model=JobBatchDeleteResult)
def batch_delete_jobs(payload: JobBatchRequest, db: Session = Depends(get_db)):
    """批量移入回收站（软删除），与单条删除及其余各域的批量删除同一口径。

    岗位是采集/粘贴攒起来的，一次误点不该让它彻底消失；软删除后可在「回收站」恢复，
    彻底删除在「回收站」里单独提供（不可恢复，需二次确认）。
    """
    jobs = _get_jobs_or_404(db, payload.job_ids)
    for job in jobs:
        trash.soft_delete(db, "job", job)
    _commit_batch(db)
    return JobBatchDeleteResult(deleted=len(jobs))


@bulk_router.post("/export")
def export_jobs_csv(payload: JobBatchRequest, db: Session = Depends(get_db)):
    """把勾选的岗位导出成 CSV（与导入共用同一列集，导出的文件可以直接改完再导回）。"""
    jobs = _get_jobs_or_404(db, payload.job_ids)
    # 按用户选择的顺序导出，而不是数据库顺序：导出文件里行的次序与界面勾选一致。
    by_id = {job.id: job for job in jobs}
    ordered = [by_id[job_id] for job_id in payload.job_ids if job_id in by_id]
    text = jobs_to_csv_text(ordered)
    return Response(
        content=text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="jobs.csv"'},
    )


@bulk_router.post("/import/preview", response_model=JobImportPreview)
async def preview_job_import(file: UploadFile = File(...)):
    """解析上传的 CSV，返回可导入行与逐行错误（不落库，等用户确认）。"""
    raw = await file.read()
    if len(raw) > MAX_IMPORT_FILE_CHARS:
        raise HTTPException(status_code=413, detail="CSV 文件过大（上限 2MB）")
    try:
        text = decode_csv_bytes(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    rows, errors = parse_job_csv(text)
    return JobImportPreview(
        rows=[JobImportRow(line=line, data=data) for line, data in rows],
        errors=errors,
    )


@bulk_router.post("/import", response_model=JobImportResult)
def import_jobs_csv(payload: JobImportRequest, db: Session = Depends(get_db)):
    """提交导入：逐行建岗、逐行容错；与岗位广场已有岗位重复的行跳过并说明。"""
    imported = 0
    failed: list[dict[str, object]] = []
    for item in payload.rows:
        try:
            clean = row_to_payload(item.data)
            title = str(clean.get("title") or "")
            company = str(clean.get("company") or "")
            source_url = str(clean.get("source_url") or "")
            if find_job_by_identity(db, title=title, company=company, source_url=source_url):
                failed.append({"line": item.line, "message": "岗位广场已有这个岗位，已跳过"})
                continue
            create_job_record(db, JobCreate(**clean))
            imported += 1
        except Exception as exc:  # noqa: BLE001 - 单行失败不拖垮整批，逐行给原因
            db.rollback()
            failed.append({"line": item.line, "message": str(exc) or "这一行导入失败"})
    return JobImportResult(imported=imported, failed=failed)


def register_jobs_bulk_routes(router: APIRouter) -> None:
    """把本模块的批量端点挂进调用方的路由树（``/api/jobs`` 前缀由调用方提供）。

    拆法沿用 ``api/apply_extra.py`` 的 ``register_*_routes`` 先例：``api/jobs.py`` 因此只多
    一行 import + 一行调用，注册顺序与拆分前逐条一致。**不要**让 ``api/jobs.py`` 直接
    ``from .jobs_bulk import bulk_router``——``test_import_direction`` 的
    ``api-cross-module-imports`` 规则只认 ``router`` 与 ``register_*_routes`` 这两种
    "子路由装配"的导入名，``bulk_router`` 会被判成业务复用（架构上不允许）。
    """
    router.include_router(bulk_router)


__all__ = ["bulk_router", "register_jobs_bulk_routes"]
