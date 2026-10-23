# SPDX-License-Identifier: Apache-2.0
"""备选岗位接口：暂存招聘信息、编辑与导入标记。"""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session
from starlette.responses import Response

from ..database import get_db
from ..models.material import CANDIDATE_JOB_STATUSES, CandidateJob
from ..schemas.common import Page
from ..schemas.material import (
    CandidateCsvExportRequest,
    CandidateCsvImportRequest,
    CandidateCsvImportResult,
    CandidateCsvPreview,
    CandidateCsvRow,
    CandidateJobBulkImportOut,
    CandidateJobBulkImportRequest,
    CandidateJobCreate,
    CandidateJobDetailOut,
    CandidateJobImportRequest,
    CandidateJobOut,
    CandidateJobUpdate,
)
from ..services import trash
from ..services.candidate_csv import (
    candidates_to_csv_text,
    decode_csv_bytes,
    import_candidate_rows,
    parse_candidate_csv,
)
from ..services.candidate_jobs import (
    MAX_CANDIDATE_LIST,
    candidate_or_none,
    create_candidate_job,
    delete_candidate_job,
    import_candidates,
    list_candidate_job_ids,
    list_candidate_jobs,
    list_candidate_jobs_page,
    mark_candidate_imported,
    update_candidate_job,
)
from ..services.csv_io import MAX_IMPORT_FILE_CHARS
from ..services.user_files import save_from_data_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/candidate-jobs", tags=["candidate-jobs"])


def _save_image_copies(db: Session, candidate_id: int, images: list[str] | None) -> None:
    """best-effort：把备选岗位截图 data URL 落一份磁盘副本（失败只记日志）。

    ``CandidateJobUpdate.images`` 允许显式传 ``null``（区分"没提这个字段"与"清空"），
    本函数对 ``None`` 与空列表同样按"没有图"处理。
    """
    for index, data_url in enumerate(images or []):
        if not data_url:
            continue
        try:
            save_from_data_url(
                db,
                str(data_url),
                source_type="candidate_image",
                source_ref=f"candidate_job:{candidate_id}",
                fallback_name=f"candidate-{candidate_id}-{index + 1}",
            )
        except Exception:  # noqa: BLE001 - 副本是锦上添花，绝不能挡住暂存
            logger.warning("备选岗位截图副本保存失败 candidate_job:%s", candidate_id, exc_info=True)


def _parse_collect_task_ids(raw: str) -> list[int]:
    """把逗号分隔的批次 id 串解析成**去重保序**的正整数列表；无效输入统一 422。"""
    if not raw.strip():
        return []
    try:
        parsed = [int(value) for value in raw.split(",") if value.strip()]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="采集批次编号无效") from exc
    if any(value < 1 for value in parsed):
        raise HTTPException(status_code=422, detail="采集批次编号无效")
    return list(dict.fromkeys(parsed))


@router.get("", response_model=list[CandidateJobOut])
def read_candidate_jobs(
    status: str = Query(default=""),
    keyword: str = Query(default=""),
    collect_task_id: int | None = Query(default=None, ge=1),
    collect_task_ids: str = Query(default=""),
    limit: int = Query(default=MAX_CANDIDATE_LIST, ge=1, le=MAX_CANDIDATE_LIST),
    db: Session = Depends(get_db),
):
    """列出备选岗位；``status`` 可选 pending / imported。

    ``collect_task_id`` 用于「本次采集结果」——按批次看这次采到了什么。
    """
    if status and status not in CANDIDATE_JOB_STATUSES:
        raise HTTPException(status_code=422, detail="无效的备选岗位状态")
    return list_candidate_jobs(
        db,
        status=status,
        keyword=keyword,
        collect_task_id=collect_task_id,
        collect_task_ids=_parse_collect_task_ids(collect_task_ids),
        limit=limit,
    )


@router.get("/page", response_model=Page[CandidateJobOut])
def read_candidate_jobs_page(
    status: str = Query(default=""),
    keyword: str = Query(default=""),
    collect_task_id: int | None = Query(default=None, ge=1),
    collect_task_ids: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """分页列出备选岗位（RF-08）：过滤与排序与旧列表端点完全一致。

    旧端点 ``GET /api/candidate-jobs`` 给 MAX_CANDIDATE_LIST（300）兜底——那是"待处理
    清单不翻页"的取舍；本端点让长期累积的历史候选**仍然全部可达**。**声明在
    ``/{candidate_id}`` 之前**：字面量段必须排在参数段前面，否则 "page" 会被当成
    candidate_id 去解析。
    """
    if status and status not in CANDIDATE_JOB_STATUSES:
        raise HTTPException(status_code=422, detail="无效的备选岗位状态")
    items, total = list_candidate_jobs_page(
        db,
        status=status,
        keyword=keyword,
        collect_task_id=collect_task_id,
        collect_task_ids=_parse_collect_task_ids(collect_task_ids),
        page=page,
        page_size=page_size,
    )
    return Page(items=items, total=total)


@router.post("", response_model=CandidateJobOut, status_code=201)
def create_candidate_job_entry(payload: CandidateJobCreate, db: Session = Depends(get_db)):
    candidate = create_candidate_job(db, payload)
    _save_image_copies(db, candidate.id, payload.images)
    return candidate


@router.post("/import", response_model=CandidateJobBulkImportOut)
def import_candidate_jobs(payload: CandidateJobBulkImportRequest, db: Session = Depends(get_db)):
    """把选中的候选岗位批量导入岗位广场（服务端建岗位并回填关联）。

    **声明在 ``/{candidate_id}`` 之前**：FastAPI 按声明顺序匹配，把具名路径放在参数路径
    后面，``/import`` 就会先被当成 ``candidate_id`` 去解析（今天靠"方法不同"侥幸不冲突，
    但以后给 ``/{candidate_id}`` 加一个 POST 就会立刻踩中），返回的 422 看起来像前端传错、
    实际是路由顺序问题。
    """
    return import_candidates(db, payload.candidate_ids)


@router.get("/ids", response_model=list[int])
def read_candidate_job_ids(
    status: str = Query(default=""),
    keyword: str = Query(default=""),
    collect_task_id: int | None = Query(default=None, ge=1),
    collect_task_ids: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """当前筛选下**全部**候选的 id（不分页）：抽屉「全选全部」用。

    **声明在 ``/{candidate_id}`` 之前**：字面量段必须排在参数段前面，否则 "ids"
    会被当成 candidate_id 去解析（与 ``/page`` 同一条铁律）。
    """
    if status and status not in CANDIDATE_JOB_STATUSES:
        raise HTTPException(status_code=422, detail="无效的备选岗位状态")
    return list_candidate_job_ids(
        db,
        status=status,
        keyword=keyword,
        collect_task_id=collect_task_id,
        collect_task_ids=_parse_collect_task_ids(collect_task_ids),
    )


@router.post("/csv/export")
def export_candidate_jobs_csv(payload: CandidateCsvExportRequest, db: Session = Depends(get_db)):
    """把勾选的候选导出成 CSV（列集与导入共用，导出的文件可以直接改完再导回）。"""
    candidates = _get_candidates_or_404(db, payload.candidate_ids)
    # 按用户选择的顺序导出，而不是数据库顺序：导出文件里行的次序与界面勾选一致。
    by_id = {candidate.id: candidate for candidate in candidates}
    ordered = [
        by_id[candidate_id] for candidate_id in payload.candidate_ids if candidate_id in by_id
    ]
    text = candidates_to_csv_text(ordered)
    return Response(
        content=text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="candidate-jobs.csv"'},
    )


@router.post("/csv/import/preview", response_model=CandidateCsvPreview)
async def preview_candidate_csv_import(file: UploadFile = File(...)):
    """解析上传的候选 CSV，返回可导入行与逐行错误（不落库，等用户确认）。"""
    raw = await file.read()
    if len(raw) > MAX_IMPORT_FILE_CHARS:
        raise HTTPException(status_code=413, detail="CSV 文件过大（上限 2MB）")
    try:
        text = decode_csv_bytes(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    rows, errors = parse_candidate_csv(text)
    return CandidateCsvPreview(
        rows=[CandidateCsvRow(line=line, data=data) for line, data in rows],
        errors=errors,
    )


@router.post("/csv/import", response_model=CandidateCsvImportResult)
def import_candidate_csv(payload: CandidateCsvImportRequest, db: Session = Depends(get_db)):
    """提交导入：逐行建候选、逐行容错；与已有候选重复的行跳过并说明。"""
    imported, failed = import_candidate_rows(db, [(item.line, item.data) for item in payload.rows])
    return CandidateCsvImportResult(imported=imported, failed=failed)


def _get_candidates_or_404(db: Session, candidate_ids: list[int]) -> list:
    """按 id 取候选，缺任何一个都 404（导出的勾选必须全部真实存在）。

    已在回收站里的候选算"不存在"：列表里看不到它就勾不到它，能拿到 id 只可能来自
    过期页面——导出一份用户以为已经删掉的数据是更糟的结果。
    """
    candidates = (
        db.query(CandidateJob)
        .filter(CandidateJob.id.in_(candidate_ids), trash.live_only(CandidateJob))
        .all()
    )
    found_ids = {candidate.id for candidate in candidates}
    missing = [candidate_id for candidate_id in candidate_ids if candidate_id not in found_ids]
    if missing:
        shown = "、".join(str(candidate_id) for candidate_id in missing)
        raise HTTPException(status_code=404, detail=f"以下备选岗位不存在：{shown}")
    return candidates


@router.get("/{candidate_id}", response_model=CandidateJobDetailOut)
def read_candidate_job(candidate_id: int, db: Session = Depends(get_db)):
    candidate = candidate_or_none(db, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="备选岗位不存在或已被删除")
    return candidate


@router.put("/{candidate_id}", response_model=CandidateJobOut)
def save_candidate_job(
    candidate_id: int, payload: CandidateJobUpdate, db: Session = Depends(get_db)
):
    candidate = candidate_or_none(db, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="备选岗位不存在或已被删除")
    updated = update_candidate_job(db, candidate, payload)
    if "images" in payload.model_fields_set:
        _save_image_copies(db, candidate.id, payload.images)
    return updated


@router.post("/{candidate_id}/imported", response_model=CandidateJobOut)
def mark_imported(
    candidate_id: int, payload: CandidateJobImportRequest, db: Session = Depends(get_db)
):
    """标记为已导入正式岗位（岗位由用户在前端确认保存后传入 id）。"""
    candidate = candidate_or_none(db, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="备选岗位不存在或已被删除")
    return mark_candidate_imported(db, candidate, payload.job_id)


@router.delete("/{candidate_id}", status_code=204)
def remove_candidate_job(candidate_id: int, db: Session = Depends(get_db)):
    if not delete_candidate_job(db, candidate_id):
        raise HTTPException(status_code=404, detail="备选岗位不存在或已被删除")
