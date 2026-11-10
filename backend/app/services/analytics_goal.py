# SPDX-License-Identifier: Apache-2.0
"""周投递目标（清单 §17.3-C6，2026-11-10 第 17 条）。

目标值存本数据集的 AppSetting（JSON，一行一个键），与其它运行时设置同一套模式；
它只影响统计页的一块对照，不参与任何投递流程。**目标为 0 = 没设目标**（默认），
不是"目标为零次"——界面上不显示进度条，只保留输入框。

本周投递数按 applied_at（用户填的投递日期）落在**本周一至周日**的记录数：业务日期是
用户在通知上看到的日期，不该按"记录创建时间"算（补录上周的投递不该算进本周）。
日期解析沿用 analytics_breakdowns.parse_iso_date 的严格口径。
"""

from __future__ import annotations

import json
from datetime import date, timedelta

from sqlalchemy.orm import Session

from ..models.setting import AppSetting
from ..models.tracker import ApplicationTrack
from . import trash
from .analytics_breakdowns import parse_iso_date

_WEEKLY_GOAL_KEY = "analytics_weekly_goal"
# 上限只防误填（一周 100 次投递已经极端）；0 表示没设目标。
MIN_WEEKLY_GOAL = 0
MAX_WEEKLY_GOAL = 100


def get_weekly_goal(db: Session) -> int:
    """读取本周投递目标；没设过/脏数据一律按 0（没设目标）处理，不抛 500。"""
    row = db.get(AppSetting, _WEEKLY_GOAL_KEY)
    if row is None or not row.value:
        return 0
    try:
        value = int(json.loads(row.value).get("target", 0))
    except (ValueError, TypeError, AttributeError):
        return 0
    return value if MIN_WEEKLY_GOAL <= value <= MAX_WEEKLY_GOAL else 0


def save_weekly_goal(db: Session, target: int) -> int:
    """写入目标值（0-100），返回落库后的值。越界由调用方（schema）先拦。"""
    value = max(MIN_WEEKLY_GOAL, min(MAX_WEEKLY_GOAL, int(target)))
    serialized = json.dumps({"target": value}, ensure_ascii=False)
    row = db.get(AppSetting, _WEEKLY_GOAL_KEY)
    if row is None:
        db.add(AppSetting(key=_WEEKLY_GOAL_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()
    return value


def week_applied_count(db: Session, *, today: date | None = None) -> int:
    """本周（周一-周日）按 applied_at 落在区间内的有效投递条数。"""
    current = today or date.today()
    monday = current - timedelta(days=current.weekday())
    week_dates = {(monday + timedelta(days=offset)).isoformat() for offset in range(7)}
    rows = db.query(ApplicationTrack.applied_at).filter(trash.live_only(ApplicationTrack)).all()
    return sum(1 for (raw,) in rows if parse_iso_date(raw) and raw.strip() in week_dates)


def weekly_goal_block(db: Session, *, today: date | None = None) -> dict:
    """看板里的"目标 vs 实际"一块：目标值 + 本周已投数。"""
    return {
        "target": get_weekly_goal(db),
        "this_week_count": week_applied_count(db, today=today),
    }


__all__ = [
    "MAX_WEEKLY_GOAL",
    "MIN_WEEKLY_GOAL",
    "get_weekly_goal",
    "save_weekly_goal",
    "week_applied_count",
    "weekly_goal_block",
]
