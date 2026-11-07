# SPDX-License-Identifier: Apache-2.0
"""Agent 任务的启动恢复：running → paused（T19，T18 Gate §3）。

与 `ai_task_recovery.fail_orphaned_ai_tasks` 的**刻意差异**：`ai_task` 的中断语义是
"失败"，因为它的执行体是进程内线程、重跑要花模型调用且没有计划可续；Agent 任务的
卖点恰恰是"重启后能继续"——`resume_cursor` 已把进度落库，转 failed 等于让一份完全
可续的计划作废。所以这里只把"进程已死、不会再有人推进"的 `running` 置 `paused`。

**不碰 `waiting_approval`**：它不是进程内状态，重启后用户仍然可以确认；自动逻辑放行
它等于绕过"用户是唯一确认人"的边界（T18 §2）。

**不碰其他数据集**：只处理 `dataset_key` 等于当前数据集的行，避免把备份导入留下的
旧数据集任务当成当前任务恢复。
"""

from __future__ import annotations

import logging
from typing import Any, cast

from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from ..models.agent_task import (
    AGENT_TASK_STATUS_PAUSED,
    AGENT_TASK_STATUS_RUNNING,
    AGENT_TASK_STEP_STATUS_PENDING,
    AGENT_TASK_STEP_STATUS_RUNNING,
    AgentTask,
    AgentTaskStep,
)
from ..models.profile import utcnow
from ..runtime import dataset_scope

logger = logging.getLogger(__name__)


def recover_running_tasks(db: Session) -> int:
    """把当前数据集遗留的 running 任务置 paused，返回处理条数。

    同时把"进程内被打断"的步骤状态从 running 退回 pending（步骤没完成，恢复后要能
    重跑）；已完成的步骤、`resume_cursor` 与 `attempt` 一律不动。
    """
    current = dataset_scope.current_dataset_id()
    now = utcnow()
    running_task_ids = select(AgentTask.id).where(
        AgentTask.status == AGENT_TASK_STATUS_RUNNING,
        AgentTask.dataset_key == current,
    )
    db.execute(
        update(AgentTaskStep)
        .where(
            AgentTaskStep.task_id.in_(running_task_ids),
            AgentTaskStep.status == AGENT_TASK_STEP_STATUS_RUNNING,
        )
        .values(status=AGENT_TASK_STEP_STATUS_PENDING, finished_at=None)
        .execution_options(synchronize_session=False)
    )
    # 恢复计数必须读 rowcount；显式收窄成 DML 的运行时真实类型。
    result = cast(
        "CursorResult[Any]",
        db.execute(
            update(AgentTask)
            .where(
                AgentTask.status == AGENT_TASK_STATUS_RUNNING,
                AgentTask.dataset_key == current,
            )
            .values(status=AGENT_TASK_STATUS_PAUSED, updated_at=now)
            .execution_options(synchronize_session=False)
        ),
    )
    recovered = result.rowcount or 0
    db.commit()
    if recovered:
        logger.warning("重启恢复：%s 个 Agent 任务由 running 置 paused", recovered)
    return recovered


__all__ = ["recover_running_tasks"]
