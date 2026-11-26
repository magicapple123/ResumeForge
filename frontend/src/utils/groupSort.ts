// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心折叠视图的**组级**排序（2026-11-26，拍板方案"排序①本地组级、不写 URL"）。
 *
 * ## 为什么不复用 `utils/resumeSort`
 *
 * `resumeSort` 映射的是**简历级**服务端排序键（`updated_desc` / `title_asc`…），
 * 请求参数一变就重新拉数据。折叠视图的排序单位是**组**（一个岗位 = 一行），而服务端
 * 根本没有"按组"这个维度：按 `updated_desc` 拉回来再分组，组序是"组内最新那份的
 * 服务端名次"，按 `updated_asc` 拉回来则变成"组内最早那份"的名次——与列上显示的
 * 组内最新时间自相矛盾。所以组序只能在**已加载数据**上本地排。
 *
 * 于是两套状态并存：数据层仍按 `sortState` 拉（平铺表格的列头排序靠它），折叠视图
 * 再按 `groupSortState` 排一遍。两者互不覆盖，见 `pages/resumes/useResumesPageView.ts`。
 *
 * ## 已知上限
 *
 * 排序只在当前加载窗口（≤2000 条简历）内成立：窗口由服务端排序决定，走到窗口边缘时
 * 组序只是"这批数据里的名次"。该上限本来就存在（`useGroupedResumes` 的分页补齐），
 * 页面底部的截断 Alert 负责解释，这里不假装全局有序。
 *
 * ## 形状与 `utils/resumeSort` 对齐
 *
 * 三态列头（升 → 降 → 取消回默认）、默认态不显示箭头、「恢复默认排序」按钮的判据，
 * 四条行为与 `resumeSort` / `jobSort` 完全一致，只是把"字段"换成了组级语义。
 */
import type { SortOrder } from "antd/es/table/interface";

/** 组级排序字段：身份（岗位名/简历标题）、最近更新、投递次数。 */
export type GroupSortField = "identity" | "updated" | "delivery";

export type GroupSortOrder = "asc" | "desc";

export interface GroupSortState {
  field: GroupSortField;
  order: GroupSortOrder;
  /** 用户是否显式点过列头：false = 默认排序（列头不显示箭头）。 */
  explicit: boolean;
}

/**
 * 默认排序：最近更新倒序。
 *
 * 刻意与后端缺省排序（`updated_desc`）同向：默认态下本地组序 == 改造前的服务端组序，
 * 用户看不到"升级后顺序变了"的抖动（验收第 2 条）。
 */
export const DEFAULT_GROUP_SORT_STATE: GroupSortState = Object.freeze({
  field: "updated",
  order: "desc",
  explicit: false,
});

/** 组级排序只认这三列的 key（antd 的 `column.key`）。 */
const GROUP_SORT_COLUMNS = {
  identity: { field: "identity", defaultOrder: "asc" },
  updated: { field: "updated", defaultOrder: "desc" },
  delivery: { field: "delivery", defaultOrder: "desc" },
} as const satisfies Record<string, { field: GroupSortField; defaultOrder: GroupSortOrder }>;

export type GroupSortColumnKey = keyof typeof GROUP_SORT_COLUMNS;

/** 组件只需要这几个字段：结构化类型而不是 `ResumeGroup`，utils 不反向依赖 features。 */
export interface GroupSortable {
  key: string;
  jobTitle: string;
  deliveryCount: number;
  latestUpdatedAt: string | null;
  latest: { id: number; title: string };
}

function isGroupSortColumn(key: string): key is GroupSortColumnKey {
  return key in GROUP_SORT_COLUMNS;
}

/** 缺时间 / 非法时间统一回落 0：让它们在升序里排最前、降序里排最后，而不是随机。 */
function timestampOf(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * 同一等值组内的稳定次序：**最近更新倒序 → id 倒序**。
 *
 * 与 `resumeGroups.ts` 的版本内排序同口径。没有它的话，同一天更新的一批组在
 * 翻页 / 重取后会换位置（`Array.prototype.sort` 的稳定只保证"同一次排序不抖动"，
 * 不保证"换一批数据顺序不变"），而用户会把它读成"列表在乱跳"。
 */
function compareTieBreak(left: GroupSortable, right: GroupSortable): number {
  const byUpdated = timestampOf(right.latestUpdatedAt) - timestampOf(left.latestUpdatedAt);
  if (byUpdated !== 0) return byUpdated;
  return right.latest.id - left.latest.id;
}

/** 身份：岗位名优先，通用简历回落到标题；数字按数值比较（"版本 2" 排在 "版本 10" 前）。 */
function identityOf(group: GroupSortable): string {
  return group.jobTitle.trim() || group.latest.title;
}

function comparePrimary(left: GroupSortable, right: GroupSortable, field: GroupSortField): number {
  if (field === "identity") {
    return identityOf(left).localeCompare(identityOf(right), "zh-CN", {
      numeric: true,
      sensitivity: "base",
    });
  }
  if (field === "delivery") {
    return left.deliveryCount - right.deliveryCount;
  }
  return timestampOf(left.latestUpdatedAt) - timestampOf(right.latestUpdatedAt);
}

/**
 * 对组排序（不改入参，返回新数组）。
 *
 * 主键按 `state.order` 取正负，等值时统一走 `compareTieBreak`——**方向只作用于主键**，
 * tie-breaker 恒为"最近更新倒序"，这样"投递次数都相同的一批组"在升降序之间切换时
 * 内部次序仍然可预期（不会整片倒过来）。
 */
export function sortGroups<T extends GroupSortable>(
  groups: readonly T[],
  state: GroupSortState,
): T[] {
  const direction = state.order === "asc" ? 1 : -1;
  return [...groups].sort((left, right) => {
    const primary = comparePrimary(left, right, state.field);
    if (primary !== 0) return primary * direction;
    return compareTieBreak(left, right);
  });
}

/** 该列的点击方向序列：默认升序的列正着给，默认降序的反着给（antd 的第一次点击才是真方向）。 */
export function groupSortDirections(columnKey: string): SortOrder[] {
  const direction = isGroupSortColumn(columnKey)
    ? GROUP_SORT_COLUMNS[columnKey].defaultOrder
    : "asc";
  return direction === "asc" ? ["ascend", "descend"] : ["descend", "ascend"];
}

/** 受控 `sortOrder`：默认态一律 `null`（列头不显示箭头）。 */
export function groupSortOrderFor(columnKey: string, state: GroupSortState): SortOrder {
  if (!state.explicit || !isGroupSortColumn(columnKey)) return null;
  if (GROUP_SORT_COLUMNS[columnKey].field !== state.field) return null;
  return state.order === "asc" ? "ascend" : "descend";
}

/** antd 的排序结果 → 组级排序状态。点第三次（`order` 为空）回到默认排序。 */
export function nextGroupSortState(
  columnKey: string,
  order: SortOrder | null | undefined,
): GroupSortState {
  if (!isGroupSortColumn(columnKey) || !order) return DEFAULT_GROUP_SORT_STATE;
  const { field } = GROUP_SORT_COLUMNS[columnKey];
  return { field, order: order === "ascend" ? "asc" : "desc", explicit: true };
}

/** 是否处于默认排序（「恢复默认排序」按钮据此**不渲染**）。 */
export function isDefaultGroupSort(state: GroupSortState): boolean {
  return !state.explicit;
}
