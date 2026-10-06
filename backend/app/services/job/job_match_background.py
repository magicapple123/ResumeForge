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
from ...schemas.job_match_background import (
    ACTIVE_JOB_MATCH_BACKGROUND_STATUSES,
    JobMatchBackgroundTask,
)
from ...services import trash
from ...services.settings_service import get_llm_config
from .job_match_batch import (
    BatchMatchCancelled,
    BatchMatchInput,
    BatchMatchRun,
    build_batch_inputs,
    persist_batch,
    run_batch_match,
)

logger = logging.getLogger(__name__)
_TASK_KEY = "job_match_background_task"


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
    db: Session, job_ids: list[int], *, force: bool
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
        requested_count=len(job_ids),
        created_at=now,
        message="等待后台任务启动",
    )
    return _write_task(db, task)


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
            self._stop.clear()
            self._current_task_id = task_id
            self._thread = threading.Thread(
                target=self._run, args=(task_id,), name=f"rf-job-match-{task_id[:8]}", daemon=True
            )
            self._thread.start()

    def cancel(self, task_id: str) -> None:
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
        try:
            prepared = self._prepare(task_id)
            if prepared is None:
                return
            inputs, config = prepared
            try:
                run = asyncio.run(
                    run_batch_match(
                        inputs,
                        config,
                        on_item_complete=lambda item: self._record_progress(task_id, item),
                        should_cancel=self._stop.is_set,
                    )
                )
            except BatchMatchCancelled as cancelled:
                batch_id = self._persist_partial(
                    BatchMatchRun(items=cancelled.items, model=cancelled.model), len(inputs)
                )
                self._finish(
                    task_id,
                    status="cancelled",
                    batch_id=batch_id,
                    message="后台分析已取消，已保留取消前完成的结果",
                )
                return
            batch_id = self._persist_partial(run, len(inputs))
            self._finish(
                task_id,
                status="completed",
                batch_id=batch_id,
                message="岗位适配度分析已完成",
            )
        except Exception as exc:  # noqa: BLE001 - 工作线程必须把异常落成可读状态
            logger.exception("岗位匹配后台任务执行失败 task_id=%s", task_id)
            self._finish(task_id, status="failed", error=str(exc) or "后台分析失败，请稍后重试")
        finally:
            with self._lock:
                if self._current_task_id == task_id:
                    self._current_task_id = None
                    self._thread = None
                    self._stop.clear()

    def _prepare(self, task_id: str) -> tuple[list[BatchMatchInput], Any] | None:
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
                db, [found[job_id] for job_id in task.job_ids], force=task.force
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
            return inputs, config
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

    def _persist_partial(self, run: BatchMatchRun, requested_count: int) -> int:
        db = self._session_factory()
        try:
            row = persist_batch(db, run, requested_count=requested_count)
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
