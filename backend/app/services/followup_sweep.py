# SPDX-License-Identifier: Apache-2.0
"""跟进巡检（期一）：沉默超过阈值的求职进度 → 一张可决策的跟进卡。

## 为什么是"两张卡、两个桶"

``is_stalled`` 的语义是「超过 N 天**没有任何更新**」，**不是**「面试卡住」——用户可能
只是忘了维护。所以沉默分成两档，**互斥**：

- 超过 ``FOLLOWUP_SILENCE_DAYS``（=7，与看板同源）且不超过 21 天：跟进卡，问"要不要
  发一条跟进？"；
- 超过 ``CONFIRM_SILENCE_DAYS``（21 天）：确认卡，先说"要不要确认一下当前状态？"——
  拿三周前的旧数据催跟进，是在制造噪音。

两个桶各一个去重键（``agent_task.source_ref``）+ 同一 ISO 周（``occurrence_key``），
由 ``uq_agent_task_source_occurrence`` 兜底：同一桶同一周最多一张卡，并发扫描撞唯一
约束时只丢这一轮（``begin_nested`` 保存点），不会出第二张。

## 边界规则（逐条落进实现）

- **总开关复用 T26 的** ``get_agent_task_events_enabled``：关闭时不写任何行，已建的卡
  保留不追删（用户关的是"以后别自动建"，不是"把我已有的卡删掉"）。
- **只读本地库、不调模型**：话术由本模块的模板常量渲染，离线可用、可断言、不外发。
- **让位规则（防双响）**：某条进度挂着 ``hr_reply`` 提醒、且该提醒最近 7 天内已经出过
  「准备」卡 → 本轮跳过这条进度；否则同一天用户会看到同一家公司的两张卡。
- **用户最近表过态就不打扰**：近 7 天内有 ``contacted`` / ``replied`` 决策、或历史上
  标过 ``stopped``（永久）的进度不入选。
- **单桶上限 5 家、合成一张卡**：按 ``updated_at`` 升序取最久没动的 5 家；其余等下周。
- **文案双向自检**：禁词 + 必备要素两条互不掩盖；建卡时再跑一次，命中禁词/缺要素就用
  兜底模板并 ``logger.warning``（"守卫真的在跑"的证据，而不是只写在测试里）。

调度不新起线程：``agent_task_events.run_for_current_dataset`` 在提醒扫描之后、**同一
Session / 租约**里调 :func:`scan_stalled_tracks``（计划 §6.1.1）。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.agent_task import (
    AGENT_TASK_SOURCE_FOLLOWUP,
    AGENT_TASK_SOURCE_REF_STALLED_CONFIRM,
    AGENT_TASK_SOURCE_REF_STALLED_FOLLOWUP,
    AGENT_TASK_SOURCE_REMINDER,
    AGENT_TASK_STATUS_DRAFT,
    AgentTask,
    AgentTaskStep,
)
from ..models.followup import (
    FOLLOWUP_DECISION_CONTACTED,
    FOLLOWUP_DECISION_REPLIED,
    FOLLOWUP_DECISION_STOPPED,
    ApplicationFollowUp,
)
from ..models.profile import utcnow
from ..models.reminder import REMINDER_KIND_HR_REPLY, Reminder
from ..models.tracker import (
    ACTIVE_STATUSES,
    CONFIRM_SILENCE_DAYS,
    FOLLOWUP_SILENCE_DAYS,
    ApplicationTrack,
)
from .settings_service import get_agent_task_events_enabled

logger = logging.getLogger(__name__)

#: 单桶单卡最多几家公司：20 家沉默时其余等下周，不刷屏。
MAX_TRACKS_PER_BUCKET = 5
#: 让位窗口：该进度的 hr_reply 提醒卡最近这么久内建过，本轮巡检让位。
DEFERRAL_WINDOW = timedelta(days=7)
#: 近期决策窗口：这段时间内用户已经表过态的进度不再打扰。
RECENT_DECISION_WINDOW = timedelta(days=7)

#: 文案禁词：``is_stalled`` 不证明"对方没回"，所以这类断言一句都不许出现。
FORBIDDEN_PHRASES: tuple[str, ...] = ("HR 没回", "对方还没回复你", "已读不回", "面试卡住")
#: 每条文案必须含的"口径"：说清只是"没有记录到变化"，不替对方下结论。
REQUIRED_FRAGMENT = "没有记录到任何状态变化"

#: 跟进桶（>7 天）步骤文案模板。要素：天数 + REQUIRED_FRAGMENT + "要不要…？"。
FOLLOWUP_STEP_TEMPLATE = (
    "投出 {days} 天，{company} · {title} 期间没有记录到任何状态变化，要不要发一条跟进？"
)
#: 确认桶（>21 天）步骤文案模板。要素同上，问的是"确认状态"而不是"发跟进"。
CONFIRM_STEP_TEMPLATE = (
    "投出 {days} 天，{company} · {title} 期间没有记录到任何状态变化，要不要确认一下当前状态？"
)
#: 模板自检未通过时的兜底：同样含全部要素，但不掺公司/岗位文本（坏输入可能带禁词）。
FALLBACK_STEP_TEMPLATE = "投出 {days} 天，期间没有记录到任何状态变化，要不要看一下这条投递？"

FOLLOWUP_TASK_TITLE = "跟进：本周有 {count} 家需要问一下"
CONFIRM_TASK_TITLE = "确认：{count} 家状态可能过期"
_TASK_GOAL = "跟进巡检生成的卡：只把该问的问题摆出来，不会自动发消息，也不会改你的进度状态。"

#: 桶 → 步骤 kind（前端按 step.kind 分支：确认桶不展示"发跟进"类动作）。
_STEP_KIND = {
    AGENT_TASK_SOURCE_REF_STALLED_FOLLOWUP: "followup",
    AGENT_TASK_SOURCE_REF_STALLED_CONFIRM: "confirm",
}
_BUCKETS: tuple[str, ...] = (
    AGENT_TASK_SOURCE_REF_STALLED_FOLLOWUP,
    AGENT_TASK_SOURCE_REF_STALLED_CONFIRM,
)

_TITLE_MAX_CHARS = 200


def _as_naive_utc(value: datetime) -> datetime:
    """全库时间口径是 naive UTC；注入的 aware 时钟先归一。"""
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _local_week_key(moment: datetime) -> str:
    """卡的周键：**本地日期**所在 ISO 周（如 ``2026-W45``）。

    ``moment` 是 naive UTC（全库口径）；"周"是给人看的节奏，所以按本地时区取日期。
    时区变更不重算历史周键——卡是按生成那一刻的本地周去重的。
    """
    local = (
        moment.replace(tzinfo=UTC).astimezone() if moment.tzinfo is None else moment.astimezone()
    )
    year, week, _day = local.isocalendar()
    return f"{year}-W{week:02d}"


def _days_since(updated_at: datetime, moment: datetime) -> int:
    """沉默天数，向上取整：刚过 7 天阈值显示"8 天"，不显示"7 天"。"""
    seconds = max(0, int((moment - updated_at).total_seconds()))
    return max(1, (seconds + 86399) // 86400)


def _bucket_of(age: timedelta) -> str | None:
    """按沉默时长分桶；两桶互斥（>21 天只算确认桶），未超阈值返回 None。

    阈值**读模块级名字**而不是把字面量抄进分支：``FOLLOWUP_SILENCE_DAYS`` 是
    ``models.tracker.FOLLOWUP_SILENCE_DAYS``（= ``STALLED_DAYS`` 的别名）的引用，
    改一处阈值时本文件与看板必须一起变（``test_followup_thresholds_single_source``）。
    """
    if age > timedelta(days=CONFIRM_SILENCE_DAYS):
        return AGENT_TASK_SOURCE_REF_STALLED_CONFIRM
    if age > timedelta(days=FOLLOWUP_SILENCE_DAYS):
        return AGENT_TASK_SOURCE_REF_STALLED_FOLLOWUP
    return None


def check_step_text(text: str, *, expected_days: int) -> str | None:
    """双向自检：返回未通过原因（None = 通过）。禁词与必备要素互不掩盖。

    这是唯一的"什么算合格文案"的实现——建卡时的运行时自检与测试断言都调它。
    """
    if not text or not text.strip():
        return "空文案"
    for phrase in FORBIDDEN_PHRASES:
        if phrase in text:
            return f"命中禁词「{phrase}」"
    if f"{expected_days} 天" not in text:
        return f"缺少天数（{expected_days} 天）"
    if REQUIRED_FRAGMENT not in text:
        return "缺少「没有记录到任何状态变化」口径"
    if "要不要" not in text or "？" not in text:
        return "缺少「要不要…？」式提问"
    return None


def _template_for(bucket: str) -> str:
    if bucket == AGENT_TASK_SOURCE_REF_STALLED_CONFIRM:
        return CONFIRM_STEP_TEMPLATE
    return FOLLOWUP_STEP_TEMPLATE


def _render_step_title(bucket: str, track: ApplicationTrack, days: int) -> str:
    """渲染一条步骤文案；运行时自检不过就用兜底模板并告警（不静默出坏文案）。"""
    company = (track.company or "").strip() or "这家公司"
    title = (track.title or "").strip() or "这个岗位"
    text = _template_for(bucket).format(days=days, company=company, title=title)
    problem = check_step_text(text, expected_days=days)
    if problem is not None:
        logger.warning("跟进卡文案自检未通过（%s），改用兜底模板 track_id=%s", problem, track.id)
        text = FALLBACK_STEP_TEMPLATE.format(days=days)
    return text[:_TITLE_MAX_CHARS]


def _task_title(bucket: str, count: int) -> str:
    template = (
        CONFIRM_TASK_TITLE
        if bucket == AGENT_TASK_SOURCE_REF_STALLED_CONFIRM
        else FOLLOWUP_TASK_TITLE
    )
    return template.format(count=count)[:_TITLE_MAX_CHARS]


def _card_exists(db: Session, bucket: str, week_key: str) -> bool:
    """桶键是否已出过卡：命中则本轮不再建第二张（并发窗口由唯一约束兜底）。"""
    statement = (
        select(AgentTask.id)
        .where(
            AgentTask.source == AGENT_TASK_SOURCE_FOLLOWUP,
            AgentTask.source_ref == bucket,
            AgentTask.occurrence_key == week_key,
        )
        .limit(1)
    )
    return db.execute(statement).first() is not None


def _candidate_tracks(db: Session) -> list[ApplicationTrack]:
    """未软删、进行中、有时间戳的进度记录（两桶的公共候选池）。"""
    rows = db.scalars(
        select(ApplicationTrack).where(
            ApplicationTrack.deleted_at.is_(None),
            ApplicationTrack.status.in_(tuple(ACTIVE_STATUSES)),
            ApplicationTrack.updated_at.is_not(None),
        )
    ).all()
    return list(rows)


def _deferred_track_ids(db: Session, track_ids: list[int], moment: datetime) -> set[int]:
    """让位规则：hr_reply 提醒最近 7 天内出过「准备」卡的进度，本轮跳过。"""
    if not track_ids:
        return set()
    reminder_rows = db.execute(
        select(Reminder.id, Reminder.track_id).where(
            Reminder.track_id.in_(track_ids),
            Reminder.kind == REMINDER_KIND_HR_REPLY,
        )
    ).all()
    reminder_track = {reminder_id: track_id for reminder_id, track_id in reminder_rows}
    if not reminder_track:
        return set()
    recent_reminder_ids = db.scalars(
        select(AgentTask.reminder_id).where(
            AgentTask.source == AGENT_TASK_SOURCE_REMINDER,
            AgentTask.reminder_id.in_(tuple(reminder_track)),
            AgentTask.created_at >= moment - DEFERRAL_WINDOW,
        )
    ).all()
    deferred: set[int] = set()
    for reminder_id in recent_reminder_ids:
        if reminder_id is None:
            continue
        track_id = reminder_track.get(reminder_id)
        if track_id is not None:
            deferred.add(track_id)
    return deferred


def _recently_decided_track_ids(db: Session, track_ids: list[int], moment: datetime) -> set[int]:
    """近期已表过态 / 永久停止的进度：contacted·replied 7 天内，stopped 永久。"""
    if not track_ids:
        return set()
    rows = db.execute(
        select(
            ApplicationFollowUp.track_id,
            ApplicationFollowUp.decision,
            ApplicationFollowUp.decided_at,
        ).where(ApplicationFollowUp.track_id.in_(track_ids))
    ).all()
    excluded: set[int] = set()
    cutoff = moment - RECENT_DECISION_WINDOW
    for track_id, decision, decided_at in rows:
        recently_answered = (
            decision in (FOLLOWUP_DECISION_CONTACTED, FOLLOWUP_DECISION_REPLIED)
            and decided_at is not None
            and _as_naive_utc(decided_at) >= cutoff
        )
        if decision == FOLLOWUP_DECISION_STOPPED or recently_answered:
            excluded.add(track_id)
    return excluded


def _build_card(
    db: Session, bucket: str, tracks: list[ApplicationTrack], week_key: str, moment: datetime
) -> AgentTask:
    """把一个桶里入选的岗位合成为**一张** draft 卡；每岗一步、output_ref 指回 track。"""
    from ..runtime import dataset_scope  # 函数级导入：与提醒扫描同一取舍（见 agent_task_events）

    steps: list[AgentTaskStep] = []
    for index, track in enumerate(tracks):
        days = _days_since(track.updated_at, moment)
        steps.append(
            AgentTaskStep(
                step_index=index,
                kind=_STEP_KIND[bucket],
                title=_render_step_title(bucket, track, days),
                output_ref={"track_id": int(track.id)},
            )
        )
    return AgentTask(
        conversation_id=None,
        dataset_key=dataset_scope.current_dataset_id(),
        title=_task_title(bucket, len(tracks)),
        goal=_TASK_GOAL,
        status=AGENT_TASK_STATUS_DRAFT,
        resume_cursor=0,
        source=AGENT_TASK_SOURCE_FOLLOWUP,
        source_ref=bucket,
        occurrence_key=week_key,
        steps=steps,
    )


def scan_stalled_tracks(
    db: Session,
    *,
    now: datetime | None = None,
    enabled: bool | None = None,
) -> dict[str, Any]:
    """扫一次当前数据集的"沉默进度"，两桶各生成至多一张卡（幂等）。

    ``now`` 可注入（测试不写死时钟）；``enabled=None`` 时读 T26 同一开关，
    明确传 False 用于断言"关闭时零副作用"。

    返回 ``{"enabled", "created", "skipped", "created_task_ids"}``。其中
    ``skipped`` 是"本轮候选里没有进卡"的岗位数：被让位/近期决策排除、超过单桶上限、
    桶键已存在、或撞唯一约束的。低于阈值的进度不算候选，也不计入。
    """
    if enabled is None:
        enabled = get_agent_task_events_enabled(db)
    if not enabled:
        return {"enabled": False, "created": 0, "skipped": 0, "created_task_ids": []}

    moment = _as_naive_utc(now or utcnow())
    week_key = _local_week_key(moment)
    candidates = _candidate_tracks(db)
    track_ids = [int(track.id) for track in candidates]
    excluded = _deferred_track_ids(db, track_ids, moment) | _recently_decided_track_ids(
        db, track_ids, moment
    )

    grouped: dict[str, list[ApplicationTrack]] = {bucket: [] for bucket in _BUCKETS}
    skipped = 0
    for track in candidates:
        if track.id in excluded:
            skipped += 1
            continue
        bucket = _bucket_of(moment - _as_naive_utc(track.updated_at))
        if bucket is None:
            continue
        grouped[bucket].append(track)

    created_ids: list[int] = []
    for bucket in _BUCKETS:
        bucket_tracks = grouped[bucket]
        if not bucket_tracks:
            continue
        if _card_exists(db, bucket, week_key):
            skipped += len(bucket_tracks)
            continue
        bucket_tracks.sort(key=lambda track: (track.updated_at, track.id))
        selected = bucket_tracks[:MAX_TRACKS_PER_BUCKET]
        skipped += len(bucket_tracks) - len(selected)
        task = _build_card(db, bucket, selected, week_key, moment)
        try:
            # SAVEPOINT：并发扫描撞唯一约束时只丢这一轮，不拖垮提醒扫描。
            with db.begin_nested():
                db.add(task)
                db.flush()
        except IntegrityError:
            logger.info("跟进桶已被其它扫描生成，跳过 bucket=%s week=%s", bucket, week_key)
            skipped += len(selected)
            continue
        created_ids.append(int(task.id))

    db.commit()
    if created_ids:
        logger.info(
            "跟进巡检生成任务卡 %s 张（候选 %s 条，跳过 %s 条）",
            len(created_ids),
            len(candidates),
            skipped,
        )
    return {
        "enabled": True,
        "created": len(created_ids),
        "skipped": skipped,
        "created_task_ids": created_ids,
    }


__all__ = [
    "DEFERRAL_WINDOW",
    "FALLBACK_STEP_TEMPLATE",
    "FOLLOWUP_STEP_TEMPLATE",
    "FORBIDDEN_PHRASES",
    "CONFIRM_STEP_TEMPLATE",
    "MAX_TRACKS_PER_BUCKET",
    "RECENT_DECISION_WINDOW",
    "REQUIRED_FRAGMENT",
    "check_step_text",
    "scan_stalled_tracks",
]
