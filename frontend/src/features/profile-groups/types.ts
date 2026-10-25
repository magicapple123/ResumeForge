// SPDX-License-Identifier: Apache-2.0
/**
 * 组与当前组的只读契约（F6）。
 *
 * 与 backend/app/schemas/profile_groups.py 逐字段对齐：participating_keys 永远是服务端按
 * 全局 section_order 解析后的有序清单（basic_info 恒首位），前端不再自行排序或补 key。
 * 写请求一律带 expected_revision；冲突由 API 层映射成 409 + revision，页面提示"刷新比较"
 * 而不是盲目重试。
 */

/** 组的只读摘要：资料页标题区、生成面板只读摘要共用。 */
export interface GroupBriefOut {
  group_id: string;
  name: string;
  is_default: boolean;
  revision: number;
  participating_keys: string[];
  member_count: number;
}

/** 组列表用的完整形状（多出创建/更新时间）。 */
export interface GroupOut extends GroupBriefOut {
  created_at?: string | null;
  updated_at?: string | null;
}

export interface GroupListOut {
  items: GroupOut[];
  current_group_id: string | null;
  default_group_id: string | null;
  workspace_revision: number;
}

export interface GroupDeleteResult {
  deleted_group_id: string;
  switched_to: string | null;
  notice_id: string | null;
  current_group: GroupBriefOut | null;
}

/** 当前组降级告知（R-25）：只在真的有事件时下发。 */
export interface PendingNotice {
  notice_id: string;
  kind: string;
  group_id?: string | null;
  group_name?: string | null;
  message?: string | null;
}

/** 只涉及工作区状态本身的响应（切组 / 写顺序 / 降级告知）。 */
export interface WorkspaceStateOut {
  section_order: string[];
  current_group_id: string;
  default_group_id: string;
  workspace_revision: number;
  pending_notice: PendingNotice | null;
}
