// SPDX-License-Identifier: Apache-2.0
/**
 * 资料库（编辑 DTO）与写入请求契约（F6）。
 *
 * 与 backend/app/schemas/profile_workspace.py 逐字段对齐。**这是编辑 DTO**：含 hidden，
 * 只给资料页录入用；生成/填充消费 DTO 在 F4 的 projection 类型里，两者不得混用
 * （消费侧类型没有 hidden/default_collapsed/collapsed_override）。
 *
 * 表单模型（ProfileFormValues）用「分区 → 条目数组」而不是固定字段：字段定义可增删，
 * 条目值键是稳定 field_id；条目数组的顺序就是界面顺序（保存时按它决定 reorder）。
 */
import type { GroupBriefOut, PendingNotice } from "../profile-groups/types";

export type ProfileFieldType = "single_line" | "multi_line" | "date_text" | "photo";
export type CustomFieldType = Exclude<ProfileFieldType, "photo">;
export type ProfileSectionForm = "singleton" | "multi";

/** 字段定义 + 该用户的 hidden 偏好。 */
export interface FieldOut {
  field_id: string;
  section_key: string;
  key: string;
  label: string;
  field_type: ProfileFieldType;
  order: number;
  /** 后端定义的默认折叠标记：DTO 兼容字段，界面已不再折叠字段，前端不读。 */
  default_collapsed: boolean;
  enum_suggestions: string[];
  is_builtin: boolean;
  private: boolean;
  llm_allowed: boolean;
  webform_allowed: boolean;
  hidden: boolean;
  /** 后端兼容字段：字段折叠已从界面移除（只保留隐藏/恢复），前端不读不写。 */
  collapsed_override: boolean | null;
  /**
   * 纸面默认位置（0069）：null = 按 field_type 自动；只有自建字段可写。
   * 位置枚举与 v2 文档模型一致（title/meta/lead/trail/body/hidden）。
   */
  default_placement?: string | null;
  /**
   * 有效位置（后端只读计算值）：自建字段 = 仅素材→hidden、显式值优先、否则按类型默认；
   * 内置字段为 null（由字段位置目录接口给）。前端显示徽标读它，不自行复制默认规则。
   */
  effective_placement?: string | null;
  /** 仅素材（0069）：只进 AI / 网申素材、不上纸面；只有自建字段可为 true。 */
  material_only?: boolean;
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
  /** 资料条目 id（**不是**纸面条目 id；资料数据的稳定身份，用于去重/禁用）。 */
  entry_id: string;
  title: string;
  subtitle: string;
  /**
   * v2 文档路径 `{section_key}.{v2_entry_id}`（自建板块同样 `{section}.{v2_entry_id}`）。
   * **第二段是纸面 v2 entry id，不等于 entry_id**；空串 = 该条目没进纸面（仅素材/空条目）。
   * 新代码优先用 `document_entry`，需要按路径定位时才用本字段。
   */
  document_path?: string;
  /**
   * 该候选在 `projection.content`（v2）里的**原样 entry JSON**，可直接拼进新简历条目；
   * null = 没有纸面条目。
   */
  document_entry?: import("../../types/resumeDocument").ResumeEntry | null;
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

/* ===== F10：编辑器视图（创建时冻结的板块/字段可见性） ===== */

/** 一个可见字段；`resume_attr` 是它在 ResumeContent 里的属性名（null = 无独立输入框）。 */
export interface EditorFieldOut {
  field_id: string;
  key: string;
  label: string;
  field_type: ProfileFieldType;
  resume_attr: string | null;
  /**
   * 自建板块的**主文本字段**标记（服务端按 `custom_section_text_field()` 打，与纸面投影
   * 同一判定）：它的值进 `ResumeCustomEntry.text`，其余字段按定义顺序进 `lines`。
   * 系统板块恒为 false；旧快照没有这个键（undefined）时按「第一个 multi_line 字段」兜底。
   */
  primary?: boolean;
}

/** 一个可见板块；`resume_field` 是正文数组字段名（标量分区为 null）。 */
export interface EditorSectionOut {
  section_key: string;
  section_name: string;
  form: ProfileSectionForm;
  resume_field: string | null;
  material_only: boolean;
  /**
   * 承载区（需求 #5）：没有独立槽位的字段（含用户自定义字段）在纸面上以「标签：值」行
   * 追加到的 ResumeContent 属性名（如 projects → "description"、educations →
   * "achievements"）。null = 该板块没有承载区（仅素材 / 自建板块 / 标量分区）。
   *
   * 编辑器据此给这些字段渲染输入框：值直接读写这个属性，与纸面投影同一口径；
   * 旧冻结快照没有这个键 → 不渲染（降级为旧行为）。
   */
  carrier_attr?: string | null;
  /** 承载区是字符串数组（education.achievements）还是标量（skills.level / publications.note）。 */
  carrier_list?: boolean;
  fields: EditorFieldOut[];
}

/** 服务端冻结的编辑器视图（只读、不含资料值；随投影与创建态快照下发）。 */
export interface EditorSchemaOut {
  sections: EditorSectionOut[];
  workspace_revision: number;
}

/** 编辑器页签的一个板块（key = 消费分区键，name = 当时的显示名，自建板块即用户起的名字）。 */
export interface EditorViewSection {
  key: string;
  name: string;
}

/**
 * 编辑器视图来源：板块清单必填；`schema` 缺省 = 字段不过滤（旧简历/旧快照）。
 *
 * 新简历取自当前方案投影；已保存简历取自创建时冻结的快照——方案后来再改也不影响它
 * （用户口径 2026-10-26：只影响此后新增的简历）。
 */
export interface EditorView {
  sections: EditorViewSection[];
  schema?: EditorSchemaOut;
}

export interface PaperProjectionOut {
  scope: ProjectionScopeOut;
  /**
   * **v2 文档**（`ResumeDocument`）：`GET /api/profile/current/projection` 自 v2 批次起在
   * 响应边界把 v1 中间态转成 v2（item 自带 `source`），新建简历/从资料填入只认它。
   * 消费方用 `projectionDocument()`
   * 做运行时判定，不要自行 cast。
   */
  content: import("../../types/resumeDocument").ResumeDocument;
  candidates: ProjectionCandidateOut[];
  source_layout: ProjectionSourceSectionOut[];
  warnings: ProjectionWarningOut[];
  snapshot_token: string;
  /** 当前方案的编辑器视图（隐藏字段不在 fields 里；自建板块带真实名字）。 */
  editor_schema?: EditorSchemaOut | null;
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
