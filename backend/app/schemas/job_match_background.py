"""岗位批量适配度分析后台任务的数据结构。"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

JobMatchBackgroundTaskStatus = Literal["pending", "running", "completed", "failed", "cancelled"]
ACTIVE_JOB_MATCH_BACKGROUND_STATUSES = ("pending", "running")


class JobMatchBackgroundTask(BaseModel):
    """存放在 ``AppSetting`` 中、供前端轮询的轻量任务快照。"""

    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=8, max_length=64)
    status: JobMatchBackgroundTaskStatus
    job_ids: list[int] = Field(min_length=1, max_length=50)
    force: bool = False
    requested_count: int = Field(ge=1, le=50)
    completed_count: int = Field(default=0, ge=0)
    failed_count: int = Field(default=0, ge=0)
    current_job_id: int | None = None
    current_job_title: str = Field(default="", max_length=256)
    batch_id: int | None = None
    message: str = Field(default="", max_length=1000)
    error: str = Field(default="", max_length=2000)
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


__all__ = [
    "ACTIVE_JOB_MATCH_BACKGROUND_STATUSES",
    "JobMatchBackgroundTask",
    "JobMatchBackgroundTaskStatus",
]
