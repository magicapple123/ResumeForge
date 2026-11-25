# SPDX-License-Identifier: Apache-2.0
"""通知 inbox 接口（prefix ``/api/notifications``，CR-22 提供、CR-25 接铃铛）。

本流只保证"前端轮询得到"：列表 / 未读数 / 单条已读 / 全部已读。呈现方式（页头铃铛、
未读角标、30 天归档入口）由 CR-25 的前端负责，后端不再另开口径。

写侧只有一个受限端点：``POST /ingest`` 只收「客户端可上报」的类型（后台任务 / 助手任务
到终态）。这类事件由**执行它的那一侧**最先知道——批次与 AI 任务在前端轮询到终态的那一刻，
后端线程早已结束；再让后端事后扫描一遍只会让 inbox 晚一拍。``reminder_due`` 这类服务端
专属类型仍然只能由后台事件通过 ``services.notifications.emit`` 产生，页面无法伪造一条
"系统提醒"。
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.notification import (
    CLIENT_REPORTABLE_TYPES,
    NOTIFICATION_SEVERITIES,
    NOTIFICATION_SEVERITY_INFO,
    Notification,
)
from ..services import notifications

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class NotificationOut(BaseModel):
    """一条通知的回显（不含 ``dedupe_key`` / ``dataset_key``：内部去重与归属细节）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    severity: str
    title: str
    body: str
    deep_link: str
    read_at: datetime | None
    created_at: datetime
    expires_at: datetime | None


class UnreadCountOut(BaseModel):
    unread: int


class ReadAllOut(BaseModel):
    updated: int


class NotificationIngest(BaseModel):
    """客户端上报的一条任务终态通知。

    ``dedupe_key`` 必填且非空：没有幂等键的写入会把 inbox 变成重复行仓库（前端在
    任务完成/失败/恢复三条路径上各调一次，重试与 StrictMode 双执行都会重复触达）。
    """

    type: str = Field(max_length=32)
    severity: str = NOTIFICATION_SEVERITY_INFO
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default="", max_length=2000)
    deep_link: str = Field(default="", max_length=500)
    dedupe_key: str = Field(min_length=1, max_length=200)

    @field_validator("type")
    @classmethod
    def _client_reportable(cls, value: str) -> str:
        if value not in CLIENT_REPORTABLE_TYPES:
            raise ValueError(f"不支持的通知类型：{value}")
        return value

    @field_validator("severity")
    @classmethod
    def _known_severity(cls, value: str) -> str:
        if value not in NOTIFICATION_SEVERITIES:
            raise ValueError(f"未知的严重度：{value}")
        return value


@router.get("", response_model=list[NotificationOut])
def read_notifications(
    limit: int = Query(default=50, ge=1, le=notifications.MAX_NOTIFICATION_LIST),
    before: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """按时间倒序列出未过期通知；``before`` 传上一页最后一条的 ``created_at``。"""
    notifications.cleanup_if_due(db)
    return notifications.list_notifications(db, limit=limit, before=before)


@router.get("/unread-count", response_model=UnreadCountOut)
def read_unread_count(db: Session = Depends(get_db)):
    notifications.cleanup_if_due(db)
    return UnreadCountOut(unread=notifications.unread_count(db))


@router.post("/read-all", response_model=ReadAllOut)
def mark_all_read(db: Session = Depends(get_db)):
    return ReadAllOut(updated=notifications.mark_all_read(db))


@router.post("/ingest", response_model=NotificationOut, status_code=status.HTTP_201_CREATED)
def ingest_notification(payload: NotificationIngest, db: Session = Depends(get_db)):
    """记录一条客户端上报的任务终态通知（``dedupe_key`` 幂等，重复上报返回同一行）。"""
    row = notifications.emit(
        db,
        type=payload.type,
        severity=payload.severity,
        title=payload.title,
        body=payload.body,
        deep_link=payload.deep_link,
        dedupe_key=payload.dedupe_key,
    )
    db.commit()
    return row


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: int, db: Session = Depends(get_db)):
    row: Notification | None = notifications.mark_read(db, notification_id)
    if row is None:
        raise HTTPException(status_code=404, detail="通知不存在或已过期")
    return row
