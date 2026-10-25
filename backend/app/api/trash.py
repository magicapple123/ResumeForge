# SPDX-License-Identifier: Apache-2.0
"""回收站接口：查看、恢复、彻底删除、清空。

薄路由：只做校验、调 service、返回 schema。

**为什么恢复与彻底删除是两个不同的接口**：它们对用户是两件风险完全不同的事——恢复是安全的、
彻底删除不可逆。合成一个"删除"接口（用参数区分）会让前端某次传错参数就变成不可逆操作，
而这种错误在界面上完全看不出来。
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.trash import (
    TrashBatchRequest,
    TrashEmptyOut,
    TrashItemOut,
    TrashPurgeBatchOut,
    TrashRestoreBatchOut,
    TrashSummaryOut,
)
from ..services import trash

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/trash", tags=["trash"])


def _require_spec(type_key: str) -> trash.TrashSpec:
    spec = trash.spec_or_none(type_key)
    if spec is None:
        raise HTTPException(status_code=404, detail="未知的内容类型")
    return spec


def _restore_conflict_response(exc: trash.RestoreConflict) -> JSONResponse:
    """恢复撞上活动行唯一约束 → 409（带具体原因与稳定 code）。

    不用 @@BT@@HTTPException(detail=...)@@BT@@：那会把 @@BT@@{"detail","code"}@@BT@@ 再包一层
    @@BT@@detail@@BT@@，前端按 code 分支的路径与其它接口不一致；这里直接给顶层两个键。
    """
    return JSONResponse(
        status_code=409,
        content={"detail": exc.detail, "code": "trash_restore_conflict"},
    )


@router.get("", response_model=TrashSummaryOut)
def read_trash(
    type: str = Query(default="", description="按类型筛选；留空表示全部"),
    db: Session = Depends(get_db),
):
    """回收站内容：总量、按类型的计数、类型名，以及条目列表（按删除时间倒序）。"""
    if type:
        _require_spec(type)
    counted = trash.counts(db)
    return TrashSummaryOut(
        counts=counted,
        labels={spec.key: spec.label for spec in trash.TRASH_SPECS},
        items=[TrashItemOut(**item) for item in trash.list_trashed(db, key=type)],
        total=sum(counted.values()),
    )


@router.post("/{type_key}/{item_id}/restore", status_code=204)
def restore_item(type_key: str, item_id: int, db: Session = Depends(get_db)):
    """把一条内容从回收站恢复；撞上活动行唯一约束（重名/排序位被占）时返回 409。"""
    _require_spec(type_key)
    try:
        restored = trash.restore(db, type_key, item_id)
    except trash.RestoreConflict as exc:
        return _restore_conflict_response(exc)
    if not restored:
        raise HTTPException(status_code=404, detail="回收站里没有这条内容（可能已被恢复或彻底删除）")


@router.delete("/{type_key}/{item_id}", status_code=204)
def purge_item(type_key: str, item_id: int, db: Session = Depends(get_db)):
    """**彻底删除**一条内容——不可恢复。

    只接受**已经在回收站里**的记录：这样"删除"永远先经过可恢复的一步，
    界面上也就不存在"点一下就没了"的路径。
    """
    _require_spec(type_key)
    if not trash.purge(db, type_key, item_id):
        raise HTTPException(status_code=404, detail="回收站里没有这条内容（可能已被恢复或彻底删除）")


@router.delete("", response_model=TrashEmptyOut)
def empty_trash(
    type: str = Query(default="", description="只清空某一类；留空表示全部清空"),
    db: Session = Depends(get_db),
):
    """清空回收站（**不可恢复**）。返回真正删掉的条数。"""
    if type:
        _require_spec(type)
    return TrashEmptyOut(removed=trash.empty(db, key=type))


@router.post("/restore", response_model=TrashRestoreBatchOut)
def restore_items(payload: TrashBatchRequest, db: Session = Depends(get_db)):
    """批量恢复（安全，无需二次确认）。逐条反馈哪几条成功、哪几条没成。

    任一选中条目恢复后会撞上活动行唯一约束（重名/排序位被占）时整批拒绝：409 含具体原因，
    已恢复的条目随事务回滚，不出现"恢复了一半"。
    """
    try:
        return trash.restore_many(db, [item.model_dump() for item in payload.items])
    except trash.RestoreConflict as exc:
        return _restore_conflict_response(exc)


@router.post("/purge", response_model=TrashPurgeBatchOut)
def purge_items(payload: TrashBatchRequest, db: Session = Depends(get_db)):
    """批量**彻底删除**（不可恢复；二次确认由前端负责）。逐条反馈哪几条成功、哪几条没成。"""
    return trash.purge_many(db, [item.model_dump() for item in payload.items])
