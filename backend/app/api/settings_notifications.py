# SPDX-License-Identifier: Apache-2.0
"""通知偏好端点（`/api/settings/notifications`，CR-29）。

单独成模块的理由与 ``settings_inline_format_preview`` 相同：``api/settings.py`` 已贴
500 行硬预算，新增开关一律走子路由（前缀由父路由提供，这里不带 prefix）。

读接口同时回 ``quiet_active``：静默时段是**服务端本地时间**算的，前端不该自己再实现
一套跨午夜区间判断（两套实现一定会在边界上说得不一样）。
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.notification_settings import (
    KEY_BATCH_DONE,
    KEY_QUIET_HOURS,
    KEY_REMINDER_DUE,
    KEY_SOUND,
    KEY_TASK_DONE,
    KEY_TASK_WAITING,
    QUIET_END,
    QUIET_START,
    quiet_active,
    read_notification_settings,
    save_notification_settings,
)

router = APIRouter(tags=["settings"])


class NotificationSettingsOut(BaseModel):
    """六个开关 + 静默窗口 + 当前是否正在静默。"""

    notify_reminder_due: bool
    notify_task_waiting: bool
    notify_task_done: bool
    notify_batch_done: bool
    notify_sound: bool
    notify_quiet_hours: bool
    quiet_start: str = QUIET_START
    quiet_end: str = QUIET_END
    quiet_active: bool = False


class NotificationSettingsIn(BaseModel):
    """部分更新：只传要改的键（未传的保持原值）。"""

    notify_reminder_due: bool | None = None
    notify_task_waiting: bool | None = None
    notify_task_done: bool | None = None
    notify_batch_done: bool | None = None
    notify_sound: bool | None = None
    notify_quiet_hours: bool | None = None


def _out(db: Session) -> NotificationSettingsOut:
    settings = read_notification_settings(db)
    snapshot = settings.as_payload()
    return NotificationSettingsOut(
        **snapshot,
        quiet_start=QUIET_START,
        quiet_end=QUIET_END,
        quiet_active=quiet_active(db),
    )


@router.get("/notifications", response_model=NotificationSettingsOut)
def read_notifications(db: Session = Depends(get_db)):
    """当前通知偏好（默认：决策类开、结果类关、提示音开、静默时段关）。"""
    return _out(db)


@router.put("/notifications", response_model=NotificationSettingsOut)
def write_notifications(payload: NotificationSettingsIn, db: Session = Depends(get_db)):
    """保存通知偏好；每个开关独立落库，下一次事件立即按新值判定。"""
    patch = {
        key: value
        for key, value in payload.model_dump(exclude_none=True).items()
        if key
        in {
            KEY_REMINDER_DUE,
            KEY_TASK_WAITING,
            KEY_TASK_DONE,
            KEY_BATCH_DONE,
            KEY_SOUND,
            KEY_QUIET_HOURS,
        }
    }
    save_notification_settings(db, patch)
    return _out(db)
