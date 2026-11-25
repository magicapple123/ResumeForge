# SPDX-License-Identifier: Apache-2.0
"""通知偏好（CR-29）：六个开关的读写与判定，一处实现。

为什么单独成模块：``settings_service.py`` 已经贴着单文件 500 行预算，而通知偏好的
读写 + 静默时段判定是**一组**语义，塞进大文件只会让"改默认值要翻三个文件"重演。

六个开关与默认值口径（§9）——**要你做决定的默认打断，只告知结果的默认安静**：

    notify_reminder_due   提醒到点     默认开（决策类：可能马上就要动作）
    notify_task_waiting   需要你确认   默认开（决策类：不处理任务就卡住）
    notify_task_done      任务完成     默认关（结果类：回来看铃铛即可）
    notify_batch_done     批次完成     默认关（结果类）
    notify_sound          提示音       默认开（只在有提示时响；结果类本身不提示）
    notify_quiet_hours    静默时段     默认关（22:00–08:00 内不弹窗/不出声，inbox 照常记）

静默时段是**通道级**的抑制：inbox 行仍然写（错过还能回看），只是不打断。这与
"关掉任务完成提醒"不同——后者表示"这类事件根本不想被告知"，前者是"这个时间别吵"。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, time
from typing import Any

from sqlalchemy.orm import Session

from ..models.setting import AppSetting
from .settings_defaults import default_for

logger = logging.getLogger(__name__)

KEY_REMINDER_DUE = "notify_reminder_due"
KEY_TASK_WAITING = "notify_task_waiting"
KEY_TASK_DONE = "notify_task_done"
KEY_BATCH_DONE = "notify_batch_done"
KEY_SOUND = "notify_sound"
KEY_QUIET_HOURS = "notify_quiet_hours"

#: 静默时段的固定窗口（不含起始、含结束）。只给一个开关，不做时间选择器：
#: 夜间静默是绝对多数场景，做成可配置窗口只会多一组要先解释的输入框。
QUIET_START = "22:00"
QUIET_END = "08:00"

KIND_KEYS: dict[str, str] = {
    "reminder_due": KEY_REMINDER_DUE,
    "task_waiting": KEY_TASK_WAITING,
    "task_done": KEY_TASK_DONE,
    "batch_done": KEY_BATCH_DONE,
}

#: 允许通过 PUT 写的键（写入口的白名单；拼错键名时明确报错，而不是静默落一个没人读的行）。
SETTING_KEYS: frozenset[str] = frozenset(
    (KEY_REMINDER_DUE, KEY_TASK_WAITING, KEY_TASK_DONE, KEY_BATCH_DONE, KEY_SOUND, KEY_QUIET_HOURS)
)


@dataclass(frozen=True)
class NotificationSettings:
    """六个开关的快照（不可变；写操作整份返回新快照）。"""

    reminder_due: bool
    task_waiting: bool
    task_done: bool
    batch_done: bool
    sound: bool
    quiet_hours: bool

    def as_payload(self) -> dict[str, bool]:
        return {
            KEY_REMINDER_DUE: self.reminder_due,
            KEY_TASK_WAITING: self.task_waiting,
            KEY_TASK_DONE: self.task_done,
            KEY_BATCH_DONE: self.batch_done,
            KEY_SOUND: self.sound,
            KEY_QUIET_HOURS: self.quiet_hours,
        }


def _flag(db: Session, key: str) -> bool:
    """读一个布尔开关；缺失或脏数据退回注册表出厂值（与 settings_service 同口径）。"""
    fallback = bool(default_for(key))
    row = db.get(AppSetting, key)
    if row is None:
        return fallback
    try:
        value = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        logger.warning("通知开关数据损坏，已按出厂值处理 key=%s", key)
        return fallback
    return value if isinstance(value, bool) else fallback


def read_notification_settings(db: Session) -> NotificationSettings:
    return NotificationSettings(
        reminder_due=_flag(db, KEY_REMINDER_DUE),
        task_waiting=_flag(db, KEY_TASK_WAITING),
        task_done=_flag(db, KEY_TASK_DONE),
        batch_done=_flag(db, KEY_BATCH_DONE),
        sound=_flag(db, KEY_SOUND),
        quiet_hours=_flag(db, KEY_QUIET_HOURS),
    )


def save_notification_settings(db: Session, patch: dict[str, Any]) -> NotificationSettings:
    """按 ``notify_*`` 键写库；未给出的键保持原值。非法值直接拒绝（不写脏数据）。"""
    unknown = [key for key in patch if key not in SETTING_KEYS]
    if unknown:
        raise ValueError(f"未知的通知开关：{'、'.join(sorted(unknown))}")
    for key, value in patch.items():
        if value is None:
            continue
        if not isinstance(value, bool):
            raise ValueError(f"通知开关必须是布尔值：{key}")
        serialized = json.dumps(value)
        row = db.get(AppSetting, key)
        if row is None:
            db.add(AppSetting(key=key, value=serialized))
        else:
            row.value = serialized
    db.commit()
    return read_notification_settings(db)


def notify_allowed(db: Session, kind: str) -> bool:
    """这一类事件要不要写通知/发通道。未知类型放行（新增类型先能跑，再登记开关）。"""
    key = KIND_KEYS.get(kind)
    if key is None:
        return True
    settings = read_notification_settings(db)
    return {
        KEY_REMINDER_DUE: settings.reminder_due,
        KEY_TASK_WAITING: settings.task_waiting,
        KEY_TASK_DONE: settings.task_done,
        KEY_BATCH_DONE: settings.batch_done,
    }[key]


def _parse_clock(value: str) -> time | None:
    try:
        hour, minute = str(value).split(":")
        return time(int(hour), int(minute))
    except (TypeError, ValueError):
        return None


def quiet_active(db: Session, *, now: datetime | None = None) -> bool:
    """现在是否落在静默时段（默认 22:00–08:00，跨午夜）。开关关掉恒为 False。"""
    if not _flag(db, KEY_QUIET_HOURS):
        return False
    moment = now or datetime.now()
    start = _parse_clock(QUIET_START)
    end = _parse_clock(QUIET_END)
    if start is None or end is None:  # pragma: no cover - 常量写死，纯防御
        return False
    current = moment.time()
    if start <= end:
        return start <= current < end
    # 跨午夜：22:00–08:00 = [22:00, 24:00) ∪ [00:00, 08:00)
    return current >= start or current < end


__all__ = [
    "KEY_BATCH_DONE",
    "KEY_QUIET_HOURS",
    "KEY_REMINDER_DUE",
    "KEY_SOUND",
    "KEY_TASK_DONE",
    "KEY_TASK_WAITING",
    "KIND_KEYS",
    "NotificationSettings",
    "QUIET_END",
    "QUIET_START",
    "SETTING_KEYS",
    "notify_allowed",
    "quiet_active",
    "read_notification_settings",
    "save_notification_settings",
]
