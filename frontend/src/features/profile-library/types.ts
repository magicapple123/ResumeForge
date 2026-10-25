// SPDX-License-Identifier: Apache-2.0
/**
 * 资料库（编辑 DTO）与写入请求契约（F6）。
 *
 * 与 backend/app/schemas/profile_workspace.py 逐字段对齐。**这是编辑 DTO**：含 hidden /
 * collapsed_override，只给资料页录入用；生成/填充消费 DTO 在 F4 的 projection 类型里，
 * 两者不得混用（消费侧类型没有 collapsed）。
 *
 * 表单模型（ProfileFormValues）用「分区 → 条目数组」而不是固定字段：字段定义可增删，
 * 条目值键是稳定 field_id；条目数组的顺序就是界面顺序（保存时按它决定 reorder）。
 */
import type { GroupBriefOut, PendingNotice } from "../profile-groups/types";

export type ProfileFieldType = "single_line" | "multi_line" | "date_text" | "photo";
export type CustomFieldType = Exclude<ProfileFieldType, "photo">;
export type ProfileSectionForm = "singleton" | "multi";

/** 字段定义 + 该用户的 hidden / collapsed_override 偏好。 */
export interface FieldOut {
  field_id: string;
  section_key: string;
  key: string;
  label: string;
  field_type: ProfileFieldType;
  order: number;
  default_collapsed: boolean;
  enum_suggestions: string[];
  is_builtin: boolean;
  private: boolean;
  llm_allowed: boolean;
  webform_allowed: boolean;
  hidden: boolean;
  collapsed_override: boolean | null;
  preference_revision: number;
  revision: number;
}

/** 一个大字段的编辑视图；fields 顺序即界面顺序（默认字段在前、自建字段在后）。 */
export interface SectionOut {
  key: string;
  name: string;
  form: ProfileSectionForm;
  is_builtin: boolean;
  carrier_field_id: string | null;
  material_only: boolean;
  provenance: string[];
  fields: FieldOut[];
  revision: number;
  deleted_at?: string | null;
}

export interface EntryOut {
  entry_id: string;
  section_key: string;
  sort_order: number;
  values: Record<string, string>;
  revision: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LimitsOut {
  max_entries_per_section: number;
  max_custom_fields_per_section: number;
  max_groups: number;
  single_line_chars: number;
  multi_line_chars: number;
}

export interface WorkspaceUpgradeOut {
  has_legacy_data: boolean;
  new_profile_has_entries: boolean;
}

/** GET /api/profile/workspace：一次拿全编辑所需数据（服务端解析顺序/组）。 */
export interface WorkspaceOut {
  sections: SectionOut[];
  section_order: string[];
  current_group: GroupBriefOut | null;
  groups: GroupBriefOut[];
  entries: EntryOut[];
  workspace_revision: number;
  pending_notice: PendingNotice | null;
  upgrade: WorkspaceUpgradeOut;
  limits: LimitsOut;
}

/* ===== 写入请求/响应 ===== */

export interface BulkEntryItem {
  section_key: string;
  entry_id?: string | null;
  values: Record<string, string>;
  expected_revision?: number | null;
}

export interface BulkEntriesResult {
  entries: EntryOut[];
  workspace_revision: number;
}

export interface SectionDeletionImpactOut {
  entry_count: number;
  filled_entry_count: number;
  can_delete: boolean;
  restore_path: string;
  revision: number;
}

export interface FieldDeletionImpactOut {
  affected_entries: number;
  can_delete: boolean;
  restore_path: string;
  revision: number;
}

export interface FieldPreferencePatch {
  section_key: string;
  hidden?: boolean;
  /** 三态：undefined=不改；null=恢复跟随代码默认；true/false=显式展开/收起。 */
  collapsed_override?: boolean | null;
  expected_revision?: number;
}

/* ===== F4 消费投影（PaperProjectionOut，与 backend/app/schemas/profile_projection.py 对齐；无 collapsed） ===== */

export interface ProjectionScopeOut {
  group_id: string;
  group_name: string;
  is_default: boolean;
  participating_keys: string[];
  section_order: string[];
  workspace_revision: number;
}

export interface ProjectionCandidateOut {
  section_key: string;
  section_name: string;
  entry_id: string;
  title: string;
  subtitle: string;
  /** 该候选在 projection.content 里的位置（如 projects/2），"追加这一条"据此取现成条目。 */
  paper_content_path: string;
}

export interface ProjectionSourceSectionOut {
  section_key: string;
  section_name: string;
  form: ProfileSectionForm;
  entry_count: number;
  material_only: boolean;
}

export interface ProjectionWarningOut {
  code: string;
  section_key: string;
  entry_id: string;
  message: string;
}

export interface PaperProjectionOut {
  scope: ProjectionScopeOut;
  content: import("../../types/resumeContent").ResumeContent;
  candidates: ProjectionCandidateOut[];
  source_layout: ProjectionSourceSectionOut[];
  warnings: ProjectionWarningOut[];
  snapshot_token: string;
}

/* ===== 表单模型 ===== */

/** 一个条目的表单草稿；entry_key 是 entry_id，或新建条目的临时键 new:<n>。 */
export interface ProfileEntryDraft {
  entry_key: string;
  values: Record<string, string>;
}

export type ProfileFormSections = Record<string, ProfileEntryDraft[]>;

export interface ProfileFormValues {
  sections: ProfileFormSections;
}
