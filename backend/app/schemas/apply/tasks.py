"""投递批次（执行）schema。"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .base import (
    MAX_TASK_TARGETS,
    TaskItemStatus,
    TaskKind,
    TaskStatus,
    _check_failure_category,
)


# ===== 批次（执行）=====


class ApplyTaskCreate(BaseModel):
    """显式开始投递：默认取整队列；给了 job_ids 就只投这几个已勾选的。

    两个都不给（空体且 use_queue=False）必须由 API 层返回 400——绝无"无参数即全网海投"。
    """

    model_config = ConfigDict(extra="forbid")

    job_ids: list[int] | None = Field(default=None, max_length=MAX_TASK_TARGETS)
    use_queue: bool = False


class ApplyTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: TaskKind
    status: TaskStatus
    total: int = 0
    processed: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    current_step: str = ""
    stop_reason: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    message: str = ""
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime


class ApplyTaskItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    job_id: int | None = None
    job_title: str = ""
    company: str = ""
    resume_id: int | None = None
    resume_title: str = ""
    greeting: str = ""
    status: TaskItemStatus = "pending"
    failure_category: str = ""
    failure_detail: str = ""
    attempt: int = 0
    sort_order: int = 0
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime

    @field_validator("failure_category")
    @classmethod
    def failure_category_must_be_known(cls, value: str) -> str:
        return _check_failure_category(value)


class ApplyTaskDetailOut(ApplyTaskOut):
    items: list[ApplyTaskItemOut] = Field(default_factory=list)

