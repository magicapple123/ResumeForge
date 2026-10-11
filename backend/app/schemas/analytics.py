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

    # ===== 简历与健康度 =====
    resume_count: int = 0
    resume_scanned_count: int = 0
    resume_with_warnings_count: int = 0
    resume_with_placeholders_count: int = 0
    unverified_claim_count: int = 0
    track_resume_linked_count: int = 0


__all__ = [
    "AppliedGapOut",
    "DashboardOut",
    "FunnelStage",
    "KeyedCount",
    "LabeledCount",
    "ReferralBlockOut",
    "ReminderCountsOut",
    "StageConversionOut",
    "StageDurationOut",
    "TrackCohortOut",
    "TrendPoint",
]
