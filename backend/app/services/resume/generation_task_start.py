# SPDX-License-Identifier: Apache-2.0
"""后台简历生成任务的创建（T2：从 `api/resumes/generate_routes.py` 的
`start_resume_generation` 下沉）。

前置校验与 SSE 入口一致（岗位存在、LLM 已配置、职业场景可解析、资料非空），并把
"同岗位去重 + 建任务行 + 冻结快照 + 写追溯行"做成一次准备动作：整段在短锁里完成，
路由拿到结果后**一次提交**（任务行与快照行同事务），再交给后台 runner。

**打桩点**：`load_llm_config` 由路由以参数注入（路由从 `app.api.resumes` 包命名空间
调用期读取，保住既有 monkeypatch 契约）。**事务边界留在路由**：本模块只 `add/flush`。
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ...models.job import Job
from ...models.resume import ResumeGenerateTask
from ...schemas.resume import GenerateRequest
from .. import trash
from ..career_scenarios.resolve import resolve_context
from ..llm.usage_tasks import set_ambient_scope
from .generate_snapshot import (
    delete_generation_snapshot,
    freeze_generation_snapshot,
    persist_generation_snapshot,
)
from .generation_entry import (
    GenerationEntryError,
    ensure_profile_not_empty,
    log_frozen_profile,
)
from .resume_generate_manager import QUEUE_MESSAGE
from .resume_generation_levels import generation_token_budget
from .resume_task_state import active_task_for_job

# 同岗位去重 + 建任务行必须原子的短锁（清单 §9.2）：两个并发请求都先查后插时，各自都会
# 查到"没有活动任务"，于是同一岗位建出两条 pending——旧实现靠"单例运行器只收一个"兜住，
# 并发化之后必须在创建处自己封口（单进程应用，不需要 DB 唯一索引/迁移）。只锁建任务
# 这一段：快照冻结与库操作本来就在请求内，模型调用在锁外。
_START_LOCK = threading.Lock()


class GenerationTaskStartError(Exception):
    """任务创建的前置条件不满足：status_code / detail 由路由映射成 HTTP 错误。"""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class GenerationTaskStart:
    """一次任务创建的全部结果：已 flush（待路由提交）的任务行 + 冻结快照。"""

    task: ResumeGenerateTask
    frozen: Any
    snapshot_row: Any
    snapshot: Any


def prepare_generation_task(
    db: Session, payload: GenerateRequest, *, load_llm_config
) -> GenerationTaskStart:
    """校验 + 去重 + 建任务行 + 写快照追溯行（不提交，路由一次提交后移交 runner）。"""
    # #35/A1：后台生成入口同样在入队前声明边界（runner.start 复制本请求 contextvars）。
    set_ambient_scope(
        input_scope="resume+profile+job",
        masked=True,
        language=payload.options.language,
        budget=generation_token_budget(payload.options),
    )
    job = db.get(Job, payload.job_id) if payload.job_id is not None else None
    if payload.job_id is not None and (job is None or trash.is_deleted(job)):
        raise GenerationTaskStartError(404, "岗位不存在或已被删除")

    config = load_llm_config(db)
    if not config.base_url or not config.model:
        raise GenerationTaskStartError(400, "尚未配置大模型 API")

    # A5：任务创建时解析并**冻结**场景快照（计划 §6.4）：runner 只读 task.context_snapshot，
    # 运行中不再查询"当前场景"。失败明确返回，不创建任务（CareerContextError 由路由映射）。
    snapshot = resolve_context(db, payload.options.career_context)

    # 同岗位去重（清单 §9.2）：同一岗位已有 pending/running 时 409（防连点/防同岗两份），
    # 不同岗位放行；通用简历（job_id=None）不受这条守卫影响，可同时生成多份。
    # 「查重 → 建任务 → commit」必须在同一把短锁里，否则两个并发请求都能查到"没有活动任务"。
    with _START_LOCK:
        if payload.job_id is not None and active_task_for_job(db, payload.job_id) is not None:
            raise GenerationTaskStartError(409, "这个岗位已有一份简历正在进行中")

        # F3 §1：冻结当前组消费快照（入队前），并随任务一起提交。
        frozen = freeze_generation_snapshot(db)
        try:
            ensure_profile_not_empty(frozen)
        except GenerationEntryError as exc:
            # 两条链路同一条"资料为空"规则：统一翻成本模块的领域异常再交给路由映射。
            raise GenerationTaskStartError(exc.status_code, exc.detail) from exc
        log_frozen_profile(frozen, transport="task")

        task = ResumeGenerateTask(
            job_id=payload.job_id,
            title=payload.title,
            # 排队文案先落库；拿到槽位时 worker 会立刻覆盖为进度文案（清单 §9.3-A3）。
            message=QUEUE_MESSAGE,
            options=payload.options.model_dump(),
            context_snapshot=snapshot.model_dump() if snapshot is not None else None,
        )
        db.add(task)
        db.flush()
        snapshot_row = persist_generation_snapshot(db, frozen, task_id=task.id)
        # 必须在锁内提交：只 flush 不 commit 时，另一条并发请求的 SELECT 看不到这条
        # 未提交的行（SQLite 的读隔离），照样查到"没有活动任务"，于是同岗位建出两条
        # pending。2026-11-15 CI（ubuntu 3.11）实测这条竞态：两个请求都拿到 201。
        # 提交在锁内也保证了"任务行 + 快照行"仍是一个事务；后续启动失败时由路由用
        # `discard_generation_task` 删除这两行并提交，不留孤儿。
        db.commit()
    return GenerationTaskStart(
        task=task, frozen=frozen, snapshot_row=snapshot_row, snapshot=snapshot
    )


def discard_generation_task(db: Session, started: GenerationTaskStart) -> None:
    """启动失败时撤销这条空任务与空快照，不留孤儿（不提交：路由提交）。"""
    delete_generation_snapshot(db, int(started.snapshot_row.id))
    db.delete(started.task)


__all__ = [
    "GenerationTaskStart",
    "GenerationTaskStartError",
    "discard_generation_task",
    "prepare_generation_task",
]
