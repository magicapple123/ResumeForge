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
    # 输入两档（0067）：只累加"有记录"的行；cache_unknown_calls 告诉你有多少条老账本
    # 没这个信息，避免把部分和误当成全量。
    cache_hit_tokens: int | None = None
    cache_miss_tokens: int | None = None
    cache_unknown_calls: int = 0
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
    cache_hit_tokens: int | None = None
    cache_miss_tokens: int | None = None
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
    """一份单价：**每百万 token**，输入拆缓存命中 / 未命中，输出单独一档。

    三档至少填一个（服务商没有缓存折扣时命中档留空很正常）；不填的档按 0 计并在界面
    上说明。名称可选，用来区分"某服务商官方价 / 某次调价后"。
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(default="", max_length=64)
    input_cache_hit_per_million: float | None = Field(default=None, ge=0, le=MAX_PRICE_PER_1K)
    input_cache_miss_per_million: float | None = Field(default=None, ge=0, le=MAX_PRICE_PER_1K)
    output_per_million: float | None = Field(default=None, ge=0, le=MAX_PRICE_PER_1K)
    currency: str = Field(default="CNY", min_length=1, max_length=8)

    @model_validator(mode="after")
    def _require_any_price(self) -> UsagePricingIn:
        prices = (
            self.input_cache_hit_per_million,
            self.input_cache_miss_per_million,
            self.output_per_million,
        )
        if all(price is None for price in prices):
            raise ValueError("至少要填一档单价（缓存命中 / 缓存未命中 / 输出）")
        return self


class UsagePricingOut(BaseModel):
    """当前生效的单价（每百万 token，三档）；configured=False 表示未配置。"""

    configured: bool = False
    input_cache_hit_per_million: float | None = None
    input_cache_miss_per_million: float | None = None
    output_per_million: float | None = None
    currency: str = ""
    # record = 单价记录；settings / environment = 老格式兜底。
    source: str = ""
    record_id: int | None = None
    name: str = ""


class UsagePricingRecordOut(BaseModel):
    """一条单价记录（可命名、可回溯）。"""

    id: int
    name: str = ""
    input_cache_hit_per_million: float | None = None
    input_cache_miss_per_million: float | None = None
    output_per_million: float | None = None
    currency: str = "CNY"
    is_active: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class UsagePricingRecordListOut(BaseModel):
    items: list[UsagePricingRecordOut] = Field(default_factory=list)
    count: int = 0


class UsagePricingRenameIn(BaseModel):
    """只改名字：价格与生效状态都不动。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(default="", max_length=64)
