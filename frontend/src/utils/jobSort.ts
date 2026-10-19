/**
 * 岗位排序（R14）：antd 列头 ↔ 后端 `sort` / `order` 参数的唯一映射。
 *
 * 后端把方向编进 sort 键（`created_desc` / `title_asc` …），`order` 只用于**覆盖**方向。
 * 所以每一列记住"自己的默认方向"：用户第一次点这一列 → 用默认方向，`order` 不必写进
 * URL；第二次点（反向）→ 才带上显式 `order`。链接因此保持干净，且刷新后能复原箭头。
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

const JOB_SORTS: readonly JobSort[] = ["created_desc", "updated_desc", "title_asc", "company_asc"];
const JOB_SORT_ORDERS: readonly JobSortOrder[] = ["asc", "desc"];

/** 可排序列（antd 列 key）→ 后端 sort 键 + 该列默认方向。三列与 fixlist 一致。 */
const JOB_SORT_COLUMNS = {
  title: { sort: "title_asc", direction: "asc" },
  company: { sort: "company_asc", direction: "asc" },
  // 「发布时间」列展示 posted_at（自由文本），后端没有这一列可排；它对应的是导入时间
  // created_at，列头 tooltip 会写明，避免"点了排序但看着没变"的误解。
  created_at: { sort: "created_desc", direction: "desc" },
} as const satisfies Record<string, { sort: JobSort; direction: JobSortOrder }>;

export type JobSortColumnKey = keyof typeof JOB_SORT_COLUMNS;

export function isJobSort(value: unknown): value is JobSort {
  return typeof value === "string" && (JOB_SORTS as readonly string[]).includes(value);
}

export function isJobSortOrder(value: unknown): value is JobSortOrder {
  return typeof value === "string" && (JOB_SORT_ORDERS as readonly string[]).includes(value);
}

/** 受控 `sortOrder`：只有当前 sort 命中的那一列显示箭头。 */
export function sortOrderFor(key: JobSortColumnKey, state: JobSortState): SortOrder {
  const column = JOB_SORT_COLUMNS[key];
  if (column.sort !== state.sort) return null;
  const direction = state.order ?? column.direction;
  return direction === "asc" ? "ascend" : "descend";
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
