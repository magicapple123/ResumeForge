"""投递队列端点（自 ``api/apply.py`` 拆出）。

拆分原因与 ``apply_tasks_page.py`` 相同：``api/apply.py`` 的 500 行预算零余量，
队列这 5 个端点整体搬过来，由 ``api/apply.py`` include 进 ``/api/apply`` 路由树
（**这里不写 prefix**）。行为变化只有一处（P2-2）：``GET /queue`` 加 500 条上限，
响应带 ``total`` 与 ``truncated``，超出部分不再全量下发；增删改语义逐字保留。

队列子路由之间保持原有相对顺序：``/queue/reorder``（字面量段）先于
``/queue/{item_id}``（参数段）注册，与拆分前一致。
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.apply import (
    ApplyQueueAddRequest,
    ApplyQueueItemOut,
    ApplyQueueItemUpdate,
    ApplyQueueListOut,
    ApplyQueueReorderRequest,
)
from ..services.apply import apply_service

router = APIRouter(tags=["apply"])


def _raise(exc: apply_service.ApplyServiceError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/queue", response_model=ApplyQueueListOut)
def get_queue(db: Session = Depends(get_db)):
    """列出投递队列；超过上限时如实标记 ``truncated``，不再静默全量下发。"""
    items = apply_service.list_queue(db)
    total = apply_service.count_queue(db)
    return ApplyQueueListOut(items=items, total=total, truncated=len(items) < total)


@router.post("/queue", response_model=list[ApplyQueueItemOut])
def add_to_queue(payload: ApplyQueueAddRequest, db: Session = Depends(get_db)):
    try:
        return apply_service.add_to_queue(db, payload)
    except apply_service.ApplyServiceError as exc:
        _raise(exc)


@router.patch("/queue/reorder", response_model=list[ApplyQueueItemOut])
def reorder_queue(payload: ApplyQueueReorderRequest, db: Session = Depends(get_db)):
    return apply_service.reorder_queue(db, payload.order)


@router.patch("/queue/{item_id}", response_model=ApplyQueueItemOut)
def update_queue_item(item_id: int, payload: ApplyQueueItemUpdate, db: Session = Depends(get_db)):
    try:
        return apply_service.update_queue_item(db, item_id, payload)
    except apply_service.ApplyServiceError as exc:
        _raise(exc)


@router.delete("/queue/{item_id}", status_code=204)
def delete_queue_item(item_id: int, db: Session = Depends(get_db)):
    try:
        apply_service.remove_queue_item(db, item_id)
    except apply_service.ApplyServiceError as exc:
        _raise(exc)
    return None
