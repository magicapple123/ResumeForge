// SPDX-License-Identifier: Apache-2.0
/**
 * 资料表单的「已保存基线」：编辑态下判断某个字段**有没有被改过**。
 *
 * 为什么需要它：编辑态里改过的字段和没改过的字段在视觉上一模一样，用户看不出"我到底改了
 * 哪些、保存会提交什么"。判据不能靠"输入框有没有被聚焦过"（点一下就脏），也不能靠
 * antd 的 `initialValues`（Form.List 增删行后会跟着漂），只能是"当前值 vs 最近一次从
 * 服务端读到的值"——和保存时 `collectEntryChanges` 用的是同一条口径。
 *
 * 用 context 而不是逐层传 prop：字段输入组件在 13 个分区的三层嵌套里，只为读一个只读的
 * 查找函数给它开 3 个 prop 不划算；provider 只出现在资料页的根上。
 */
import { createContext, useContext } from "react";
import type { WorkspaceOut } from "../profile-library/types";

/** `entry_id` → 该条目已保存的字段值（`field_id` → 原值）。查不到返回 null（新条目）。 */
export type ProfileBaselineLookup = (entryKey: unknown) => Record<string, unknown> | null;

export const ProfileBaselineContext = createContext<ProfileBaselineLookup | null>(null);

export function useProfileBaselineLookup(): ProfileBaselineLookup | null {
  return useContext(ProfileBaselineContext);
}

/**
 * 从工作区快照建一个查找函数。**每次 workspace 变化都要重建**（保存成功后基线要跟着走，
 * 否则刚保存完的字段仍然显示"已修改"）。
 */
export function buildProfileBaseline(workspace: WorkspaceOut | null): ProfileBaselineLookup {
  const byEntryId = new Map<string, Record<string, unknown>>();
  workspace?.entries.forEach((entry) => {
    if (typeof entry.entry_id === "string") byEntryId.set(entry.entry_id, entry.values ?? {});
  });
  return (entryKey) => (typeof entryKey === "string" ? (byEntryId.get(entryKey) ?? null) : null);
}
