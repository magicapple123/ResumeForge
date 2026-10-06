"""投递记录与招呼语预览 schema。"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .base import TaskItemStatus, TaskStatus, _check_failure_category

# ===== 记录 =====


class ApplyRecordOut(BaseModel):
    """投递记录（已脱敏：只含岗位/简历的展示快照，不含任何完整个人资料）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    job_id: int | None = None
    job_title: str = ""
    company: str = ""
    resume_title: str = ""
    greeting: str = ""
    status: TaskItemStatus = "pending"
    failure_category: str = ""
    # 失败分类的中文说明（由服务层按 FAILURE_CATEGORY_LABELS 填充）。
    failure_label: str = ""
    failure_detail: str = ""
    attempt: int = 0
    created_at: datetime
    finished_at: datetime | None = None

    @field_validator("failure_category")
    @classmethod
    def failure_category_must_be_known(cls, value: str) -> str:
        return _check_failure_category(value)


class ApplyRecordBatchOut(BaseModel):
    """一个投递批次及其全部记录（投递记录按批次分组展示的载体）。

    一次「开始投递」建一个批次（``ApplyTask``，kind=apply），批次里的每个岗位是一条
    记录（``ApplyTaskItem``）。用户一次性投了好几个岗位时，这几条记录同属一个批次，
    界面把它们折叠成一组、点击展开看明细——分组键就是批次 id。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    status: TaskStatus
    total: int = 0
    processed: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    message: str = ""
    created_at: datetime
    finished_at: datetime | None = None
    items: list[ApplyRecordOut] = Field(default_factory=list)


# ===== 招呼语预览 =====


class GreetingPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: int = Field(ge=1)
    # 给了 item_id 就基于队列里该条目当前的简历与招呼语来生成。
    item_id: int | None = Field(default=None, ge=1)


class GreetingPreviewOut(BaseModel):
    greeting: str = ""
    # 来源：generated（模型生成）/ queue（队列已有值）/ default（默认招呼语）。
    source: str = "default"

