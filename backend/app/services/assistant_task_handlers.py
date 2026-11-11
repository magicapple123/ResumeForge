# SPDX-License-Identifier: Apache-2.0
"""#18A 助手长任务的执行器注册表（对外唯一入口 execute_step）。

四个 kind 的 handler 按领域拆到三个模块（resume / job_import / match+greeting），
本文件只做注册与分发，避免单文件超过 500 行预算；共享基座在
assistant_task_handler_common.py（StepResult / provider / 参数校验 / stage 缓存）。
"""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy.orm import Session

from ..models.agent_task import AgentTask, AgentTaskStep
from .assistant_task_handler_common import (
    MAX_BATCH_JOBS,
    MAX_REWRITE_ITEMS,
    StepResult,
    clear_task_state,
    provider_for_task,
)
from .assistant_task_handler_job_import import JOB_IMPORT_HANDLERS
from .assistant_task_handler_match_greeting import GREETING_HANDLERS, MATCH_HANDLERS
from .assistant_task_handler_resume import RESUME_HANDLERS

Handler = Callable[[Session, AgentTask, AgentTaskStep], StepResult]

#: (task.kind, step.kind) → handler。四种 kind 的每个步骤都必须在这里有真实实现；
#: 未知组合由 execute_step 转成可读失败（老任务/脏数据不会让执行器崩溃）。
HANDLERS: dict[tuple[str, str], Handler] = {}
HANDLERS.update(RESUME_HANDLERS)
HANDLERS.update(JOB_IMPORT_HANDLERS)
HANDLERS.update(MATCH_HANDLERS)
HANDLERS.update(GREETING_HANDLERS)


def execute_step(db: Session, task: AgentTask, step: AgentTaskStep) -> StepResult:
    """按 (task.kind, step.kind) 找 handler 执行一步；未知组合是可读失败而不是崩溃。"""
    params = task.params if isinstance(task.params, dict) else {}
    kind = str(params.get("kind") or "")
    handler = HANDLERS.get((kind, str(step.kind or "")))
    if handler is None:
        return StepResult(
            False,
            error=f"任务类型「{kind or '未记录'}」的步骤「{step.kind}」没有执行器，不能自动执行",
        )
    try:
        return handler(db, task, step)
    except ValueError as exc:
        return StepResult(False, error=str(exc)[:500])


__all__ = [
    "HANDLERS",
    "MAX_BATCH_JOBS",
    "MAX_REWRITE_ITEMS",
    "StepResult",
    "clear_task_state",
    "execute_step",
    "provider_for_task",
]
