# SPDX-License-Identifier: Apache-2.0
"""Agent 任务的状态迁移：start / wait-approval / pause / resume / mark_waiting / fail / cancel。

与 `agent_task_service.py` 的分工：本模块只做"状态怎么变、什么状态允许变、重复调用怎么
幂等"；创建、读取、完成步骤（推进游标）留在 service。拆开的原因是 T20 新增两个端点后
service 单文件会超过 500 行硬闸门；所有函数都在 service 命名空间重新导出，调用方无感。

统一语义：
- **非法迁移显式抛 `AgentTaskError`（ValueError 子类）**，不静默；
- **同一状态上的重复调用幂等**（网络重试/双击不是用户错误）：已 running 再 start、已
  暂停再 pause、已等待再 wait-approval、已失败再 fail、已取消再 cancel 都返回当前快照；
- **条件写**（`cas_task`）保证并发请求里只有一个能改状态，抢不到的回滚后返回快照或报
  "状态已变化"。
"""

from __future__ import annotations

from typing import Any, cast

from sqlalchemy import update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from ..models.agent_task import (
    AGENT_TASK_ACTIVE_STATUSES,
    AGENT_TASK_STATUS_CANCELLED,
    AGENT_TASK_STATUS_DONE,
    AGENT_TASK_STATUS_DRAFT,
    AGENT_TASK_STATUS_FAILED,
    AGENT_TASK_STATUS_PAUSED,
    AGENT_TASK_STATUS_RUNNING,
    AGENT_TASK_STATUS_WAITING_APPROVAL,
    AGENT_TASK_STEP_STATUS_DONE,
    AGENT_TASK_STEP_STATUS_FAILED,
    AGENT_TASK_STEP_STATUS_PENDING,
    AGENT_TASK_STEP_STATUS_RUNNING,
    AGENT_TASK_STEP_STATUS_SKIPPED,
    AGENT_TASK_STEP_STATUS_WAITING_APPROVAL,
    AgentTask,
    AgentTaskStep,
)
from ..models.profile import utcnow
from .agent_task_core import (
    PROGRESS_STATUSES,
    WAITING_STATUSES,
    AgentTaskError,
    cas_task,
    current_step,
    load_task,
)


def start(db: Session, task_id: int) -> AgentTask:
    """draft → running；已在 running 时幂等返回快照（不是非法迁移）。"""
    task = load_task(db, task_id)
    if task.status == AGENT_TASK_STATUS_RUNNING:
        return task
    if task.status != AGENT_TASK_STATUS_DRAFT:
        raise AgentTaskError(f"任务当前状态为「{task.status}」，不能开始")
    return cas_task(
        db,
        task_id,
        allowed=(AGENT_TASK_STATUS_DRAFT,),
        values={"status": AGENT_TASK_STATUS_RUNNING, "updated_at": utcnow()},
        idempotent_status=AGENT_TASK_STATUS_RUNNING,
    )


def wait_approval_for_step(db: Session, task_id: int, step_index: int) -> AgentTask:
    """把**当前步骤**置 waiting_approval；重复调用同一步幂等。

    只接受"当前步骤"（= `resume_cursor`）：允许指定任意步骤会让 UI 或调用方跳过前面的
    步骤去放行后面某步，破坏"一步一推进"的顺序契约。
    """
    if step_index < 0:
        raise AgentTaskError("step_index 不能为负")
    task = load_task(db, task_id)
    if step_index != task.resume_cursor:
        raise AgentTaskError(
            f"只能让当前步骤等待审批（当前是第 {task.resume_cursor} 步），不能跳步"
        )
    return mark_waiting_approval(db, task_id)


def pause(db: Session, task_id: int) -> AgentTask:
    """draft/running/waiting_approval → paused；已在 paused 时幂等返回。"""
    task = load_task(db, task_id)
    if task.status == AGENT_TASK_STATUS_PAUSED:
        return task
    if task.status not in PROGRESS_STATUSES:
        raise AgentTaskError(f"任务当前状态为「{task.status}」，不能暂停")
    return cas_task(
        db,
        task_id,
        allowed=PROGRESS_STATUSES,
        values={"status": AGENT_TASK_STATUS_PAUSED, "updated_at": utcnow()},
        idempotent_status=AGENT_TASK_STATUS_PAUSED,
    )


def resume(db: Session, task_id: int) -> AgentTask:
    """paused → running；若当前步骤仍在等待审批，恢复后仍停在 waiting_approval。"""
    task = load_task(db, task_id)
    if task.status in (AGENT_TASK_STATUS_RUNNING, AGENT_TASK_STATUS_WAITING_APPROVAL):
        return task
    if task.status != AGENT_TASK_STATUS_PAUSED:
        raise AgentTaskError(f"任务当前状态为「{task.status}」，只有 paused 可以恢复")
    step = current_step(db, task)
    waiting = step is not None and step.status == AGENT_TASK_STEP_STATUS_WAITING_APPROVAL
    target_status = AGENT_TASK_STATUS_WAITING_APPROVAL if waiting else AGENT_TASK_STATUS_RUNNING
    return cas_task(
        db,
        task_id,
        allowed=(AGENT_TASK_STATUS_PAUSED,),
        values={"status": target_status, "updated_at": utcnow()},
        idempotent_status=target_status,
    )


def mark_waiting_approval(db: Session, task_id: int) -> AgentTask:
    """把当前步骤与任务一起置为 waiting_approval；之后只有用户操作能推进它。"""
    task = load_task(db, task_id)
    if task.status == AGENT_TASK_STATUS_WAITING_APPROVAL:
        return task
    if task.status not in WAITING_STATUSES:
        raise AgentTaskError(f"任务当前状态为「{task.status}」，不能标记为等待审批")
    step = current_step(db, task)
    if step is None:
        raise AgentTaskError("任务已经没有待执行的步骤，不能标记为等待审批")
    now = utcnow()
    # 条件写必须读 rowcount；显式收窄成 DML 的运行时真实类型。
    updated = cast(
        "CursorResult[Any]",
        db.execute(
            update(AgentTaskStep)
            .where(
                AgentTaskStep.id == step.id,
                AgentTaskStep.status.in_(
                    (AGENT_TASK_STEP_STATUS_PENDING, AGENT_TASK_STEP_STATUS_RUNNING)
                ),
            )
            .values(
                status=AGENT_TASK_STEP_STATUS_WAITING_APPROVAL,
                started_at=step.started_at or now,
            )
            .execution_options(synchronize_session=False)
        ),
    )
    if (updated.rowcount or 0) == 0:
        db.rollback()
        refreshed = load_task(db, task_id)
        if refreshed.status == AGENT_TASK_STATUS_WAITING_APPROVAL:
            return refreshed
        raise AgentTaskError("当前步骤已变化，请刷新后重试")
    return cas_task(
        db,
        task_id,
        allowed=WAITING_STATUSES,
        values={"status": AGENT_TASK_STATUS_WAITING_APPROVAL, "updated_at": now},
        idempotent_status=AGENT_TASK_STATUS_WAITING_APPROVAL,
    )


def fail(db: Session, task_id: int, error: str = "任务执行失败") -> AgentTask:
    """非终态 → failed；已 failed 幂等返回，done/cancelled 不允许再改。"""
    task = load_task(db, task_id)
    if task.status == AGENT_TASK_STATUS_FAILED:
        return task
    if task.status in (AGENT_TASK_STATUS_DONE, AGENT_TASK_STATUS_CANCELLED):
        raise AgentTaskError(f"任务当前状态为「{task.status}」，不能标记为失败")
    message = (error or "").strip() or "任务执行失败"
    now = utcnow()
    step = current_step(db, task)
    if step is not None and step.status not in (
        AGENT_TASK_STEP_STATUS_DONE,
        AGENT_TASK_STEP_STATUS_SKIPPED,
    ):
        db.execute(
            update(AgentTaskStep)
            .where(
                AgentTaskStep.id == step.id,
                AgentTaskStep.status != AGENT_TASK_STEP_STATUS_DONE,
            )
            .values(
                status=AGENT_TASK_STEP_STATUS_FAILED,
                error=message,
                started_at=step.started_at or now,
                finished_at=now,
            )
            .execution_options(synchronize_session=False)
        )
    values = {
        "status": AGENT_TASK_STATUS_FAILED,
        "error": message,
        "finished_at": now,
        "updated_at": now,
    }
    return cas_task(
        db,
        task_id,
        allowed=AGENT_TASK_ACTIVE_STATUSES,
        values=values,
        idempotent_status=AGENT_TASK_STATUS_FAILED,
    )


def cancel(db: Session, task_id: int) -> AgentTask:
    """非终态 → cancelled，未完成的步骤置 skipped；已 cancelled 幂等返回。"""
    task = load_task(db, task_id)
    if task.status == AGENT_TASK_STATUS_CANCELLED:
        return task
    if task.status in (AGENT_TASK_STATUS_DONE, AGENT_TASK_STATUS_FAILED):
        raise AgentTaskError(f"任务当前状态为「{task.status}」，不能取消")
    now = utcnow()
    db.execute(
        update(AgentTaskStep)
        .where(
            AgentTaskStep.task_id == task.id,
            AgentTaskStep.status.notin_(
                (
                    AGENT_TASK_STEP_STATUS_DONE,
                    AGENT_TASK_STEP_STATUS_FAILED,
                    AGENT_TASK_STEP_STATUS_SKIPPED,
                )
            ),
        )
        .values(status=AGENT_TASK_STEP_STATUS_SKIPPED, finished_at=now)
        .execution_options(synchronize_session=False)
    )
    values = {
        "status": AGENT_TASK_STATUS_CANCELLED,
        "finished_at": now,
        "updated_at": now,
    }
    return cas_task(
        db,
        task_id,
        allowed=AGENT_TASK_ACTIVE_STATUSES,
        values=values,
        idempotent_status=AGENT_TASK_STATUS_CANCELLED,
    )


__all__ = [
    "cancel",
    "fail",
    "mark_waiting_approval",
    "pause",
    "resume",
    "start",
    "wait_approval_for_step",
]
