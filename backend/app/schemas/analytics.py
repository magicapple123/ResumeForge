# SPDX-License-Identifier: Apache-2.0
"""求职数据看板（R-14）的响应结构。

只承载结构，**所有计数口径的唯一来源是 ``models/tracker.py`` 的 ``STATUSES`` /
``STATUS_RANK`` / ``STATUS_LABELS``**，看板不另写枚举。具体口径定义与计算见
``services/analytics.py`` 的模块 docstring（那里也写明了**因数据模型不支持而刻意不提供**
的指标，别再提）。

字段全部带默认值：空库时每项都是明确的零/空列表，**不是 None**——前端据此渲染空态，
不需要到处判空。新增字段一律与 ``frontend/src/types/analytics.ts`` 逐字对应（snake_case）。
"""
from pydantic import BaseModel, Field


class FunnelStage(BaseModel):
    """漏斗里的一个阶段：状态键、面向用户的中文名与计数。"""

    status: str
    label: str
    count: int


class TrendPoint(BaseModel):
    """趋势图上的一个点：一个自然月的投递数量。"""

    month: str = ""  # YYYY-MM
    label: str = ""  # 面向展示的短标签（如 "9月"）
    count: int = 0


class LabeledCount(BaseModel):
    """带展示名的分桶计数（周内分布 / 公司排行 / 记录来源共用）。

    ``label`` 只由**拥有该词表**的一侧填：``SOURCE_LABELS`` 与公司名在后端，
    所以这里给得出；内推状态的中文名归前端（见 :class:`KeyedCount`）。
    """

    key: str = ""
    label: str = ""
    count: int = 0


class KeyedCount(BaseModel):
    """只有键与计数的分桶（内推状态分布用）。

    **刻意不带 ``label``**：内推状态的展示名归前端 ``REFERRAL_STATUS_LABELS``，
    后端再写一份就是同一件事的两份定义、迟早漂移。
    """

    key: str = ""
    count: int = 0


class AppliedGapOut(BaseModel):
    """投递日期的填写情况，供前端如实说明"这张图为什么是空的"。

    趋势图与周内分布只统计有 ``applied_at`` 的记录；没有这组数字，一张全零的图会被
    读成"这几个月真的一份没投"，而事实是那些记录**没填日期**。
    """

    dated: int = 0
    undated: int = 0
    total: int = 0


class ReferralBlockOut(BaseModel):
    """内推转化（口径来自 ``referral_service``，看板只搬运）。"""

    total: int = 0
    converted: int = 0
    rate: float = 0.0


class ReminderCountsOut(BaseModel):
    """待办提醒按紧急度分档（阈值口径来自 ``reminder_service.reminder_urgency``）。"""

    overdue: int = 0
    soon: int = 0
    upcoming: int = 0
    later: int = 0
    total: int = 0


class StageConversionOut(BaseModel):
    """一个相邻阶段对的真实转化（RF-18，口径来自事件表）。

    ``numerator`` = 同时到过 from 与 to 的记录数；``denominator`` = 到过 from 的
    记录数。``small_sample`` = 分母低于小样本阈值——前端要显示徽标，不硬算精度。
    """

    from_status: str = ""
    to_status: str = ""
    numerator: int = 0
    denominator: int = 0
    rate: float = 0.0
    small_sample: bool = False


class StageDurationOut(BaseModel):
    """一个相邻阶段对的真实耗时（RF-18，口径来自事件表）。

    ``median_days`` 是同一条记录两个"最早到达日期"的间隔中位数；样本里没有
    可用日期对时为 ``None``——前端显示"暂无可比数据"，不显示 0 天。间隔为负
    （乱序补录）的样本计入 ``skipped_negative``，不硬掰成 0。
    """

    from_status: str = ""
    to_status: str = ""
    numerator: int = 0
    denominator: int = 0
    median_days: float | None = None
    skipped_negative: int = 0
    small_sample: bool = False


class TrackCohortOut(BaseModel):
    """基于状态变化事件表的真实时间线指标（RF-18）。

    覆盖率三兄弟让每个数字可解释：``event_track_count`` 是有事件记录的条数
    （全部阶段指标的样本空间），``historical_track_count`` 是早于事件功能、
    无阶段数据的旧记录条数，``undated_event_count`` 是缺业务日期、只能用落库日
    兜底的事件数。历史行**不回填**：这三个数字就是"我们知道什么、不知道什么"的
    全部边界。
    """

    event_track_count: int = 0
    historical_track_count: int = 0
    undated_event_count: int = 0
    conversions: list[StageConversionOut] = Field(default_factory=list)
    durations: list[StageDurationOut] = Field(default_factory=list)


class ChannelStatOut(BaseModel):
    """一个投递渠道的投递数 / 面试率 / Offer 率（清单 §17.3-A1）。

    channel / label 来自 models/tracker.py 的 CHANNELS / CHANNEL_LABELS（唯一词表）；
    small_sample = 该渠道投递数低于小样本阈值——12 条数据下每个渠道都该亮徽标。
    """

    channel: str = ""
    label: str = ""
    total: int = 0
    interview_count: int = 0
    interview_rate: float = 0.0
    offer_count: int = 0
    offer_rate: float = 0.0
    small_sample: bool = False


class StatusDurationOut(BaseModel):
    """「投递 → 当前状态」耗时（清单 §17.3-A2，只用 applied_at + status_date）。

    sample_count 是可用日期对的条数，denominator 是该状态的记录总数——两个数一起看
    才知道中位数覆盖了多少。median_days 为 None 表示没有可用样本（前端显示
    "暂无可比数据"，不显示 0 天）。skipped_negative 是 status_date 早于 applied_at
    的乱序补录数，不硬掰成 0。
    """

    status: str = ""
    label: str = ""
    sample_count: int = 0
    denominator: int = 0
    median_days: float | None = None
    skipped_negative: int = 0
    small_sample: bool = False


class CompanyRepeatOut(BaseModel):
    """同一家公司投了多个岗位的记录组（清单 §17.3-A3）。"""

    company_key: str = ""
    company: str = ""
    total: int = 0
    interview_count: int = 0
    offer_count: int = 0


class CompanyRepeatBlockOut(BaseModel):
    """同公司多投的两份清单：>=2 次投递；>=3 次且 0 面试（最该止损）。"""

    repeats: list[CompanyRepeatOut] = Field(default_factory=list)
    no_interview: list[CompanyRepeatOut] = Field(default_factory=list)


class ResumeEffectOut(BaseModel):
    """按关联简历分组的投递结果（清单 §17.3-B4）。**样本量必须展示**，不做因果归因。"""

    resume_id: int
    resume_title: str = ""
    total: int = 0
    interview_count: int = 0
    interview_rate: float = 0.0
    small_sample: bool = False


class ModelUsageOut(BaseModel):
    """一个模型的生成用量（按 resume_generate 分组；换模型后不该被旧账拉偏）。"""

    model: str = ""
    calls: int = 0
    completion_tokens: int = 0
    avg_duration_ms: int = 0


class GenerationCostOut(BaseModel):
    """生成成本与耗时（清单 §17.3-C7）。**只报 token 与耗时，不报金额**——本库没有价格表。"""

    generate_calls: int = 0
    generate_completion_tokens: int = 0
    generate_avg_duration_ms: int = 0
    total_calls: int = 0
    total_tokens: int = 0
    by_model: list[ModelUsageOut] = Field(default_factory=list)


class WeeklyGoalOut(BaseModel):
    """周投递目标 vs 本周已投（清单 §17.3-C6）。target=0 表示没设目标。"""

    target: int = 0
    this_week_count: int = 0


class WeeklyGoalIn(BaseModel):
    """写入周目标：0-100；0 = 取消目标。"""

    target: int = Field(default=0, ge=0, le=100)


class DashboardOut(BaseModel):
    """看板整体响应：概览指标 + 四个主题区块所需的分组数据。"""

    # ===== 概览 =====
    total_applications: int = 0
    valid_applications: int = 0
    interview_count: int = 0
    interview_rate: float = 0.0
    assessment_count: int = 0
    assessment_to_interview_count: int = 0
    assessment_pass_rate: float = 0.0
    offer_count: int = 0
    offer_rate: float = 0.0
    funnel: list[FunnelStage] = Field(default_factory=list)
    trend: list[TrendPoint] = Field(default_factory=list)

    # ===== 转化与卡点 =====
    active_count: int = 0
    stalled_count: int = 0
    no_next_action_count: int = 0

    # ===== 时间与节奏 =====
    weekday: list[LabeledCount] = Field(default_factory=list)
    applied_date_gap: AppliedGapOut = Field(default_factory=AppliedGapOut)
    recent_7d_count: int = 0
    recent_30d_count: int = 0
    reminder_counts: ReminderCountsOut = Field(default_factory=ReminderCountsOut)

    # ===== 渠道与去向 =====
    top_companies: list[LabeledCount] = Field(default_factory=list)
    other_company_count: int = 0
    record_sources: list[LabeledCount] = Field(default_factory=list)
    referral: ReferralBlockOut = Field(default_factory=ReferralBlockOut)
    referral_status: list[KeyedCount] = Field(default_factory=list)

    # ===== 真实时间线（RF-18，口径来自状态变化事件表）=====
    cohort: TrackCohortOut = Field(default_factory=TrackCohortOut)

    # ===== 第 17 条新增：渠道转化 / 投递→当前状态耗时 / 同公司多投 / 简历效果 =====
    channel_stats: list[ChannelStatOut] = Field(default_factory=list)
    status_durations: list[StatusDurationOut] = Field(default_factory=list)
    company_repeats: CompanyRepeatBlockOut = Field(default_factory=CompanyRepeatBlockOut)
    resume_effects: list[ResumeEffectOut] = Field(default_factory=list)

    # ===== 第 17 条新增：周目标与生成成本（P3） =====
    weekly_goal: WeeklyGoalOut = Field(default_factory=WeeklyGoalOut)
    generation_cost: GenerationCostOut = Field(default_factory=GenerationCostOut)

    # ===== 简历与健康度 =====
    resume_count: int = 0
    resume_scanned_count: int = 0
    resume_with_warnings_count: int = 0
    resume_with_placeholders_count: int = 0
    unverified_claim_count: int = 0
    track_resume_linked_count: int = 0


__all__ = [
    "AppliedGapOut",
    "ChannelStatOut",
    "CompanyRepeatBlockOut",
    "CompanyRepeatOut",
    "DashboardOut",
    "FunnelStage",
    "KeyedCount",
    "LabeledCount",
    "GenerationCostOut",
    "ModelUsageOut",
    "ReferralBlockOut",
    "ReminderCountsOut",
    "ResumeEffectOut",
    "StageConversionOut",
    "StageDurationOut",
    "StatusDurationOut",
    "TrackCohortOut",
    "TrendPoint",
    "WeeklyGoalIn",
    "WeeklyGoalOut",
]
