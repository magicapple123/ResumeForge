# SPDX-License-Identifier: Apache-2.0
"""T26 事件触发：提醒到期 → 生成任务卡（只生成，不执行）。

目标（master plan §5 T26）：Agent 不等用户开口，提醒到期时自动生成一张"准备"任务卡，
**不自动执行任何写操作、不发消息、不弹窗**。

边界规则（逐条落进实现，不是文档口号）：

- **开关默认关**（settings_service.get_agent_task_events_enabled）：关闭时扫描直接返回，
  已生成的任务卡保留不追删。
- **去重键 = (reminder_id, occurrence_due_at)**：同一提醒的同一到期时刻无论扫多少次
  只有一张卡（模型侧 UniqueConstraint + 本模块插入时的唯一冲突兜底）。
  提醒延期/改时间 → occurrence_due_at 变 → 允许再生成一条，旧卡保留。
- **只补最近 24 小时**：启动补扫与周期扫描都只处理 [now-24h, now] 内的 occurrence；
  应用没启动期间更早的不生成，避免开机被过期任务淹没。
- **时区**：occurrence 以本地时区计算后落成**绝对时间**（全库口径：naive UTC）；
  时区变更不重算历史 occurrence。
- **数据集隔离**：扫描只跑当前数据集（后台线程先取 dataset_scope 租约），任务落库
  带当前 dataset_key；不跨库补扫。
- **时钟可注入**：scan_due_reminders(now=...) 不写死 datetime.now()，测试与补扫共用。

调度复用现有后台模式（与 data_backup/scheduler.py 同一套：守护线程 + 可唤醒事件 +
租约），启动时由 application.lifespan 调 start_scheduler_if_enabled()。
"""

from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.agent_task import (
    AGENT_TASK_SOURCE_REMINDER,
    AGENT_TASK_STATUS_DRAFT,
    AgentTask,
    AgentTaskStep,
)
from ..models.profile import utcnow
from ..models.reminder import REMINDER_STATUS_PENDING, Reminder
from .followup_sweep import scan_stalled_tracks
from .settings_service import get_agent_task_events_enabled

logger = logging.getLogger(__name__)

#: 任务卡标题前缀：一眼看出这是"提醒到期自动生成"的准备任务。
TASK_TITLE_PREFIX = "准备："
#: 启动/周期补扫只回看这么多：更早的 occurrence 不生成（手册 T26 边界规则）。
BACKFILL_WINDOW = timedelta(hours=24)
#: 周期扫描间隔。低频即可：提醒精度到分钟，任务卡晚一分钟生成并无影响。
DEFAULT_CHECK_SECONDS = 60.0
#: 任务卡（含唯一一个确认步骤）的标题上限，与 AgentTask.title 列一致。
_TITLE_MAX_CHARS = 200
_TASK_GOAL = "提醒到期后自动生成的任务卡：只提醒你准备，不会自动执行任何写操作。"
_STEP_TITLE_PREFIX = "确认："


def _as_naive_utc(value: datetime) -> datetime:
    """全库时间口径是 naive UTC；外部若传 aware（本地时区/注入时钟）先归一。"""
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _task_title(reminder_title: str) -> str:
    base = (reminder_title or "").strip() or "提醒"
    return f"{TASK_TITLE_PREFIX}{base}"[:_TITLE_MAX_CHARS]


def _occurrence_exists(db: Session, reminder_id: int, due_at: datetime) -> bool:
    statement = (
        select(AgentTask.id)
        .where(
            AgentTask.reminder_id == reminder_id,
            AgentTask.occurrence_due_at == due_at,
        )
        .limit(1)
    )
    return db.execute(statement).first() is not None


def _create_task_for_occurrence(
    db: Session, reminder: Reminder, due_at: datetime, dataset_key: str
) -> AgentTask:
    title = _task_title(reminder.title)
    task = AgentTask(
        conversation_id=None,
        dataset_key=dataset_key,
        title=title,
        goal=_TASK_GOAL,
        status=AGENT_TASK_STATUS_DRAFT,
        resume_cursor=0,
        source=AGENT_TASK_SOURCE_REMINDER,
        reminder_id=reminder.id,
        occurrence_due_at=due_at,
    )
    # 只生成"一张待用户确认的卡"：单个确认步骤，不预先规划任何写操作。
    task.steps = [
        AgentTaskStep(
            step_index=0,
            kind="confirm",
            title=f"{_STEP_TITLE_PREFIX}{title}"[:_TITLE_MAX_CHARS],
        )
    ]
    return task


def scan_due_reminders(
    db: Session,
    *,
    now: datetime | None = None,
    window: timedelta = BACKFILL_WINDOW,
    enabled: bool | None = None,
) -> dict[str, Any]:
    """扫一次当前数据集里到期的提醒，按 occurrence 生成任务卡（幂等）。

    now 可注入（测试与"应用未启动 3 天"的补扫都用它判断 24h 窗口）；
    enabled=None 时读设置，明确传 False 用于测试"关闭时零副作用"。
    返回 {"enabled", "created", "skipped", "created_task_ids"}。
    """
    if enabled is None:
        enabled = get_agent_task_events_enabled(db)
    if not enabled:
        return {"enabled": False, "created": 0, "skipped": 0, "created_task_ids": []}

    moment = _as_naive_utc(now or utcnow())
    cutoff = moment - window
    reminders = db.scalars(
        select(Reminder)
        .where(
            Reminder.status == REMINDER_STATUS_PENDING,
            Reminder.deleted_at.is_(None),
            Reminder.remind_at <= moment,
            Reminder.remind_at >= cutoff,
        )
        .order_by(Reminder.remind_at.asc(), Reminder.id.asc())
    ).all()

    from ..runtime import dataset_scope  # 函数级导入：避免模块加载期依赖 runtime 初始化

    dataset_key = dataset_scope.current_dataset_id()
    created_ids: list[int] = []
    skipped = 0
    for reminder in reminders:
        due_at = _as_naive_utc(reminder.remind_at)
        if _occurrence_exists(db, reminder.id, due_at):
            skipped += 1
            continue
        task = _create_task_for_occurrence(db, reminder, due_at, dataset_key)
        try:
            # SAVEPOINT：并发扫描撞唯一约束时只丢这一条，不拖垮整轮。
            with db.begin_nested():
                db.add(task)
                db.flush()
        except IntegrityError:
            logger.info(
                "提醒 occurrence 已被其它扫描生成，跳过 reminder_id=%s due=%s",
                reminder.id,
                due_at,
            )
            skipped += 1
            continue
        created_ids.append(int(task.id))
    db.commit()
    if created_ids:
        logger.info(
            "提醒到期生成任务卡 %s 张（reminder 扫描 %s 条）", len(created_ids), len(reminders)
        )
    return {
        "enabled": True,
        "created": len(created_ids),
        "skipped": skipped,
        "created_task_ids": created_ids,
    }


# ---------------------------------------------------------------------------
# 后台调度（与 data_backup/scheduler.py 同一套模式：守护线程 + 可唤醒 + 数据集租约）
# ---------------------------------------------------------------------------


def run_for_current_dataset(*, now: datetime | None = None) -> dict[str, Any] | None:
    """对当前活动数据集做一次到期扫描；取不到租约（切换中）就整轮跳过。"""
    from ..database import SessionLocal
    from ..runtime import dataset_scope
    from ..runtime.log_context import bound_context

    try:
        lease = dataset_scope.acquire_lease("agent-task-events")
    except dataset_scope.DatasetScopeError:
        logger.info("数据集正在切换中，本轮提醒任务扫描跳过")
        return None
    try:
        identity = lease.identity
        with (
            bound_context(dataset_id=getattr(identity, "dataset_id", "-")),
            SessionLocal(bind=identity.engine) as db,
        ):
            result = scan_due_reminders(db, now=now)
            # 期一跟进巡检：与提醒扫描共用同一 Session / 租约 / 开关（计划 §6.1.1）。
            # 单独 try 包住：巡检失败不能改变提醒扫描的既有返回值与卡（T03 边界）。
            try:
                scan_stalled_tracks(db, now=now)
            except Exception:  # noqa: BLE001 - 巡检是旁路，绝不拖垮提醒通道
                logger.warning("跟进巡检扫描失败", exc_info=True)
            return result
    except Exception:  # noqa: BLE001 - 调度线程绝不能把服务拖垮
        logger.warning("提醒到期任务扫描失败", exc_info=True)
        return None
    finally:
        lease.release()


class ReminderTaskScheduler:
    """低频提醒扫描线程：wait 可被 trigger_check 提前唤醒。"""

    def __init__(self, check_seconds: float = DEFAULT_CHECK_SECONDS) -> None:
        self._check_seconds = max(5.0, check_seconds)
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, name="resumeforge-reminder-task-scheduler", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def trigger_check(self) -> None:
        self._wake.set()

    def _loop(self) -> None:
        logger.info("提醒任务调度启动（间隔 %.0fs）", self._check_seconds)
        while not self._stop.is_set():
            self._wake.wait(timeout=self._check_seconds)
            if self._stop.is_set():
                break
            self._wake.clear()
            run_for_current_dataset()
        logger.info("提醒任务调度退出")


_scheduler: ReminderTaskScheduler | None = None
_scheduler_lock = threading.Lock()


def start_scheduler(check_seconds: float = DEFAULT_CHECK_SECONDS) -> ReminderTaskScheduler:
    """启动（或复用）全局扫描线程；重复调用安全。"""
    global _scheduler
    with _scheduler_lock:
        if _scheduler is None:
            _scheduler = ReminderTaskScheduler(check_seconds)
        _scheduler.start()
        return _scheduler


def get_scheduler() -> ReminderTaskScheduler | None:
    return _scheduler


def stop_scheduler() -> None:
    """停止并清空全局扫描线程（进程退出/测试隔离用；重复调用安全）。"""
    global _scheduler
    with _scheduler_lock:
        if _scheduler is not None:
            _scheduler.stop()
            _scheduler = None


def trigger_check() -> None:
    """立即唤醒一次扫描；调度未启动时静默跳过。"""
    scheduler = get_scheduler()
    if scheduler is not None:
        scheduler.trigger_check()


def start_scheduler_if_enabled() -> bool:
    """启动入口（application.lifespan 调）：开关关闭时**不建空线程**。

    开启时启动线程并立即唤醒一次——这就是"启动补扫最近 24h"的路径
    （扫描内部仍按 24h 窗口裁剪，应用停机 3 天也不会批量生成）。
    """
    from ..database import SessionLocal

    with SessionLocal() as db:
        enabled = get_agent_task_events_enabled(db)
    if not enabled:
        return False
    start_scheduler()
    trigger_check()
    return True


def on_enabled_setting_changed(enabled: bool) -> None:
    """设置页把开关打开时立即生效（启动线程并马上补扫一次）；关闭时线程空转。"""
    if enabled:
        start_scheduler()
        trigger_check()


__all__ = [
    "BACKFILL_WINDOW",
    "DEFAULT_CHECK_SECONDS",
    "ReminderTaskScheduler",
    "TASK_TITLE_PREFIX",
    "get_scheduler",
    "on_enabled_setting_changed",
    "run_for_current_dataset",
    "scan_due_reminders",
    "start_scheduler",
    "start_scheduler_if_enabled",
    "stop_scheduler",
    "trigger_check",
]
