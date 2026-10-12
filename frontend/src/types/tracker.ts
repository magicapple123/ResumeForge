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

export const TRACK_STATUS_LABELS: Record<TrackStatus, string> = {
  applied: "已投递",
  screening: "筛选中",
  assessment: "测评/笔试",
  interview: "面试",
  offer: "Offer",
  rejected: "已结束",
  unknown: "待确认",
};

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

export const TRACK_SOURCE_LABELS: Record<TrackSource, string> = {
  apply: "投递台自动记录",
  manual: "手动添加",
  recognized: "识别导入",
};

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

export const TRACK_CHANNEL_LABELS: Record<TrackChannel, string> = {
  unknown: "未知",
  referral: "内推",
  official_website: "官网",
  job_platform: "招聘平台",
  headhunter: "猎头/中介",
  other: "其他",
};

/** 合并结论：这次识别对这条记录做了什么。 */
export const MERGE_ACTIONS = ["created", "updated", "unchanged"] as const;
export type MergeAction = (typeof MERGE_ACTIONS)[number];

export const MERGE_ACTION_LABELS: Record<MergeAction, string> = {
  created: "新增记录",
  updated: "更新进度",
  unchanged: "已是最新，未改动",
};

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
  resume_id: number | null;
  /** 所用简历的标题快照（RF-17）：简历被删后仍可读；空 = 历史关联未知。 */
  resume_title: string;
  /** 投递渠道（RF-18）：用户自选，默认「未知」。 */
  channel: TrackChannel;
}

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
    channel: "unknown",
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
    channel: track.channel,
    ...patch,
  };
}
