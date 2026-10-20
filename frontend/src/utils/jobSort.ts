/**
 * 岗位排序（R14/E）：antd 列头 ↔ 后端 `sort` / `order` 参数的唯一映射。
 *
 * 后端把方向编进 sort 键（`created_desc` / `title_asc` / `posted_desc` …），`order`
 * 只用于**覆盖**方向。所以每一列记住"自己的默认方向"：用户第一次点这一列 → 用默认
 * 方向，第二次点（反向）→ 才带上显式 `order`。
 *
 * 排序状态**不再写进 URL**（E）：它属于"这次浏览的临时视角"，离开岗位广场即恢复
 * 默认（最近导入在前）。这样从简历中心回来不会莫名停在上次的排序上，链接也不会
 * 把"默认值"当成用户选择显式写出来。
 */
import type { SortOrder } from "antd/es/table/interface";
import type { JobSort, JobSortOrder } from "../api/jobs";

export interface JobSortState {
  sort: JobSort;
  /** `null` = 用该 sort 键自带的方向（后端语义）。 */
  order: JobSortOrder | null;
}

export const DEFAULT_JOB_SORT: JobSort = "created_desc";
export const DEFAULT_JOB_SORT_STATE: JobSortState = { sort: DEFAULT_JOB_SORT, order: null };

/** 可排序列（antd 列 key）→ 后端 sort 键 + 该列默认方向。三列与 fixlist 一致。 */
const JOB_SORT_COLUMNS = {
  title: { sort: "title_asc", direction: "asc" },
  company: { sort: "company_asc", direction: "asc" },
  // 「发布时间」列展示 posted_at，后端 `posted_desc` 按 date(posted_at) 排序、
  // 解析不出日期时回落到导入日期（见 job_sorting.py）——列名与排序口径一致。
  posted_at: { sort: "posted_desc", direction: "desc" },
} as const satisfies Record<string, { sort: JobSort; direction: JobSortOrder }>;

export type JobSortColumnKey = keyof typeof JOB_SORT_COLUMNS;

/**
 * 受控 `sortOrder`：只有当前 sort 命中的那一列显示箭头。
 *
 * 默认态（最近导入倒序）**一律返回 null**：它是列表接口不带参数时的行为，不是用户
 * 显式选择。给它加箭头会让「发布时间」列永远带灰底（antd 对有序列表头的样式），
 * 看起来像"一进页面就按发布时间排"，与「恢复默认排序」按钮的禁用态也自相矛盾。
 */
export function sortOrderFor(key: JobSortColumnKey, state: JobSortState): SortOrder {
  if (state.sort === DEFAULT_JOB_SORT_STATE.sort && state.order === null) return null;
  const column = JOB_SORT_COLUMNS[key];
  if (column.sort !== state.sort) return null;
  const direction = state.order ?? column.direction;
  return direction === "asc" ? "ascend" : "descend";
}

/** 是否处于默认排序（「恢复默认排序」按钮据此禁用）。 */
export function isDefaultJobSort(state: JobSortState): boolean {
  return state.sort === DEFAULT_JOB_SORT_STATE.sort && state.order === null;
}

/**
 * antd 的排序结果 → 后端参数。
 *
 * 点到不支持的列、或点第三次取消排序（`order` 为空）都回到默认排序（最近导入倒序），
 * 这也是列表接口在拿不到参数时的行为——两边不能各说一套。
 */
export function nextSortState(
  columnKey: string,
  order: SortOrder | null | undefined,
): JobSortState {
  if (!(columnKey in JOB_SORT_COLUMNS) || !order) return DEFAULT_JOB_SORT_STATE;
  const column = JOB_SORT_COLUMNS[columnKey as JobSortColumnKey];
  const direction: JobSortOrder = order === "ascend" ? "asc" : "desc";
  return { sort: column.sort, order: direction === column.direction ? null : direction };
}
