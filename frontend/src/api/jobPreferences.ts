// SPDX-License-Identifier: Apache-2.0
/**
 * 求职偏好档（T14）接口：列表 / 直接编辑 / 删除 / 撤销到上一版 / 提案的「只在这次对话」。
 *
 * 契约见 D:/rf_verify/contracts/preference.md。三条边界：
 * - `kind` / `value_kind` / `source` / `state` 都是**协议值**，永不翻译；展示名走
 *   `jobPreference` 语言包；
 * - 列表只返回 active 且未删除的行（superseded / 回收站永不出现），顺序由后端按
 *   inject_priority 给；
 * - 409 的稳定码在 `ApiError.businessCode`（`not_current` / `no_previous`），
 *   调用方据此给"刷新后再试 / 没有上一版可撤销"的提示，而不是只显示中文 detail。
 */
import { request } from "./client";

/** 13 类闭集（与后端 job_preference_catalog.py 的 kind 逐字一致）。 */
export type JobPreferenceKind =
  | "target_role_family"
  | "target_city"
  | "exclude_company"
  | "exclude_industry"
  | "salary_floor"
  | "work_mode"
  | "employment_type"
  | "overtime"
  | "redline_banned_word"
  | "redline_length"
  | "redline_tone"
  | "available_from"
  | "session_note";

/** 值形态：list 存数组，scalar 存小对象或协议串。 */
export type JobPreferenceValueKind = "list" | "scalar";
/** 来源闭集（不含 assistant）。 */
export type JobPreferenceSource = "user_stated" | "user_edited" | "imported";
/** 版本状态（deleted_at 只表示用户删除，不在这里）。 */
export type JobPreferenceState = "active" | "superseded" | "undone";

export interface JobPreference {
  pref_id: string;
  kind: JobPreferenceKind;
  /** 后端目录里的中文名（注入块/日志用）；界面展示名走自己的语言包。 */
  label: string;
  value_kind: JobPreferenceValueKind;
  /** list → string[]；scalar → 枚举串 / 文本 / {amount,unit,currency} / {max_pages}。 */
  value: unknown;
  source: JobPreferenceSource;
  source_proposal_id: string | null;
  note: string;
  state: JobPreferenceState;
  /** 同 kind 是否有可撤销的上一版。 */
  has_previous: boolean;
  created_at: string;
  updated_at: string;
}

export interface JobPreferenceCatalogOption {
  value: string;
  label: string;
}

/** 目录项：kind 下拉与枚举选项由后端给，前端只做双语展示名。 */
export interface JobPreferenceCatalogItem {
  kind: JobPreferenceKind;
  value_kind: JobPreferenceValueKind;
  label: string;
  inject_priority: number;
  options: JobPreferenceCatalogOption[];
}

export interface JobPreferenceList {
  items: JobPreference[];
  catalog: JobPreferenceCatalogItem[];
}

export interface JobPreferenceInput {
  kind: JobPreferenceKind;
  value: unknown;
  note?: string;
}

export interface JobPreferenceUpdateInput {
  value: unknown;
  note?: string;
}

export interface JobPreferenceDeleteResponse {
  pref_id: string;
  deleted: boolean;
  /**
   * 回收站恢复需要的 DB 行 id（可选：后端契约若补齐才给）。
   * 有它才能发"删除后 5 秒撤销"；没有时退化成「可在回收站恢复」的提示。
   */
  id?: number;
}

/** 「只在这次对话」响应：提案被置 executed，并落一行 session_note。 */
export interface JobPreferenceSessionResponse {
  pref: JobPreference;
  proposal_id: string;
  proposal_status: string;
  summary: string;
}

/** 会走"两个按钮"确认卡的写工具（其余工具卡片保持不变）。 */
export const JOB_PREFERENCE_PROPOSAL_TOOLS = [
  "create_job_preference",
  "update_job_preference",
] as const;

/** 这个工具名是不是偏好写入提案（决定确认卡显示哪两个按钮）。 */
export function isJobPreferenceProposalTool(toolName: string): boolean {
  return (JOB_PREFERENCE_PROPOSAL_TOOLS as readonly string[]).includes(toolName);
}

/** 当前数据集全部 active 偏好 + 13 类目录（一次请求拿全）。 */
export function getJobPreferences(): Promise<JobPreferenceList> {
  return request("/job-preferences");
}

/** 新增一条偏好（source=user_edited；同 kind 旧 active → superseded）。 */
export function createJobPreference(input: JobPreferenceInput): Promise<JobPreference> {
  return request("/job-preferences", { method: "POST", body: JSON.stringify(input) });
}

/** 编辑一条偏好（新值替换旧版本；同值 no-op）。 */
export function updateJobPreference(
  prefId: string,
  input: JobPreferenceUpdateInput,
): Promise<JobPreference> {
  return request(`/job-preferences/${encodeURIComponent(prefId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** 删除一条偏好（软删进回收站；恢复走 /api/trash）。 */
export function deleteJobPreference(prefId: string): Promise<JobPreferenceDeleteResponse> {
  return request(`/job-preferences/${encodeURIComponent(prefId)}`, { method: "DELETE" });
}

/**
 * 撤销到上一版（当前 active → undone，最近一条 superseded → active）。
 *
 * 409 稳定码：`not_current`（pref_id 已不是当前活动行）/ `no_previous`（没有上一版）。
 */
export function undoJobPreference(prefId: string): Promise<JobPreference> {
  return request(`/job-preferences/${encodeURIComponent(prefId)}/undo`, { method: "POST" });
}

/**
 * 「只在这次对话」= 把待确认的偏好提案转成一行 session_note。
 *
 * 只接受 pending 且 tool_name ∈ {create_job_preference, update_job_preference}；
 * 后端把提案置 executed（summary 说明"仅本次对话"）。session_note 永不进系统提示注入块。
 */
export function saveJobPreferenceForSession(
  proposalId: string,
): Promise<JobPreferenceSessionResponse> {
  return request(`/job-preferences/proposals/${encodeURIComponent(proposalId)}/session`, {
    method: "POST",
  });
}
