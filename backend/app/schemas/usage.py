# SPDX-License-Identifier: Apache-2.0
"""R04 用量汇总的接口形状：只含数字/枚举，不含提示词、密钥或个人资料。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class UsageBucketOut(BaseModel):
    """按任务或按模型的聚合桶；token 为 None 表示**存在未知用量**（不是 0）。"""

    key: str
    calls: int = 0
    retries: int = 0
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    duration_ms: int | None = None
    unknown_token_calls: int = 0


class UsageCostOut(BaseModel):
    """费用只在用户配置了单价时估算；否则 estimated=False 且不给数字。"""

    estimated: bool = False
    currency: str = ""
    amount: float | None = None
    reason: str = "未配置模型价格，不估算费用"


class UsageSummaryOut(BaseModel):
    dataset_id: str | None = None
    records: int = 0
    since: datetime | None = None
    tasks: list[UsageBucketOut] = Field(default_factory=list)
    models: list[UsageBucketOut] = Field(default_factory=list)
    totals: UsageBucketOut = Field(default_factory=UsageBucketOut)
    unknown_token_records: int = 0
    cost: UsageCostOut = Field(default_factory=UsageCostOut)


class UsageRecordOut(BaseModel):
    """单条用量（诊断用）；**没有任何正文/密钥字段**。"""

    id: int
    task: str
    model: str = ""
    resume_id: int | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    duration_ms: int | None = None
    finish_reason: str = ""
    retries: int = 0
    created_at: datetime | None = None
