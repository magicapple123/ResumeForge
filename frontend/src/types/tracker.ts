// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度类型。
 *
 * 取值与后端 `models/tracker.py` 的常量**逐字对应**——两处各写一份最容易漂移，
 * 而这里的漂移会表现成"界面上能选、保存时 422"。
 */

/** 漏斗的七个状态。顺序就是漏斗的推进顺序，「已结束」和「待确认」不在主线上。 */
export const TRACK_STATUSES = [
  "applied",
  "screening",
  "assessment",
  "interview",
  "offer",
  "rejected",
  "unknown",
] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];

/** 漏斗主线（按推进顺序），「已结束」「待确认」不属于主线。 */
export const FUNNEL_STATUSES: readonly TrackStatus[] = [
  "applied",
  "screening",
  "assessment",
  "interview",
  "offer",
];

export const TRACK_STATUS_COLORS: Record<TrackStatus, string> = {
  applied: "default",
  screening: "blue",
  assessment: "cyan",
  interview: "purple",
  offer: "green",
  rejected: "red",
  unknown: "gold",
};

/** 进行中：还没走到终态的，界面上要突出。 */
export const ACTIVE_TRACK_STATUSES: readonly TrackStatus[] = [
  "applied",
  "screening",
  "assessment",
  "interview",
];

export function isActiveStatus(status: TrackStatus): boolean {
  return ACTIVE_TRACK_STATUSES.includes(status);
}

/** 记录来源：区分"投递台自动记的"和"我自己加的/识别导入的"。 */
export const TRACK_SOURCES = ["apply", "manual", "recognized"] as const;
export type TrackSource = (typeof TRACK_SOURCES)[number];

/**
 * 投递渠道（RF-18）：用户自选"这份工作从哪来的"，与上面的记录来源是两个维度。
 * 取值与后端 `models/tracker.py` 的 CHANNELS 逐字对应；「未知」是合法默认值。
 */
export const TRACK_CHANNELS = [
  "unknown",
  "referral",
  "official_website",
  "job_platform",
  "headhunter",
  "other",
] as const;
export type TrackChannel = (typeof TRACK_CHANNELS)[number];

/** 合并结论：这次识别对这条记录做了什么。 */
export const MERGE_ACTIONS = ["created", "updated", "unchanged"] as const;
export type MergeAction = (typeof MERGE_ACTIONS)[number];

export const MERGE_ACTION_COLORS: Record<MergeAction, string> = {
  created: "green",
  updated: "blue",
  unchanged: "default",
};

export interface TrackRecord {
  company: string;
  title: string;
  status: TrackStatus;
  stage_note: string;
  applied_at: string;
  status_date: string;
  next_action: string;
  next_action_date: string;
  note: string;
  evidence: string;
}

export interface Track extends TrackRecord {
  id: number;
  source: TrackSource;
  created_at: string;
  updated_at: string;
  job_id: number | null;
  /**
   * 岗位深链（整改 #7）：这一行的岗位名能点去哪。
   *
   * **只读派生字段**：`job_id` 有值且岗位还在时就是它，否则后端按"同公司 + 岗位名相等
   * 或为进度标题前缀"求唯一命中（见 `services/tracker_job_link.py`）。为 null 表示
   * 没匹配上 / 岗位已删 / 有多个候选——此时岗位名保持纯文本，不给死链。
   * 可选：单条详情等不做批量匹配的出口不带这个字段。
   */
  job_link_id?: number | null;
  resume_id: number | null;
  /**
   * 关联的外部简历（T6）：用户在别处生成的 PDF / docx 原件。
   *
   * 与 `resume_id` **互斥**（后端契约守着，同时非空 422）；两张表 id 空间独立、会撞号，
   * 所以下拉的值域是复合串 `internal:3` / `external:3`，**不要在这里改成裸数字**。
   */
  external_resume_id: number | null;
  /**
   * 所用简历的标题快照（RF-17 / T6）：**两种来源共用这一列**——内部简历取
   * `resume_record.title`，外部简历取 `external_resume.name`。简历/外部简历被删后仍可读；
   * 空 = 历史关联未知（界面标「历史关联」）。清空关联不会清空这里。
   */
  resume_title: string;
  /** 投递渠道（RF-18）：用户自选，默认「未知」。 */
  channel: TrackChannel;
  /** 关联链接（替代已删除的「状态回读」）：空串 = 没填。 */
  link: string;
  /**
   * 最近一次「已联系」跟进决策的时刻（CR-19，naive UTC）。
   *
   * 只读派生字段：`GET /tracker/page` 按 `application_follow_up` 批查询补齐；
   * `null` = 没联系过（或走的是不带该字段的旧接口/旧数据）——界面此时不显示跟进标记。
   */
  latest_followup?: string | null;
}

/**
 * 提交时可写字段 = `Track` 去掉服务端生成的那些。
 *
 * `resume_id` / `external_resume_id` 是**可写**的关联（互斥，见 `Track.external_resume_id`），
 * 必须留在这个类型里；`resume_title` 是只读快照，必须留在上面的 `Omit` 里。
 * 判据：这个字段是「用户选的」还是「服务端算的」。
 */
export type TrackPayload = Omit<
  Track,
  "id" | "source" | "created_at" | "updated_at" | "resume_title"
>;

export interface TrackList {
  items: Track[];
  total: number;
  status_counts: Record<string, number>;
  active_count: number;
  offer_count: number;
  rejected_count: number;
  month_count: number;
}

/**
 * 漏斗/统计摘要（P1-2）：`GET /tracker/stats` 的响应，与 TrackList 同一套统计字段
 * 但**不含 items**——页面展示统计不再为拉漏斗而整表取回。
 */
export type TrackStats = Omit<TrackList, "items" | "total">;

/** 一条识别结果的合并预览：会新增、会更新，还是没变化。 */
export interface TrackMergePreview {
  record: TrackRecord;
  action: MergeAction;
  reason: string;
  current_status: string;
}

export interface TrackParseResult {
  items: TrackMergePreview[];
  parse_engine: "ai" | "local";
  notes: string[];
}

export interface TrackApplyResultItem {
  company: string;
  title: string;
  action: string;
  status: string;
  reason: string;
}

export interface TrackApplyResult {
  items: TrackApplyResultItem[];
  created: number;
  updated: number;
  unchanged: number;
}

export function emptyTrack(): TrackPayload {
  return {
    company: "",
    title: "",
    status: "applied",
    stage_note: "",
    applied_at: "",
    status_date: "",
    next_action: "",
    next_action_date: "",
    note: "",
    evidence: "",
    job_id: null,
    resume_id: null,
    external_resume_id: null,
    channel: "unknown",
    link: "",
  };
}

/**
 * 从一条完整记录里取出可提交的字段（去掉服务端生成的 id、时间戳与来源）。
 *
 * 显式列字段而不是"解构后丢掉几个"：后者漏掉新字段时不会报错，只会静默把用户的
 * 输入丢掉——那是最难发现的一类毛病。
 */
export function trackPayload(track: Track, patch: Partial<TrackPayload> = {}): TrackPayload {
  return {
    company: track.company,
    title: track.title,
    status: track.status,
    stage_note: track.stage_note,
    applied_at: track.applied_at,
    status_date: track.status_date,
    next_action: track.next_action,
    next_action_date: track.next_action_date,
    note: track.note,
    evidence: track.evidence,
    job_id: track.job_id,
    resume_id: track.resume_id,
    // 外部关联（T6）：漏这一行就是「保存后外部关联消失」——五处同批改的其中一处。
    external_resume_id: track.external_resume_id,
    channel: track.channel,
    link: track.link,
    ...patch,
  };
}
