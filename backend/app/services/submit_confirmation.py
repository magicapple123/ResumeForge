# SPDX-License-Identifier: Apache-2.0
"""「我已提交」（期一 T05）：把一条投递记录升级成"真的投出去了"的进度 + 跟进提醒。

## 为什么需要一个独立服务

投递台的成功记录描述的是"自动投递动作完成了"，但用户最终是否亲手点了提交、是否
在浏览器里补完了 OTP，只有用户自己知道。这个端点是**用户的一次显式确认**，它写三样
东西（同一事务）：

1. 一条 ``application_track```（经 ``record_applied``，合并键去重；已在面试/更后状态
   不会被降级——``record_applied`` 本身不改已有状态）；
2. 一条 7 天后到期的 ``hr_reply`` 提醒（同 track 已有 pending 的复用，不新增行、不改
   时间——重复点击不能让提醒无限延期）；
3. 一次性引导标记 ``followup_sweep_hint_shown``（开关关 → 不弹也不标记，等用户开了
   开关再弹一次，而不是把它永久吞掉）。

投递快照由 ``record_applied`` 内部的 ``freeze_delivery`` 留下，幂等键
``apply_task_item:{id}``：连点 3 次行数不变（track 1 / reminder 1 / delivery 1）。

契约见 ``D:/rf_verify/contracts/CONTRACTS.md`` B 节。一次性引导键的私有 helper 就放
在本文件：它只有一个消费点，为它新增 settings_service 的导出面没有收益。
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.apply import ITEM_STATUS_SUCCESS, ApplyTaskItem
from ..models.profile import utcnow
from ..models.reminder import REMINDER_KIND_HR_REPLY, REMINDER_STATUS_PENDING, Reminder
from ..models.setting import AppSetting
from ..models.tracker import ApplicationTrack
from ..schemas.followup import SubmitConfirmationOut
from ..schemas.tracker import TrackRecordIn
from . import trash
from .settings_service import get_agent_task_events_enabled
from .tracker import record_applied
from .tracker_merge import _find_by_key

logger = logging.getLogger(__name__)

#: 一次性引导的持久化键：true = 已经给用户看过一次「7 天后可以跟进」的提示。
FOLLOWUP_HINT_SETTING_KEY = "followup_sweep_hint_shown"
#: 「我已提交」后挂的 hr_reply 提醒：7 天后提醒"该问一下了"。
HR_REPLY_REMINDER_DAYS = 7
#: 提醒标题模板：一眼看出它属于哪家公司哪个岗位。
HR_REPLY_TITLE_TEMPLATE = "跟进：{company} · {job_title}"
_TITLE_MAX_CHARS = 200


class SubmitConfirmationError(ValueError):
    """带 HTTP 状态码的业务错误：由 api 层映射成 4xx（与 ApplyServiceError 同款口径）。"""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _track_payload(company: str, title: str) -> TrackRecordIn:
    return TrackRecordIn(company=company, title=title)


def _upsert_hr_reply_reminder(
    db: Session,
    *,
    track: ApplicationTrack,
    company: str,
    job_title: str,
    moment: datetime,
) -> tuple[Reminder, bool]:
    """同 track 的 pending hr_reply 提醒存在就复用（不新增、不改时间），否则 +7 天新建。"""
    existing = db.scalars(
        select(Reminder)
        .where(
            Reminder.track_id == track.id,
            Reminder.kind == REMINDER_KIND_HR_REPLY,
            Reminder.status == REMINDER_STATUS_PENDING,
            Reminder.deleted_at.is_(None),
        )
        .order_by(Reminder.id)
    ).first()
    if existing is not None:
        return existing, False
    reminder = Reminder(
        title=HR_REPLY_TITLE_TEMPLATE.format(company=company, job_title=job_title)[
            :_TITLE_MAX_CHARS
        ],
        remind_at=moment + timedelta(days=HR_REPLY_REMINDER_DAYS),
        kind=REMINDER_KIND_HR_REPLY,
        track_id=track.id,
    )
    db.add(reminder)
    db.flush()
    return reminder, True


def _hint_already_shown(db: Session) -> bool:
    """读一次性引导键；缺失/脏数据一律当"没展示过"（宁可多弹一次，不静默吞掉）。"""
    row = db.get(AppSetting, FOLLOWUP_HINT_SETTING_KEY)
    if row is None:
        return False
    try:
        value = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        return False
    return value is True


def _claim_followup_hint(db: Session) -> bool:
    """返回"这次要不要展示引导"，并在同一事务里落"已展示"（即消费一次）。

    开关关 → 返回 False 且**不标记**：用户还没开巡检，提示也不该弹；等他开了，
    第一次「我已提交」仍然应该看到它。
    """
    if not get_agent_task_events_enabled(db):
        return False
    if _hint_already_shown(db):
        return False
    row = db.get(AppSetting, FOLLOWUP_HINT_SETTING_KEY)
    serialized = json.dumps(True)
    if row is None:
        db.add(AppSetting(key=FOLLOWUP_HINT_SETTING_KEY, value=serialized))
    else:
        row.value = serialized
    return True


def mark_submitted(db: Session, record_id: int) -> SubmitConfirmationOut:
    """处理一次「我已提交」；返回写侧回执（行数不变的重放得到同样的 id）。"""
    item = trash.get_live(db, ApplyTaskItem, record_id)
    if item is None:
        raise SubmitConfirmationError(404, "投递记录不存在或已被删除")
    if item.status != ITEM_STATUS_SUCCESS:
        raise SubmitConfirmationError(409, "只有投递成功的记录才能标记为已提交")
    company = (item.company or "").strip()
    job_title = (item.job_title or "").strip()
    if not company or not job_title:
        raise SubmitConfirmationError(409, "投递记录缺少公司或岗位信息，无法标记为已提交")

    payload = _track_payload(company, job_title)
    created_track = _find_by_key(db, payload) is None
    moment = utcnow()
    try:
        record_applied(
            db,
            company=company,
            title=job_title,
            job_id=item.job_id,
            resume_id=item.resume_id,
            resume_title=item.resume_title or "",
            attempt_key=f"apply_task_item:{item.id}",
            user_confirmed=True,
        )
        track = _find_by_key(db, payload)
        if track is None:  # 防御：record_applied 只在公司/岗位为空时跳过，而上面已排除
            raise SubmitConfirmationError(409, "无法建立求职进度记录，请检查投递记录")
        reminder, created_reminder = _upsert_hr_reply_reminder(
            db, track=track, company=company, job_title=job_title, moment=moment
        )
        show_hint = _claim_followup_hint(db)
        track_id = int(track.id)
        reminder_id = int(reminder.id)
        due_at = reminder.remind_at
        db.commit()
    except Exception:
        db.rollback()
        raise

    logger.info(
        "「我已提交」record_id=%s track_id=%s reminder_id=%s created_track=%s created_reminder=%s",
        record_id,
        track_id,
        reminder_id,
        created_track,
        created_reminder,
    )
    return SubmitConfirmationOut(
        record_id=record_id,
        track_id=track_id,
        reminder_id=reminder_id,
        reminder_due_at=due_at,
        created_track=created_track,
        created_reminder=created_reminder,
        show_followup_hint=show_hint,
    )


__all__ = [
    "FOLLOWUP_HINT_SETTING_KEY",
    "HR_REPLY_REMINDER_DAYS",
    "HR_REPLY_TITLE_TEMPLATE",
    "SubmitConfirmationError",
    "mark_submitted",
]
