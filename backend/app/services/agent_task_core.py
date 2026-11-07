# SPDX-License-Identifier: Apache-2.0
"""Agent 任务服务的内核：错误类型、数据集归属校验与条件写原语（T19/T20）。

拆出来的原因：T20 增加 `start` / `wait-approval` 后，service 单文件会超过 500 行硬闸门。
本模块只放"服务层各文件都要用的东西"——错误类型、读任务/读步骤、条件写任务的
`cas_task`，以及"用户还能推进任务"的状态白名单；**不放任何业务动作**。

方向约束：本模块不 import `api/`，也不 import 同目录的 service/transitions（只能被它们
import），避免循环依赖。
"""

from __future__ import annotations

from typing import Any, cast

from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, selectinload

from ..models.agent_task import (
    AGENT_TASK_STATUS_DRAFT,
    AGENT_TASK_STATUS_RUNNING,
    AGENT_TASK_STATUS_WAITING_APPROVAL,
    AgentTask,
    AgentTaskStep,
)
from ..runtime import dataset_scope

#: 用户还能推进任务的状态：draft（未开始）/ running / waiting_approval。
#: 完成一步、暂停、开始都只认这些起点；终态一律拒绝。
PROGRESS_STATUSES: tuple[str, ...] = (
    AGENT_TASK_STATUS_DRAFT,
    AGENT_TASK_STATUS_RUNNING,
    AGENT_TASK_STATUS_WAITING_APPROVAL,
)
#: 允许标记"等待用户确认"的起点状态。
WAITING_STATUSES: tuple[str, ...] = (
    AGENT_TASK_STATUS_DRAFT,
    AGENT_TASK_STATUS_RUNNING,
)


class AgentTaskError(ValueError):
    """状态机/参数错误：显式失败，由 API 层映射成 4xx（不静默）。"""


class AgentTaskNotFound(LookupError):
    """任务或步骤不存在（含"存在但不属于当前数据集"，不泄露跨数据集的存在性）。"""


def current_dataset_key() -> str:
    return dataset_scope.current_dataset_id()


def select_task():
    """任务连同全部步骤一起取（步骤数很小，避免 N+1 与跨请求懒加载）。"""
    return select(AgentTask).options(selectinload(AgentTask.steps))


def load_task(db: Session, task_id: int) -> AgentTask:
    """按 id 取任务并校验数据集归属；读前先 expire，保证拿到最新提交。"""
    db.expire_all()
    task = db.scalar(select_task().where(AgentTask.id == task_id))
    if task is None or task.dataset_key != current_dataset_key():
        raise AgentTaskNotFound("Agent 任务不存在")
    return task


def find_step(db: Session, task_id: int, step_index: int) -> AgentTaskStep:
    step = db.scalar(
        select(AgentTaskStep).where(
            AgentTaskStep.task_id == task_id, AgentTaskStep.step_index == step_index
        )
    )
    if step is None:
        raise AgentTaskNotFound(f"任务里没有第 {step_index} 步")
    return step


def current_step(db: Session, task: AgentTask) -> AgentTaskStep | None:
    return db.scalar(
        select(AgentTaskStep).where(
            AgentTaskStep.task_id == task.id, AgentTaskStep.step_index == task.resume_cursor
        )
    )


def cas_task(
    db: Session,
    task_id: int,
    *,
    allowed: tuple[str, ...],
    values: dict[str, Any],
    idempotent_status: str,
) -> AgentTask:
    """条件写任务行：只有"当前状态在 allowed 内"才生效，抢不到就回滚并回读。

    回读已是目标状态（并发/重复请求先到）→ 幂等返回快照；否则状态已过期，显式抛错。
    """
    # 条件写必须读 rowcount；显式收窄成 DML 的运行时真实类型（同
    # career_scenarios/store.py 的条件写）。
    result = cast(
        "CursorResult[Any]",
        db.execute(
            update(AgentTask)
            .where(
                AgentTask.id == task_id,
                AgentTask.dataset_key == current_dataset_key(),
                AgentTask.status.in_(allowed),
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        ),
    )
    if (result.rowcount or 0) == 0:
        db.rollback()
        refreshed = load_task(db, task_id)
        if refreshed.status == idempotent_status:
            return refreshed
        raise AgentTaskError("任务状态已变化，请刷新后重试")
    db.commit()
    return load_task(db, task_id)


__all__ = [
    "PROGRESS_STATUSES",
    "WAITING_STATUSES",
    "AgentTaskError",
    "AgentTaskNotFound",
    "cas_task",
    "current_dataset_key",
    "current_step",
    "find_step",
    "load_task",
    "select_task",
]
