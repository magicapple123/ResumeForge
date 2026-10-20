/**
 * 简历排序（T2）：antd 列头 ↔ 后端 `sort` 复合键的唯一映射。
 *
 * 与岗位广场（`utils/jobSort.ts`）同一套交互：点列头升序 → 再点降序 → 第三次取消回默认，
 * 筛选栏右侧有「恢复默认排序」按钮。差别只有两处：
 * 1. 后端把方向写进键名本身（`title_asc` / `title_desc`…），没有 `order` 覆盖参数，
 *    所以这里不需要"方向是否等于默认方向"的归一化；
 * 2. 多一个 `explicit` 字段。默认排序「最近修改倒序」本身就是可排序列，若照抄岗位侧
 *    "方向等于默认就归零"的写法，用户第一次点「最近修改」会看不出任何反馈；`explicit`
 *    记录"用户点过"，第一次点击至少能出现箭头。
 *
 * 排序写回 URL（`?sort=title_desc`）：简历列表一直支持分享/刷新保留排序，这是与岗位
 * 广场**刻意保留**的差异，不是漏改。
 */
import type { SortOrder } from "antd/es/table/interface";
import type { ResumeSort, ResumeSortOrder } from "../types";

export type ResumeSortField = "title" | "job_title" | "created" | "updated";

export interface ResumeSortState {
  field: ResumeSortField;
  order: ResumeSortOrder;
  /** 用户是否显式点过列头：false = 默认排序（列头不显示箭头）。 */
  explicit: boolean;
}

/** 默认排序：最近修改在前（与后端 `sort` 的缺省值一致）。 */
export const DEFAULT_RESUME_SORT_STATE: ResumeSortState = Object.freeze({
  field: "updated",
  order: "desc",
  explicit: false,
});

/** 可排序列（antd 列 key）→ 排序字段 + 该列默认方向。 */
const RESUME_SORT_COLUMNS = {
  title: { field: "title", defaultOrder: "asc" },
  job: { field: "job_title", defaultOrder: "asc" },
  created_at: { field: "created", defaultOrder: "desc" },
  updated_at: { field: "updated", defaultOrder: "desc" },
} as const satisfies Record<string, { field: ResumeSortField; defaultOrder: ResumeSortOrder }>;

export type ResumeSortColumnKey = keyof typeof RESUME_SORT_COLUMNS;

/** 前端认可的 8 个复合键（4 个字段 × 升降序）。 */
const KNOWN_COMPOUND_KEYS: readonly ResumeSort[] = [
  "updated_asc",
  "updated_desc",
  "created_asc",
  "created_desc",
  "title_asc",
  "title_desc",
  "job_title_asc",
  "job_title_desc",
];

function isSortColumn(key: string): key is ResumeSortColumnKey {
  return key in RESUME_SORT_COLUMNS;
}

/**
 * 受控 `sortOrder`：只有"用户点过的、且命中的"那一列显示箭头。
 *
 * 默认态一律返回 `null`：默认排序是接口不带参数时的行为，不是用户的选择；给它加箭头
 * 会让列表头永远带高亮，与「恢复默认排序」按钮的禁用态自相矛盾。
 */
export function sortOrderFor(columnKey: string, state: ResumeSortState): SortOrder {
  if (!state.explicit || !isSortColumn(columnKey)) return null;
  if (RESUME_SORT_COLUMNS[columnKey].field !== state.field) return null;
  return state.order === "asc" ? "ascend" : "descend";
}

/**
 * 该列的点击方向序列。
 *
 * 默认升序的列用 antd 的 `["ascend","descend"]`；默认降序的列必须反过来，否则第一次
 * 点击会被 antd 当成"取消排序"，而取消又回落到默认降序——用户看到的是"点了没反应"。
 */
export function sortDirectionsFor(columnKey: string): SortOrder[] {
  const direction = isSortColumn(columnKey) ? RESUME_SORT_COLUMNS[columnKey].defaultOrder : "asc";
  return direction === "asc" ? ["ascend", "descend"] : ["descend", "ascend"];
}

/** antd 的排序结果 → 页面状态。点第三次（`order` 为空）回到默认排序。 */
export function nextSortState(
  columnKey: string,
  order: SortOrder | null | undefined,
): ResumeSortState {
  if (!isSortColumn(columnKey) || !order) return DEFAULT_RESUME_SORT_STATE;
  const { field } = RESUME_SORT_COLUMNS[columnKey];
  return { field, order: order === "ascend" ? "asc" : "desc", explicit: true };
}

/** 页面状态 → 后端 `sort` 参数。 */
export function toResumeSort(state: ResumeSortState): ResumeSort {
  return `${state.field}_${state.order}` as ResumeSort;
}

/**
 * 后端 `sort`（或 URL 里的 `?sort=`）→ 页面状态。
 *
 * **只接受前端这 8 个复合键**：`null`、空串、未知值（含旧下拉框留下的 `company_asc`）
 * 一律回落默认。以前是 `as ResumeSort` 硬转，`?sort=xxx` 会被原样发给后端换回 422。
 *
 * 拆分用**最后一个下划线**：`job_title_desc` 里字段名本身带下划线，`split("_")` 会把
 * 它切成三段、把字段解析成 `job`。
 */
export function parseResumeSort(raw: string | null | undefined): ResumeSortState {
  if (!raw || !KNOWN_COMPOUND_KEYS.includes(raw as ResumeSort)) {
    return DEFAULT_RESUME_SORT_STATE;
  }
  const separator = raw.lastIndexOf("_");
  const field = raw.slice(0, separator) as ResumeSortField;
  const order = raw.slice(separator + 1) as ResumeSortOrder;
  return { field, order, explicit: raw !== "updated_desc" };
}

/** 是否处于默认排序（「恢复默认排序」按钮据此禁用）。 */
export function isDefaultResumeSort(state: ResumeSortState): boolean {
  return !state.explicit;
}

/** 「恢复默认排序」按钮的 Tooltip 文案：说清"点了会发生什么"。 */
export function resumeSortResetHint(state: ResumeSortState): string {
  return isDefaultResumeSort(state)
    ? "当前已是默认排序：最近修改在前"
    : "恢复默认排序：最近修改在前";
}
