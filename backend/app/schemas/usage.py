# SPDX-License-Identifier: Apache-2.0
"""R04 用量汇总的接口形状：只含数字/枚举，不含提示词、密钥或个人资料。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_PRICE_PER_1K = 1_000_000.0


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
    # 结束原因计数（stop/length/cancelled/error/unknown…）；R04 要求按任务/模型汇总。
    finish_reasons: dict[str, int] = Field(default_factory=dict)


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
    # UsageBucketOut.key 是必填字段：默认桶用空 key（现状没有任何构造点省略 totals，
    # 这个默认值只是让"缺省可用"为真，而不是在第一次触发时抛 ValidationError）。
    totals: UsageBucketOut = Field(default_factory=lambda: UsageBucketOut(key=""))
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
    # 记录时的费用快照（未配置单价时为 None/空串）；不含任何正文。
    cost_estimate: float | None = None
    cost_currency: str = ""
    created_at: datetime | None = None


class UsageRecordListOut(BaseModel):
    items: list[UsageRecordOut] = Field(default_factory=list)
    count: int = 0


class UsagePricingIn(BaseModel):
    """用户配置的每千 token 单价（输入/输出分开）；两项同时给或同时清空。

    费用只在配置后估算（R04）；不配置时接口保持 estimated=False，不臆造金额。
    """

    model_config = ConfigDict(extra="forbid")

    input_per_1k: float | None = Field(default=None, ge=0, le=MAX_PRICE_PER_1K)
    output_per_1k: float | None = Field(default=None, ge=0, le=MAX_PRICE_PER_1K)
    currency: str = Field(default="CNY", min_length=1, max_length=8)

    @model_validator(mode="after")
    def _require_both_prices(self) -> UsagePricingIn:
        if (self.input_per_1k is None) != (self.output_per_1k is None):
            raise ValueError("输入与输出单价必须同时配置或同时清除")
        return self


class UsagePricingOut(BaseModel):
    """当前生效的单价配置；configured=False 表示未配置（费用一律未知）。"""

    configured: bool = False
    input_per_1k: float | None = None
    output_per_1k: float | None = None
    currency: str = ""
    # settings = 用户保存在设置里的值；environment = 环境变量兜底。
    source: str = ""
