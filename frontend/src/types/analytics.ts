// SPDX-License-Identifier: Apache-2.0
/** 求职数据看板（后端 /api/analytics）。
 *
 * 字段与 `backend/app/schemas/analytics.py` 的 `DashboardOut` **逐字对应**（snake_case，
 * 没有 camelCase 转换层）。各指标的口径写在 `services/analytics.py` 的模块 docstring 里，
 * 那里也写明了因数据模型不支持而**刻意不提供**的指标。
 *
 * 所有字段在后端都有默认值：空库时是明确的零/空数组，**不是 null**——所以这里不需要
 * 到处判空，直接渲染空态即可。
 */

export interface FunnelStage {
  status: string;
  label: string;
  count: number;
}

export interface TrendPoint {
  /** YYYY-MM。 */
  month: string;
  /** 面向展示的短标签，如 "9月"。 */
  label: string;
  count: number;
}

/** 带展示名的分桶计数（周内分布 / 公司排行 / 记录来源共用）。 */
export interface LabeledCount {
  key: string;
  label: string;
  count: number;
}

/** 只有键与计数的分桶（内推状态分布）。中文名由 `i18n/enum/referral.ts` 的
 *  `REFERRAL_STATUS_LABEL_KEYS` 映射到语言包提供。 */
export interface KeyedCount {
  key: string;
  count: number;
}

/** 投递日期的填写情况：趋势图与周内分布**只统计有日期的记录**，没有这组数字，
 *  一张全零的图会被读成"这几个月真的一份没投"。 */
export interface AppliedGap {
  dated: number;
  undated: number;
  total: number;
}

export interface ReferralBlock {
  total: number;
  converted: number;
  rate: number;
}

export interface ReminderCounts {
  overdue: number;
  soon: number;
  upcoming: number;
  later: number;
  total: number;
}

/** 一个相邻阶段对的真实转化（RF-18，口径来自状态变化事件表）。 */
export interface StageConversion {
  from_status: string;
  to_status: string;
  /** 同时到过 from 与 to 的记录数。 */
  numerator: number;
  /** 到过 from 的记录数。 */
  denominator: number;
  rate: number;
  small_sample: boolean;
}

/** 一个相邻阶段对的真实耗时。median_days 为 null 表示没有可用日期对，不显示 0 天。 */
export interface StageDuration {
  from_status: string;
  to_status: string;
  numerator: number;
  denominator: number;
  median_days: number | null;
  skipped_negative: number;
  small_sample: boolean;
}

/** 基于状态变化事件表的真实时间线指标（RF-18）。历史行不回填，覆盖率如实下发。 */
export interface TrackCohort {
  event_track_count: number;
  historical_track_count: number;
  undated_event_count: number;
  conversions: StageConversion[];
  durations: StageDuration[];
}

/** 一个投递渠道的投递数 / 面试率 / Offer 率（清单 §17.3-A1）。
 *
 *  `channel` 是用户自选的"这份工作从哪来的"，与「记录来源」（`source`）和内推模块
 *  （`referral` 表）是三套不同口径，不能相加。样本低于阈值时 `small_sample` 为真，
 *  界面必须亮徽标。
 */
export interface ChannelStat {
  channel: string;
  /** 中文展示名由后端下发（CHANNEL_LABELS 是唯一词表）。 */
  label: string;
  total: number;
  interview_count: number;
  interview_rate: number;
  offer_count: number;
  offer_rate: number;
  small_sample: boolean;
}

/** 「投递 → 当前状态」耗时（清单 §17.3-A2）：只用 applied_at + status_date，不依赖事件表。 */
export interface StatusDuration {
  status: string;
  label: string;
  /** 有可用日期对的条数。 */
  sample_count: number;
  /** 该状态的记录总数（含缺日期的）。 */
  denominator: number;
  /** null = 没有可用样本，界面显示"暂无可比数据"，不显示 0 天。 */
  median_days: number | null;
  skipped_negative: number;
  small_sample: boolean;
}

/** 同一家公司投了多个岗位（清单 §17.3-A3）。 */
export interface CompanyRepeat {
  company_key: string;
  company: string;
  total: number;
  interview_count: number;
  offer_count: number;
}

export interface CompanyRepeatBlock {
  /** 投了 >=2 个岗位的公司。 */
  repeats: CompanyRepeat[];
  /** 投了 >=3 次但 0 面试的公司——最该止损的清单。 */
  no_interview: CompanyRepeat[];
}

/** 按关联简历分组的投递结果（清单 §17.3-B4）；`small_sample` 必须展示，不做因果归因。 */
export interface ResumeEffect {
  resume_id: number;
  resume_title: string;
  total: number;
  interview_count: number;
  interview_rate: number;
  small_sample: boolean;
}

export interface ModelUsage {
  model: string;
  calls: number;
  completion_tokens: number;
  avg_duration_ms: number;
}

/** 生成成本与耗时（清单 §17.3-C7）。只报 token 与耗时，不报金额（没有价格表）。 */
export interface GenerationCost {
  generate_calls: number;
  generate_completion_tokens: number;
  generate_avg_duration_ms: number;
  total_calls: number;
  total_tokens: number;
  by_model: ModelUsage[];
}

/** 周投递目标 vs 本周已投（清单 §17.3-C6）；target=0 表示没设目标。 */
export interface WeeklyGoal {
  target: number;
  this_week_count: number;
}

export interface AnalyticsDashboard {
  // ===== 概览 =====
  total_applications: number;
  valid_applications: number;
  interview_count: number;
  interview_rate: number;
  assessment_count: number;
  assessment_to_interview_count: number;
  assessment_pass_rate: number;
  offer_count: number;
  offer_rate: number;
  funnel: FunnelStage[];
  trend: TrendPoint[];

  // ===== 转化与卡点 =====
  active_count: number;
  /** 进行中且**超过 7 天没有发生状态变化**（事件 > status_date > updated_at），
   *  不叫"面试卡住"——改备注不再刷新这个判定。 */
  stalled_count: number;
  no_next_action_count: number;

  // ===== 时间与节奏 =====
  weekday: LabeledCount[];
  applied_date_gap: AppliedGap;
  /** 滚动窗口（按 created_at），与用户时区无关。 */
  recent_7d_count: number;
  recent_30d_count: number;
  reminder_counts: ReminderCounts;

  // ===== 渠道与去向 =====
  top_companies: LabeledCount[];
  other_company_count: number;
  /** **记录怎么进系统的**，不是投递渠道。 */
  record_sources: LabeledCount[];
  referral: ReferralBlock;
  referral_status: KeyedCount[];

  // ===== 真实时间线（RF-18，口径来自状态变化事件表）=====
  cohort: TrackCohort;

  // ===== 第 17 条新增：渠道转化 / 投递→当前状态耗时 / 同公司多投 / 简历效果 =====
  channel_stats: ChannelStat[];
  status_durations: StatusDuration[];
  company_repeats: CompanyRepeatBlock;
  resume_effects: ResumeEffect[];

  // ===== 第 17 条新增：周目标与生成成本（P3） =====
  weekly_goal: WeeklyGoal;
  generation_cost: GenerationCost;

  // ===== 简历与健康度 =====
  resume_count: number;
  /** 健康度扫描窗口内的份数；小于 `resume_count` 时说明只扫了最近这批。 */
  resume_scanned_count: number;
  resume_with_warnings_count: number;
  resume_with_placeholders_count: number;
  unverified_claim_count: number;
  /** 投递-简历关联覆盖率。录入界面目前没有关联入口，所以它是用来**暴露缺口**的。 */
  track_resume_linked_count: number;
}
