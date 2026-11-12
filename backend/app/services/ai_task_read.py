# SPDX-License-Identifier: Apache-2.0
"""通用 AI 任务的只读查询（当前活动任务列表）。

从 api/ai_tasks.py 搬来：GET /api/ai-tasks/active 的"哪些状态算在跑"必须与运行器、
启动恢复共用同一份状态常量。为什么放服务层：路由只该做依赖注入与响应序列化，
活动任务的取数口径属于 AI 任务域。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..models.ai_task import AI_TASK_ACTIVE_STATUSES, AiTask


def list_active_tasks(db: Session, limit: int = 50) -> list[AiTask]:
    """当前仍处于活动状态的任务（按 id 倒序，最多 limit 条）。"""
    return (
        db.query(AiTask)
        .filter(AiTask.status.in_(AI_TASK_ACTIVE_STATUSES))
        .order_by(AiTask.id.desc())
        .limit(limit)
        .all()
    )


__all__ = ["list_active_tasks"]
