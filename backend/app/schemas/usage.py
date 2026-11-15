# SPDX-License-Identifier: Apache-2.0
"""R04 用量汇总的接口形状：只含数字/枚举，不含提示词、密钥或个人资料。"""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_PRICE_PER_1K = 1_000_000.0


class UsageExternalWindowOut(BaseModel):
    """外部用量的时间窗（含首尾）；`days` = 窗口覆盖的自然日数。"""

    days: int = 0
    since: date | None = None
    until: date | None = None


class UsageExternalOut(BaseModel):
    """四类**非 token** 用量（T16）：只有数量与单位，**没有任何金额字段**。

    - OCR = 页数；TTS = 计费字符数（汉字算 2，由生产方折算）；ASR = 音频秒数；
      搜索 = 成功请求次数。
    - 没记过任何数时四项都是 0（不是 null）：界面上一行"0 页"是可用的事实，
      空白会被读成功能坏了。
    - 决策 #5 是"用量不折算金额"，所以这里不出现 cost / price / amount / currency，
      也不提供按单价换算的入口。
    """

    ocr_pages: int = 0
    tts_chars: int = 0
    asr_seconds: float = 0.0
    search_calls: int = 0
    window: UsageExternalWindowOut = Field(default_factory=UsageExternalWindowOut)


class UsageExternalPayloadOut(BaseModel):
    """`GET /api/analytics/usage` 的响应：`external` 段 + 当前数据集。"""

    dataset_id: str | None = None
    external: UsageExternalOut = Field(default_factory=UsageExternalOut)


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
    # 非 token 用量（T16）：与 token 汇总同一份响应、同一个时间窗，但**没有任何金额**。
    external: UsageExternalOut = Field(default_factory=UsageExternalOut)


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
    # #35 数据边界审计四字段（0074）：喂了什么范围、是否脱敏、目标语言、token 预算。
    # ``masked`` 的 None 与 False 必须能区分：None = 未声明（老账本 / 未声明入口），
    # False = 明确未脱敏。空串同理表示"该入口没有声明这一项"。
    input_scope: str = ""
    masked: bool | None = None
    language: str = ""
    budget: int | None = None
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
