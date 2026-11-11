# SPDX-License-Identifier: Apache-2.0
"""今日简报（18B）：启动时补算一屏"今天该干什么"，只读已有数据。

关键设计约束（问题清单 #18B）：**不做常驻调度进程**。本地单用户工具常开一个 scheduler 是
负担，用户不开机它也没有意义。所以走"启动时补算 + 手动重新生成"：

- 距上次简报超过 24 小时（或跨过了设置里的发送时刻）→ 重新生成；
- 24 小时内再启动 → 原样返回上次那份（``generated_at`` 不变，证明没有重复生成）；
- 卡片上的「重新生成」= ``refresh_digest``，无条件重算。

数据全部来自已有表，**不新增采集、不联网、不调模型**：

====================  ================================================
板块                   来源
====================  ================================================
值得投的新岗位          JobMatchAnalysis（最近分析）+ 14B reference_score
7 天无回音             14C funnel.stale_records
面试倒计时 / 今天面试   tracker 的 next_action_date
已过期 / 已下架         岗位状态「已截止」（被动式，不额外抓取）
本周投递漏斗            14F funnel.summary
异动 N 条              15B JD 变更（job_seen 指纹）+ 无回音条数
====================  ================================================

存储：AppSetting 一行 JSON（零迁移）。简报是**界面卡片**，不进模型上下文——数字分与
免责文案在这里展示，助手工具侧仍遵守"不把数字评分喂给模型"的红线（见 p3_tools）。
"""

from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.apply import JobMatchAnalysis
from ..models.job import JOB_STATUS_CLOSED, JOB_STATUS_OPEN, Job
from ..models.profile import utcnow
from ..models.setting import AppSetting
from ..models.tracker import ACTIVE_STATUSES, ApplicationTrack, parse_business_date
from . import trash
from .apply import funnel, lifecycle
from .apply.signals import reference_score
from .match_scoring import _DISCLAIMER as MATCH_SCORE_DISCLAIMER

#: AppSetting 里的简报存储键（JSON：一份完整 payload）。
DIGEST_KEY = "assistant_digest"
#: 自动补算间隔（小时）。问题清单定的"距上次简报 >24h"。
REFRESH_HOURS = 24
#: 可选设置：每天的简报时刻 HH:MM（空 = 只看 24h 间隔）。跨过该时刻也会重算。
SCHEDULE_KEY = "assistant_digest_schedule"
#: 「新岗位」窗口（天）：只把最近这些天进库的岗位算"值得投的新岗位"。
NEW_JOB_DAYS = 7
WORTH_LIMIT = 5
#: 无回音 / 已截止两块各最多展示几条（计数给全量，列表只取前几条）。
LIST_LIMIT = 5
#: 面试倒计时看未来多少天。
INTERVIEW_HORIZON_DAYS = 14
#: 异动统计扫多少个在招岗位（job_seen 指纹是逐岗读；封顶避免启动时扫全库）。
ANOMALY_JOB_LIMIT = 100


# ===== 本地时间与状态存取 =====


def _local_now(now: datetime | None = None) -> datetime:
    """用户本地时间（aware）。库里时间戳是无时区 UTC，跨时区比较前必须显式换算。"""
    if now is None:
        return datetime.now().astimezone()
    return now if now.tzinfo is not None else now.astimezone()


def _local_date(value: date | None = None) -> date:
    return value if value is not None else _local_now().date()


def _read_state(db: Session) -> dict[str, Any] | None:
    row = db.get(AppSetting, DIGEST_KEY)
    if row is None:
        return None
    try:
        data = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def _write_state(db: Session, payload: dict[str, Any]) -> None:
    serialized = json.dumps(payload, ensure_ascii=False)
    row = db.get(AppSetting, DIGEST_KEY)
    if row is None:
        db.add(AppSetting(key=DIGEST_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()


def _read_schedule_time(db: Session) -> str:
    row = db.get(AppSetting, SCHEDULE_KEY)
    if row is None:
        return ""
    try:
        value = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        return ""
    return value if isinstance(value, str) else ""


def parse_schedule_time(value: str) -> time | None:
    """设置时刻 HH:MM → time；空/写坏一律 None（= 只看 24 小时间隔，不报错）。"""
    text = str(value or "").strip()
    if len(text) != 5 or text[2] != ":":
        return None
    try:
        hour, minute = int(text[:2]), int(text[3:])
    except ValueError:
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return time(hour=hour, minute=minute)


def _last_generated_at(state: dict[str, Any] | None) -> datetime | None:
    if not state:
        return None
    raw = state.get("generated_at")
    if not isinstance(raw, str):
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.astimezone()


def should_refresh(
    state: dict[str, Any] | None,
    *,
    now: datetime | None = None,
    scheduled_time: str = "",
) -> bool:
    """要不要重算：没生成过 / 超过 24h / 跨过设置时刻（当天该发还没发）。"""
    moment = _local_now(now)
    last = _last_generated_at(state)
    if last is None:
        return True
    if moment - last >= timedelta(hours=REFRESH_HOURS):
        return True
    scheduled = parse_schedule_time(scheduled_time)
    if scheduled is None:
        return False
    today_slot = datetime.combine(moment.date(), scheduled, tzinfo=moment.tzinfo)
    # 跨过今天的设置时刻、而上次简报还是"今天该发之前"的 → 该补一份今天的。
    return moment >= today_slot and last < today_slot


# ===== 各板块（全部只读）=====


def _item(job: Job) -> dict[str, Any]:
    return {"job_id": int(job.id), "title": job.title, "company": job.company}


def _worth_jobs(db: Session) -> dict[str, Any]:
    """最近 NEW_JOB_DAYS 天进库、仍在招、已分析过的岗位，按参考分取前 N。"""
    now_utc = utcnow()
    cutoff = now_utc - timedelta(days=NEW_JOB_DAYS)
    rows = (
        db.query(JobMatchAnalysis, Job)
        .join(Job, Job.id == JobMatchAnalysis.job_id)
        .filter(
            trash.live_only(Job),
            Job.status == JOB_STATUS_OPEN,
            Job.created_at >= cutoff,
        )
        .order_by(JobMatchAnalysis.created_at.desc(), JobMatchAnalysis.id.desc())
        .limit(40)
        .all()
    )
    cache: dict[str, Any] = {}
    scored: list[tuple[int, Job]] = []
    for match, job in rows:
        score = reference_score(db, job, match, cache=cache)
        if score is not None:
            scored.append((int(score), job))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    items = [{**_item(job), "score": score} for score, job in scored[:WORTH_LIMIT]]
    return {
        "key": "worth_jobs",
        "count": len(items),
        "items": items,
        "link": "/apply",
        "window_days": NEW_JOB_DAYS,
        "disclaimer": MATCH_SCORE_DISCLAIMER,
    }


def _stale_applications(db: Session) -> dict[str, Any]:
    """14C：投出去 ≥N 天、进度仍停在已投递/筛选中的记录（按静默天数降序）。"""
    result = funnel.stale_records(db)
    items = sorted(result.items, key=lambda item: item.days, reverse=True)
    return {
        "key": "stale_applications",
        "count": int(result.count),
        "items": [
            {
                "record_id": int(item.record_id),
                "job_id": int(item.job_id) if item.job_id else None,
                "title": item.job_title,
                "company": item.company,
                "days": int(item.days),
            }
            for item in items[:LIST_LIMIT]
        ],
        "link": "/apply",
        "window_days": funnel.DEFAULT_DAYS,
    }


def _interviews(db: Session, *, today: date) -> dict[str, Any]:
    """面试倒计时 / 今天有面试：tracker 的 next_action_date（未来两周内）。"""
    items: list[dict[str, Any]] = []
    for track in db.query(ApplicationTrack).filter(trash.live_only(ApplicationTrack)).all():
        if track.status not in ACTIVE_STATUSES:
            continue
        due = parse_business_date(track.next_action_date)
        if due is None:
            continue
        days = (due.date() - today).days
        if days < 0 or days > INTERVIEW_HORIZON_DAYS:
            continue
        items.append(
            {
                "track_id": int(track.id),
                "company": track.company,
                "title": track.title,
                "status": track.status,
                "next_action": track.next_action,
                "next_action_date": track.next_action_date,
                "days_until": days,
            }
        )
    items.sort(key=lambda item: (item["days_until"], item["company"]))
    return {
        "key": "interviews",
        "count": len(items),
        "today_count": sum(1 for item in items if item["days_until"] == 0),
        "items": items[:LIST_LIMIT],
        "link": "/tracker",
        "horizon_days": INTERVIEW_HORIZON_DAYS,
    }


def _expired_jobs(db: Session) -> dict[str, Any]:
    """已过期/已下架：岗位状态是「已截止」。被动式统计，不额外抓取页面。"""
    total = (
        db.query(func.count(Job.id))
        .filter(trash.live_only(Job), Job.status == JOB_STATUS_CLOSED)
        .scalar()
        or 0
    )
    rows = (
        db.query(Job)
        .filter(trash.live_only(Job), Job.status == JOB_STATUS_CLOSED)
        .order_by(Job.updated_at.desc(), Job.id.desc())
        .limit(LIST_LIMIT)
        .all()
    )
    return {
        "key": "expired_jobs",
        "count": int(total),
        "items": [_item(job) for job in rows],
        "link": "/jobs",
        "note": "按岗位状态「已截止」统计；不额外抓取招聘页，状态需要用户或采集来更新",
    }


def _funnel(db: Session) -> dict[str, Any]:
    """本周投递漏斗（14F 的 summary，窗口天数就是它的默认 7 天）。"""
    summary = funnel.summary(db)
    return {
        "key": "funnel",
        "count": int(summary.applied),
        "summary": {
            "applied": int(summary.applied),
            "succeeded": int(summary.succeeded),
            "failed": int(summary.failed),
            "interviewing": int(summary.interviewing),
        },
        "link": "/apply",
        "window_days": funnel.DEFAULT_DAYS,
    }


def _changes(db: Session, *, stale_count: int) -> dict[str, Any]:
    """异动 N 条 = JD 变更（15B 指纹）+ 无回音（14C）。排序口径与队列同一份实现。"""
    rows = (
        db.query(Job.id)
        .filter(trash.live_only(Job), Job.status == JOB_STATUS_OPEN)
        .order_by(Job.updated_at.desc(), Job.id.desc())
        .limit(ANOMALY_JOB_LIMIT)
        .all()
    )
    changed = lifecycle.jd_changed_map(db, [row[0] for row in rows])
    jd_changed = sum(1 for value in changed.values() if value)
    return {
        "count": int(jd_changed + stale_count),
        "jd_changed": int(jd_changed),
        "stale": int(stale_count),
        "link": "/jobs",
    }


def build_digest(db: Session, *, now: datetime | None = None) -> dict[str, Any]:
    """现算一份完整简报（只读 DB；不写存储态——写由 generate_digest 统一做）。"""
    moment = _local_now(now)
    stale = _stale_applications(db)
    interviews = _interviews(db, today=_local_date(moment.date()))
    return {
        "generated_at": moment.isoformat(timespec="seconds"),
        "sections": [
            _worth_jobs(db),
            stale,
            interviews,
            _expired_jobs(db),
            _funnel(db),
        ],
        "changes": _changes(db, stale_count=int(stale["count"])),
        "refresh_hours": REFRESH_HOURS,
    }


def generate_digest(db: Session, *, now: datetime | None = None) -> dict[str, Any]:
    """现算并落库（生成时间来自同一个 moment，测试可注入 now）。"""
    state = build_digest(db, now=now)
    _write_state(db, state)
    return state


def get_digest(db: Session, *, now: datetime | None = None) -> dict[str, Any]:
    """启动/打开时调用：过期或跨过设置时刻就补算，否则原样返回上次那份。"""
    stored = _read_state(db)
    if should_refresh(stored, now=now, scheduled_time=_read_schedule_time(db)):
        return generate_digest(db, now=now)
    assert stored is not None  # should_refresh 只在"没有可用状态"时才返回 True
    return stored


def refresh_digest(db: Session, *, now: datetime | None = None) -> dict[str, Any]:
    """卡片上「重新生成」：无条件重算并落库。"""
    return generate_digest(db, now=now)


__all__ = [
    "ANOMALY_JOB_LIMIT",
    "DIGEST_KEY",
    "INTERVIEW_HORIZON_DAYS",
    "LIST_LIMIT",
    "NEW_JOB_DAYS",
    "REFRESH_HOURS",
    "SCHEDULE_KEY",
    "WORTH_LIMIT",
    "build_digest",
    "generate_digest",
    "get_digest",
    "parse_schedule_time",
    "refresh_digest",
    "should_refresh",
]
