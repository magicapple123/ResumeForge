# SPDX-License-Identifier: Apache-2.0
"""Agent 任务服务：创建/读取/推进 + 状态迁移与跨重启恢复的统一出口（T19/T20）。

本文件保留"创建、读取、推进"与公开门面；共享内核在 `agent_task_core.py`，状态迁移在
`agent_task_transitions.py`，启动恢复在 `agent_task_recovery.py`（拆分原因：T20 新增
start / wait-approval 后单文件会超过 500 行硬闸门）。所有原语仍在**本模块命名空间**可
import（`from app.services import agent_task_service` 后 `agent_task_service.pause(...)`
照旧可用），调用方无需感知拆分。

设计约束来自 T18 Gate 文档（`.workbuddy/audit/t18-ai-task-vs-agent-task.md`）：

- **状态机显式**：非法迁移抛 `AgentTaskError`（`ValueError` 子类），不静默吞掉；
  同一状态上的重复调用（网络重试）按幂等处理，不算非法。
- **同一步只发生一次副作用**：完成步骤是条件写（`WHERE status != done`），重复调用直接
  返回快照，不增加 `attempt`、不覆盖 `output_ref`、不重复推进游标。
- **等待审批不占线程**：`waiting_approval` 只是数据库状态，只有用户的 REST 调用能推进
  它；启动恢复只碰 running → paused（不是 failed）。
- **数据集归属**：`dataset_key` 创建时写入 `dataset_scope.current_dataset_id()`，任何读写
  都先核对（备份导入可能把别的数据集的旧行留在当前库）。
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from typing import Any, cast

from sqlalchemy import func, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from ..models.agent_task import (
    AGENT_TASK_SOURCE_MANUAL,
    AGENT_TASK_STATUS_DONE,
    AGENT_TASK_STATUS_DRAFT,
    AGENT_TASK_STATUS_RUNNING,
    AGENT_TASK_STATUSES,
    AGENT_TASK_STEP_STATUS_DONE,
    AGENT_TASK_STEP_STATUS_FAILED,
    AGENT_TASK_STEP_STATUS_PENDING,
    AGENT_TASK_STEP_STATUS_RUNNING,
    AGENT_TASK_STEP_STATUS_SKIPPED,
    AgentTask,
    AgentTaskStep,
)
from ..models.profile import utcnow
from .agent_task_core import (
    PROGRESS_STATUSES,
    AgentTaskError,
    AgentTaskNotFound,
    current_dataset_key,
    find_step,
    load_task,
    select_task,
)
from .agent_task_recovery import recover_running_tasks
from .agent_task_transitions import (
    cancel,
    fail,
    mark_waiting_approval,
    pause,
    resume,
    start,
    wait_approval_for_step,
)

#: 一次任务最多的步骤数：计划是给用户看的小列表，不是无限工作流。
MAX_AGENT_TASK_STEPS = 50
#: 执行参数（agent_task.params）的序列化上限：它是"最小输入"，不是数据仓库；
#: 超限说明调用方把正文塞进来了，显式拒绝而不是让它撑大任务行。
MAX_AGENT_TASK_PARAMS_CHARS = 4_000


# ===== 创建与读取 =====


def _normalize_steps(steps: Iterable[str | Mapping[str, Any]]) -> list[tuple[str, str]]:
    """把"一步"统一成 (title, kind)：字符串只给标题，映射可带 kind。"""
    if isinstance(steps, (str, bytes)):
        raise AgentTaskError("steps 必须是步骤列表，不能是单个字符串")
    specs: list[tuple[str, str]] = []
    for raw in steps:
        if isinstance(raw, str):
            title, kind = raw, ""
        elif isinstance(raw, Mapping):
            title, kind = str(raw.get("title") or ""), str(raw.get("kind") or "")
        else:
            raise AgentTaskError("步骤必须是字符串或 {title, kind} 对象")
        clean_title, clean_kind = title.strip(), kind.strip()
        if not clean_title:
            raise AgentTaskError("步骤标题不能为空")
        if len(clean_title) > 200 or len(clean_kind) > 32:
            raise AgentTaskError("步骤标题或类型过长")
        specs.append((clean_title, clean_kind))
    if not specs:
        raise AgentTaskError("任务至少需要一个步骤")
    if len(specs) > MAX_AGENT_TASK_STEPS:
        raise AgentTaskError(f"任务步骤不能超过 {MAX_AGENT_TASK_STEPS} 个")
    return specs


def create_task(
    db: Session,
    *,
    title: str,
    steps: Iterable[str | Mapping[str, Any]],
    conversation_id: int | None = None,
    goal: str = "",
    source: str = AGENT_TASK_SOURCE_MANUAL,
    params: Mapping[str, Any] | None = None,
) -> AgentTask:
    """建一个 draft 任务：步骤顺序落库，`resume_cursor` 从 0 开始。

    ``params`` 是执行所需的最小输入（#18A，0017 新增列）：存 JSON 对象，不存正文/隐私/
    密钥。显式传的非法值抛 ``AgentTaskError``，不静默丢弃——执行器要靠它干活。
    """
    clean_title = (title or "").strip()
    if not clean_title or len(clean_title) > 200:
        raise AgentTaskError("任务标题不能为空，也不能超过 200 字")
    if conversation_id is not None and conversation_id < 1:
        raise AgentTaskError("conversation_id 必须为正整数")
    clean_source = (source or "").strip()
    if not clean_source or len(clean_source) > 32:
        raise AgentTaskError("任务来源必须是 1–32 字的标签")
    if params is not None and not isinstance(params, Mapping):
        raise AgentTaskError("任务参数必须是 JSON 对象")
    clean_params: dict[str, Any] | None = dict(params) if params else None
    if clean_params is not None:
        try:
            serialized = json.dumps(clean_params, ensure_ascii=False)
        except (TypeError, ValueError) as exc:
            raise AgentTaskError("任务参数必须是可序列化的 JSON 对象") from exc
        if len(serialized) > MAX_AGENT_TASK_PARAMS_CHARS:
            raise AgentTaskError(
                f"任务参数不能超过 {MAX_AGENT_TASK_PARAMS_CHARS} 字符（只存执行所需的最小输入）"
            )
    specs = _normalize_steps(steps)
    db.expire_all()
    task = AgentTask(
        conversation_id=conversation_id,
        dataset_key=current_dataset_key(),
        title=clean_title,
        goal=(goal or "").strip(),
        status=AGENT_TASK_STATUS_DRAFT,
        resume_cursor=0,
        source=clean_source,
        params=clean_params,
    )
    task.steps = [
        AgentTaskStep(step_index=index, kind=kind, title=step_title)
        for index, (step_title, kind) in enumerate(specs)
    ]
    db.add(task)
    db.commit()
    return load_task(db, task.id)


def get_task(db: Session, task_id: int) -> AgentTask:
    """按 id 取任务（含全部步骤）；跨数据集的行按不存在处理。"""
    return load_task(db, task_id)


def list_tasks(
    db: Session,
    *,
    conversation_id: int | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[AgentTask]:
    """列当前数据集的任务（新→旧），可按会话与状态过滤。

    会话过滤的语义是「本会话的任务 **加** 数据集级任务」：`conversation_id is None`
    的任务不是某个会话发起的（例：提醒到期生成的任务卡，见 `agent_task_events`），
    它没有"自己的会话"，但也应该出现在任何会话的任务区里，否则用户永远看不到它。
    带 `conversation_id` 的任务仍只在它自己的会话里出现。

    **不传 `conversation_id` 时不过滤**（`GET /api/agent-tasks` 的行为保持不变）。
    """
    if status is not None and status not in AGENT_TASK_STATUSES:
        raise AgentTaskError(f"未知的任务状态：{status}")
    if not 1 <= limit <= 100 or offset < 0:
        raise AgentTaskError("limit 必须在 1–100 之间且 offset 不能为负")
    db.expire_all()
    query = select_task().where(AgentTask.dataset_key == current_dataset_key())
    if conversation_id is not None:
        query = query.where(
            or_(
                AgentTask.conversation_id == conversation_id,
                AgentTask.conversation_id.is_(None),
            )
        )
    if status is not None:
        query = query.where(AgentTask.status == status)
    query = query.order_by(AgentTask.id.desc()).limit(limit).offset(offset)
    return list(db.scalars(query).all())


# ===== 推进（核心：条件写 + 幂等） =====


def advance_step(
    db: Session,
    task_id: int,
    step_index: int,
    *,
    output_ref: Mapping[str, Any] | None = None,
    attempt: int | None = None,
) -> AgentTask:
    """完成当前步骤并推进 `resume_cursor`；重复完成同一步是幂等空转。

    幂等与并发都靠条件写：步骤行只有 `status != done` 时才更新，游标只有还停在
    `step_index` 时才推进；抢不到就回滚并返回当前快照，绝不二次推进。
    """
    if step_index < 0:
        raise AgentTaskError("step_index 不能为负")
    task = load_task(db, task_id)
    step = find_step(db, task.id, step_index)
    # 幂等重试：这一步已经完成 → 直接回快照，不产生第二次副作用。
    if step.status == AGENT_TASK_STEP_STATUS_DONE:
        return task
    if task.status not in PROGRESS_STATUSES:
        raise AgentTaskError(f"任务当前状态为「{task.status}」，不能完成步骤")
    if step_index != task.resume_cursor:
        raise AgentTaskError(f"只能完成当前步骤（当前是第 {task.resume_cursor} 步），不能跳步")
    if step.status in (AGENT_TASK_STEP_STATUS_FAILED, AGENT_TASK_STEP_STATUS_SKIPPED):
        raise AgentTaskError("这一步已失败或已跳过，不能完成")
    if output_ref is not None and not isinstance(output_ref, Mapping):
        raise AgentTaskError("output_ref 必须是 JSON 对象")
    if attempt is not None and (attempt < 1 or attempt < step.attempt):
        raise AgentTaskError(f"attempt 必须 ≥ 1 且不小于已完成尝试次数（当前 {step.attempt}）")
    new_attempt = attempt if attempt is not None else step.attempt + 1

    now = utcnow()
    # 抢占判定必须读 rowcount；显式收窄成 DML 的运行时真实类型。
    claimed = cast(
        "CursorResult[Any]",
        db.execute(
            update(AgentTaskStep)
            .where(
                AgentTaskStep.id == step.id,
                AgentTaskStep.status != AGENT_TASK_STEP_STATUS_DONE,
            )
            .values(
                status=AGENT_TASK_STEP_STATUS_DONE,
                output_ref=dict(output_ref) if output_ref is not None else None,
                attempt=new_attempt,
                error="",
                started_at=step.started_at or now,
                finished_at=now,
            )
            .execution_options(synchronize_session=False)
        ),
    )
    if (claimed.rowcount or 0) == 0:
        # 并发请求已经完成同一步：回滚自己的写，返回对方的终态（幂等语义）。
        db.rollback()
        return load_task(db, task_id)

    total_steps = (
        db.scalar(select(func.count(AgentTaskStep.id)).where(AgentTaskStep.task_id == task.id)) or 0
    )
    next_cursor = step_index + 1
    values: dict[str, Any] = {"resume_cursor": next_cursor, "updated_at": now}
    if next_cursor >= total_steps:
        values.update(status=AGENT_TASK_STATUS_DONE, finished_at=now, error="")
    else:
        values.update(status=AGENT_TASK_STATUS_RUNNING)
    advanced = cast(
        "CursorResult[Any]",
        db.execute(
            update(AgentTask)
            .where(
                AgentTask.id == task.id,
                AgentTask.dataset_key == current_dataset_key(),
                AgentTask.resume_cursor == step_index,
                AgentTask.status.in_(PROGRESS_STATUSES),
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        ),
    )
    if (advanced.rowcount or 0) == 0:
        db.rollback()
        refreshed = load_task(db, task_id)
        if refreshed.resume_cursor > step_index:
            return refreshed
        raise AgentTaskError("任务状态已变化，请刷新后重试")
    db.commit()
    return load_task(db, task_id)


def mark_step_running(db: Session, task_id: int, step_index: int) -> AgentTask:
    """把当前步骤标 `running` 并写 `started_at`（#18A 执行器专用）。

    条件写：只有"任务 running 且这一步还是 pending"才生效；重复调用（例如恢复后
    重跑）直接返回快照，不覆盖 started_at。执行器的唯一标记入口，避免每个 handler
    各写一份 SQL。
    """
    if step_index < 0:
        raise AgentTaskError("step_index 不能为负")
    task = load_task(db, task_id)
    if task.status != AGENT_TASK_STATUS_RUNNING:
        raise AgentTaskError(f"任务当前状态为「{task.status}」，不能执行步骤")
    if step_index != task.resume_cursor:
        raise AgentTaskError(f"只能执行当前步骤（当前是第 {task.resume_cursor} 步）")
    step = find_step(db, task.id, step_index)
    if step.status == AGENT_TASK_STEP_STATUS_RUNNING:
        return task
    if step.status != AGENT_TASK_STEP_STATUS_PENDING:
        raise AgentTaskError(f"第 {step_index} 步状态为「{step.status}」，不能开始执行")
    claimed = cast(
        "CursorResult[Any]",
        db.execute(
            update(AgentTaskStep)
            .where(
                AgentTaskStep.id == step.id,
                AgentTaskStep.status == AGENT_TASK_STEP_STATUS_PENDING,
            )
            .values(status=AGENT_TASK_STEP_STATUS_RUNNING, started_at=utcnow())
            .execution_options(synchronize_session=False)
        ),
    )
    if (claimed.rowcount or 0) == 0:
        db.rollback()
        return load_task(db, task_id)
    db.commit()
    return load_task(db, task_id)


__all__ = [
    "MAX_AGENT_TASK_PARAMS_CHARS",
    "MAX_AGENT_TASK_STEPS",
    "AgentTaskError",
    "AgentTaskNotFound",
    "advance_step",
    "cancel",
    "create_task",
    "fail",
    "get_task",
    "list_tasks",
    "mark_step_running",
    "mark_waiting_approval",
    "pause",
    "recover_running_tasks",
    "resume",
    "start",
    "wait_approval_for_step",
]
