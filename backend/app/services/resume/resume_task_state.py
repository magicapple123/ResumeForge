# SPDX-License-Identifier: Apache-2.0
"""简历生成任务的终态仲裁写入（RF-02，从 resume_generate_runner.py 拆出）。

只放"任务终态的原子写入"三件套：终态守卫写入、completed 认领、取消即时落库。
运行器本体（线程、预算、快照、落库编排）留在 ``resume_generate_runner.py``。

共同纪律：全部走条件 UPDATE + ``synchronize_session=False``，SQLite 串行化写入
下只会有一个写入者生效（先到者赢），绝不覆盖已写入的终态；调用方自此不再通过
ORM 改 status，避免把原子守卫绕过去。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from ...models.profile import utcnow
from ...models.resume import (
    GENERATE_ACTIVE_STATUSES,
    GENERATE_STATUS_CANCELLED,
    GENERATE_STATUS_COMPLETED,
    GENERATE_STATUS_PENDING,
    GENERATE_STATUS_RUNNING,
    ResumeGenerateTask,
)

logger = logging.getLogger(__name__)


def finalize_task(session: Any, task: ResumeGenerateTask, status: str, error: str = "") -> None:
    """写入任务终态；**终态守卫**：只允许从 pending/running 转入，绝不覆盖已有终态。

    取消与异常收尾可能并发（cancel 已把任务写成 cancelled，worker 又因模型错误
    到达这里）：条件 UPDATE 在 SQLite 串行化写入下只会有一个生效，先到者赢
    （RF-02 仲裁守卫）。影响 0 行说明终态已被其它路径写入，记一条日志即可，
    不再改写。
    """
    from sqlalchemy import update

    statement = (
        update(ResumeGenerateTask)
        .where(ResumeGenerateTask.id == task.id)
        .where(ResumeGenerateTask.status.in_(GENERATE_ACTIVE_STATUSES))
        .values(status=status, error=error, finished_at=utcnow())
        .execution_options(synchronize_session=False)
    )
    result = session.execute(statement)
    session.commit()
    if result.rowcount != 1:
        logger.warning(
            "生成任务 %s 的终态已被其它路径写入（本次目标 %s），保持现有终态",
            task.id,
            status,
        )


def claim_completed(session: Any, task_id: int) -> bool:
    """原子地把任务从 running 认领为 completed，返回是否认领成功（**不提交**）。

    这是"取消 vs 完成"的**唯一仲裁点**：与 cancel 的 running→cancelled 是两个互斥的
    UPDATE，SQLite 串行化写入下只会有一个成功。认领成功（影响 1 行）后，调用方才在
    **同一事务**里写入简历记录、回填 resume_id 并一次 commit；影响 0 行说明 cancel 已
    先把任务翻成 cancelled，调用方按 cancelled 收尾（此时尚未建简历，无孤儿记录）。

    **提交权交给调用方**：这样 resume_id 与 status=completed 才能落在同一个事务里，
    观察者绝不会看到"completed 但 resume_id 为空"的中间态。
    """
    from sqlalchemy import update

    statement = (
        update(ResumeGenerateTask)
        .where(ResumeGenerateTask.id == task_id)
        .where(ResumeGenerateTask.status == GENERATE_STATUS_RUNNING)
        .values(status=GENERATE_STATUS_COMPLETED)
        .execution_options(synchronize_session=False)
    )
    result = session.execute(statement)
    return result.rowcount == 1


def set_cancelled(task_id: int, *, open_session: Callable[[], Any]) -> None:
    """取消接口即时落一次状态，让界面立刻看到"已取消"。

    与工作线程并发写同一行，因此用原子 UPDATE + 活动态守卫：只有当前仍是
    pending/running 时才改成 cancelled，绝不把已 completed/failed 的终态盖掉。
    会话由调用方提供（走任务启动时冻结的工厂，RF-03：切换后取消也写进任务所在
    的旧库）。
    """
    from sqlalchemy import update

    session = open_session()
    try:
        statement = (
            update(ResumeGenerateTask)
            .where(ResumeGenerateTask.id == task_id)
            .where(
                ResumeGenerateTask.status.in_((GENERATE_STATUS_RUNNING, GENERATE_STATUS_PENDING))
            )
            .values(status=GENERATE_STATUS_CANCELLED, error="已取消", finished_at=utcnow())
            .execution_options(synchronize_session=False)
        )
        session.execute(statement)
        session.commit()
    except Exception:  # noqa: BLE001 - 与工作线程并发写时可能短暂锁库，忽略即可
        logger.warning("更新生成任务取消状态失败 task_id=%s", int(task_id))
    finally:
        session.close()


__all__ = ["claim_completed", "finalize_task", "set_cancelled"]
