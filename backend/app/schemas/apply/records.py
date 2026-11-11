# SPDX-License-Identifier: Apache-2.0
"""投递记录与招呼语预览 schema。"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .base import TaskItemStatus, TaskStatus, _check_failure_category
from .tasks import ApplyTaskOut

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
    # #39：失败三段稳定码（0073）。都是**协议值**，展示名与建议在语言包里：
    # 在哪一步（opening/.../unknown）、卡在哪个控件、为什么失败（site_changed 等）。
    failure_step: str = ""
    failure_target: str = ""
    failure_reason: str = ""
    attempt: int = 0
    # 15B：这条记录对应的岗位，JD 在两次采集之间改过（**被动式**：下次采集时才更新）。
    # 记录行上的徽标只说"改过了"，before/after 由 ``GET /queue/{id}/jd-change`` 提供。
    jd_changed: bool = False
    # 15B：这条记录关联的**队列条目 id**（按 job_id 反查，供上面那个徽标点开抽屉）。
    # 记录表里没有这一列，服务层批量算好后传入；岗位不在队列里（已投完移出、手改过队列）
    # 时为空 —— 此时徽标仍显示，但点不开：抽屉端点只认队列条目 id，不许拿 job_id 去猜。
    queue_id: int | None = None
    created_at: datetime
    finished_at: datetime | None = None

    @field_validator("failure_category")
    @classmethod
    def failure_category_must_be_known(cls, value: str) -> str:
        return _check_failure_category(value)


class ApplyRecordBatchDeleteRequest(BaseModel):
    """批量删除请求：与 ``schemas.material.MaterialBatchRequest`` 同款口径（去重 + 上限 500）。"""

    record_ids: list[int] = Field(max_length=500)

    @field_validator("record_ids")
    @classmethod
    def validate_and_deduplicate_ids(cls, value: list[int]) -> list[int]:
        if not value:
            raise ValueError("请至少选择一条投递记录")
        return list(dict.fromkeys(value))


class ApplyRecordBatchDeleteResult(BaseModel):
    deleted: int


class ApplyFailureCountOut(BaseModel):
    """一个批次里某个失败分类的条数（组头「选择器失效 ×2」聚合项）。"""

    category: str
    label: str
    count: int


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
    # 命中当前筛选的记录数（include_items=false 的轻量分页用它展示「N 条记录」，
    # 展开时再按需拉明细；include_items=true 时与 len(items) 一致）。
    matched_count: int = 0
    # #39：组头同因聚合——本批各失败分类的条数（后端已把枚举翻好标签）。
    failure_summary: list[ApplyFailureCountOut] = Field(default_factory=list)
    # #39：「只重试这 N 条」里的 N——本批命中当前筛选、且状态为失败的记录数。
    # 与 matched_count 分开：后者含成功/跳过，能重投的只有失败的那些。
    retryable_count: int = 0
    items: list[ApplyRecordOut] = Field(default_factory=list)


class ApplyRecordRetryBatchRequest(BaseModel):
    """「只重试这 N 条」：在一个批次里按当前筛选选出可重投的失败记录。

    刻意收**筛选条件**而不是 record_ids：明细表是服务端分页的（一页 20 条），
    批次里可能几百条，前端手上没有全集；交给服务端按同一套筛选重新取，才和组头
    显示的 N 对得上。
    """

    model_config = ConfigDict(extra="forbid")

    task_id: int = Field(ge=1)
    keyword: str = Field(default="", max_length=128)
    result: str = Field(default="", max_length=16)
    failure_category: str = Field(default="", max_length=32)

    @field_validator("failure_category")
    @classmethod
    def failure_category_must_be_known(cls, value: str) -> str:
        return _check_failure_category(value)


class ApplyRecordRetryBatchResult(BaseModel):
    """重投结果：实际重投了几条 + 新建的投递批次。"""

    retried: int
    task: ApplyTaskOut


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
