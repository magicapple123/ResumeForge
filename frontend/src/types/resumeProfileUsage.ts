// SPDX-License-Identifier: Apache-2.0
/**
 * 简历「本次使用」追溯快照的类型（R-33）：对应后端
 * GET /api/resumes/{id}/profile-usage 的响应。
 *
 * 与 ResumeDetail 分开成文件的原因很实际：types/resume.ts 贴着 500 行预算，而这两个
 * 形状只服务详情里的一条只读元信息；放进主文件会把"简历正文契约"和"追溯元数据"混在一起。
 */
import type { EditorSchemaOut } from "../features/profile-library/types";

/** 快照里冻结的一个参与大字段（key 稳定、name 是当时的显示名）。 */
export interface ProfileUsageParticipating {
  key: string;
  name: string;
}

/** 一份简历保存/生成时冻结的"本次使用"元数据（只读，组改名/删除后历史仍可读）。 */
export interface ResumeProfileUsageSnapshot {
  /** 组名快照：组改名/删除后仍显示"当时用的组名"。 */
  group_name: string;
  /** 逻辑引用组 id；null = 快照未记录组身份。 */
  group_id: string | null;
  /** 按全局顺序排列的参与大字段。 */
  participating: ProfileUsageParticipating[];
  section_order: string[];
  definition_revision: number;
  data_revision: number;
  created_at: string;
  /** 快照里的组已不在活动组里（被删除/在回收站）。 */
  group_deleted: boolean;
  /** 创建时冻结的编辑器视图（F10）：方案后来再改，这份简历的板块/字段不跟着变。 */
  editor_schema?: EditorSchemaOut | null;
}

/** 快照之后的变化类别（后端枚举，前端只做提示，不据此改任何内容）。 */
export type ProfileUsageFreshnessReason =
  "content_changed" | "group_changed" | "definition_changed";

/** 快照之后资料/组定义是否变过：changed=true 时提示"需重新生成才体现"。 */
export interface ProfileUsageFreshness {
  changed: boolean;
  reasons: ProfileUsageFreshnessReason[];
}

/** GET /api/resumes/{id}/profile-usage 的响应体；无快照时 profile_usage=null。 */
export interface ResumeProfileUsage {
  profile_usage: ResumeProfileUsageSnapshot | null;
  freshness: ProfileUsageFreshness;
}
