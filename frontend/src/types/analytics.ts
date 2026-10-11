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

/** 只有键与计数的分桶（内推状态分布）。中文名由前端 `REFERRAL_STATUS_LABELS` 提供。 */
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
  /** 进行中且**超过 7 天没有任何更新**（改一条备注也算更新），不叫"面试卡住"。 */
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
