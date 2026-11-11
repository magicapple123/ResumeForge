# SPDX-License-Identifier: Apache-2.0
"""#18A 执行器的共享基座：StepResult、provider 入口、参数校验与步骤间缓存。

拆出来是因为四个 kind 的 handler 合计超过单文件 500 行预算；本模块只放"各 handler 都
要用的东西"（不含任何业务动作），避免循环 import。
"""

from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from ..models.agent_task import AgentTask
from ..models.job import Job
from ..models.resume import ResumeRecord
from . import trash
from .llm import create_provider
from .settings_service import get_llm_config

#: 一步最多改写的条目数：任务是"小批量活"，不是整库重写。
MAX_REWRITE_ITEMS = 50
#: 单条文本送模型的上限（与文档字段上限同一量级）。
MAX_REWRITE_CHARS = 1_500
#: 批量匹配 / 打招呼单批上限（与 task_tools.MAX_JOB_BATCH 一致）。
MAX_BATCH_JOBS = 50


@dataclass
class StepResult:
    """一步的执行结果：ok=False 由 runner 转成 step failed + task failed。"""

    ok: bool
    output_ref: dict[str, Any] = field(default_factory=dict)
    error: str = ""


#: 步骤间的进程内缓存（task_id → 抓取/改写中间结果）。缓存丢时对应步骤自行重取。
_STAGE: dict[int, dict[str, Any]] = {}
_STAGE_LOCK = threading.Lock()


def clear_task_state(task_id: int) -> None:
    """任务结束（done/failed/cancelled）后清掉本任务的中间缓存。"""
    with _STAGE_LOCK:
        _STAGE.pop(int(task_id), None)


def clear_all_task_state() -> None:
    """清空全部中间缓存（测试隔离用；生产只在进程退出时自然消失）。"""
    with _STAGE_LOCK:
        _STAGE.clear()


def stage_of(task_id: int) -> dict[str, Any]:
    with _STAGE_LOCK:
        return _STAGE.setdefault(int(task_id), {})


def task_params(task: AgentTask) -> dict[str, Any]:
    params = task.params if isinstance(task.params, dict) else None
    if not params:
        raise ValueError("这个任务没有执行参数（可能是执行器上线前创建的老任务），无法自动执行")
    return params


def provider_for_task(db: Session) -> Any:
    """执行器用的真实 provider；未配置大模型时返回 None（handler 各自降级/报错）。

    测试通过 monkeypatch 本函数注入 fake provider（仓库既有做法：把外部调用收成一个
    模块级入口，测试替换它而不是替换全局 create_provider）。
    """
    config = get_llm_config(db)
    if not (config.base_url.strip() and config.model.strip()):
        return None
    return create_provider(config.without_thinking())


def run_async(coro: Any) -> Any:
    """在同步 runner 里 await 一个协程；执行器跑在独立线程，通常没有事件循环。"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    # 极端情况（调用方在事件循环里同步调用执行器）：丢到临时线程里跑，绝不嵌套 loop。
    outcome: dict[str, Any] = {}

    def target() -> None:
        try:
            outcome["value"] = asyncio.run(coro)
        except BaseException as exc:  # noqa: BLE001 - 原样带回调用线程
            outcome["error"] = exc

    thread = threading.Thread(target=target)
    thread.start()
    thread.join()
    if "error" in outcome:
        raise outcome["error"]
    return outcome["value"]


def require_live_resume(db: Session, params: dict[str, Any]) -> ResumeRecord:
    try:
        resume_id = int(params.get("resume_id") or 0)
    except (TypeError, ValueError):
        raise ValueError("任务参数 resume_id 非法") from None
    record = trash.get_live(db, ResumeRecord, resume_id) if resume_id else None
    if record is None:
        raise ValueError(f"简历 {resume_id} 不存在或已被删除")
    return record


def require_live_jobs(db: Session, params: dict[str, Any]) -> list[Job]:
    raw = params.get("job_ids")
    if not isinstance(raw, (list, tuple)) or not raw:
        raise ValueError("任务参数 job_ids 缺失")
    ids: list[int] = []
    for item in raw:
        try:
            job_id = int(item)
        except (TypeError, ValueError):
            raise ValueError("任务参数 job_ids 含非法 id") from None
        if job_id > 0 and job_id not in ids:
            ids.append(job_id)
    ids = ids[:MAX_BATCH_JOBS]
    jobs = db.query(Job).filter(Job.id.in_(ids), trash.live_only(Job)).all() if ids else []
    by_id = {int(job.id): job for job in jobs}
    missing = [job_id for job_id in ids if job_id not in by_id]
    if missing:
        raise ValueError(f"这些岗位不存在或已被删除：{missing}")
    return [by_id[job_id] for job_id in ids]


__all__ = [
    "MAX_BATCH_JOBS",
    "MAX_REWRITE_CHARS",
    "MAX_REWRITE_ITEMS",
    "StepResult",
    "clear_all_task_state",
    "clear_task_state",
    "provider_for_task",
    "require_live_jobs",
    "require_live_resume",
    "run_async",
    "stage_of",
    "task_params",
]
