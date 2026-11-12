# SPDX-License-Identifier: Apache-2.0
"""岗位接口：列表、新增、文本解析、AI 解读、编辑与删除。"""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
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
    JobMultiTextParseResult,
    JobTextParseRequest,
    JobTextParseResult,
)
from ..services import trash
from ..services.actions import add_action_route
from ..services.actions.domains.jobs import job_actions
from ..services.actions.pilots import pilot_actions
from ..services.attachments import (
    assert_attachment_budget,
    image_data_urls,
    normalize_extraction_images,
    total_attachment_bytes,
)
from ..services.document_text import extract_documents_text
from ..services.job.job_csv import (
    MAX_IMPORT_FILE_CHARS,
    decode_csv_bytes,
    jobs_to_csv_text,
    parse_job_csv,
    row_to_payload,
)
from ..services.job.job_multi_parser import extract_multiple_jobs, local_multi_drafts
from ..services.job.job_queries import filtered_query as _filtered_query
from ..services.job.job_queries import jobs_by_ids
from ..services.job.job_service import create_job_record, find_job_by_identity
from ..services.job.job_sorting import JobSort, JobSortOrder, job_order_by
from ..services.job_text_parser import parse_job_text
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.settings_service import get_llm_config
from ..services.text_extraction import (
    ai_failed_warning,
    extract_job_text,
    finalize_recognition_result,
    llm_is_configured,
    mark_local_fallback,
    no_model_warning,
)

router = APIRouter(prefix="/api/jobs", tags=["jobs"])
logger = logging.getLogger(__name__)


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


add_action_route(router, job_actions()["list_jobs"])


@router.get("/ids", response_model=list[int])
def list_job_ids(
    db: Session = Depends(get_db),
    keyword: str = Query(default=""),
    job_type: str = Query(default=""),
    status: str = Query(default=""),
    favorite: bool | None = Query(default=None),
    source_kind: str = Query(default=""),
    sort: JobSort = Query(default="created_desc"),
    order: JobSortOrder | None = Query(default=None),
):
    """当前筛选下**全部**岗位的 id（不分页）：批量选择「全选全部岗位」用。

    id 列表本身很轻（几千条也只是几 KB），把筛选逻辑交给前端分页拉取反而要多轮请求；
    批量操作 500 的上限由前端在拿到列表后裁决——这里如实返回全量。

    排序参数与 ``/jobs`` 完全同源（同一份 ``job_order_by``）：跨页全选拿到的 id 顺序
    必须与用户看到的列表一致，否则"全选后批量导出/改状态"的处理顺序会莫名其妙。
    """
    return [
        job_id
        for (job_id,) in _filtered_query(db, keyword, job_type, status, favorite, source_kind)
        .order_by(*job_order_by(sort, order))
        .with_entities(Job.id)
        .all()
    ]


add_action_route(router, job_actions()["create_job"])


@router.post("/parse-text", response_model=JobTextParseResult)
async def parse_job_text_draft(payload: JobTextParseRequest, db: Session = Depends(get_db)):
    """把用户粘贴的招聘信息（或截图、文档）解析为草稿；确认后仍由新增岗位接口入库。"""
    try:
        images = normalize_extraction_images(payload.images)
        # PDF/DOCX 解析是同步 CPU/IO 重活（pypdf 最多 30 页），下沉线程池。
        documents = await run_in_threadpool(extract_documents_text, payload.documents)
        assert_attachment_budget(
            count=len(payload.images) + len(payload.documents),
            total_bytes=total_attachment_bytes(images) + documents.size_bytes,
        )
    except ValueError as exc:
        # 在路由层抛：只有 HTTPException 的 detail 会被前端原样展示。
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # PDF 扫描页渲染出的图片并进同一图片通路：与用户截图一样走视觉识别。
    image_urls = image_data_urls(images) + list(documents.images)
    has_images = bool(image_urls)
    has_documents = bool(payload.documents)

    # 文档文字与粘贴文本合并成同一份 source_text：本地规则与模型看到的材料一致，
    # 字段锚定也仍然对着原文，比图片那条"让模型自己抄录再核对"的路子强。
    source_text = "\n\n".join(part for part in (payload.text, documents.text) if part.strip())
    local_draft = parse_job_text(source_text)
    config = get_llm_config(db)
    if not llm_is_configured(config):
        return finalize_recognition_result(
            mark_local_fallback(local_draft, no_model_warning(has_images, has_documents)),
            has_images=has_images,
            document_warnings=documents.warnings,
        )
    provider = create_provider(config)
    db.close()
    try:
        result = await extract_job_text(provider, source_text, local_draft, image_urls)
    except LLMError as exc:
        logger.warning("岗位文本 AI 识别失败，已回退本地解析：%s", exc)
        result = mark_local_fallback(
            local_draft, ai_failed_warning(has_images, str(exc), has_documents)
        )
    except Exception:  # noqa: BLE001 - 外部模型异常不能阻断草稿解析
        logger.exception("岗位文本 AI 识别发生内部错误，已回退本地解析")
        result = mark_local_fallback(
            local_draft, ai_failed_warning(has_images, has_documents=has_documents)
        )
    return finalize_recognition_result(
        result, has_images=has_images, document_warnings=documents.warnings
    )


@router.post("/parse-multiple", response_model=JobMultiTextParseResult)
async def parse_job_text_multiple(payload: JobTextParseRequest, db: Session = Depends(get_db)):
    """一次粘贴多份招聘信息：拆成多份草稿，用户逐条或全部保存。

    与单份 ``/parse-text`` 共用输入校验与兜底策略：没有可用模型、或模型切不出来时，
    退回本地按显式分隔切分，绝不返回一份"吞掉了其它几份"的草稿。AI 识别偶发抖动
    （如没抄录图片文字、没输出 jobs 数组）会先原样重试一次再回退。本地兜底对纯图片
    无字可切时也保证 ``items`` **至少一条**（空内容草稿 + 原因说明）——响应契约是
    items 非空，前端据此解构第一份草稿的 warnings 与字段。
    """
    try:
        images = normalize_extraction_images(payload.images)
        # PDF/DOCX 解析是同步 CPU/IO 重活（pypdf 最多 30 页），下沉线程池。
        documents = await run_in_threadpool(extract_documents_text, payload.documents)
        assert_attachment_budget(
            count=len(payload.images) + len(payload.documents),
            total_bytes=total_attachment_bytes(images) + documents.size_bytes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # PDF 扫描页渲染出的图片并进同一图片通路：与用户截图一样走视觉识别。
    image_urls = image_data_urls(images) + list(documents.images)
    has_images = bool(image_urls)
    has_documents = bool(payload.documents)
    source_text = "\n\n".join(part for part in (payload.text, documents.text) if part.strip())
    if not source_text.strip() and not image_urls:
        raise HTTPException(status_code=422, detail="缺少招聘信息或截图、文档")

    def _local_items(reason: str) -> list[JobTextParseResult]:
        drafts = local_multi_drafts(source_text)
        if not drafts:
            # 纯图片输入时本地规则无字可切（本地没有 OCR），但本接口的响应契约是
            # items 至少一条：前端按 items[0] 解构 warnings 与字段，空列表会让它
            # 炸出 "Cannot destructure property 'warnings'" 的英文 TypeError。
            # 返回一份空内容草稿，前端走"没有识别到内容"的正常提示并保留原因说明。
            drafts = [parse_job_text("")]
        return [mark_local_fallback(draft, reason) for draft in drafts]

    config = get_llm_config(db)
    if not llm_is_configured(config):
        items = _local_items(no_model_warning(has_images, has_documents))
        return JobMultiTextParseResult(
            items=[
                finalize_recognition_result(
                    item, has_images=has_images, document_warnings=documents.warnings
                )
                for item in items
            ],
            parse_engine="local",
        )

    provider = create_provider(config)
    db.close()
    try:
        results = await extract_multiple_jobs(provider, source_text, image_urls)
        engine = "ai"
    except LLMError as exc:
        logger.warning("多份岗位 AI 识别失败，已回退本地切分：%s", exc)
        results = _local_items(ai_failed_warning(has_images, str(exc), has_documents))
        engine = "local"
    except Exception:  # noqa: BLE001 - 外部模型异常不能阻断草稿解析
        logger.exception("多份岗位 AI 识别发生内部错误，已回退本地切分")
        results = _local_items(ai_failed_warning(has_images, "", has_documents))
        engine = "local"

    items = [
        finalize_recognition_result(
            item, has_images=has_images, document_warnings=documents.warnings
        )
        for item in results
    ]
    return JobMultiTextParseResult(items=items, parse_engine=engine)


@router.post("/batch-status", response_model=JobBatchStatusResult)
def batch_update_job_status(payload: JobBatchStatusRequest, db: Session = Depends(get_db)):
    if payload.status not in JOB_STATUSES:
        allowed = "、".join(JOB_STATUSES)
        raise HTTPException(status_code=400, detail=f"无效的岗位状态，可选值：{allowed}")

    jobs = _get_jobs_or_404(db, payload.job_ids)
    for job in jobs:
        job.status = payload.status
    _commit_batch(db)
    return JobBatchStatusResult(updated=len(jobs))


@router.post("/batch-delete", response_model=JobBatchDeleteResult)
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


@router.post("/export")
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


@router.post("/import/preview", response_model=JobImportPreview)
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


@router.post("/import", response_model=JobImportResult)
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


# T28 首批：GET /api/jobs/{job_id} 由契约层生成（ActionSpec 是参数/权限唯一真源）。
# 注册位置仍由本文件里的调用点显式决定（原来的装饰器位置，保持注册顺序）。
add_action_route(router, pilot_actions()["get_job"])


add_action_route(router, job_actions()["update_job"])


@router.delete("/{job_id}", status_code=204)
def delete_job(job_id: int, db: Session = Depends(get_db)):
    """移入回收站（软删除）。

    岗位是采集/粘贴攒起来的，一次误点不该让它彻底消失；而且岗位被删后**关联的投递记录会保留
    快照并按既有约定置空 job_id**，所以软删除与真删在这条行为上没有区别。
    彻底删除在「回收站」里单独提供（不可恢复，需二次确认）。
    """
    job = db.get(Job, job_id)
    if job is None or trash.is_deleted(job):
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")
    trash.soft_delete(db, "job", job)
    db.commit()
