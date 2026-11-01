# SPDX-License-Identifier: Apache-2.0
"""投递批次明细的分页端点（B4 按需加载）。

``GET /records/grouped`` 走轻量模式（``include_items=false``）时组内不带明细，展开某个
批次由这里分页拉取。**过滤语义与 grouped 完全同源**：复用 ``_records._matched_items_query``
（关键词/结果筛选、软删过滤、只含投递批次），组内记录与组头 ``matched_count`` 对得上。

独立成模块的原因与 ``apply_tasks_page.py`` 相同：``api/apply.py`` 的行数预算吃紧
（``test_file_size_budget`` 守卫 500 行），由 ``api/apply.py`` include 进 ``/api/apply``
路由树（**这里不写 prefix**：include 会把宿主路由的 ``/api/apply`` 再前置一遍）。
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.apply import ApplyTaskItem
from ..schemas.apply import (
    ApplyRecordBatchDeleteRequest,
    ApplyRecordBatchDeleteResult,
    ApplyRecordOut,
    ApplyRecordRetryBatchRequest,
    ApplyRecordRetryBatchResult,
    ApplyTaskCreate,
    ApplyTaskOut,
)
from ..schemas.common import Page
from ..services import trash
from ..services.apply import apply_service, task_runner

router = APIRouter(tags=["apply"])


@router.get("/records/batches/{task_id}/items", response_model=Page[ApplyRecordOut])
def list_record_batch_items(
    task_id: int,
    keyword: str = Query(default=""),
    result: str = Query(default="", description="success / failed / skipped"),
    failure_category: str = Query(default="", description="#39：按失败分类筛选（空 = 不过滤）"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """分页返回一个批次内命中当前筛选的投递记录（按 sort_order, id 排序）。

    记录可软删：已删的记录不会出现（与 grouped 的口径一致）。
    """
    items, total = apply_service.list_batch_items(
        db,
        task_id,
        keyword=keyword,
        result=result,
        failure_category=failure_category,
        page=page,
        page_size=page_size,
    )
    return Page(items=items, total=total)


@router.post("/records/retry-batch", response_model=ApplyRecordRetryBatchResult)
def retry_batch_records(payload: ApplyRecordRetryBatchRequest, db: Session = Depends(get_db)):
    """「只重试这 N 条」（#39）：把某批次里命中当前筛选的失败记录一起重投。

    按**筛选条件**收参而不是 record_ids：明细表是服务端分页的，前端手上没有全集；
    服务端用与 grouped / items 同一套查询重新选，选出的条数与组头显示的
    retryable_count 一致。

    只选状态为失败的记录（成功/跳过没有需要重投的失败）。选出来的记录里若岗位已被
    删除（job_id 为空）就跳过——重投需要岗位；一条都重投不了时给 404，不建空批次。
    """
    items = apply_service.select_retryable_items(
        db,
        payload.task_id,
        keyword=payload.keyword,
        result=payload.result,
        failure_category=payload.failure_category,
    )
    if not items:
        raise HTTPException(status_code=404, detail="该批次里没有命中筛选的失败记录可重投")
    job_ids = list(dict.fromkeys(item.job_id for item in items if item.job_id is not None))
    if not job_ids:
        raise HTTPException(status_code=409, detail="这些记录对应的岗位已被删除，无法重投")
    try:
        task = apply_service.create_apply_task(
            db, ApplyTaskCreate(job_ids=job_ids, use_queue=False)
        )
    except apply_service.ApplyServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except task_runner.TaskRunnerError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return ApplyRecordRetryBatchResult(
        retried=len(job_ids), task=ApplyTaskOut.model_validate(task)
    )


@router.post("/records/batch-delete", response_model=ApplyRecordBatchDeleteResult)
def batch_delete_apply_records(
    payload: ApplyRecordBatchDeleteRequest, db: Session = Depends(get_db)
):
    """批量移入回收站（软删除）：单次上限 500，与简历/资料批量删除同一口径。

    语义对齐单条 ``DELETE /records/{record_id}``（``_records.delete_record`` 的
    trash key ``apply_record``）：任何一条 id 不存在或已在回收站里即整体 404 并附
    缺失 id 清单，不做"删一半"。只软删记录，不动批次本身（同整批删除的语义）。
    **声明在 ``/records/batches/{task_id}/items`` 之后不冲突**（方法不同，且
    ``batch-delete`` 是字面量段、``batches/{task_id}`` 不含它）。
    """
    items: list[ApplyTaskItem] = []
    missing: list[int] = []
    for record_id in payload.record_ids:
        item = trash.get_live(db, ApplyTaskItem, record_id)
        if item is None:
            missing.append(record_id)
        else:
            items.append(item)
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"以下投递记录不存在或已被删除：{'、'.join(map(str, missing))}",
        )
    for item in items:
        trash.soft_delete(db, "apply_record", item)
    db.commit()
    return ApplyRecordBatchDeleteResult(deleted=len(items))
