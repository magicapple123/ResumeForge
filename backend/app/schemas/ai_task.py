# SPDX-License-Identifier: Apache-2.0
"""通用 AI 任务（``ai_task``）的请求与响应结构。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

#: 与 ``models/ai_task.py`` 的状态常量逐字对应（前端按同一套字符串分支）。
AiTaskStatus = Literal["pending", "running", "succeeded", "failed", "canceled"]


class AiTaskCreateRequest(BaseModel):
    """创建一次 AI 任务：类型 + 输入摘要（不放完整 JD / 个人资料正文）。"""

    model_config = ConfigDict(extra="forbid")

    kind: str = Field(min_length=1, max_length=32)
    payload: dict[str, Any] = Field(default_factory=dict)
    #: 人话说明（前端页头任务面板显示）。留空时前端按 kind 自行兜底。
    label: str = Field(default="", max_length=256)


class AiTaskOut(BaseModel):
    """任务快照：状态 + 进度 + 失败原因 + 落点标识（前端据此弹通知与生成深链）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    status: AiTaskStatus
    progress: int = Field(default=0, ge=0, le=100)
    label: str = ""
    message: str = ""
    #: 完成后点通知该跳哪：``{"resume_id": 12}`` / ``{"job_id": 7}``；无落点时为 ``None``。
    result_ref: dict[str, Any] | None = None
    error: str = ""
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


__all__ = ["AiTaskCreateRequest", "AiTaskOut", "AiTaskStatus"]
