# SPDX-License-Identifier: Apache-2.0
"""日历提醒接口（prefix ``/api/reminders``）。

提醒的增删改查：列表 / 待办（upcoming）/ 新增 / 修改（PATCH）/ 删除。删除走软删除
（``trash.live_only`` 列表里不再出现），彻底删除在回收站里另做。

``/upcoming`` 必须注册在 ``/{reminder_id}`` 之前——虽然二者方法不同（GET vs PATCH/DELETE）
不会撞车，但顺序放前面能让"待办"这个更常用的语义不被路径参数抢走语义。
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.reminder import ReminderUpcomingOut
from ..services.actions import add_action_route
from ..services.actions.domains.reminders import reminder_actions
from ..services.actions.pilots import pilot_actions
from ..services.reminder_service import (
    delete_reminder,
    upcoming_reminders_out,
)

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api/reminders", tags=["reminders"])


# T28 Batch B：GET /api/reminders 由契约层生成（注册位置/顺序保持原装饰器位置）。
add_action_route(router, reminder_actions()["list_reminders"])


@router.get("/upcoming", response_model=list[ReminderUpcomingOut])
def read_upcoming(limit: int = Query(default=50, ge=1, le=500), db: Session = Depends(get_db)):
    """待办提醒：只返回 pending，按紧急度+提醒时间升序。"""
    return upcoming_reminders_out(db, limit=limit)


# T27 试点 2：POST /api/reminders 由契约层生成（写操作带 preview；参数/权限唯一真源）。
# 注册位置仍由本文件里的调用点显式决定（原来的装饰器位置，保持注册顺序）。
add_action_route(router, pilot_actions()["create_reminder"])


# T28 Batch B：PATCH /api/reminders/{reminder_id} 由契约层生成（可逆写，带 preview）。
add_action_route(router, reminder_actions()["update_reminder"])


@router.delete("/{reminder_id}", status_code=204)
def remove_reminder(reminder_id: int, db: Session = Depends(get_db)):
    if not delete_reminder(db, reminder_id):
        raise HTTPException(status_code=404, detail="提醒不存在或已被删除")
