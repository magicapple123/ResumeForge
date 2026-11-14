# SPDX-License-Identifier: Apache-2.0
"""岗位批量适配度分析的后台任务状态与单线程运行器。

任务状态只保存轻量的岗位 ID、进度和最终批次 ID，结果仍由 job_match_batch 快照表保存。
这样页面刷新后可以恢复进度，又不会把完整岗位描述或个人资料复制到任务设置里。
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from collections.abc import Callable
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from ...database import SessionLocal
from ...models.job import Job
from ...models.profile import utcnow
from ...models.setting import AppSetting
from ...runtime import dataset_scope
from ...runtime.dataset_scope import DatasetLease, DatasetScopeError
from ...runtime.log_context import run_with_bound_context
from ...schemas.job_match_background import (
    ACTIVE_JOB_MATCH_BACKGROUND_STATUSES,
    JobMatchBackgroundTask,
)
from ...schemas.job_match_batch import JobMatchBatchItem
from ...services import trash
from ...services.settings_service import get_llm_config
from .job_match_batch import (
    BatchMatchCancelled,
    BatchMatchInput,
    BatchMatchRun,
    build_batch_inputs,
    persist_batch,
    run_batch_comparison,
    run_batch_match,
    sort_batch_items,
)

logger = logging.getLogger(__name__)
_TASK_KEY = "job_match_background_task"
# 取消信号的观察间隔：用户按下"取消"到任务收敛的时间上限（不含调度抖动）。
# 0.2s 足够快（界面轮询本身就是 1.5s 一次），又不会让工作线程空转抢 GIL。
_CANCEL_POLL_SECONDS = 0.2


class _CancelledDuringCall(Exception):
    """取消时打断了**正在进行**的模型调用（不是两个岗位之间的协作式退出）。"""


def _read_task(db: Session) -> JobMatchBackgroundTask | None:
    row = db.get(AppSetting, _TASK_KEY)
    if row is None:
        return None
    try:
        return JobMatchBackgroundTask.model_validate(json.loads(row.value))
    except (json.JSONDecodeError, TypeError, ValueError):
        logger.warning("岗位匹配后台任务状态损坏，已忽略")
        return None


def _write_task(db: Session, task: JobMatchBackgroundTask) -> JobMatchBackgroundTask:
    serialized = json.dumps(task.model_dump(mode="json"), ensure_ascii=False)
    row = db.get(AppSetting, _TASK_KEY)
    if row is None:
        db.add(AppSetting(key=_TASK_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()
    return task


def get_job_match_background_task(
    db: Session, task_id: str | None = None
) -> JobMatchBackgroundTask | None:
    task = _read_task(db)
    if task is None or (task_id is not None and task.task_id != task_id):
        return None
    return task


def list_active_job_match_background_tasks(db: Session) -> list[JobMatchBackgroundTask]:
    task = _read_task(db)
    if task is None or task.status not in ACTIVE_JOB_MATCH_BACKGROUND_STATUSES:
        return []
    return [task]


def create_job_match_background_task(
    db: Session,
    job_ids: list[int],
    *,
    force: bool,
    mode: str = "match",
    resume_id: int | None = None,
) -> JobMatchBackgroundTask:
    current = _read_task(db)
    if current is not None and current.status in ACTIVE_JOB_MATCH_BACKGROUND_STATUSES:
        raise ValueError("已有岗位适配度分析正在后台运行，请等待完成后再开始")
    now = utcnow()
    task = JobMatchBackgroundTask(
        task_id=uuid4().hex,
        status="pending",
        job_ids=job_ids,
        force=force,
        resume_id=resume_id,
        mode="compare" if mode == "compare" else "match",
        requested_count=len(job_ids),
        created_at=now,
        message="等待后台任务启动",
    )
    return _write_task(db, task)


async def _await_with_cancel(awaitable: Any, stop: threading.Event) -> Any:
    """等一个批次协程跑完，同时盯住取消信号：一置位就**立刻**打断它。

    为什么不能只靠 ``should_cancel``：那个回调只在"下一个岗位开始前"和"重试前"
    被查一次，所以用户在第一个岗位的模型调用中途点取消时，界面会一直停在
    「已处理 0/3」直到那次调用自己返回（真实模型 30~120s）。这里的做法是把批次
    跑成独立 task，用轮询把「取消」变成 ``task.cancel()``——非流式/流式请求都是
    httpx 的 await 点，能真正被打断，用户不用等当前岗位跑完。

    被打断时已完成的结果由 ``on_item_complete`` 事先留存，调用方据此落库。
    """
    task = asyncio.ensure_future(awaitable)
    try:
        while True:
            done, _pending = await asyncio.wait({task}, timeout=_CANCEL_POLL_SECONDS)
            if done:
                return task.result()
            if stop.is_set():
                task.cancel()
                # 等它真的放手（httpx 连接随之关闭），别在会话里留下还活着的协程。
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                except Exception:  # noqa: BLE001 - 被打断的协程可以带着任何异常退出
                    pass
                raise _CancelledDuringCall
    finally:
        if not task.done():
            task.cancel()


class JobMatchBackgroundRunnerError(Exception):
    """后台岗位匹配运行器的控制类错误。"""


class JobMatchBackgroundRunner:
    """单用户本地应用使用的单线程 runner；数据库状态负责跨页面保存进度。"""

    def __init__(self, *, session_factory: Callable[[], Any] = SessionLocal) -> None:
        self._session_factory = session_factory
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._current_task_id: str | None = None

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self, task_id: str) -> None:
        with self._lock:
            if self.is_running():
                raise JobMatchBackgroundRunnerError("已有岗位适配度分析正在后台运行，请稍候")
            # 先取租约再起线程（RF-03 TOCTOU）：切换持锁期间直接失败（409 语义不变）。
            try:
                lease = dataset_scope.acquire_lease("job-match")
            except DatasetScopeError as exc:
                raise JobMatchBackgroundRunnerError(str(exc)) from exc
            # 每个任务一个全新 Event：上一次任务的取消状态不可能被这一次读到，
            # 这一次的取消也不会被下一次继承（旧实现靠 clear()，顺序一变就互相打架）。
            self._stop = threading.Event()
            self._current_task_id = task_id
            self._thread = threading.Thread(
                # RF-20：复制启动方 contextvars 并绑定 task_id/dataset_id（同 apply 运行器）。
                target=run_with_bound_context(
                    self._run_releasing_lease,
                    task_id,
                    lease,
                    task_id=task_id,
                    dataset_id=lease.identity.dataset_id,
                ),
                name=f"rf-job-match-{task_id[:8]}",
                daemon=True,
            )
            self._thread.start()

    def _run_releasing_lease(self, task_id: str, lease: DatasetLease) -> None:
        """线程入口：保证无论任务怎么收尾，租约都会归还。"""
        try:
            self._run(task_id)
        finally:
            lease.release()

    def cancel(self, task_id: str) -> None:
        # 持锁做"确认还是这个任务 + 置位"：避免任务刚好在自己收尾时被误判为可取消。
        with self._lock:
            if self._current_task_id != task_id or not self.is_running():
                raise JobMatchBackgroundRunnerError("该后台任务当前未在运行，无法取消")
            self._stop.set()

    def fail_task(self, task_id: str, error: str) -> None:
        self._finish(task_id, status="failed", error=error)

    def fail_orphaned_task(self, db: Session) -> None:
        task = _read_task(db)
        if task is None or task.status not in ACTIVE_JOB_MATCH_BACKGROUND_STATUSES:
            return
        _write_task(
            db,
            task.model_copy(
                update={
                    "status": "failed",
                    "error": "后端上次退出时任务被中断，请重新发起分析",
                    "message": "任务已中断",
                    # 终态必须清空「正在分析：X」（问题 13）：否则重启后界面会挂着一条
                    # 早已不存在的进行中岗位。
                    "current_job_id": None,
                    "current_job_title": "",
                    "finished_at": utcnow(),
                }
            ),
        )

    def shutdown(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=5)

    def _run(self, task_id: str) -> None:
        # 本任务专属的取消信号：后面所有判断都读这一个对象，不受后续 start() 影响。
        stop = self._stop
        # 已完成项先留在本地再落库：硬取消会随时打断批次，落库时只能从这里取回结果。
        collected: list[JobMatchBatchItem] = []

        def on_item_complete(item: JobMatchBatchItem) -> None:
            collected.append(item)
            self._record_progress(task_id, item)

        try:
            prepared = self._prepare(task_id)
            if prepared is None:
                return
            inputs, config, mode = prepared
            try:
                run = asyncio.run(
                    _await_with_cancel(
                        run_batch_match(
                            inputs,
                            config,
                            on_item_start=lambda item: self._mark_current(task_id, item),
                            on_item_complete=on_item_complete,
                            should_cancel=stop.is_set,
                        ),
                        stop,
                    )
                )
            except BatchMatchCancelled as cancelled:
                self._finish_cancelled(task_id, cancelled.items, cancelled.model, len(inputs))
                return
            except _CancelledDuringCall:
                # 当前岗位的模型调用被中断：它的结论不存在，已完成的照样保留落库。
                self._finish_cancelled(
                    task_id, collected, str(getattr(config, "model", "") or ""), len(inputs)
                )
                return
            comparison = None
            if mode == "compare" and not stop.is_set():
                try:
                    comparison = asyncio.run(
                        _await_with_cancel(
                            run_batch_comparison(inputs, run, config, should_cancel=stop.is_set),
                            stop,
                        )
                    )
                except _CancelledDuringCall:
                    # 逐岗结论已经有了，只是横向对比没做完：保留结论、不写对比。
                    self._finish_cancelled(task_id, run.items, run.model, len(inputs))
                    return
            batch_id = self._persist_partial(run, len(inputs), comparison)
            self._finish(
                task_id,
                status="completed",
                batch_id=batch_id,
                message="岗位横向对比已完成" if mode == "compare" else "岗位适配度分析已完成",
            )
        except Exception as exc:  # noqa: BLE001 - 工作线程必须把异常落成可读状态
            logger.exception("岗位匹配后台任务执行失败 task_id=%s", task_id)
            self._finish(task_id, status="failed", error=str(exc) or "后台分析失败，请稍后重试")
        finally:
            with self._lock:
                if self._current_task_id == task_id:
                    self._current_task_id = None
                    self._thread = None

    def _finish_cancelled(
        self,
        task_id: str,
        items: list[JobMatchBatchItem],
        model: str,
        requested_count: int,
    ) -> None:
        """把"取消"落成终态：已完成的结果照常入库，一项都没完成就不留空批次。"""
        if not items:
            self._finish(
                task_id,
                status="cancelled",
                message="后台分析已取消",
            )
            return
        batch_id = self._persist_partial(
            BatchMatchRun(items=sort_batch_items(items), model=model), requested_count
        )
        self._finish(
            task_id,
            status="cancelled",
            batch_id=batch_id,
            message="后台分析已取消，已保留取消前完成的结果",
        )

    def _prepare(self, task_id: str) -> tuple[list[BatchMatchInput], Any, str] | None:
        db = self._session_factory()
        try:
            task = get_job_match_background_task(db, task_id)
            if task is None:
                return None
            if self._stop.is_set():
                self._finish(task_id, status="cancelled", message="后台分析已取消")
                return None
            jobs = db.query(Job).filter(trash.live_only(Job), Job.id.in_(task.job_ids)).all()
            found = {job.id: job for job in jobs}
            if any(job_id not in found for job_id in task.job_ids):
                raise ValueError("部分岗位已不存在或已被删除，请刷新岗位列表后重试")
            inputs = build_batch_inputs(
                db,
                [found[job_id] for job_id in task.job_ids],
                force=task.force,
                resume_id=task.resume_id,
            )
            config = get_llm_config(db)
            _write_task(
                db,
                task.model_copy(
                    update={
                        "status": "running",
                        "started_at": utcnow(),
                        "message": "正在准备岗位资料",
                    }
                ),
            )
            return inputs, config, task.mode
        finally:
            db.close()

    def _mark_current(self, task_id: str, item: Any) -> None:
        """记下**当前正在分析**的岗位（问题 13）。

        与 `_record_progress` 成对：这个回调在每项**开始前**触发，只写当前岗位与提示，
        **不动 completed/failed 计数**——计数仍只在完成后 +1，"已完成 N"才名副其实。
        """
        db = self._session_factory()
        try:
            task = get_job_match_background_task(db, task_id)
            if task is None or task.status not in ACTIVE_JOB_MATCH_BACKGROUND_STATUSES:
                return
            _write_task(
                db,
                task.model_copy(
                    update={
                        "current_job_id": item.job_id,
                        "current_job_title": item.job_title,
                        "message": f"正在分析：{item.job_title}",
                    }
                ),
            )
        finally:
            db.close()

    def _record_progress(self, task_id: str, item: Any) -> None:
        db = self._session_factory()
        try:
            task = get_job_match_background_task(db, task_id)
            if task is None or task.status not in ACTIVE_JOB_MATCH_BACKGROUND_STATUSES:
                return
            completed = task.completed_count + (1 if item.status == "completed" else 0)
            failed = task.failed_count + (1 if item.status == "failed" else 0)
            _write_task(
                db,
                task.model_copy(
                    update={
                        "completed_count": completed,
                        "failed_count": failed,
                        "current_job_id": item.job_id,
                        "current_job_title": item.job_title,
                        "message": f"已处理 {completed + failed}/{task.requested_count} 个岗位",
                    }
                ),
            )
        finally:
            db.close()

    def _persist_partial(
        self,
        run: BatchMatchRun,
        requested_count: int,
        comparison: Any = None,
    ) -> int:
        db = self._session_factory()
        try:
            row = persist_batch(db, run, requested_count=requested_count, comparison=comparison)
            return row.id
        finally:
            db.close()

    def _finish(
        self,
        task_id: str,
        *,
        status: str,
        message: str = "",
        error: str = "",
        batch_id: int | None = None,
    ) -> None:
        db = self._session_factory()
        try:
            task = get_job_match_background_task(db, task_id)
            if task is None:
                return
            _write_task(
                db,
                task.model_copy(
                    update={
                        "status": status,
                        "batch_id": batch_id,
                        "message": message,
                        "error": error,
                        "current_job_id": None,
                        "current_job_title": "",
                        "finished_at": utcnow(),
                    }
                ),
            )
        finally:
            db.close()


_RUNNER: JobMatchBackgroundRunner | None = None
_RUNNER_LOCK = threading.Lock()


def get_job_match_background_runner() -> JobMatchBackgroundRunner:
    global _RUNNER
    with _RUNNER_LOCK:
        if _RUNNER is None:
            _RUNNER = JobMatchBackgroundRunner()
        return _RUNNER


__all__ = [
    "JobMatchBackgroundRunner",
    "JobMatchBackgroundRunnerError",
    "create_job_match_background_task",
    "get_job_match_background_runner",
    "get_job_match_background_task",
    "list_active_job_match_background_tasks",
]
