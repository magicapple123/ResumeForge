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
)
from ..schemas.common import Page
from ..services import trash
from ..services.apply import apply_service

router = APIRouter(tags=["apply"])


@router.get("/records/batches/{task_id}/items", response_model=Page[ApplyRecordOut])
def list_record_batch_items(
    task_id: int,
    keyword: str = Query(default=""),
    result: str = Query(default="", description="success / failed / skipped"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """分页返回一个批次内命中当前筛选的投递记录（按 sort_order, id 排序）。

    记录可软删：已删的记录不会出现（与 grouped 的口径一致）。
    """
    items, total = apply_service.list_batch_items(
        db, task_id, keyword=keyword, result=result, page=page, page_size=page_size
    )
    return Page(items=items, total=total)


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
