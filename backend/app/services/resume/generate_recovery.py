# SPDX-License-Identifier: Apache-2.0
"""简历生成任务的启动恢复（RF-02，从 resume_generate_runner.py 拆出）。

只放"跨进程的遗留状态收尾"：运行器本体（线程、预算、仲裁）留在
``resume_generate_runner.py``。恢复语义：进程中断后 pending/running 任务
转现有 ``failed`` 终态、写可读原因、**不自动重跑**（重跑要重新花模型调用）。
"""
from __future__ import annotations

import logging
from typing import Any

from ...models.profile import utcnow
from ...models.resume import (
    GENERATE_ACTIVE_STATUSES,
    GENERATE_STATUS_FAILED,
    ResumeGenerateTask,
)

logger = logging.getLogger(__name__)


def fail_orphaned_generate_tasks(db: Any) -> int:
    """应用重启后，把遗留的 pending/running 生成任务标记为失败（RF-02）。

    生成任务只活在进程内的一个工作线程里：进程中断后这些行永远不会有人推进，却
    占着"同一时刻只跑一个任务"的入口（``/generate/tasks`` 对任何活动任务回 409）。
    启动恢复把它们转成现有 ``failed`` 终态、写可读原因；**不自动重跑**——重跑要
    重新花模型调用，必须由用户显式发起。
    """
    from sqlalchemy import update

    statement = (
        update(ResumeGenerateTask)
        .where(ResumeGenerateTask.status.in_(GENERATE_ACTIVE_STATUSES))
        .values(
            status=GENERATE_STATUS_FAILED,
            error="应用重启导致任务中断，请重新发起生成",
            finished_at=utcnow(),
        )
        .execution_options(synchronize_session=False)
    )
    result = db.execute(statement)
    db.commit()
    recovered = result.rowcount or 0
    if recovered:
        logger.warning("清理了 %s 个中断的简历生成任务", recovered)
    return recovered


__all__ = ["fail_orphaned_generate_tasks"]
