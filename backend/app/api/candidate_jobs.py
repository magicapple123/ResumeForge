"""备选岗位接口：暂存招聘信息、编辑与导入标记。"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.material import CANDIDATE_JOB_STATUSES
from ..schemas.common import Page
from ..schemas.material import (
    CandidateJobBulkImportOut,
    CandidateJobBulkImportRequest,
    CandidateJobCreate,
    CandidateJobDetailOut,
    CandidateJobImportRequest,
    CandidateJobOut,
    CandidateJobUpdate,
)
from ..services.candidate_jobs import (
    MAX_CANDIDATE_LIST,
    candidate_or_none,
    create_candidate_job,
    delete_candidate_job,
    import_candidates,
    list_candidate_jobs,
    list_candidate_jobs_page,
    mark_candidate_imported,
    update_candidate_job,
)
from ..services.user_files import save_from_data_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/candidate-jobs", tags=["candidate-jobs"])


def _save_image_copies(db: Session, candidate_id: int, images: list[str]) -> None:
    """best-effort：把备选岗位截图 data URL 落一份磁盘副本（失败只记日志）。"""
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
