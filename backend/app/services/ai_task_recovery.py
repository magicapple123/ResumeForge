# SPDX-License-Identifier: Apache-2.0
"""通用 AI 任务的启动恢复：把进程中断留下的 pending/running 收尾成 failed。

**为什么必须做**：任务只活在进程内的一个工作线程里（见 ``ai_task_runner.py``）。进程被杀、
崩溃或用户重启应用之后，那条记录永远不会再有人推进，而前端会一直看到 ``running``——
轮询永不终态，页头任务面板一直转圈，取消按钮也只能把它变成 canceled（结果本来就没有）。
这与简历生成任务当年踩过的是同一个坑（RF-02），所以用同一套语义：转 ``failed``、
写可读原因、**不自动重跑**（重跑要花模型调用，必须由用户显式发起）。
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import update

from ..models.ai_task import AI_TASK_ACTIVE_STATUSES, AI_TASK_STATUS_FAILED, AiTask
from ..models.profile import utcnow

logger = logging.getLogger(__name__)

#: 中断原因（**只写原因**：不带"请重试"这类引导，引导由前端 errorGuidance 补）。
ORPHANED_AI_TASK_REASON = "应用重启导致任务中断"


def fail_orphaned_ai_tasks(db: Any) -> int:
    """把遗留的 pending/running AI 任务标记为 failed；返回处理条数。"""
    statement = (
        update(AiTask)
        .where(AiTask.status.in_(AI_TASK_ACTIVE_STATUSES))
        .values(
            status=AI_TASK_STATUS_FAILED,
            error=ORPHANED_AI_TASK_REASON,
            finished_at=utcnow(),
        )
        .execution_options(synchronize_session=False)
    )
    result = db.execute(statement)
    db.commit()
    recovered = result.rowcount or 0
    if recovered:
        logger.warning("清理了 %s 个中断的 AI 任务", recovered)
    return recovered


__all__ = ["ORPHANED_AI_TASK_REASON", "fail_orphaned_ai_tasks"]
