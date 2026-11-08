# SPDX-License-Identifier: Apache-2.0
"""求职偏好的请求/响应结构（计划 §6.3.2 / 契约 D 节）。

三个刻意分开的语义轴在回显里原样呈现，不做"友好化"合并：
- state：版本状态（active / superseded / undone）；
- deleted_at 不出现（删除后本就查不到）；
- source：这条从哪来（user_stated / user_edited / imported）——**不含 assistant**。

值校验在 pydantic 层调用 services/job_preference_catalog 的逐 kind 校验器：非法 kind、
非法值形状（城市里带数字/履历名词、薪资解析不了等）在**参数校验阶段**就 422，
不会进到服务层。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..services import job_preference_catalog as catalog

MAX_NOTE_CHARS = 200

PREFERENCE_SOURCE_VALUES = ("user_stated", "user_edited", "imported")
PREFERENCE_STATE_VALUES = ("active", "superseded", "undone")


class JobPreferenceOut(BaseModel):
    """一条偏好的回显（契约 D 节的最低字段 + 注入块用的 label）。"""

    pref_id: str
    kind: str
    label: str
    value_kind: str
    value: Any
    source: str
    source_proposal_id: str | None = None
    note: str = ""
    state: str
    # 同 kind 是否有可撤销的上一版（前端据此显示/禁用「撤销到上一版」）。
    has_previous: bool = False
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_record(cls, record: Any, *, has_previous: bool = False) -> JobPreferenceOut:
        spec = catalog.spec_for_kind(record.kind)
        return cls(
            pref_id=record.pref_id,
            kind=record.kind,
            label=spec.label,
            value_kind=record.value_kind,
            value=record.value,
            source=record.source,
            source_proposal_id=record.source_proposal_id,
            note=record.note or "",
            state=record.state,
            has_previous=has_previous,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )


class JobPreferenceCatalogItem(BaseModel):
    """目录的一条：kind 是稳定协议值，label 是后端给的中文名（前端可走自己的 i18n）。"""

    kind: str
    value_kind: str
    label: str
    inject_priority: int
    options: list[dict[str, str]] = Field(default_factory=list)


class JobPreferenceListOut(BaseModel):
    """GET /api/job-preferences 的响应：列表 + 目录一次拿全（前端不必再请求一份闭集）。"""

    items: list[JobPreferenceOut]
    catalog: list[JobPreferenceCatalogItem]


class CreateJobPreferenceInput(BaseModel):
    """POST /api/job-preferences 与 create_job_preference 工具共用入参。"""

    model_config = ConfigDict(extra="forbid")

    kind: str = Field(min_length=1, max_length=48, description="偏好类别（12 类闭集之一）")
    value: Any = Field(description="偏好值：list 类传数组，scalar 类传对象或协议串")
    note: str = Field(default="", max_length=MAX_NOTE_CHARS, description="用户原话摘录（可选）")

    @model_validator(mode="after")
    def normalize_value(self) -> CreateJobPreferenceInput:
        spec = catalog.spec_for_kind(self.kind)
        self.kind = spec.kind
        self.value = catalog.normalize_value(spec.kind, self.value)
        return self


class UpdateJobPreferenceInput(BaseModel):
    """PATCH /api/job-preferences/{pref_id} 与 update_job_preference 工具共用入参。

    值校验要等看到目标行才知道 kind（同一 pref_id 的 kind 不可变），所以在服务层按
    行内 kind 校验；这里只挡"没给值"这种结构错误。
    """

    model_config = ConfigDict(extra="forbid")

    pref_id: str = Field(
        min_length=4, max_length=32, description="偏好 pref_id（先用 get_job_preferences 查）"
    )
    value: Any = Field(description="新的偏好值（类别沿用该条偏好，不可在更新时改类别）")
    note: str | None = Field(
        default=None, max_length=MAX_NOTE_CHARS, description="用户原话摘录；不传则保留原备注"
    )

    @model_validator(mode="after")
    def value_is_required(self) -> UpdateJobPreferenceInput:
        if self.value is None:
            raise ValueError("必须给出新的偏好值（value）")
        self.pref_id = self.pref_id.strip()
        return self


class JobPreferenceDeleteOut(BaseModel):
    """DELETE 的回显。

    id 是**回收站用的数据库行 id**（/api/trash 的恢复接口只认它，前端 5 秒「撤销」
    Toast 直接用它调 POST /api/trash/job_preference/{id}/restore）；pref_id 是对外
    稳定 id，两个都要给——只给 pref_id 前端构造不出撤销。
    """

    pref_id: str
    id: int
    deleted: bool = True


class SessionProposalOut(BaseModel):
    """「只在这次对话」端点的回显：落下的那行 + 提案终态。"""

    pref: JobPreferenceOut
    proposal_id: str
    proposal_status: str
    summary: str


__all__ = [
    "CreateJobPreferenceInput",
    "JobPreferenceCatalogItem",
    "JobPreferenceDeleteOut",
    "JobPreferenceListOut",
    "JobPreferenceOut",
    "MAX_NOTE_CHARS",
    "PREFERENCE_SOURCE_VALUES",
    "PREFERENCE_STATE_VALUES",
    "SessionProposalOut",
    "UpdateJobPreferenceInput",
]
